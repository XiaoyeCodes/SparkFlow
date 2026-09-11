"""Durable intent identity and atomic account-wide reservations.

This module cannot contact a broker. API consent and broker submission are
separate layers; recording a grant here does not establish user authorization.
"""
from contextlib import contextmanager
from datetime import datetime, timezone
from decimal import Decimal, localcontext
import hashlib
import json
from pathlib import Path
import sqlite3
from threading import RLock
from typing import Literal
from zoneinfo import ZoneInfo
from uuid import uuid4

from .audit import append_event, read_events
from .risk import Authorization, OrderIntent, RiskContext, RiskDenied, canonical, check_risk, intent_hash, legacy_intent_hash, reservation_price
from .schemas import Contract
from .identity import BrokerIdentity, BrokerSession


class IntentConflict(ValueError):
    pass


class OrderRecord(Contract):
    intent: OrderIntent
    bodyHash: str
    createdAt: datetime | None = None
    source: Literal['fixture', 'user']
    submission: Literal['PERSISTED', 'SUBMITTING', 'ACKNOWLEDGED', 'UNKNOWN', 'RECONCILING', 'DENIED']
    execution: str
    reservedCash: str
    reservedNotional: str
    reservedQuantity: str
    reservationPrice: str | None = None
    orderId: int | None = None
    clientId: int | None = None
    permId: int | None = None
    lastError: str | None = None
    filledQuantity: str = '0'  # recorded execution total; not guessed broker cumulative fills
    brokerFilled: str | None = None
    brokerRemaining: str | None = None
    reconciliationRequired: bool = False
    cancelRequested: bool = False
    identity: BrokerIdentity | None = None
    cancelState: Literal['NONE', 'PERSISTED', 'SUBMITTING', 'REQUESTED', 'UNKNOWN', 'ACKNOWLEDGED', 'TOO_LATE'] = 'NONE'
    activeIntent: OrderIntent | None = None
    orderVersion: int = 1
    pendingAmendmentId: str | None = None
    amendmentState: Literal['NONE', 'PERSISTED', 'SUBMITTING', 'SENT', 'UNKNOWN', 'ACKNOWLEDGED', 'ABANDONED', 'REJECTED'] = 'NONE'

    @property
    def terms(self):
        return self.activeIntent or self.intent


