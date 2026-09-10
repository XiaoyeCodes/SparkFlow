"""Append-only broker evidence and deterministic managed-order reconciliation.

No write transport is accepted. A cancellation request cannot release money.
Account proofs require a stable event barrier, source times, cash and shares;
unexplained external cash/position changes pause reconciliation.
"""
import hashlib
import json
from decimal import Decimal, localcontext, ROUND_HALF_UP
from datetime import timezone
from typing import Literal

from pydantic import AwareDatetime, Field, model_validator

from .audit import append_event, read_events
from .risk import Amount, Identifier, RiskContext, RiskDenied, canonical
from .schemas import Contract, DecimalText
from .identity import ReadOrderEvidence


TERMINAL = {'CANCELLED', 'FILLED', 'REJECTED'}


class BrokerEvent(Contract):
    eventId: Identifier
    kind: Literal['status', 'fill', 'commission']
    accountKey: Identifier
    mode: Literal['paper', 'live', 'backtest']
    source: Literal['fixture', 'ibkr']
    sessionRevision: int = Field(gt=0, strict=True)
    orderId: int = Field(ge=0, strict=True)
    clientId: int = Field(gt=0, strict=True)
    permId: int = Field(gt=0, strict=True)
    observedAt: AwareDatetime
    status: Literal['PENDING', 'OPEN', 'PARTIALLY_FILLED', 'FILLED', 'CANCEL_PENDING', 'CANCELLED', 'REJECTED', 'INACTIVE'] | None = None
    filled: Amount | None = None
    remaining: Amount | None = None
    execId: Identifier | None = None
    conId: int | None = Field(default=None, gt=0, strict=True)
    side: Literal['BUY', 'SELL'] | None = None
    quantity: Amount | None = None
    price: Amount | None = None
    currency: str | None = None
    executedAt: AwareDatetime | None = None
    commission: DecimalText | None = Field(default=None, max_length=38)
    replacesExecId: Identifier | None = None

    @model_validator(mode='after')
    def required_evidence(self):
        required = {'status': ('status', 'filled', 'remaining'), 'fill': ('execId', 'conId', 'side', 'quantity', 'price', 'currency', 'executedAt'), 'commission': ('execId', 'commission', 'currency')}[self.kind]
        if any(getattr(self, key) is None for key in required):
            raise ValueError('incomplete broker event')
        if self.kind == 'fill' and Decimal(self.quantity) == 0 and not self.replacesExecId:
            raise ValueError('zero execution requires explicit correction/bust identity')
        return self


class AccountProof(Contract):
    accountKey: Identifier
    mode: Literal['paper', 'live', 'backtest']
    source: Literal['fixture', 'ibkr']
    sessionRevision: int = Field(gt=0, strict=True)
    snapshotId: Identifier
    watermark: int = Field(ge=0, strict=True)
    cashBalance: Amount
    currency: Literal['USD']
    positions: dict[int, Amount]
    cashObservedAt: AwareDatetime
    positionsObservedAt: AwareDatetime


def event_identity(event, *, execution=False):
    body = event.model_dump(mode='json', exclude={'eventId', 'observedAt', 'sessionRevision'})
    if event.executedAt is not None:
        body['executedAt'] = event.executedAt.astimezone(timezone.utc).isoformat()
    # Request/reconnect receipt times are not execution identity.
    if execution:
        body.pop('kind')
    return json.dumps(body, sort_keys=True, separators=(',', ':'))


