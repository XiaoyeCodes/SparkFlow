"""Default-disabled, immediate native SDK dispatch of durable commands.

The service does not connect or create permission. A trusted local confirmation
flow must supply an immutable, revocable permit for the exact command and
binding, in addition to the ledger's strategy/manual authorization and risk
checks. No production startup currently constructs this dispatcher.
"""
import asyncio
from datetime import datetime, timezone
import hashlib
import logging
from typing import Literal

from pydantic import AwareDatetime, Field, model_validator

from .audit import append_event
from .identity import BrokerSession, SubmissionCommand, CancellationCommand
from .order_codec import encode_order, encode_cancel
from .orders import IntentConflict
from .risk import Identifier, RiskContext, RiskDenied, canonical
from .schemas import Contract
from .session import AccountBinding


def command_hash(command):
    return hashlib.sha256(canonical(command).encode()).hexdigest()


def binding_hash(binding):
    return hashlib.sha256(canonical(binding).encode()).hexdigest()


class DispatchPermit(Contract):
    permitId: Identifier
    commandHash: str = Field(pattern=r'^[a-f0-9]{64}$')
    bindingHash: str = Field(pattern=r'^[a-f0-9]{64}$')
    channelKey: Identifier
    accountKey: Identifier
    mode: Literal['paper', 'live']
    sessionRevision: int = Field(gt=0, strict=True)
    source: Literal['fixture', 'user']
    purpose: Literal['submit', 'modify', 'cancel']
    authorizationHash: str | None = Field(default=None, pattern=r'^[a-f0-9]{64}$')
    issuedAt: AwareDatetime
    expiresAt: AwareDatetime
    consentReference: Identifier

    @model_validator(mode='after')
    def scope(self):
        if not self.accountKey.startswith(f'{self.mode}:') or self.expiresAt <= self.issuedAt:
            raise ValueError('invalid dispatch permit scope or expiry')
        if self.purpose != 'cancel' and self.authorizationHash is None:
            raise ValueError('risk authorization required')
        return self


class DispatchReceipt(Contract):
    commandHash: str
    state: Literal['WRITING', 'SENT', 'UNKNOWN', 'DENIED']
    reason: str | None = None


