"""Versioned, explicitly confirmed amendments of owned DAY limit orders.

Same broker identity; no cancel-and-replace, no automatic retry. Real command
dispatch stays disabled; only engineering transports are currently enabled.
"""
import hashlib
from decimal import Decimal
from typing import Literal

from pydantic import Field

from .identity import BrokerSession, ModificationCommand, ReadOrderEvidence
from .orders import IntentConflict
from .risk import Amount, Identifier, OrderIntent, RiskContext, RiskDenied, canonical
from .schemas import Contract


class Amendment(Contract):
    amendmentId: Identifier
    accountKey: Identifier
    mode: Literal['paper', 'live', 'backtest']
    clientIntentId: Identifier
    expectedVersion: int = Field(gt=0, strict=True)
    sessionRevision: int = Field(gt=0, strict=True)
    authorizationId: Identifier
    snapshotId: Identifier
    quantity: Amount
    limitPrice: Amount


def amendment_hash(amendment):
    return hashlib.sha256(canonical(amendment).encode()).hexdigest()


class AmendmentManager:
    def __init__(self, ledger, broker):
        self.ledger, self.broker = ledger, broker

    @property
    def db(self):
        return self.ledger._db

    def _get(self, account_key, mode, amendment_id):
        return self.db.execute('SELECT payload,candidate,state,intent_id FROM order_amendments WHERE account_key=? AND mode=? AND amendment_id=?', (account_key, mode, amendment_id)).fetchone()

    def _check(self, request, context, record):
        if record is None or record.orderVersion != request.expectedVersion:
            raise RiskDenied('ORDER_VERSION')
        if record.pendingAmendmentId not in (None, request.amendmentId):
            raise RiskDenied('AMENDMENT_IN_PROGRESS')
        if (record.identity is None or record.permId is None or record.submission != 'ACKNOWLEDGED'
            or record.execution not in ('OPEN', 'PARTIALLY_FILLED') or record.cancelRequested or record.reconciliationRequired
            or record.brokerFilled is None or Decimal(record.brokerFilled) != Decimal(record.filledQuantity)):
            raise RiskDenied('ORDER_NOT_READY_FOR_AMENDMENT')
        if request.snapshotId != context.snapshotId:
            raise RiskDenied('AMENDMENT_SNAPSHOT_CHANGED')
        candidate = OrderIntent.model_validate({**record.terms.model_dump(), 'quantity': request.quantity, 'limitPrice': request.limitPrice,
            'authorizationId': request.authorizationId, 'sessionRevision': request.sessionRevision})
        grant = self.ledger._grant(candidate)
        if grant.purpose != 'amend_order':
            raise RiskDenied('AUTHORIZATION_PURPOSE')
        if grant.kind != 'manual':
            raise RiskDenied('AMENDMENT_CONFIRMATION_REQUIRED')
        _, reservation, day = self.ledger._validate(candidate, context, self.ledger.clock(), exclude=request.clientIntentId,
            purpose='amend_order', confirmation_hash=amendment_hash(request), filled_quantity=record.filledQuantity, operation_key=request.amendmentId)
        return candidate, reservation, day

    def prepare(self, request, context):
        request = Amendment.model_validate(request.model_dump())
        context = RiskContext.model_validate(context.model_dump())
        with self.ledger.transaction():
            existing = self._get(request.accountKey, request.mode, request.amendmentId)
            record = self.ledger._get(request.accountKey, request.mode, request.clientIntentId)
            if existing:
                if existing[0] != canonical(request):
                    raise IntentConflict('same amendment id with a different body')
                return record
            candidate, reservation, day = self._check(request, context, record)
            self.db.execute('INSERT INTO order_amendments VALUES(?,?,?,?,?,?,?,?,?,?)', (request.mode, request.accountKey, request.amendmentId,
                request.clientIntentId, canonical(request), canonical(candidate), canonical(context), 'PERSISTED', self.ledger.clock().timestamp(), day))
            changes = dict(pendingAmendmentId=request.amendmentId, amendmentState='PERSISTED')
            for field, key in (('reservedCash', 'cash'), ('reservedNotional', 'notional'), ('reservedQuantity', 'quantity')):
                changes[field] = format(max(Decimal(getattr(record, field)), Decimal(reservation[key])), 'f')
            record = record.model_copy(update=changes)
            self.ledger._replace(record, 'AMENDMENT_RESERVED', amendmentId=request.amendmentId, amendmentHash=amendment_hash(request),
                candidateHash=hashlib.sha256(canonical(candidate).encode()).hexdigest())
            return record

    def _channel(self, record):
        channel = BrokerSession.model_validate(self.broker.session().model_dump())
        identity = record.identity
        if identity is None or not channel.ready or (channel.accountKey, channel.mode, channel.channelKey, channel.clientId) != (
            record.intent.accountKey, record.intent.mode, identity.channelKey, identity.clientId) or channel.sessionRevision < identity.sessionRevision:
            raise RiskDenied('BROKER_SESSION_SCOPE')
        if (record.source == 'fixture') != (channel.source == 'fixture'):
            raise RiskDenied('BROKER_SESSION_SOURCE')
        return channel

    def send(self, account_key, mode, amendment_id, context):
        context = RiskContext.model_validate(context.model_dump())
        with self.ledger.transaction():
            stored = self._get(account_key, mode, amendment_id)
            if not stored:
                raise RiskDenied('AMENDMENT_MISSING')
            request = Amendment.model_validate_json(stored[0])
            record = self.ledger._get(account_key, mode, request.clientIntentId)
            if not self.ledger.allow_fixtures or self.broker.source != 'fixture' or record.source != 'fixture':
                raise RiskDenied('BROKER_WRITE_DISABLED')
            if stored[2] != 'PERSISTED':
                return record
            channel = self._channel(record)
            if channel.sessionRevision != request.sessionRevision:
                raise RiskDenied('BROKER_SESSION_SCOPE')
            candidate, _, _ = self._check(request, context, record)
            command = ModificationCommand(intent=candidate, identity=record.identity, permId=record.permId,
                amendmentId=amendment_id, expectedVersion=request.expectedVersion)
            self.db.execute("UPDATE order_amendments SET state='SUBMITTING' WHERE mode=? AND account_key=? AND amendment_id=?", (mode, account_key, amendment_id))
            record = record.model_copy(update={'amendmentState': 'SUBMITTING'})
            self.ledger._replace(record, 'AMENDMENT_SUBMISSION_CLAIMED', amendmentId=amendment_id, contextHash=hashlib.sha256(canonical(context).encode()).hexdigest())
        try:
            self.broker.modify(command)
        except Exception as error:
            return self._sent(request, type(error).__name__)
        except BaseException as error:
            self._sent(request, type(error).__name__)
            raise
        return self._sent(request)

    def _sent(self, request, error=None):
        with self.ledger.transaction():
            record = self.ledger._get(request.accountKey, request.mode, request.clientIntentId)
            if record.amendmentState != 'SUBMITTING':
                return record
            state = 'UNKNOWN' if error else 'SENT'
            self.db.execute('UPDATE order_amendments SET state=? WHERE mode=? AND account_key=? AND amendment_id=?', (state, request.mode, request.accountKey, request.amendmentId))
            changes = {'amendmentState': state}
            if error:
                changes.update(lastError=f'AMENDMENT_{error}', reconciliationRequired=True)
            record = record.model_copy(update=changes)
            self.ledger._replace(record, 'AMENDMENT_UNKNOWN' if error else 'AMENDMENT_SENT', amendmentId=request.amendmentId, error=error)
            return record

    def confirm(self, amendment_id, evidence):
        from .reconcile import OrderReconciler
        evidence = ReadOrderEvidence.model_validate(evidence.model_dump())
        with self.ledger._lock:
            stored = self._get(evidence.accountKey, evidence.mode, amendment_id)
            if not stored:
                raise RiskDenied('AMENDMENT_MISSING')
            record = self.ledger._get(evidence.accountKey, evidence.mode, stored[3])
            channel = self._channel(record)
            if evidence.sessionRevision != channel.sessionRevision or evidence.source != channel.source:
                raise RiskDenied('EVENT_SCOPE')
            return OrderReconciler(self.ledger, channel.accountKey, channel.mode, channel.sessionRevision).confirm_amendment(amendment_id, evidence)

    def discard(self, account_key, mode, amendment_id):
        # Local prepared command only. Never withdraw an already-sent command
        # by changing a local flag; that requires broker evidence.
        from .reconcile import OrderReconciler
        with self.ledger.transaction():
            stored = self._get(account_key, mode, amendment_id)
            if not stored or stored[2] != 'PERSISTED':
                raise RiskDenied('AMENDMENT_ALREADY_ATTEMPTED')
            record = self.ledger._get(account_key, mode, stored[3])
            record = record.model_copy(update={'pendingAmendmentId': None, 'amendmentState': 'ABANDONED'})
            record = OrderReconciler(self.ledger, account_key, mode, record.terms.sessionRevision)._hold(record)
            self.db.execute("UPDATE order_amendments SET state='ABANDONED' WHERE mode=? AND account_key=? AND amendment_id=?", (mode, account_key, amendment_id))
            self.ledger._replace(record, 'AMENDMENT_ABANDONED', amendmentId=amendment_id)
            return record