class OrderReconciler:
    def __init__(self, ledger, account_key, mode, session_revision):
        self.ledger = ledger
        self.account_key, self.mode, self.revision = account_key, mode, session_revision

    @property
    def db(self):
        return self.ledger._db

    def _scope(self, item):
        if item.accountKey != self.account_key or item.mode != self.mode or item.sessionRevision != self.revision:
            raise RiskDenied('EVENT_SCOPE')
        if item.source == 'fixture' and not self.ledger.allow_fixtures:
            raise RiskDenied('FIXTURE_DISABLED')

    def _matched(self, event):
        matches = [row for row in self.ledger._records(self.account_key, self.mode)
            if (row.orderId, row.clientId, row.permId) == (event.orderId, event.clientId, event.permId)]
        if len(matches) != 1:
            raise RiskDenied('UNMATCHED_BROKER_ORDER')
        record = matches[0]
        if (record.source == 'fixture') != (event.source == 'fixture'):
            raise RiskDenied('EVENT_SOURCE')
        return record

    def _watermark(self):
        return self.db.execute('SELECT COALESCE(MAX(seq),0) FROM order_broker_events WHERE mode=? AND account_key=?', (self.mode, self.account_key)).fetchone()[0]

    def watermark(self):
        with self.ledger._lock:
            return self._watermark()

    def _executions(self, include_superseded=False):
        rows = self.db.execute('SELECT payload,replaces_exec_id FROM order_fills WHERE mode=? AND account_key=?', (self.mode, self.account_key)).fetchall()
        replaced = {row[1] for row in rows if row[1]}
        return [BrokerEvent.model_validate_json(payload) for payload, _ in rows if include_superseded or json.loads(payload)['execId'] not in replaced]

    def executions(self, include_superseded=False):
        with self.ledger._lock:
            return self._executions(include_superseded)

    def _fees(self):
        fees = {}
        for payload, in self.db.execute('SELECT payload FROM order_commissions WHERE mode=? AND account_key=? ORDER BY seq', (self.mode, self.account_key)):
            event = BrokerEvent.model_validate_json(payload)
            fees[event.execId] = event
        return fees

    def _reservation_price(self, record):
        if record.terms.limitPrice is not None:
            return Decimal(record.terms.limitPrice)
        if record.terms.orderType != 'MKT' or record.reservationPrice is None:
            raise RiskDenied('MISSING_MARKET_RESERVATION')
        observed = [Decimal(fill.price) for fill in self._executions()
            if (fill.permId, fill.clientId, fill.orderId) == (record.permId, record.clientId, record.orderId)]
        return max([Decimal(record.reservationPrice), *observed])

    def _full_hold(self, record):
        # Authorization expiry/revocation never prevents following existing risk.
        row = self.db.execute('SELECT payload FROM order_authorizations WHERE id=?', (record.terms.authorizationId,)).fetchone()
        fee = Decimal(json.loads(row[0])['limits']['feeReserve'])
        with localcontext() as arithmetic:
            arithmetic.prec = 80
            value = Decimal(record.terms.quantity) * self._reservation_price(record)
            return record.model_copy(update={'reservedCash': format((value if record.intent.side == 'BUY' else Decimal(0)) + fee, 'f'),
                'reservedNotional': format(value if record.intent.side == 'BUY' else Decimal(0), 'f'),
                'reservedQuantity': record.terms.quantity if record.intent.side == 'SELL' else '0', 'reconciliationRequired': True})

    def _hold(self, record):
        full = self._full_hold(record)
        # Callbacks may increase conservative holds, never lower them. A lower
        # amended price/size is released only by the account proof below.
        return full.model_copy(update={field: format(max(Decimal(getattr(record, field)), Decimal(getattr(full, field))), 'f')
            for field in ('reservedCash', 'reservedNotional', 'reservedQuantity')})

    def _fill_total(self, record):
        return sum((Decimal(event.quantity) for event in self._executions() if event.permId == record.permId and event.clientId == record.clientId and event.orderId == record.orderId), Decimal(0))

    def _execution_time_replay(self, old, event):
        """Repair the legacy UTC-as-local projection, retaining original evidence.

        Only an otherwise identical paper fill, replayed with a timestamp near
        the original live receipt, qualifies. Financial/ownership conflicts
        still halt. Recovery of a prior halt additionally needs an account proof.
        """
        if event.kind != 'fill' or event.source != 'ibkr' or event.mode != 'paper':
            return False
        prior = self.db.execute('SELECT payload FROM order_fills WHERE mode=? AND account_key=? AND exec_id=?',
            (self.mode, self.account_key, event.execId)).fetchone()
        if not prior:
            return False
        current = BrokerEvent.model_validate_json(prior[0])
        if event_identity(current) == event_identity(event):
            return True
        if event_identity(old.model_copy(update={'executedAt': event.executedAt})) != event_identity(event):
            return False
        delta = abs((event.executedAt - old.executedAt).total_seconds())
        if (not 900 <= delta <= 14 * 3600 or delta % 900 != 0
                or abs((old.observedAt - event.executedAt).total_seconds()) > 60
                or event.observedAt <= old.observedAt):
            return False
        read_events(self.db, self.account_key)
        self.db.execute('UPDATE order_fills SET payload=? WHERE mode=? AND account_key=? AND exec_id=?',
            (event.model_dump_json(), self.mode, self.account_key, event.execId))
        append_event(self.db, self.account_key, 'EXECUTION_TIME_NORMALIZED', event.observedAt.isoformat(),
            {'eventId': event.eventId, 'execId': event.execId, 'original': old.model_dump(mode='json'),
             'replayed': event.model_dump(mode='json')})
        return True

    def _recoverable_time_halt(self):
        events = read_events(self.db, self.account_key)
        for index in range(len(events) - 1, -1, -1):
            if events[index]['kind'] in ('EMPTY_SESSION_HALT_RECOVERED', 'EXECUTION_TIME_HALT_RECOVERED'):
                events = events[index + 1:]
                break
        repaired = {e['details']['eventId'] for e in events if e['kind'] == 'EXECUTION_TIME_NORMALIZED'}
        conflicts = [e for e in events if e['kind'] == 'BROKER_EVIDENCE_CONFLICT']
        rejected = [e for e in events if e['kind'] == 'SDK_EVIDENCE_REJECTED']
        return bool(conflicts) and all(e['details'].get('code') == 'CONFLICTING_EVENT_ID'
            and e['details'].get('eventId') in repaired for e in conflicts) and all(
            e['details'].get('code') == 'CONFLICTING_EVENT_ID' for e in rejected)

    def apply(self, event):
        event = BrokerEvent.model_validate(event.model_dump())
        self._scope(event)
        failure = None
        with self.ledger.transaction(), localcontext() as arithmetic:
            try:
                arithmetic.prec = 80
                record = self._matched(event)
                identity = event_identity(event)
                old = self.db.execute('SELECT payload FROM order_broker_events WHERE mode=? AND account_key=? AND event_id=?', (self.mode, self.account_key, event.eventId)).fetchone()
                if old:
                    original = BrokerEvent.model_validate_json(old[0])
                    if event_identity(original) != identity and not self._execution_time_replay(original, event):
                        raise RiskDenied('CONFLICTING_EVENT_ID')
                    return record
                if event.kind == 'fill':
                    if (event.conId, event.side, event.currency) != (record.intent.conId, record.intent.side, 'USD'):
                        raise RiskDenied('FILL_SCOPE')
                    prior = self.db.execute('SELECT payload FROM order_fills WHERE mode=? AND account_key=? AND exec_id=?', (self.mode, self.account_key, event.execId)).fetchone()
                    if prior:
                        if event_identity(BrokerEvent.model_validate_json(prior[0]), execution=True) != event_identity(event, execution=True):
                            raise RiskDenied('CONFLICTING_EXECUTION')
                        return record
                    if event.replacesExecId:
                        replaced = self.db.execute('SELECT intent_id FROM order_fills WHERE mode=? AND account_key=? AND exec_id=?', (self.mode, self.account_key, event.replacesExecId)).fetchone()
                        existing_child = self.db.execute('SELECT 1 FROM order_fills WHERE mode=? AND account_key=? AND replaces_exec_id=?', (self.mode, self.account_key, event.replacesExecId)).fetchone()
                        if not replaced or replaced[0] != record.intent.clientIntentId or existing_child:
                            raise RiskDenied('CONFLICTING_CORRECTION')
                    self.db.execute('INSERT INTO order_fills VALUES(?,?,?,?,?,?)', (self.mode, self.account_key, event.execId, record.intent.clientIntentId, event.model_dump_json(), event.replacesExecId))
                    record = record.model_copy(update={'filledQuantity': format(self._fill_total(record), 'f')})
                    if event.replacesExecId:
                        record = record.model_copy(update={'brokerFilled': None, 'brokerRemaining': None})
                    if record.execution not in TERMINAL and not record.cancelRequested:
                        record = record.model_copy(update={'execution': 'FILLED' if Decimal(record.filledQuantity) == Decimal(record.terms.quantity) else 'PARTIALLY_FILLED'})
                elif event.kind == 'commission':
                    fill = self.db.execute('SELECT intent_id FROM order_fills WHERE mode=? AND account_key=? AND exec_id=?', (self.mode, self.account_key, event.execId)).fetchone()
                    if not fill or fill[0] != record.intent.clientIntentId or event.currency != 'USD':
                        raise RiskDenied('COMMISSION_SCOPE')
                    self.db.execute('INSERT INTO order_commissions(mode,account_key,exec_id,payload) VALUES(?,?,?,?)', (self.mode, self.account_key, event.execId, event.model_dump_json()))
                else:
                    # Cumulative counters may arrive out of order. A lower
                    # quantity requires an explicit correction before acceptance.
                    stale = record.brokerFilled is not None and Decimal(event.filled) < Decimal(record.brokerFilled)
                    if record.execution in TERMINAL and event.status not in TERMINAL and not stale:
                        raise RiskDenied('CONFLICTING_TERMINAL_STATUS')
                    if stale:
                        append_event(self.db, self.account_key, 'STALE_STATUS_IGNORED', event.observedAt.isoformat(), {'eventId': event.eventId})
                        return record
                    record = record.model_copy(update={'execution': event.status, 'brokerFilled': event.filled, 'brokerRemaining': event.remaining})
                    if record.cancelRequested and event.status in ('CANCELLED', 'FILLED'):
                        record = record.model_copy(update={'cancelState': 'ACKNOWLEDGED' if event.status == 'CANCELLED' else 'TOO_LATE'})
                self.db.execute('INSERT INTO order_broker_events(mode,account_key,event_id,intent_id,payload,identity) VALUES(?,?,?,?,?,?)',
                    (self.mode, self.account_key, event.eventId, record.intent.clientIntentId, event.model_dump_json(), identity))
                record = self._hold(record)
                self.ledger._replace(record, 'BROKER_EVENT', eventId=event.eventId, eventKind=event.kind, eventHash=hashlib.sha256(identity.encode()).hexdigest())
                return record
            except RiskDenied as error:
                if not error.code.startswith('CONFLICTING_'):
                    raise
                # Every conflict check precedes mutation of broker evidence.
                # Persist the halt under the same write lock, then raise after
                # commit: no other reservation can slip between error and halt.
                self.db.execute('INSERT INTO order_integrity_halts VALUES(?,?,?) ON CONFLICT(mode,account_key) DO UPDATE SET reason=excluded.reason', (self.mode, self.account_key, error.code))
                append_event(self.db, self.account_key, 'BROKER_EVIDENCE_CONFLICT', self.ledger.clock().isoformat(), {'code': error.code, 'eventId': event.eventId})
                failure = error
        if failure:
            raise failure

    def request_cancel(self, intent_id, request_id):
        with self.ledger.transaction():
            record = self.ledger._get(self.account_key, self.mode, intent_id)
            if record is None or record.permId is None:
                raise RiskDenied('UNMATCHED_BROKER_ORDER')
            if record.execution in TERMINAL or record.cancelRequested:
                return record
            self.db.execute('INSERT INTO order_cancel_requests VALUES(?,?,?,?)', (self.mode, self.account_key, intent_id, request_id))
            record = record.model_copy(update={'execution': 'CANCEL_PENDING', 'cancelRequested': True, 'cancelState': 'PERSISTED'})
            self.ledger._replace(record, 'CANCEL_QUEUED', requestId=request_id)
            return record

    def match_unknown(self, evidence):
        evidence = ReadOrderEvidence.model_validate(evidence.model_dump())
        self._scope(evidence)
        with self.ledger.transaction():
            matches = [row for row in self.ledger._records(self.account_key, self.mode) if row.identity
                and (row.identity.channelKey, row.identity.orderRef, row.orderId, row.clientId) ==
                    (evidence.channelKey, evidence.orderRef, evidence.orderId, evidence.clientId)]
            if len(matches) != 1:
                raise RiskDenied('UNMATCHED_BROKER_ORDER')
            record = matches[0]
            intent = record.terms
            if (record.source == 'fixture') != (evidence.source == 'fixture'):
                raise RiskDenied('EVENT_SOURCE')
            if ((intent.conId, intent.side, intent.orderType, intent.tif) != (evidence.conId, evidence.side, evidence.orderType, evidence.tif)
                or Decimal(intent.quantity) != Decimal(evidence.quantity)):
                raise RiskDenied('BROKER_ORDER_BODY_MISMATCH')
            if (intent.limitPrice is None) != (evidence.limitPrice is None) or intent.limitPrice is not None and Decimal(intent.limitPrice) != Decimal(evidence.limitPrice):
                raise RiskDenied('BROKER_ORDER_BODY_MISMATCH')
            if record.permId is not None and record.permId != evidence.permId:
                raise RiskDenied('BROKER_OWNERSHIP_CONFLICT')
            if record.submission not in ('SUBMITTING', 'UNKNOWN', 'RECONCILING', 'ACKNOWLEDGED'):
                raise RiskDenied('ORDER_NOT_SUBMITTED')
            self.ledger._claim_ownership(record, evidence.permId)
            if record.submission == 'ACKNOWLEDGED' and record.permId == evidence.permId:
                return record
            record = self._hold(record.model_copy(update={'submission': 'ACKNOWLEDGED', 'permId': evidence.permId, 'lastError': None}))
            self.ledger._replace(record, 'UNKNOWN_MATCHED_BY_READ', evidenceHash=hashlib.sha256(canonical(evidence).encode()).hexdigest(), evidence=evidence.model_dump(mode='json'))
            return record

    def confirm_amendment(self, amendment_id, evidence):
        """Receive-only confirmation; does not require a command transport."""
        from .amendments import Amendment
        from .risk import OrderIntent
        evidence = ReadOrderEvidence.model_validate(evidence.model_dump())
        self._scope(evidence)
        with self.ledger.transaction():
            stored = self.db.execute('SELECT payload,candidate,state,intent_id FROM order_amendments '
                'WHERE account_key=? AND mode=? AND amendment_id=?',
                (self.account_key, self.mode, amendment_id)).fetchone()
            if not stored:
                raise RiskDenied('AMENDMENT_MISSING')
            request, candidate = Amendment.model_validate_json(stored[0]), OrderIntent.model_validate_json(stored[1])
            record = self.ledger._get(self.account_key, self.mode, request.clientIntentId)
            identity = record.identity
            if (identity is None or record.submission != 'ACKNOWLEDGED'
                or (evidence.channelKey, evidence.orderId, evidence.clientId, evidence.orderRef, evidence.permId) !=
                (identity.channelKey, identity.orderId, identity.clientId, identity.orderRef, record.permId)):
                raise RiskDenied('UNMATCHED_BROKER_ORDER')
            if (record.source == 'fixture') != (evidence.source == 'fixture'):
                raise RiskDenied('EVENT_SOURCE')
            if evidence.sessionRevision < identity.sessionRevision:
                raise RiskDenied('EVENT_SCOPE')
            if ((evidence.conId, evidence.side, evidence.orderType, evidence.tif) !=
                (candidate.conId, candidate.side, candidate.orderType, candidate.tif)
                or Decimal(evidence.quantity) != Decimal(candidate.quantity) or evidence.limitPrice is None
                or Decimal(evidence.limitPrice) != Decimal(candidate.limitPrice)):
                raise RiskDenied('AMENDMENT_BODY_MISMATCH')
            if stored[2] == 'ACKNOWLEDGED':
                return record
            if (stored[2] not in ('SUBMITTING', 'SENT', 'UNKNOWN') or record.orderVersion != request.expectedVersion
                or record.pendingAmendmentId != amendment_id):
                raise RiskDenied('ORDER_VERSION')
            if record.execution in TERMINAL:
                raise RiskDenied('AMENDMENT_ORDER_TERMINAL')
            self.db.execute("UPDATE order_amendments SET state='ACKNOWLEDGED' WHERE mode=? AND account_key=? AND amendment_id=?",
                (request.mode, request.accountKey, amendment_id))
            record = record.model_copy(update={'activeIntent': candidate, 'orderVersion': request.expectedVersion + 1,
                'pendingAmendmentId': None, 'amendmentState': 'ACKNOWLEDGED', 'reconciliationRequired': True,
                'brokerFilled': None, 'brokerRemaining': None, 'lastError': None})
            self.ledger._replace(record, 'AMENDMENT_ACKNOWLEDGED', amendmentId=amendment_id,
                evidenceHash=hashlib.sha256(canonical(evidence).encode()).hexdigest(), evidence=evidence.model_dump(mode='json'),
                version=record.orderVersion)
            return record

    def reconcile(self, proof):
        proof = AccountProof.model_validate(proof.model_dump())
        self._scope(proof)
        with self.ledger.transaction(), localcontext() as arithmetic:
            arithmetic.prec = 80
            if proof.watermark != self._watermark():
                raise RiskDenied('EVENT_BARRIER_CHANGED')
            records = self.ledger._records(self.account_key, self.mode)
            if not records or any((row.source == 'fixture') != (proof.source == 'fixture') for row in records):
                raise RiskDenied('EVENT_SOURCE')
            halt = self.db.execute('SELECT reason FROM order_integrity_halts WHERE mode=? AND account_key=?', (self.mode, self.account_key)).fetchone()
            recover_time = halt and halt[0] == 'CONFLICTING_EVENT_ID' and self._recoverable_time_halt()
            if halt and not recover_time:
                raise RiskDenied('ACCOUNT_INTEGRITY_HALT')
            event_times = [BrokerEvent.model_validate_json(row[0]).observedAt for row in self.db.execute('SELECT payload FROM order_broker_events WHERE mode=? AND account_key=?', (self.mode, self.account_key))]
            latest = max(event_times) if event_times else None
            if (latest and min(proof.cashObservedAt, proof.positionsObservedAt) < latest) or max(proof.cashObservedAt, proof.positionsObservedAt) > self.ledger.clock():
                raise RiskDenied('STALE_ACCOUNT_PROOF')
            first = self.db.execute('SELECT context FROM order_intents WHERE mode=? AND account_key=? ORDER BY created_epoch,rowid LIMIT 1', (self.mode, self.account_key)).fetchone()
            baseline = RiskContext.model_validate_json(first[0])
            if baseline.totalCash is None:
                raise RiskDenied('MISSING_CASH_BASELINE')
            expected_cash = Decimal(baseline.totalCash)
            positions = {row.conId: Decimal(row.quantity) for row in baseline.holdings}
            fills, fees = self._executions(), self._fees()
            for fill in fills:
                if fill.execId not in fees:
                    raise RiskDenied('COMMISSION_PENDING')
                sign = 1 if fill.side == 'BUY' else -1
                positions[fill.conId] = positions.get(fill.conId, Decimal(0)) + sign * Decimal(fill.quantity)
                expected_cash -= sign * Decimal(fill.quantity) * Decimal(fill.price) + Decimal(fees[fill.execId].commission)
            reported_cash = Decimal(proof.cashBalance)
            # USD account summaries are rounded to cents, while IB commissions
            # can contain fractional cents. Never tolerate a whole-cent gap.
            if expected_cash != reported_cash and not (proof.source == 'ibkr'
                    and reported_cash == reported_cash.quantize(Decimal('.01'))
                    and expected_cash.quantize(Decimal('.01'), rounding=ROUND_HALF_UP) == reported_cash):
                raise RiskDenied('CASH_MISMATCH')
            if {key: value for key, value in positions.items() if value} != {key: Decimal(value) for key, value in proof.positions.items() if Decimal(value)}:
                raise RiskDenied('POSITION_MISMATCH')
            updated = []
            for record in records:
                if record.pendingAmendmentId:
                    raise RiskDenied('UNRESOLVED_AMENDMENT')
                if record.submission == 'PERSISTED':
                    continue  # no broker attempt exists yet; keep its hold
                if record.submission != 'ACKNOWLEDGED' or record.brokerFilled is None or record.brokerRemaining is None:
                    raise RiskDenied('UNRESOLVED_ORDER')
                filled, remaining, quantity = Decimal(record.filledQuantity), Decimal(record.brokerRemaining), Decimal(record.terms.quantity)
                if filled != Decimal(record.brokerFilled) or filled > quantity or (record.execution not in TERMINAL and filled + remaining != quantity):
                    raise RiskDenied('ORDER_QUANTITY_MISMATCH')
                if remaining > quantity - filled or record.execution == 'FILLED' and (filled != quantity or remaining != 0):
                    raise RiskDenied('ORDER_QUANTITY_MISMATCH')
                if record.execution == 'INACTIVE':
                    raise RiskDenied('INACTIVE_ORDER_UNRESOLVED')
                if record.execution in TERMINAL:
                    changes = dict(reservedCash='0', reservedNotional='0', reservedQuantity='0', reconciliationRequired=False)
                else:
                    original = self._full_hold(record)
                    full_value = Decimal(record.terms.quantity) * self._reservation_price(record) if record.intent.side == 'BUY' else Decimal(0)
                    fee_hold = Decimal(original.reservedCash) - full_value
                    pending_value = remaining * self._reservation_price(record) if record.intent.side == 'BUY' else Decimal(0)
                    changes = dict(reservedCash=format(pending_value + fee_hold, 'f'), reservedNotional=format(pending_value, 'f'),
                        reservedQuantity=format(remaining if record.intent.side == 'SELL' else Decimal(0), 'f'), reconciliationRequired=False)
                updated.append(record.model_copy(update=changes))
            existing = self.db.execute('SELECT payload FROM order_account_proofs WHERE mode=? AND account_key=? AND snapshot_id=?', (self.mode, self.account_key, proof.snapshotId)).fetchone()
            if existing and existing[0] != canonical(proof):
                raise RiskDenied('SNAPSHOT_ID_CONFLICT')
            self.db.execute('INSERT OR IGNORE INTO order_account_proofs VALUES(?,?,?,?)', (self.mode, self.account_key, proof.snapshotId, canonical(proof)))
            if recover_time:
                self.db.execute('DELETE FROM order_integrity_halts WHERE mode=? AND account_key=? AND reason=?',
                    (self.mode, self.account_key, 'CONFLICTING_EVENT_ID'))
                append_event(self.db, self.account_key, 'EXECUTION_TIME_HALT_RECOVERED', self.ledger.clock().isoformat(),
                    {'snapshotId': proof.snapshotId, 'watermark': proof.watermark})
            for record in updated:
                self.ledger._replace(record, 'ACCOUNT_RECONCILED', snapshotId=proof.snapshotId, watermark=proof.watermark)
            return updated
