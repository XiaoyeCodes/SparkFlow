"""Durable paper strategy state that reuses the unified order risk ledger."""
from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timezone
from decimal import Decimal
from hashlib import sha256
from pathlib import Path
import sqlite3
from threading import RLock
from typing import Literal
from uuid import uuid4

from pydantic import AwareDatetime, Field, model_validator

from .orders import IntentConflict, OrderLedger
from .risk import Amount, Identifier, OrderIntent, RiskContext, RiskDenied, canonical
from .schemas import Contract
from .signals import generate_target_signals
from .strategy import StrategyRecord


class RuntimeStateError(ValueError):
    """A fail-closed state transition that must commit before surfacing."""


class RuntimeSignal(Contract):
    strategyHash: str = Field(pattern=r'^[0-9a-f]{64}$')
    accountKey: Identifier
    mode: Literal['paper', 'live']
    sequence: int = Field(gt=0, strict=True)
    observedAt: AwareDatetime
    snapshotId: Identifier
    conId: int = Field(gt=0, strict=True)
    targetQuantity: Amount
    source: Literal['fixture', 'ibkr']

    @model_validator(mode='after')
    def long_whole_target(self):
        target = Decimal(self.targetQuantity)
        if target != target.to_integral_value():
            raise ValueError('runtime target must be whole shares')
        if not self.accountKey.startswith(f'{self.mode}:'):
            raise ValueError('signal account namespace mismatch')
        return self


class StrategyActivation(Contract):
    activationId: Identifier
    accountKey: Identifier
    mode: Literal['paper']
    sessionRevision: int = Field(gt=0, strict=True)
    strategyId: Identifier
    strategyVersion: Identifier
    strategyHash: str = Field(pattern=r'^[0-9a-f]{64}$')
    authorizationId: Identifier
    testData: bool
    state: Literal['STOPPED', 'RUNNING', 'PAUSED', 'HALTED', 'RECOVERY_REQUIRED', 'EXPIRED']
    activatedAt: AwareDatetime
    expiresAt: AwareDatetime
    updatedAt: AwareDatetime
    lastSignalSequence: int = Field(ge=0)
    lastSnapshotId: str | None = None
    reason: str | None = None


class RuntimeDecision(Contract):
    activationId: Identifier
    sequence: int
    state: Literal['NOOP', 'ORDER_PERSISTED', 'DENIED']
    reason: str
    clientIntentId: str | None
    targetQuantity: Amount
    deltaQuantity: str
    decidedAt: AwareDatetime


def runtime_strategy_version(record: StrategyRecord):
    return f'{record.definition.strategyId}@{record.definition.version}:{record.strategyHash[:16]}'


def runtime_signals_from_definition(record: StrategyRecord, observations, *, account_key, mode, source, snapshot_id):
    """Map the shared pure signal decisions into scoped runtime events."""
    return tuple(RuntimeSignal(strategyHash=record.strategyHash, accountKey=account_key, mode=mode,
        sequence=index, observedAt=row.observedAt, snapshotId=snapshot_id(row), conId=row.conId,
        targetQuantity=row.targetQuantity, source=source)
        for index, row in enumerate(generate_target_signals(record, observations), start=1))


