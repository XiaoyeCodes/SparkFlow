"""Receive-only mapping of raw IB callbacks into the managed-order ledger.

No connection, submission, authorization or account-proof capability lives here.
Receipt callbacks run before ib_async fills defaults, suppresses duplicate fills
or discards commissions that have no in-memory Trade after a process restart.
"""
import hashlib
from decimal import Decimal
from uuid import uuid4

from .audit import append_event
from .broker_views import decimal_text
from .identity import ReadOrderEvidence
from .reconcile import BrokerEvent
from .risk import RiskDenied
from .session import AccountBinding


STATUSES = {'PendingSubmit': 'PENDING', 'ApiPending': 'PENDING', 'PreSubmitted': 'OPEN',
    'Submitted': 'OPEN', 'PendingCancel': 'CANCEL_PENDING', 'ApiCancelled': 'CANCELLED',
    'Cancelled': 'CANCELLED', 'Filled': 'FILLED', 'Inactive': 'INACTIVE'}


def amount(value):
    text = decimal_text(value)
    if text is None:
        raise RiskDenied('SDK_MISSING_NUMBER')
    return text


def key(kind, value):
    return f'sdk:{kind}:' + hashlib.sha256(value.encode()).hexdigest()


class ManagedOrderObserver:
    def __init__(self, reconciler, binding, *, channel_key, source, current_revision, clock):
        self.rec = reconciler
        self.binding = AccountBinding.model_validate(binding.model_dump())
        self.channel_key, self.source = channel_key, source
        self.current_revision, self.clock = current_revision, clock
        if (self.binding.accountKey, self.binding.mode) != (reconciler.account_key, reconciler.mode):
            raise RiskDenied('SDK_BINDING_SCOPE')
        if source not in ('ibkr', 'fixture') or source == 'fixture' and not reconciler.ledger.allow_fixtures:
            raise RiskDenied('SDK_SOURCE_SCOPE')

    def _session(self):
        if self.current_revision() != self.rec.revision:
            raise RiskDenied('SDK_SESSION_CHANGED')

    def _candidate(self, order_id, client_id):
        self._session()
        if client_id != self.binding.clientId:
            return None
        matches = [row for row in self.rec.ledger._records(self.rec.account_key, self.rec.mode)
            if (row.orderId, row.clientId) == (order_id, client_id)]
        if not matches:
            return None  # External TWS orders never gain management rights.
        if len(matches) != 1:
            raise RiskDenied('SDK_AMBIGUOUS_ORDER')
        row = matches[0]
        if not row.identity or row.identity.channelKey != self.channel_key:
            raise RiskDenied('SDK_CHANNEL_SCOPE')
        if (row.source == 'fixture') != (self.source == 'fixture'):
            raise RiskDenied('SDK_SOURCE_SCOPE')
        return row

    def _owned(self, order_id, client_id, perm_id):
        row = self._candidate(order_id, client_id)
        if row is not None and (row.permId is None or row.permId != perm_id):
            # Identity must first be confirmed by full openOrder/read evidence.
            raise RiskDenied('SDK_ORDER_IDENTITY_UNCONFIRMED')
        return row

    def open_order(self, order_id, contract, order, order_state):
        with self.rec.ledger._lock:
            if order.whatIf:
                return None
            row = self._candidate(order_id, order.clientId)
            if row is None:
                return None
            # Accept both Outside RTH values while reconciling legacy orders;
            # False only narrows the session and cannot widen an owned order.
            if (order.orderId != order_id or order.account != self.binding.brokerAccount
                or order.orderRef != row.identity.orderRef
                or order.parentId != 0 or order.ocaGroup or order.conditions):
                raise RiskDenied('SDK_OPEN_ORDER_SCOPE')
            if (contract.conId, contract.secType, contract.currency) != (row.intent.conId, 'STK', 'USD'):
                raise RiskDenied('SDK_CONTRACT_SCOPE')
            try:
                evidence = ReadOrderEvidence(channelKey=self.channel_key, source=self.source,
                    accountKey=self.rec.account_key, mode=self.rec.mode, sessionRevision=self.rec.revision,
                    clientId=order.clientId, orderId=order_id, orderRef=order.orderRef, permId=order.permId,
                    conId=contract.conId, side=order.action, quantity=amount(order.totalQuantity),
                    orderType=order.orderType, limitPrice=amount(order.lmtPrice) if order.orderType == 'LMT' else None,
                    tif=order.tif)
            except ValueError as error:
                raise RiskDenied('SDK_INVALID_EVIDENCE') from error
            # openOrder has no cumulative fill counters. Even a Filled state
            # cannot substitute for raw orderStatus + executions + account proof.
            if row.pendingAmendmentId:
                # A delayed echo of the old terms is not an amendment ACK.
                # Preserve the pending version and its worst-case reservation.
                try:
                    return self.rec.match_unknown(evidence)
                except RiskDenied as error:
                    if error.code != 'BROKER_ORDER_BODY_MISMATCH':
                        raise
                return self.rec.confirm_amendment(row.pendingAmendmentId, evidence)
            return self.rec.match_unknown(evidence)

    def _event(self, row, event_id, kind, **values):
        try:
            return BrokerEvent(eventId=event_id, kind=kind, accountKey=self.rec.account_key, mode=self.rec.mode,
                source=self.source, sessionRevision=self.rec.revision, orderId=row.orderId,
                clientId=row.clientId, permId=row.permId, observedAt=self.clock(), **values)
        except ValueError as error:
            raise RiskDenied('SDK_INVALID_EVIDENCE') from error

    def order_status(self, orderId, status, filled, remaining, permId, clientId):
        with self.rec.ledger._lock:
            row = self._owned(orderId, clientId, permId)
            if row is None:
                return None
            state = STATUSES.get(status)
            if state is None:
                raise RiskDenied('SDK_UNKNOWN_ORDER_STATUS')
            filled, remaining = amount(filled), amount(remaining)
            if state == 'OPEN' and Decimal(filled) > 0 and Decimal(remaining) > 0:
                state = 'PARTIALLY_FILLED'
            # Status has no broker event ID. Keep each receipt so a later OPEN
            # identical to an old OPEN cannot bypass a subsequent terminal state.
            return self.rec.apply(self._event(row, 'sdk:status:' + uuid4().hex, 'status',
                status=state, filled=filled, remaining=remaining))

    def _predecessor(self, exec_id):
        history = self.rec._executions(include_superseded=True)
        existing = next((event for event in history if event.execId == exec_id), None)
        if existing:
            return existing.replacesExecId  # replay preserves the original correction identity
        prefix, separator, version = exec_id.rpartition('.')
        if not separator or not version.isascii() or not version.isdigit():
            return None
        if int(version) < 1:
            raise RiskDenied('SDK_INVALID_EXECUTION_VERSION')
        related = [event for event in history if event.execId.rpartition('.')[0] == prefix]
        if int(version) == 1:
            if related:
                raise RiskDenied('SDK_EXECUTION_HISTORY_CONFLICT')
            return None
        candidates = [event for event in related if event.execId.rpartition('.')[2].isascii()
            and event.execId.rpartition('.')[2].isdigit()]
        if not candidates:
            raise RiskDenied('SDK_CORRECTION_PREDECESSOR_MISSING')
        latest = max(candidates, key=lambda event: int(event.execId.rpartition('.')[2]))
        if int(latest.execId.rpartition('.')[2]) >= int(version):
            raise RiskDenied('SDK_EXECUTION_HISTORY_CONFLICT')
        return latest.execId

    def execution(self, contract, execution):
        with self.rec.ledger._lock:
            row = self._owned(execution.orderId, execution.clientId, execution.permId)
            if row is None:
                return None
            if execution.acctNumber != self.binding.brokerAccount or execution.orderRef != row.identity.orderRef:
                raise RiskDenied('SDK_EXECUTION_SCOPE')
            if (contract.conId, contract.secType, contract.currency) != (row.intent.conId, 'STK', 'USD'):
                raise RiskDenied('SDK_CONTRACT_SCOPE')
            side = {'BOT': 'BUY', 'SLD': 'SELL'}.get(execution.side)
            if side != row.intent.side:
                raise RiskDenied('SDK_EXECUTION_SIDE')
            return self.rec.apply(self._event(row, key('fill', execution.execId), 'fill', execId=execution.execId,
                conId=contract.conId, side=side, quantity=amount(execution.shares), price=amount(execution.price),
                currency=contract.currency, executedAt=execution.time, replacesExecId=self._predecessor(execution.execId)))

    def commission(self, report):
        with self.rec.ledger._lock:
            self._session()
            fill = next((event for event in self.rec._executions(include_superseded=True) if event.execId == report.execId), None)
            if fill is None:
                # This callback carries no account/order identity. Do not bind
                # unknown fees to an order based on an SDK cache or symbol.
                return None
            row = self._owned(fill.orderId, fill.clientId, fill.permId)
            if report.currency != fill.currency:
                raise RiskDenied('SDK_COMMISSION_CURRENCY')
            fee = amount(report.commission)  # explicit negative rebates are valid
            return self.rec.apply(self._event(row, key('fee', f'{report.execId}|{fee}|{report.currency}'),
                'commission', execId=report.execId, commission=fee, currency=report.currency))

    def broker_error(self, request_id, code, *, request_active):
        self._session()
        if type(code) is not int or code <= 0:
            raise RiskDenied('SDK_INVALID_ERROR_CODE')
        if code in (1100, 1101, 1300, 2110):
            self.failed(f'IBKR_{code}')
            return None
        if request_active or request_id < 0:
            return None  # read request errors are not evidence about an order
        with self.rec.ledger.transaction():
            row = self._candidate(request_id, self.binding.clientId)
            if row is None:
                return None
            reason = f'IBKR_{code}'
            # An order error may reject a new order, reject an amendment while
            # the old order remains live, or race with a fill/cancellation.
            # It carries no fill counters: never fabricate a terminal status.
            changes = {'lastError': reason, 'reconciliationRequired': True}
            if row.submission == 'SUBMITTING':
                changes['submission'] = 'UNKNOWN'
            if row.cancelState in ('SUBMITTING', 'REQUESTED'):
                changes['cancelState'] = 'UNKNOWN'
            if row.amendmentState in ('SUBMITTING', 'SENT'):
                changes['amendmentState'] = 'UNKNOWN'
                self.rec.db.execute("UPDATE order_amendments SET state='UNKNOWN' WHERE mode=? AND account_key=? AND amendment_id=?",
                    (self.rec.mode, self.rec.account_key, row.pendingAmendmentId))
            row = self.rec._hold(row.model_copy(update=changes))
            self.rec.ledger._replace(row, 'SDK_ORDER_ERROR', code=reason)
            self._halt(reason)
            return row

    def _halt(self, reason):
        self.rec.db.execute('INSERT INTO order_integrity_halts VALUES(?,?,?) '
            'ON CONFLICT(mode,account_key) DO UPDATE SET reason=excluded.reason',
            (self.rec.mode, self.rec.account_key, reason))
        append_event(self.rec.db, self.rec.account_key, 'SDK_EVIDENCE_REJECTED',
            self.clock().isoformat(), {'code': reason})

    def failed(self, reason):
        # Called by the raw SDK wrapper: eventkit may swallow listener errors,
        # so invalid managed evidence must also durably stop new reservations.
        with self.rec.ledger.transaction():
            self._halt(reason)