class OrderLedger:
    def __init__(self, path: Path, *, allow_fixtures=False, clock=None):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.allow_fixtures = allow_fixtures
        self.clock = clock or (lambda: datetime.now(timezone.utc))
        self._lock = RLock()
        self._db = sqlite3.connect(path, isolation_level=None, check_same_thread=False, timeout=10)
        self._db.execute('PRAGMA journal_mode=WAL')
        self._db.execute('PRAGMA synchronous=FULL')
        with self.transaction():
            version = self._db.execute('PRAGMA user_version').fetchone()[0]
            if version not in (0, 1, 2, 3, 4, 5, 6):
                raise ValueError('unsupported order database version')
            self._db.execute('CREATE TABLE IF NOT EXISTS order_authorizations (id TEXT PRIMARY KEY, account_key TEXT NOT NULL, payload TEXT NOT NULL, revoked INTEGER NOT NULL DEFAULT 0)')
            self._db.execute('''CREATE TABLE IF NOT EXISTS order_intents (
                mode TEXT NOT NULL, account_key TEXT NOT NULL, intent_id TEXT NOT NULL,
                payload TEXT NOT NULL, context TEXT NOT NULL, trading_day TEXT NOT NULL, created_epoch REAL NOT NULL,
                PRIMARY KEY(mode,account_key,intent_id))''')
            self._db.execute('CREATE TABLE IF NOT EXISTS order_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, account_key TEXT NOT NULL, payload TEXT NOT NULL, previous TEXT NOT NULL, digest TEXT NOT NULL)')
            self._db.execute('''CREATE TABLE IF NOT EXISTS order_attempts (
                mode TEXT NOT NULL, account_key TEXT NOT NULL, intent_id TEXT NOT NULL,
                context TEXT NOT NULL, claimed_at TEXT NOT NULL, PRIMARY KEY(mode,account_key,intent_id))''')
            self._db.execute('''CREATE TABLE IF NOT EXISTS order_broker_events (
                seq INTEGER PRIMARY KEY AUTOINCREMENT, mode TEXT NOT NULL, account_key TEXT NOT NULL,
                event_id TEXT NOT NULL, intent_id TEXT NOT NULL, payload TEXT NOT NULL, identity TEXT NOT NULL,
                UNIQUE(mode,account_key,event_id))''')
            self._db.execute('''CREATE TABLE IF NOT EXISTS order_fills (
                mode TEXT NOT NULL, account_key TEXT NOT NULL, exec_id TEXT NOT NULL, intent_id TEXT NOT NULL,
                payload TEXT NOT NULL, replaces_exec_id TEXT,
                PRIMARY KEY(mode,account_key,exec_id), UNIQUE(mode,account_key,replaces_exec_id))''')
            self._db.execute('''CREATE TABLE IF NOT EXISTS order_commissions (
                seq INTEGER PRIMARY KEY AUTOINCREMENT, mode TEXT NOT NULL, account_key TEXT NOT NULL,
                exec_id TEXT NOT NULL, payload TEXT NOT NULL)''')
            self._db.execute('''CREATE TABLE IF NOT EXISTS order_cancel_requests (
                mode TEXT NOT NULL, account_key TEXT NOT NULL, intent_id TEXT NOT NULL, request_id TEXT NOT NULL,
                PRIMARY KEY(mode,account_key,intent_id,request_id))''')
            self._db.execute('''CREATE TABLE IF NOT EXISTS order_account_proofs (
                mode TEXT NOT NULL, account_key TEXT NOT NULL, snapshot_id TEXT NOT NULL, payload TEXT NOT NULL,
                PRIMARY KEY(mode,account_key,snapshot_id))''')
            self._db.execute('''CREATE TABLE IF NOT EXISTS order_integrity_halts (
                mode TEXT NOT NULL, account_key TEXT NOT NULL, reason TEXT NOT NULL, PRIMARY KEY(mode,account_key))''')
            self._db.execute('CREATE TABLE IF NOT EXISTS broker_channels (channel_key TEXT PRIMARY KEY, mode TEXT NOT NULL)')
            self._db.execute('''CREATE TABLE IF NOT EXISTS broker_id_sequences (
                channel_key TEXT NOT NULL, client_id INTEGER NOT NULL, next_id INTEGER NOT NULL, PRIMARY KEY(channel_key,client_id))''')
            self._db.execute('''CREATE TABLE IF NOT EXISTS broker_identities (
                mode TEXT NOT NULL, account_key TEXT NOT NULL, intent_id TEXT NOT NULL,
                channel_key TEXT NOT NULL, client_id INTEGER NOT NULL, order_id INTEGER NOT NULL, order_ref TEXT NOT NULL UNIQUE,
                PRIMARY KEY(mode,account_key,intent_id), UNIQUE(channel_key,client_id,order_id))''')
            self._db.execute('''CREATE TABLE IF NOT EXISTS broker_order_ownership (
                mode TEXT NOT NULL, account_key TEXT NOT NULL, perm_id INTEGER NOT NULL, intent_id TEXT NOT NULL,
                PRIMARY KEY(mode,account_key,perm_id))''')
            self._db.execute('''CREATE TABLE IF NOT EXISTS order_amendments (
                mode TEXT NOT NULL, account_key TEXT NOT NULL, amendment_id TEXT NOT NULL, intent_id TEXT NOT NULL,
                payload TEXT NOT NULL, candidate TEXT NOT NULL, context TEXT NOT NULL, state TEXT NOT NULL,
                created_epoch REAL NOT NULL, trading_day TEXT NOT NULL, PRIMARY KEY(mode,account_key,amendment_id))''')
            self._db.execute('''CREATE TABLE IF NOT EXISTS order_previews (
                preview_id TEXT PRIMARY KEY, account_key TEXT NOT NULL, mode TEXT NOT NULL,
                body_hash TEXT NOT NULL, payload TEXT NOT NULL, expires_epoch REAL NOT NULL,
                confirmed_intent_id TEXT)''')
            self._db.execute('''CREATE TABLE IF NOT EXISTS sdk_dispatch_permits (
                permit_id TEXT PRIMARY KEY, payload TEXT NOT NULL, revoked INTEGER NOT NULL DEFAULT 0)''')
            self._db.execute('''CREATE TABLE IF NOT EXISTS sdk_dispatch_attempts (
                command_hash TEXT PRIMARY KEY, permit_id TEXT NOT NULL, account_key TEXT NOT NULL,
                mode TEXT NOT NULL, state TEXT NOT NULL, reason TEXT, claimed_at TEXT NOT NULL)''')
            self._db.execute('PRAGMA user_version=6')

    @contextmanager
    def transaction(self):
        with self._lock:
            self._db.execute('BEGIN IMMEDIATE')
            try:
                yield
            except BaseException:
                self._db.rollback()
                raise
            else:
                self._db.commit()

    def _source(self, source):
        if source == 'fixture' and not self.allow_fixtures:
            raise RiskDenied('FIXTURE_DISABLED')

    def _record_authorization_locked(self, grant, now):
        grant = Authorization.model_validate(grant.model_dump())
        self._source(grant.source)
        body = canonical(grant)
        stored = self._db.execute('SELECT payload FROM order_authorizations WHERE id=?', (grant.authorizationId,)).fetchone()
        if stored:
            if canonical(Authorization.model_validate_json(stored[0])) != body:
                raise IntentConflict('authorization is immutable; use a new id')
            return
        self._db.execute('INSERT INTO order_authorizations(id,account_key,payload) VALUES(?,?,?)', (grant.authorizationId, grant.accountKey, body))
        append_event(self._db, grant.accountKey, 'AUTHORIZATION_RECORDED', now.isoformat(), {'authorizationId': grant.authorizationId, 'source': grant.source, 'hash': hashlib.sha256(body.encode()).hexdigest()})

    def record_authorization(self, grant):
        with self.transaction():
            self._record_authorization_locked(grant, self.clock())

    def revoke_authorization(self, authorization_id):
        with self.transaction():
            row = self._db.execute('SELECT account_key,revoked FROM order_authorizations WHERE id=?', (authorization_id,)).fetchone()
            if not row:
                raise RiskDenied('AUTHORIZATION_MISSING')
            if not row[1]:
                self._db.execute('UPDATE order_authorizations SET revoked=1 WHERE id=?', (authorization_id,))
                append_event(self._db, row[0], 'AUTHORIZATION_REVOKED', self.clock().isoformat(), {'authorizationId': authorization_id})

    def _grant(self, intent):
        row = self._db.execute('SELECT payload,revoked FROM order_authorizations WHERE id=?', (intent.authorizationId,)).fetchone()
        if row is None:
            raise RiskDenied('AUTHORIZATION_MISSING')
        if row[1]:
            raise RiskDenied('AUTHORIZATION_REVOKED')
        grant = Authorization.model_validate_json(row[0])
        self._source(grant.source)
        return grant

    def _decode(self, payload, created_epoch=None):
        record = OrderRecord.model_validate_json(payload)
        if record.createdAt is None and created_epoch is not None:
            record = record.model_copy(update={'createdAt': datetime.fromtimestamp(created_epoch, timezone.utc)})
        self._source(record.source)
        valid_hashes = {intent_hash(record.intent)}
        if record.intent.tradingSession == 'EXTENDED':
            valid_hashes.add(legacy_intent_hash(record.intent))
        if record.bodyHash not in valid_hashes:
            raise RiskDenied('PERSISTED_INTENT_INVALID')
        if record.identity and (record.identity.accountKey, record.identity.mode, record.identity.sessionRevision, record.identity.orderId, record.identity.clientId) != (
            record.intent.accountKey, record.intent.mode, record.intent.sessionRevision, record.orderId, record.clientId):
            raise RiskDenied('PERSISTED_IDENTITY_INVALID')
        if record.activeIntent and any(getattr(record.activeIntent, key) != getattr(record.intent, key)
            for key in ('accountKey', 'mode', 'clientIntentId', 'conId', 'side', 'orderType', 'tif', 'tradingSession', 'strategyVersion')):
            raise RiskDenied('PERSISTED_AMENDMENT_INVALID')
        return record

    def _get(self, account_key, mode, intent_id):
        row = self._db.execute('SELECT payload,created_epoch FROM order_intents WHERE account_key=? AND mode=? AND intent_id=?', (account_key, mode, intent_id)).fetchone()
        return self._decode(row[0], row[1]) if row else None

    def get(self, account_key, mode, intent_id):
        with self._lock:
            return self._get(account_key, mode, intent_id)

    def _records(self, account_key, mode):
        rows = self._db.execute('SELECT payload,created_epoch FROM order_intents WHERE account_key=? AND mode=? ORDER BY created_epoch ASC,rowid ASC', (account_key, mode))
        return [self._decode(payload, created_epoch) for payload, created_epoch in rows]

    def _reservations(self, account_key, mode, exclude=None):
        cash, notional, quantities, symbols = Decimal(0), Decimal(0), {}, {}
        with localcontext() as arithmetic:
            arithmetic.prec = 80
            for row in self._records(account_key, mode):
                if row.intent.clientIntentId == exclude:
                    continue
                cash += Decimal(row.reservedCash)
                notional += Decimal(row.reservedNotional)
                con_id = str(row.intent.conId)
                quantities[con_id] = quantities.get(con_id, Decimal(0)) + Decimal(row.reservedQuantity)
                symbols[con_id] = symbols.get(con_id, Decimal(0)) + Decimal(row.reservedNotional)
        return {'cash': format(cash, 'f'), 'notional': format(notional, 'f'),
            'quantity': {key: format(value, 'f') for key, value in quantities.items() if value},
            'symbols': {key: format(value, 'f') for key, value in symbols.items() if value}}

    def reservations(self, account_key, mode):
        with self._lock:
            return self._reservations(account_key, mode)

    def _validate(self, intent, context, now, exclude=None, *, purpose='new_order', confirmation_hash=None, filled_quantity='0', operation_key=None, grant_override=None):
        if self._db.execute('SELECT 1 FROM order_integrity_halts WHERE mode=? AND account_key=?', (intent.mode, intent.accountKey)).fetchone():
            raise RiskDenied('ACCOUNT_INTEGRITY_HALT')
        grant = Authorization.model_validate(grant_override.model_dump()) if grant_override is not None else self._grant(intent)
        unresolved = [row for row in self._records(intent.accountKey, intent.mode) if row.intent.clientIntentId != exclude
            and (row.submission in ('UNKNOWN', 'RECONCILING') or row.reconciliationRequired or row.pendingAmendmentId)]
        manual_paper = intent.mode == 'paper' and grant.kind == 'manual' and purpose == 'new_order'
        if unresolved and not manual_paper:
            raise RiskDenied('UNRESOLVED_ORDER')
        self._source(grant.source)
        checkpoint = self._db.execute('SELECT payload FROM order_account_proofs WHERE mode=? AND account_key=? ORDER BY rowid DESC LIMIT 1', (intent.mode, intent.accountKey)).fetchone()
        if checkpoint and not (manual_paper and unresolved):
            proof = json.loads(checkpoint[0])
            positions = {str(row.conId): Decimal(row.quantity) for row in context.holdings if Decimal(row.quantity)}
            expected = {key: Decimal(value) for key, value in proof['positions'].items() if Decimal(value)}
            source_time = min(datetime.fromisoformat(proof['cashObservedAt']), datetime.fromisoformat(proof['positionsObservedAt']))
            funding = context.settledCash
            if (funding is None and intent.mode == 'paper' and grant.kind == 'manual' and purpose == 'new_order'
                    and context.availableFunds is not None and context.totalCash is not None):
                funding = min(Decimal(context.totalCash), Decimal(context.availableFunds))
            # A completed subsequent broker read has a new snapshot ID. It may
            # fund the next order when it is newer and cash/shares still agree.
            if (context.sessionRevision != proof['sessionRevision']
                or context.source != proof['source'] or context.asOf < source_time or context.totalCash is None
                or Decimal(context.totalCash) != Decimal(proof['cashBalance']) or positions != expected
                or funding is None or Decimal(funding) > Decimal(proof['cashBalance'])):
                raise RiskDenied('STALE_ACCOUNT_CHECKPOINT')
        day = now.astimezone(ZoneInfo('America/New_York')).date().isoformat()
        counts = self._db.execute('''SELECT trading_day,created_epoch,intent_id FROM order_intents
            WHERE account_key=? AND mode=?''', (intent.accountKey, intent.mode)).fetchall()
        daily_count = sum(1 for date, _, key in counts if date == day and (key != exclude or purpose == 'amend_order'))
        minute_count = sum(1 for _, timestamp, key in counts if timestamp > now.timestamp() - 60 and (key != exclude or purpose == 'amend_order'))
        amendments = self._db.execute('SELECT trading_day,created_epoch,amendment_id FROM order_amendments WHERE account_key=? AND mode=?', (intent.accountKey, intent.mode)).fetchall()
        daily_count += sum(1 for date, _, key in amendments if date == day and key != operation_key)
        minute_count += sum(1 for _, timestamp, key in amendments if timestamp > now.timestamp() - 60 and key != operation_key)
        reservation = check_risk(intent, grant, context, self._reservations(intent.accountKey, intent.mode, exclude),
            now=now, daily_count=daily_count, minute_count=minute_count, purpose=purpose, confirmation_hash=confirmation_hash, filled_quantity=filled_quantity)
        return grant, reservation, day

    def dry_run(self, intent, grant, context, *, now=None):
        intent = OrderIntent.model_validate(intent.model_dump())
        grant = Authorization.model_validate(grant.model_dump())
        context = RiskContext.model_validate(context.model_dump())
        with self.transaction():
            _, reserved, _ = self._validate(intent, context, now or self.clock(), grant_override=grant)
            return reserved

    def _reserve_locked(self, intent, context, now):
        body_hash = intent_hash(intent)
        previous = self._get(intent.accountKey, intent.mode, intent.clientIntentId)
        if previous:
            compatible = previous.bodyHash == body_hash or (intent.tradingSession == 'EXTENDED'
                and previous.bodyHash == legacy_intent_hash(intent))
            if not compatible:
                raise IntentConflict('same intent id with a different body')
            return previous
        grant, reserved, day = self._validate(intent, context, now)
        record = OrderRecord(intent=intent, bodyHash=body_hash, createdAt=now, source=grant.source, submission='PERSISTED', execution='PENDING',
            reservedCash=reserved['cash'], reservedNotional=reserved['notional'], reservedQuantity=reserved['quantity'],
            reservationPrice=format(reservation_price(intent, context), 'f') if intent.orderType == 'MKT' else None)
        self._db.execute('INSERT INTO order_intents VALUES(?,?,?,?,?,?,?)', (intent.mode, intent.accountKey, intent.clientIntentId, record.model_dump_json(), canonical(context), day, now.timestamp()))
        append_event(self._db, intent.accountKey, 'INTENT_RESERVED', now.isoformat(), {'clientIntentId': intent.clientIntentId,
            'bodyHash': body_hash, 'contextHash': hashlib.sha256(canonical(context).encode()).hexdigest(), 'reservation': reserved})
        return record

    def reserve(self, intent, context):
        intent = OrderIntent.model_validate(intent.model_dump())
        context = RiskContext.model_validate(context.model_dump())
        with self.transaction():
            return self._reserve_locked(intent, context, self.clock())

    def save_preview(self, preview_id, account_key, mode, body_hash, payload, expires_epoch):
        with self.transaction():
            self._db.execute('INSERT INTO order_previews VALUES(?,?,?,?,?,?,NULL)',
                (preview_id, account_key, mode, body_hash, payload, expires_epoch))

    def load_preview(self, preview_id):
        with self._lock:
            return self._db.execute('SELECT account_key,mode,body_hash,payload,expires_epoch,confirmed_intent_id FROM order_previews WHERE preview_id=?', (preview_id,)).fetchone()

    def confirm_preview(self, preview_id, body_hash, grant, intent, context, *, now):
        grant = Authorization.model_validate(grant.model_dump())
        intent = OrderIntent.model_validate(intent.model_dump())
        context = RiskContext.model_validate(context.model_dump())
        with self.transaction():
            row = self._db.execute('SELECT body_hash,expires_epoch,confirmed_intent_id FROM order_previews WHERE preview_id=?', (preview_id,)).fetchone()
            if row is None:
                raise RiskDenied('PREVIEW_MISSING')
            if row[0] != body_hash:
                raise RiskDenied('PREVIEW_BODY_CHANGED')
            if now.timestamp() >= row[1]:
                raise RiskDenied('PREVIEW_EXPIRED')
            if row[2]:
                record = self._get(intent.accountKey, intent.mode, row[2])
                if record is None:
                    raise RiskDenied('PREVIEW_CONFIRMATION_INVALID')
                return record
            self._record_authorization_locked(grant, now)
            record = self._reserve_locked(intent, context, now)
            self._db.execute('UPDATE order_previews SET confirmed_intent_id=? WHERE preview_id=?',
                (intent.clientIntentId, preview_id))
            return record

    def audit(self, account_key):
        with self._lock:
            return read_events(self._db, account_key)

    def _replace(self, record, kind, **details):
        intent = record.intent
        self._db.execute('UPDATE order_intents SET payload=? WHERE mode=? AND account_key=? AND intent_id=?',
            (record.model_dump_json(), intent.mode, intent.accountKey, intent.clientIntentId))
        append_event(self._db, intent.accountKey, kind, self.clock().isoformat(), {'clientIntentId': intent.clientIntentId, **details})

    def _allocate_identity(self, record, channel):
        intent = record.intent
        if not channel.ready or (channel.accountKey, channel.mode, channel.sessionRevision) != (intent.accountKey, intent.mode, intent.sessionRevision):
            raise RiskDenied('BROKER_SESSION_SCOPE')
        if (record.source == 'fixture') != (channel.source == 'fixture'):
            raise RiskDenied('BROKER_SESSION_SOURCE')
        known = self._db.execute('SELECT mode FROM broker_channels WHERE channel_key=?', (channel.channelKey,)).fetchone()
        if known and known[0] != channel.mode:
            raise RiskDenied('BROKER_CHANNEL_MODE_CHANGED')
        self._db.execute('INSERT OR IGNORE INTO broker_channels VALUES(?,?)', (channel.channelKey, channel.mode))
        previous = self._db.execute('SELECT next_id FROM broker_id_sequences WHERE channel_key=? AND client_id=?', (channel.channelKey, channel.clientId)).fetchone()
        order_id = max(channel.nextValidId, previous[0] if previous else channel.nextValidId)
        identity = BrokerIdentity(channelKey=channel.channelKey, accountKey=intent.accountKey, mode=intent.mode,
            sessionRevision=intent.sessionRevision, clientId=channel.clientId, orderId=order_id, orderRef=f'SF-{uuid4().hex[:24]}')
        self._db.execute('INSERT INTO broker_id_sequences VALUES(?,?,?) ON CONFLICT(channel_key,client_id) DO UPDATE SET next_id=excluded.next_id', (channel.channelKey, channel.clientId, order_id + 1))
        self._db.execute('INSERT INTO broker_identities VALUES(?,?,?,?,?,?,?)', (intent.mode, intent.accountKey, intent.clientIntentId, channel.channelKey, channel.clientId, order_id, identity.orderRef))
        return identity

    def claim_submission(self, account_key, mode, intent_id, context, *, channel):
        context = RiskContext.model_validate(context.model_dump())
        channel = BrokerSession.model_validate(channel.model_dump())
        with self.transaction():
            record = self._get(account_key, mode, intent_id)
            if record is None:
                raise RiskDenied('INTENT_MISSING')
            if record.submission != 'PERSISTED':
                return record, False
            now = self.clock()
            _, reserved, _ = self._validate(record.intent, context, now, exclude=intent_id)
            if record.intent.orderType == 'MKT':
                record = record.model_copy(update={
                    'reservationPrice': format(max(Decimal(record.reservationPrice), reservation_price(record.intent, context)), 'f'),
                    **{field: format(max(Decimal(getattr(record, field)), Decimal(reserved[key])), 'f')
                       for field, key in [('reservedCash','cash'), ('reservedNotional','notional'), ('reservedQuantity','quantity')]}})
            identity = self._allocate_identity(record, channel)
            record = record.model_copy(update={'submission': 'SUBMITTING', 'identity': identity, 'orderId': identity.orderId, 'clientId': identity.clientId})
            # A unique durable attempt is claimed before calling any broker.
            self._db.execute('INSERT INTO order_attempts VALUES(?,?,?,?,?)', (mode, account_key, intent_id, canonical(context), now.isoformat()))
            self._replace(record, 'SUBMISSION_CLAIMED', contextHash=hashlib.sha256(canonical(context).encode()).hexdigest())
            return record, True

    def _claim_ownership(self, record, perm_id):
        intent = record.intent
        owner = self._db.execute('SELECT intent_id FROM broker_order_ownership WHERE mode=? AND account_key=? AND perm_id=?', (intent.mode, intent.accountKey, perm_id)).fetchone()
        # Include pre-v3 records before they have been read into the index.
        conflicts = any(row.permId == perm_id and row.intent.clientIntentId != intent.clientIntentId for row in self._records(intent.accountKey, intent.mode))
        if conflicts or owner and owner[0] != intent.clientIntentId:
            raise RiskDenied('BROKER_OWNERSHIP_CONFLICT')
        self._db.execute('INSERT OR IGNORE INTO broker_order_ownership VALUES(?,?,?,?)', (intent.mode, intent.accountKey, perm_id, intent.clientIntentId))

    def finish_submission(self, account_key, mode, intent_id, *, ack=None, reason='BROKER_RESPONSE_UNKNOWN'):
        with self.transaction():
            record = self._get(account_key, mode, intent_id)
            if record is None:
                raise RiskDenied('INTENT_MISSING')
            if record.submission != 'SUBMITTING':
                return record
            changes = {'submission': 'UNKNOWN' if ack is None else 'ACKNOWLEDGED', 'lastError': reason if ack is None else None}
            if ack is not None:
                if (ack.orderId, ack.clientId) != (record.orderId, record.clientId):
                    raise RiskDenied('BROKER_ACK_IDENTITY')
                self._claim_ownership(record, ack.permId)
                changes.update(ack.model_dump())
            record = record.model_copy(update=changes)
            self._replace(record, 'SUBMISSION_UNKNOWN' if ack is None else 'BROKER_ACKNOWLEDGED', **changes)
            return record

    def recover_inflight(self):
        # Call only after the service has acquired exclusive runtime ownership;
        # not from every DB connection or while another worker may submit.
        with self.transaction():
            count = 0
            for payload, in self._db.execute('SELECT payload FROM order_intents').fetchall():
                record = self._decode(payload)
                changes, interrupted = {}, []
                if record.submission == 'SUBMITTING':
                    changes['submission'] = 'UNKNOWN'
                    interrupted.append('SUBMISSION')
                    if record.identity is not None:
                        from .identity import SubmissionCommand
                        digest = hashlib.sha256(canonical(SubmissionCommand(intent=record.intent, identity=record.identity)).encode()).hexdigest()
                        self._db.execute("UPDATE sdk_dispatch_attempts SET state='UNKNOWN',reason='INTERRUPTED_SUBMISSION' "
                            "WHERE command_hash=? AND state IN ('WRITING','SENT')", (digest,))
                if record.cancelState in ('SUBMITTING', 'REQUESTED'):
                    changes['cancelState'] = 'UNKNOWN'
                    interrupted.append('CANCEL')
                    if record.identity is not None and record.permId is not None:
                        from .identity import CancellationCommand
                        requests = self._db.execute('SELECT request_id FROM order_cancel_requests WHERE mode=? AND account_key=? AND intent_id=?',
                            (record.intent.mode, record.intent.accountKey, record.intent.clientIntentId)).fetchall()
                        for request_id, in requests:
                            command = CancellationCommand(identity=record.identity, permId=record.permId, requestId=request_id)
                            digest = hashlib.sha256(canonical(command).encode()).hexdigest()
                            self._db.execute("UPDATE sdk_dispatch_attempts SET state='UNKNOWN',reason='INTERRUPTED_CANCEL' "
                                "WHERE command_hash=? AND state IN ('WRITING','SENT')", (digest,))
                if record.amendmentState == 'SUBMITTING':
                    self._db.execute("UPDATE order_amendments SET state='UNKNOWN' WHERE mode=? AND account_key=? AND amendment_id=?", (record.intent.mode, record.intent.accountKey, record.pendingAmendmentId))
                    changes['amendmentState'] = 'UNKNOWN'
                    interrupted.append('AMENDMENT')
                if changes:
                    changes.update(lastError='INTERRUPTED_' + '_AND_'.join(interrupted), reconciliationRequired=True)
                    self._replace(record.model_copy(update=changes), 'INTERRUPTED_COMMANDS', commands=interrupted)
                    count += len(interrupted)
            return count

    def claim_cancel(self, account_key, mode, intent_id, request_id, channel):
        from .identity import CancellationCommand
        channel = BrokerSession.model_validate(channel.model_dump())
        with self.transaction():
            record = self._get(account_key, mode, intent_id)
            if record is None or record.identity is None or record.permId is None:
                raise RiskDenied('ORDER_IDENTITY_REQUIRED')
            identity = record.identity
            if (not channel.ready or (channel.accountKey, channel.mode, channel.channelKey, channel.clientId) !=
                (account_key, mode, identity.channelKey, identity.clientId) or channel.sessionRevision < identity.sessionRevision):
                raise RiskDenied('BROKER_SESSION_SCOPE')
            if (record.source == 'fixture') != (channel.source == 'fixture'):
                raise RiskDenied('BROKER_SESSION_SOURCE')
            command = CancellationCommand(identity=identity, permId=record.permId, requestId=request_id)
            if record.execution in ('FILLED', 'CANCELLED', 'REJECTED') or record.cancelState not in ('NONE', 'PERSISTED'):
                return record, command, False
            if record.cancelState == 'PERSISTED':
                request = self._db.execute('SELECT 1 FROM order_cancel_requests WHERE mode=? AND account_key=? AND intent_id=? AND request_id=?', (mode, account_key, intent_id, request_id)).fetchone()
                if not request:
                    return record, command, False
            else:
                self._db.execute('INSERT INTO order_cancel_requests VALUES(?,?,?,?)', (mode, account_key, intent_id, request_id))
            record = record.model_copy(update={'cancelState': 'SUBMITTING', 'cancelRequested': True, 'execution': 'CANCEL_PENDING'})
            self._replace(record, 'CANCEL_SUBMISSION_CLAIMED', requestId=request_id)
            return record, command, True

    def finish_cancel(self, account_key, mode, intent_id, *, error=None):
        with self.transaction():
            record = self._get(account_key, mode, intent_id)
            if record is None:
                raise RiskDenied('INTENT_MISSING')
            if record.cancelState != 'SUBMITTING':
                return record  # a real broker event may already have arrived
            changes = {'cancelState': 'UNKNOWN' if error else 'REQUESTED'}
            if error:
                changes.update(lastError=f'CANCEL_{error}', reconciliationRequired=True)
            record = record.model_copy(update=changes)
            self._replace(record, 'CANCEL_UNKNOWN' if error else 'CANCEL_SENT', error=error)
            return record

    def close(self):
        self._db.close()

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()
