"""Immutable, source-labelled strategy definitions for the IBKR terminal."""
from contextlib import contextmanager
from datetime import datetime, timezone
from decimal import Decimal
import hashlib
from pathlib import Path
import sqlite3
from threading import RLock
from typing import Annotated, Literal

from pydantic import AwareDatetime, Field, StringConstraints, model_validator

from .risk import Amount, Identifier, canonical
from .schemas import Contract


RuleText = Annotated[str, StringConstraints(strict=True, min_length=1, max_length=2000)]


class StrategyConflict(ValueError):
    pass


class SmaCrossSignal(Contract):
    kind: Literal['sma_cross']
    priceField: Literal['close']
    fastWindow: int = Field(ge=1, le=100, strict=True)
    slowWindow: int = Field(ge=2, le=500, strict=True)
    entryWhen: Literal['FAST_ABOVE_SLOW']
    exitWhen: Literal['FAST_AT_OR_BELOW_SLOW']

    @model_validator(mode='after')
    def ordered_windows(self):
        if self.fastWindow >= self.slowWindow:
            raise ValueError('fast window must be below slow window')
        return self


class FixedQuantitySizing(Contract):
    kind: Literal['fixed_quantity']
    targetQuantity: Amount

    @model_validator(mode='after')
    def positive_whole_quantity(self):
        value = Decimal(self.targetQuantity)
        if value <= 0 or value != value.to_integral_value():
            raise ValueError('fixed quantity must be positive whole shares')
        return self


class StrategyCosts(Contract):
    commissionPerOrder: Amount
    commissionPerShare: Amount
    slippageBps: Amount

    @model_validator(mode='after')
    def bounded_slippage(self):
        if Decimal(self.slippageBps) > 1000:
            raise ValueError('slippage assumption exceeds supported bound')
        return self


class StrategyRisk(Contract):
    allowShort: Literal[False]
    maxPositionQuantity: Amount

    @model_validator(mode='after')
    def positive_whole_limit(self):
        value = Decimal(self.maxPositionQuantity)
        if value <= 0 or value != value.to_integral_value():
            raise ValueError('position limit must be positive whole shares')
        return self


class StrategyDefinition(Contract):
    strategyId: Identifier
    version: Annotated[str, StringConstraints(strict=True, pattern=r'^[0-9]+\.[0-9]+\.[0-9]+$', max_length=32)]
    origin: Literal['fixture', 'user']
    name: Identifier
    universe: tuple[int, ...] = Field(min_length=1)
    barInterval: Literal['1D', '1h']
    entryRule: RuleText
    exitRule: RuleText
    parameters: dict[Identifier, Identifier]
    signal: SmaCrossSignal
    positionSizing: FixedQuantitySizing
    costs: StrategyCosts
    risk: StrategyRisk
    versionNotes: RuleText

    @model_validator(mode='after')
    def valid_definition(self):
        prefix = 'example:' if self.origin == 'fixture' else 'user:'
        if not self.strategyId.startswith(prefix):
            raise ValueError('strategy origin namespace mismatch')
        if any(value <= 0 for value in self.universe) or len(set(self.universe)) != len(self.universe):
            raise ValueError('invalid universe')
        if Decimal(self.positionSizing.targetQuantity) > Decimal(self.risk.maxPositionQuantity):
            raise ValueError('target quantity exceeds strategy position limit')
        return self


class StrategyRecord(Contract):
    definition: StrategyDefinition
    strategyHash: str
    createdAt: AwareDatetime


class StrategyCatalog:
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
            if version not in (0, 1):
                raise StrategyConflict('UNSUPPORTED_STRATEGY_DATABASE')
            self._db.execute('''CREATE TABLE IF NOT EXISTS terminal_strategies (
                strategy_id TEXT NOT NULL, version TEXT NOT NULL, strategy_hash TEXT NOT NULL,
                payload TEXT NOT NULL, created_epoch REAL NOT NULL, PRIMARY KEY(strategy_id,version))''')
            self._db.execute('PRAGMA user_version=1')

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

    @staticmethod
    def _hash(definition):
        return hashlib.sha256(canonical(definition).encode()).hexdigest()

    def save(self, definition):
        definition = StrategyDefinition.model_validate(definition.model_dump())
        if definition.origin == 'fixture' and not self.allow_fixtures:
            raise StrategyConflict('FIXTURE_STRATEGY_DISABLED')
        strategy_hash = self._hash(definition)
        with self.transaction():
            row = self._db.execute('SELECT strategy_hash,payload,created_epoch FROM terminal_strategies WHERE strategy_id=? AND version=?',
                (definition.strategyId, definition.version)).fetchone()
            if row:
                if row[0] != strategy_hash or canonical(StrategyDefinition.model_validate_json(row[1])) != canonical(definition):
                    raise StrategyConflict('STRATEGY_VERSION_IMMUTABLE')
                return StrategyRecord(definition=definition, strategyHash=row[0], createdAt=datetime.fromtimestamp(row[2], timezone.utc))
            now = self.clock()
            self._db.execute('INSERT INTO terminal_strategies VALUES(?,?,?,?,?)',
                (definition.strategyId, definition.version, strategy_hash, canonical(definition), now.timestamp()))
            return StrategyRecord(definition=definition, strategyHash=strategy_hash, createdAt=now)

    def list(self, strategy_id=None):
        query = 'SELECT strategy_hash,payload,created_epoch FROM terminal_strategies'
        args = ()
        if strategy_id is not None:
            query += ' WHERE strategy_id=?'
            args = (strategy_id,)
        query += ' ORDER BY created_epoch,rowid'
        with self._lock:
            rows = self._db.execute(query, args).fetchall()
        return [StrategyRecord(definition=StrategyDefinition.model_validate_json(payload), strategyHash=digest,
            createdAt=datetime.fromtimestamp(created, timezone.utc)) for digest, payload, created in rows]

    def close(self):
        with self._lock:
            self._db.close()

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()