class StrategyRuntime:
    """Persists signals and creates deterministic intents; it has no broker transport."""

    def __init__(self, path: Path, orders: OrderLedger, *, allow_fixtures=False, clock=None):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.orders = orders
        self.allow_fixtures = allow_fixtures
        self.clock = clock or (lambda: datetime.now(timezone.utc))
        self._lock = RLock()
        self._db = sqlite3.connect(path, isolation_level=None, check_same_thread=False, timeout=10)
        self._db.execute('PRAGMA journal_mode=WAL')
        self._db.execute('PRAGMA synchronous=FULL')
        with self.transaction():
            self._db.execute('''CREATE TABLE IF NOT EXISTS terminal_strategy_activations (
                activation_id TEXT PRIMARY KEY, payload TEXT NOT NULL)''')
            self._db.execute('''CREATE TABLE IF NOT EXISTS terminal_strategy_decisions (
                activation_id TEXT NOT NULL, sequence INTEGER NOT NULL, signal_hash TEXT NOT NULL,
                payload TEXT NOT NULL, PRIMARY KEY(activation_id,sequence))''')
            rows = self._db.execute('SELECT activation_id,payload FROM terminal_strategy_activations').fetchall()
            for activation_id, payload in rows:
                value = StrategyActivation.model_validate_json(payload)
                if value.state in ('RUNNING', 'PAUSED'):
                    updated = value.model_copy(update={'state': 'RECOVERY_REQUIRED', 'updatedAt': self.clock(), 'reason': 'PROCESS_RESTARTED'})
                    self._db.execute('UPDATE terminal_strategy_activations SET payload=? WHERE activation_id=?', (canonical(updated), activation_id))

    @contextmanager
    def transaction(self):
        with self._lock:
            self._db.execute('BEGIN IMMEDIATE')
            try:
                yield
            except RuntimeStateError:
                self._db.commit()
                raise
            except BaseException:
                self._db.rollback()
                raise
            else:
                self._db.commit()

    def _get_locked(self, activation_id):
        row = self._db.execute('SELECT payload FROM terminal_strategy_activations WHERE activation_id=?', (activation_id,)).fetchone()
        if row is None:
            raise ValueError('ACTIVATION_MISSING')
        return StrategyActivation.model_validate_json(row[0])

    def get(self, activation_id):
        with self._lock:
            return self._get_locked(activation_id)

    def list(self, account_key=None):
        with self._lock:
            rows = self._db.execute('SELECT payload FROM terminal_strategy_activations ORDER BY rowid DESC').fetchall()
        values = [StrategyActivation.model_validate_json(row[0]) for row in rows]
        return [value for value in values if account_key is None or value.accountKey == account_key]

    def _save_activation(self, value):
        self._db.execute('UPDATE terminal_strategy_activations SET payload=? WHERE activation_id=?', (canonical(value), value.activationId))
        return value

    def activate(self, strategy: StrategyRecord, *, account_key, mode, session_revision, authorization_id,
        expires_at, explicit: bool):
        strategy = StrategyRecord.model_validate(strategy.model_dump())
        now = self.clock()
        if explicit is not True:
            raise ValueError('EXPLICIT_ACTIVATION_REQUIRED')
        if mode == 'live':
            raise ValueError('LIVE_RUNTIME_DISABLED')
        if mode != 'paper' or not account_key.startswith('paper:'):
            raise ValueError('ACCOUNT_SCOPE_MISMATCH')
        if strategy.definition.origin == 'fixture' and not self.allow_fixtures:
            raise ValueError('FIXTURE_RUNTIME_DISABLED')
        if expires_at <= now:
            raise ValueError('ACTIVATION_EXPIRED')
        value = StrategyActivation(activationId=f'activation:{uuid4().hex}', accountKey=account_key, mode='paper',
            sessionRevision=session_revision, strategyId=strategy.definition.strategyId,
            strategyVersion=runtime_strategy_version(strategy), strategyHash=strategy.strategyHash,
            authorizationId=authorization_id, testData=strategy.definition.origin == 'fixture', state='STOPPED',
            activatedAt=now, expiresAt=expires_at, updatedAt=now, lastSignalSequence=0)
        with self.transaction():
            self._db.execute('INSERT INTO terminal_strategy_activations VALUES(?,?)', (value.activationId, canonical(value)))
        return value

    def resume(self, activation_id, context: RiskContext):
        context = RiskContext.model_validate(context.model_dump())
        with self.transaction():
            value = self._get_locked(activation_id)
            if self.clock() >= value.expiresAt:
                self._save_activation(value.model_copy(update={'state': 'EXPIRED', 'updatedAt': self.clock(), 'reason': 'ACTIVATION_EXPIRED'}))
                raise RuntimeStateError('ACTIVATION_EXPIRED')
            fixture = context.source == 'fixture'
            if (value.accountKey, value.mode, value.sessionRevision) != (context.accountKey, context.mode, context.sessionRevision) or fixture != value.testData:
                raise ValueError('ACCOUNT_SCOPE_MISMATCH')
            if not context.connected or not context.reconciled or context.halted:
                raise ValueError('RECONCILIATION_REQUIRED')
            return self._save_activation(value.model_copy(update={'state': 'RUNNING', 'updatedAt': self.clock(),
                'lastSnapshotId': context.snapshotId, 'reason': None}))

    def stop(self, activation_id):
        with self.transaction():
            value = self._get_locked(activation_id)
            return self._save_activation(value.model_copy(update={'state': 'STOPPED', 'updatedAt': self.clock(),
                'reason': 'USER_STOPPED_NEW_SIGNALS'}))

    def _record(self, signal, decision, activation):
        self._db.execute('INSERT INTO terminal_strategy_decisions VALUES(?,?,?,?)',
            (activation.activationId, signal.sequence, sha256(canonical(signal).encode()).hexdigest(), canonical(decision)))
        return self._save_activation(activation.model_copy(update={'lastSignalSequence': signal.sequence,
            'lastSnapshotId': signal.snapshotId, 'updatedAt': self.clock()}))

    def process(self, activation_id, signal: RuntimeSignal, context: RiskContext):
        signal = RuntimeSignal.model_validate(signal.model_dump())
        context = RiskContext.model_validate(context.model_dump())
        signal_hash = sha256(canonical(signal).encode()).hexdigest()
        with self.transaction():
            previous = self._db.execute('SELECT signal_hash,payload FROM terminal_strategy_decisions WHERE activation_id=? AND sequence=?',
                (activation_id, signal.sequence)).fetchone()
            if previous:
                if previous[0] != signal_hash:
                    value = self._get_locked(activation_id)
                    self._save_activation(value.model_copy(update={'state': 'HALTED', 'updatedAt': self.clock(), 'reason': 'SIGNAL_SEQUENCE_CONFLICT'}))
                    raise RuntimeStateError('SIGNAL_SEQUENCE_CONFLICT')
                return RuntimeDecision.model_validate_json(previous[1])
            value = self._get_locked(activation_id)
            if value.state != 'RUNNING':
                raise ValueError(f'RUNTIME_NOT_RUNNING:{value.state}')
            if self.clock() >= value.expiresAt:
                self._save_activation(value.model_copy(update={'state': 'EXPIRED', 'updatedAt': self.clock(), 'reason': 'ACTIVATION_EXPIRED'}))
                raise RuntimeStateError('ACTIVATION_EXPIRED')
            if signal.sequence != value.lastSignalSequence + 1:
                self._save_activation(value.model_copy(update={'state': 'RECOVERY_REQUIRED', 'updatedAt': self.clock(), 'reason': 'SIGNAL_GAP'}))
                raise RuntimeStateError('SIGNAL_GAP')
            fixture = signal.source == 'fixture'
            if (signal.accountKey, signal.mode, signal.strategyHash) != (value.accountKey, value.mode, value.strategyHash) or fixture != value.testData:
                self._save_activation(value.model_copy(update={'state': 'HALTED', 'updatedAt': self.clock(), 'reason': 'SIGNAL_SCOPE_MISMATCH'}))
                raise RuntimeStateError('SIGNAL_SCOPE_MISMATCH')
            if (context.accountKey, context.mode, context.sessionRevision, context.snapshotId) != (value.accountKey, value.mode, value.sessionRevision, signal.snapshotId):
                self._save_activation(value.model_copy(update={'state': 'RECOVERY_REQUIRED', 'updatedAt': self.clock(), 'reason': 'RECONCILIATION_REQUIRED'}))
                raise RuntimeStateError('RECONCILIATION_REQUIRED')
            if signal.conId != context.conId or signal.observedAt > context.quoteAt:
                self._save_activation(value.model_copy(update={'state': 'HALTED', 'updatedAt': self.clock(), 'reason': 'SIGNAL_DATA_MISMATCH'}))
                raise RuntimeStateError('SIGNAL_DATA_MISMATCH')
            current = next((Decimal(row.quantity) for row in context.holdings if row.conId == signal.conId), Decimal(0))
            target = Decimal(signal.targetQuantity)
            delta = target - current
            if delta == 0:
                decision = RuntimeDecision(activationId=activation_id, sequence=signal.sequence, state='NOOP', reason='TARGET_ALREADY_HELD',
                    clientIntentId=None, targetQuantity=signal.targetQuantity, deltaQuantity='0', decidedAt=self.clock())
                self._record(signal, decision, value)
                return decision
            client_intent_id = f'strategy:{activation_id.split(":", 1)[-1]}:{signal.sequence}'
            if context.referencePrice is None:
                decision = RuntimeDecision(activationId=activation_id, sequence=signal.sequence, state='DENIED', reason='MISSING_ACCOUNT_DATA',
                    clientIntentId=None, targetQuantity=signal.targetQuantity, deltaQuantity=format(delta, 'f'), decidedAt=self.clock())
                self._record(signal, decision, value)
                return decision
            intent = OrderIntent(accountKey=value.accountKey, mode=value.mode, clientIntentId=client_intent_id,
                conId=signal.conId, side='BUY' if delta > 0 else 'SELL', quantity=format(abs(delta), 'f'),
                orderType='LMT', limitPrice=context.referencePrice, tif='DAY', strategyVersion=value.strategyVersion,
                authorizationId=value.authorizationId, sessionRevision=value.sessionRevision)
            try:
                record = self.orders.reserve(intent, context)
                decision = RuntimeDecision(activationId=activation_id, sequence=signal.sequence, state='ORDER_PERSISTED', reason='UNIFIED_RISK_PASSED',
                    clientIntentId=record.intent.clientIntentId, targetQuantity=signal.targetQuantity, deltaQuantity=format(delta, 'f'), decidedAt=self.clock())
            except RiskDenied as error:
                decision = RuntimeDecision(activationId=activation_id, sequence=signal.sequence, state='DENIED', reason=error.code,
                    clientIntentId=None, targetQuantity=signal.targetQuantity, deltaQuantity=format(delta, 'f'), decidedAt=self.clock())
            except IntentConflict:
                self._save_activation(value.model_copy(update={'state': 'HALTED', 'updatedAt': self.clock(), 'reason': 'ORDER_INTENT_CONFLICT'}))
                raise RuntimeStateError('ORDER_INTENT_CONFLICT') from None
            self._record(signal, decision, value)
            return decision

    def decisions(self, activation_id):
        with self._lock:
            rows = self._db.execute('SELECT payload FROM terminal_strategy_decisions WHERE activation_id=? ORDER BY sequence', (activation_id,)).fetchall()
        return [RuntimeDecision.model_validate_json(row[0]) for row in rows]

    def close(self):
        with self._lock:
            self._db.close()

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()