class NativeDispatcher:
    def __init__(self, ledger, sdk, binding, *, channel_key, enabled=False, current_revision, clock=None, ack_timeout_seconds=10):
        if not 0 < ack_timeout_seconds <= 60:
            raise ValueError('ack timeout must be in (0, 60] seconds')
        self.ledger, self.sdk = ledger, sdk
        self.binding = AccountBinding.model_validate(binding.model_dump())
        self.channel_key, self.enabled = channel_key, enabled
        self.current_revision = current_revision
        self.clock = clock or (lambda: datetime.now(timezone.utc))
        self.loop = asyncio.get_running_loop()
        self.ack_timeout_seconds = ack_timeout_seconds
        self._pending = {}
        self._closed = False

    @property
    def pending_count(self):
        return len(self._pending)

    def _expire(self, digest, command, reason='SDK_ACK_TIMEOUT'):
        pending = self._pending.pop(digest, None)
        if pending is not None:
            pending[0].cancel()
        with self.ledger.transaction():
            if isinstance(command, CancellationCommand):
                row = self._cancel_record(command)
                if row is None or row.cancelState not in ('SUBMITTING', 'REQUESTED'):
                    return
                row = row.model_copy(update={'cancelState': 'UNKNOWN', 'reconciliationRequired': True, 'lastError': reason})
                self.ledger._replace(row, 'SDK_CANCEL_UNRESOLVED', commandHash=digest, reason=reason)
                self.ledger._db.execute("UPDATE sdk_dispatch_attempts SET state='UNKNOWN',reason=? WHERE command_hash=?", (reason, digest))
                return
            row = self.ledger._get(command.intent.accountKey, command.intent.mode, command.intent.clientIntentId)
            if row is None or row.submission != 'SUBMITTING':
                return  # raw ACK/error already resolved the submission wait
            row = row.model_copy(update={'submission': 'UNKNOWN', 'reconciliationRequired': True, 'lastError': reason})
            self.ledger._replace(row, 'SDK_ACK_UNRESOLVED', commandHash=digest, reason=reason)
            self.ledger._db.execute("UPDATE sdk_dispatch_attempts SET state='UNKNOWN',reason=? WHERE command_hash=?", (reason, digest))

    def close(self):
        self._closed = True
        for digest, (_, command) in tuple(self._pending.items()):
            self._expire(digest, command, 'DISPATCHER_STOPPED')

    def record_permit(self, permit):
        """Internal persistence only: not proof that a human approved a command."""
        permit = DispatchPermit.model_validate(permit.model_dump())
        self.ledger._source(permit.source)
        body = canonical(permit)
        with self.ledger.transaction():
            old = self.ledger._db.execute('SELECT payload FROM sdk_dispatch_permits WHERE permit_id=?', (permit.permitId,)).fetchone()
            if old:
                if old[0] != body:
                    raise IntentConflict('dispatch permit is immutable')
                return
            self.ledger._db.execute('INSERT INTO sdk_dispatch_permits(permit_id,payload) VALUES(?,?)', (permit.permitId, body))
            append_event(self.ledger._db, permit.accountKey, 'DISPATCH_PERMIT_RECORDED', self.clock().isoformat(),
                {'permitId': permit.permitId, 'source': permit.source, 'commandHash': permit.commandHash})

    def revoke_permit(self, permit_id):
        with self.ledger.transaction():
            row = self.ledger._db.execute('SELECT payload,revoked FROM sdk_dispatch_permits WHERE permit_id=?', (permit_id,)).fetchone()
            if row is None:
                raise RiskDenied('DISPATCH_PERMIT_MISSING')
            if not row[1]:
                permit = DispatchPermit.model_validate_json(row[0])
                self.ledger._db.execute('UPDATE sdk_dispatch_permits SET revoked=1 WHERE permit_id=?', (permit_id,))
                append_event(self.ledger._db, permit.accountKey, 'DISPATCH_PERMIT_REVOKED', self.clock().isoformat(), {'permitId': permit_id})

    def _sdk_ready(self):
        if self.enabled is not True or self._closed:
            raise RiskDenied('BROKER_WRITE_DISABLED')
        if asyncio.get_running_loop() is not self.loop:
            raise RiskDenied('SDK_OWNER_LOOP_REQUIRED')
        client = self.sdk.client
        if not client.isConnected() or not client.isReady() or not client._hasReqId:
            raise RiskDenied('SDK_NOT_READY')
        if (client.host, client.port, client.clientId) != (self.binding.host, self.binding.port, self.binding.clientId):
            raise RiskDenied('SDK_CONNECTION_SCOPE')
        if self.binding.brokerAccount not in client.getAccounts():
            raise RiskDenied('SDK_ACCOUNT_NOT_BOUND')
        observer = self.sdk.wrapper.managed_observer
        if (observer is None or observer.rec.ledger is not self.ledger or binding_hash(observer.binding) != binding_hash(self.binding)
            or observer.channel_key != self.channel_key or observer.current_revision() != self.current_revision()
            or observer.rec.revision != self.current_revision()):
            raise RiskDenied('SDK_OBSERVER_SCOPE')
        if client._msgQ or client._isThrottling:
            raise RiskDenied('SDK_DEFERRED_SEND_FORBIDDEN')
        active = sum(self.loop.time() - timestamp <= client.RequestsInterval for timestamp in client._timeQ)
        if client.MaxRequests and active >= client.MaxRequests:
            raise RiskDenied('SDK_THROTTLED')
        if client._logger.isEnabledFor(logging.DEBUG):
            raise RiskDenied('SDK_UNSAFE_DEBUG_LOGGING')
        return observer

    def session(self):
        observer = self._sdk_ready()
        return BrokerSession(channelKey=self.channel_key, source=observer.source, accountKey=self.binding.accountKey,
            mode=self.binding.mode, sessionRevision=self.current_revision(), clientId=self.binding.clientId,
            nextValidId=self.sdk.client._reqIdSeq, ready=True)

    def _validate(self, command, permit_id, context):
        observer = self._sdk_ready()
        stored = self.ledger._db.execute('SELECT payload,revoked FROM sdk_dispatch_permits WHERE permit_id=?', (permit_id,)).fetchone()
        if stored is None:
            raise RiskDenied('DISPATCH_PERMIT_MISSING')
        if stored[1]:
            raise RiskDenied('DISPATCH_PERMIT_REVOKED')
        permit = DispatchPermit.model_validate_json(stored[0])
        identity, intent = command.identity, command.intent
        if (permit.commandHash != command_hash(command) or permit.purpose != 'submit'
            or permit.bindingHash != binding_hash(self.binding)
            or (permit.accountKey, permit.mode, permit.channelKey, permit.sessionRevision) !=
            (self.binding.accountKey, self.binding.mode, self.channel_key, self.current_revision())
            or (identity.accountKey, identity.mode, identity.channelKey, identity.clientId, identity.sessionRevision) !=
            (permit.accountKey, permit.mode, permit.channelKey, self.binding.clientId, permit.sessionRevision)):
            raise RiskDenied('DISPATCH_PERMIT_SCOPE')
        now = self.clock()
        if not permit.issuedAt <= now < permit.expiresAt:
            raise RiskDenied('DISPATCH_PERMIT_EXPIRED')
        row = self.ledger._get(intent.accountKey, intent.mode, intent.clientIntentId)
        if row is None or row.submission != 'SUBMITTING' or row.identity != identity or canonical(row.intent) != canonical(intent):
            raise RiskDenied('DURABLE_COMMAND_REQUIRED')
        if (permit.source != row.source or (row.source == 'fixture') != (observer.source == 'fixture')):
            raise RiskDenied('DISPATCH_SOURCE_SCOPE')
        if not self.ledger._db.execute('SELECT 1 FROM order_attempts WHERE mode=? AND account_key=? AND intent_id=?',
            (intent.mode, intent.accountKey, intent.clientIntentId)).fetchone():
            raise RiskDenied('DURABLE_COMMAND_REQUIRED')
        if identity.orderId < self.sdk.client._reqIdSeq:
            raise RiskDenied('SDK_ORDER_ID_PASSED')
        grant = self.ledger._grant(intent)
        if hashlib.sha256(canonical(grant).encode()).hexdigest() != permit.authorizationHash:
            raise RiskDenied('DISPATCH_AUTHORIZATION_CHANGED')
        self.ledger._validate(intent, context, now, exclude=intent.clientIntentId)
        return row

    def _receipt(self, digest):
        row = self.ledger._db.execute('SELECT state,reason FROM sdk_dispatch_attempts WHERE command_hash=?', (digest,)).fetchone()
        return DispatchReceipt(commandHash=digest, state=row[0], reason=row[1]) if row else None

    def _cancel_record(self, command):
        return next((row for row in self.ledger._records(command.identity.accountKey, command.identity.mode)
            if row.identity == command.identity and row.permId == command.permId), None)

    def _validate_cancel(self, command, permit_id):
        observer = self._sdk_ready()
        stored = self.ledger._db.execute('SELECT payload,revoked FROM sdk_dispatch_permits WHERE permit_id=?', (permit_id,)).fetchone()
        if stored is None or stored[1]:
            raise RiskDenied('DISPATCH_PERMIT_MISSING_OR_REVOKED')
        permit = DispatchPermit.model_validate_json(stored[0])
        identity = command.identity
        if (permit.commandHash != command_hash(command) or permit.purpose != 'cancel'
            or permit.bindingHash != binding_hash(self.binding)
            or (permit.accountKey, permit.mode, permit.channelKey, permit.sessionRevision) !=
            (self.binding.accountKey, self.binding.mode, self.channel_key, self.current_revision())
            or (identity.accountKey, identity.mode, identity.channelKey, identity.clientId) !=
            (permit.accountKey, permit.mode, permit.channelKey, self.binding.clientId)
            or identity.sessionRevision > permit.sessionRevision):
            raise RiskDenied('DISPATCH_PERMIT_SCOPE')
        if not permit.issuedAt <= self.clock() < permit.expiresAt:
            raise RiskDenied('DISPATCH_PERMIT_EXPIRED')
        row = self._cancel_record(command)
        if row is None or row.cancelState != 'SUBMITTING' or row.execution in ('FILLED','CANCELLED','REJECTED'):
            raise RiskDenied('DURABLE_CANCEL_REQUIRED')
        if row.source != permit.source or (row.source == 'fixture') != (observer.source == 'fixture'):
            raise RiskDenied('DISPATCH_SOURCE_SCOPE')
        if not self.ledger._db.execute('SELECT 1 FROM order_cancel_requests WHERE mode=? AND account_key=? AND intent_id=? AND request_id=?',
            (identity.mode, identity.accountKey, row.intent.clientIntentId, command.requestId)).fetchone():
            raise RiskDenied('DURABLE_CANCEL_REQUIRED')
        return row

    def cancel(self, command, permit_id):
        """An exact, independently confirmed cancellation; no new-risk grant."""
        if self.enabled is not True or self._closed:
            raise RiskDenied('BROKER_WRITE_DISABLED')
        command = CancellationCommand.model_validate(command.model_dump())
        digest = command_hash(command)
        with self.ledger.transaction():
            old = self._receipt(digest)
            if old is not None:
                return old
            if len(self._pending) >= 64:
                raise RiskDenied('SDK_PENDING_LIMIT')
            row = self._validate_cancel(command, permit_id)
            native_order = encode_cancel(command, self.binding)
            self.ledger._db.execute('INSERT INTO sdk_dispatch_attempts VALUES(?,?,?,?,?,?,?)',
                (digest, permit_id, command.identity.accountKey, command.identity.mode, 'WRITING', None, self.clock().isoformat()))
            append_event(self.ledger._db, command.identity.accountKey, 'SDK_CANCEL_CLAIMED', self.clock().isoformat(), {'commandHash': digest})
        failure = interrupted = None
        with self.ledger.transaction():
            original_send = self.sdk.client.conn.sendMsg
            wire_started = False
            def guarded_send(payload):
                nonlocal wire_started
                if wire_started:
                    raise RiskDenied('SDK_MULTIPLE_HANDOFF_FORBIDDEN')
                self._validate_cancel(command, permit_id)
                wire_started = True
                return original_send(payload)
            try:
                self._validate_cancel(command, permit_id)
                self.sdk.client.conn.sendMsg = guarded_send
                self.sdk.client.cancelOrder(native_order.orderId, '')
                if not wire_started:
                    raise RiskDenied('SDK_HANDOFF_MISSING')
                state, reason = 'SENT', None
            except RiskDenied as error:
                state, reason = ('UNKNOWN' if wire_started else 'DENIED'), error.code
                if not wire_started:
                    failure = error
            except Exception as error:
                state, reason = 'UNKNOWN', type(error).__name__
            except BaseException as error:
                state, reason, interrupted = 'UNKNOWN', type(error).__name__, error
            finally:
                self.sdk.client.conn.sendMsg = original_send
            self.ledger._db.execute('UPDATE sdk_dispatch_attempts SET state=?,reason=? WHERE command_hash=?', (state, reason, digest))
            append_event(self.ledger._db, command.identity.accountKey, 'SDK_CANCEL_' + state, self.clock().isoformat(),
                {'commandHash': digest, 'reason': reason})
        self.ledger.finish_cancel(row.intent.accountKey, row.intent.mode, row.intent.clientIntentId,
            error=reason if state != 'SENT' else None)
        if failure is not None:
            raise failure
        if interrupted is not None:
            raise interrupted
        if state == 'SENT':
            self._pending[digest] = (self.loop.call_later(self.ack_timeout_seconds, self._expire, digest, command), command)
        return DispatchReceipt(commandHash=digest, state=state, reason=reason)

    def dispatch(self, command, permit_id, *, instrument, context):
        if self.enabled is not True or self._closed:
            raise RiskDenied('BROKER_WRITE_DISABLED')
        if type(command) is not SubmissionCommand:
            raise RiskDenied('UNSUPPORTED_NATIVE_COMMAND')
        command = SubmissionCommand.model_validate(command.model_dump())
        context = RiskContext.model_validate(context.model_dump())
        digest = command_hash(command)
        with self.ledger.transaction():
            old = self._receipt(digest)
            if old is not None:
                return old  # even WRITING after interruption must never resend
            if len(self._pending) >= 64:
                raise RiskDenied('SDK_PENDING_LIMIT')
            self._validate(command, permit_id, context)
            native_contract, native_order = encode_order(command, self.binding, instrument)
            self.ledger._db.execute('INSERT INTO sdk_dispatch_attempts VALUES(?,?,?,?,?,?,?)',
                (digest, permit_id, command.intent.accountKey, command.intent.mode, 'WRITING', None, self.clock().isoformat()))
            append_event(self.ledger._db, command.intent.accountKey, 'SDK_DISPATCH_CLAIMED', self.clock().isoformat(), {'commandHash': digest})
        # A second committed marker exists before the wire call. Revocation
        # and this final check serialize on the same SQLite writer lock. There
        # is no await, retry or SDK queue between validation and hand-off.
        failure = None
        interrupted = None
        with self.ledger.transaction():
            try:
                self._validate(command, permit_id, context)
            except RiskDenied as error:
                failure = error
                state, reason = 'DENIED', error.code
            else:
                original_send = self.sdk.client.conn.sendMsg
                wire_started = False
                def guarded_send(payload):
                    nonlocal wire_started
                    if wire_started:
                        raise RiskDenied('SDK_MULTIPLE_HANDOFF_FORBIDDEN')
                    # Check again after native serialization, at the last
                    # synchronous boundary before handing bytes to transport.
                    self._validate(command, permit_id, context)
                    wire_started = True
                    return original_send(payload)
                try:
                    self.sdk.client.conn.sendMsg = guarded_send
                    self.sdk.client.placeOrder(command.identity.orderId, native_contract, native_order)
                    if not wire_started:
                        raise RiskDenied('SDK_HANDOFF_MISSING')
                    state, reason = 'SENT', None  # local hand-off, never broker ACK
                except RiskDenied as error:
                    state, reason = ('UNKNOWN' if wire_started else 'DENIED'), error.code
                    if not wire_started:
                        failure = error
                except Exception as error:
                    state, reason = 'UNKNOWN', type(error).__name__
                except BaseException as error:
                    state, reason, interrupted = 'UNKNOWN', type(error).__name__, error
                finally:
                    self.sdk.client.conn.sendMsg = original_send
                    self.sdk.client.updateReqId(command.identity.orderId + 1)
            self.ledger._db.execute('UPDATE sdk_dispatch_attempts SET state=?,reason=? WHERE command_hash=?', (state, reason, digest))
            append_event(self.ledger._db, command.intent.accountKey, 'SDK_DISPATCH_' + state, self.clock().isoformat(),
                {'commandHash': digest, 'reason': reason})
        if state in ('DENIED', 'UNKNOWN'):
            self.ledger.finish_submission(command.intent.accountKey, command.intent.mode, command.intent.clientIntentId, reason=reason)
        if failure is not None:
            raise failure
        if interrupted is not None:
            raise interrupted
        if state == 'SENT':
            self._pending[digest] = (self.loop.call_later(self.ack_timeout_seconds, self._expire, digest, command), command)
        return DispatchReceipt(commandHash=digest, state=state, reason=reason)
