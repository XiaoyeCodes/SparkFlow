"""Explicit account binding; revision-scoped snapshots and fail-closed recovery."""
from typing import Literal
from threading import RLock
import asyncio

from pydantic import Field, ValidationError, model_validator

from .schemas import Contract, Snapshot, Mode, Metrics, Capabilities
from .store import SnapshotStore
from .events import Subscription


class AccountBinding(Contract):
    mode: Literal['paper', 'live']
    accountKey: str = Field(min_length=3)
    brokerAccount: str = Field(min_length=1)
    confirmed: Literal[True]
    host: Literal['127.0.0.1'] = '127.0.0.1'
    port: int = Field(default=4002, ge=1, le=65535)
    # ib_async clientId=0 auto-binds TWS orders even on a readonly connection.
    clientId: int = Field(default=78, ge=1)
    baseCurrency: str | None = None
    readonly: bool = True

    @model_validator(mode='after')
    def namespace(self):
        if not self.accountKey.startswith(f'{self.mode}:'):
            raise ValueError('binding namespace mismatch')
        if self.mode == 'live' and self.readonly is not True:
            raise ValueError('live bindings must remain readonly')
        return self


def empty_snapshot(mode: Mode, revision: int = 0, account_key: str | None = None) -> Snapshot:
    return Snapshot(schemaVersion=1, snapshotId='', accountKey=account_key or f'{mode}:unbound', mode=mode,
        sessionRevision=revision, sequence=0, source='ibkr', testData=False, asOf=None, connection='unconfigured',
        state='permission-required', baseCurrency=None, metrics=Metrics(), cash=(), positions=(), orders=(), quotes=(),
        capabilities=Capabilities(), missing=('account-binding', 'quotes'), detail='等待本地账户绑定与官方客户端登录。')


class AccountSession:
    def __init__(self, mode: Mode, store: SnapshotStore):
        self.mode = mode
        self.store = store
        self.binding: AccountBinding | None = None
        self.revision = 0
        self._snapshot = empty_snapshot(mode)
        self._lock = RLock()
        self._subscribers: set[Subscription] = set()

    @property
    def subscriber_count(self):
        with self._lock:
            return len(self._subscribers)

    def subscribe(self, max_pending=64):
        with self._lock:
            if len(self._subscribers) >= 8:
                raise ValueError('subscriber limit reached')
            subscription = Subscription(asyncio.get_running_loop(), asyncio.Queue(maxsize=max(1, max_pending)))
            self._subscribers.add(subscription)
            return subscription

    def unsubscribe(self, subscription):
        with self._lock:
            subscription.active = False
            self._subscribers.discard(subscription)

    def _publish(self, previous):
        current = self._snapshot
        scope = {key: getattr(current, key) for key in ('mode', 'accountKey', 'sessionRevision', 'sequence')}
        if previous.sessionRevision != current.sessionRevision:
            event = {**scope, 'kind': 'resync-required', 'reason': 'session-revision-changed'}
        else:
            before, after = previous.model_dump(mode='json'), current.model_dump(mode='json')
            event = {**scope, 'kind': 'snapshot.patch', 'previousSequence': previous.sequence,
                'payload': {key: value for key, value in after.items() if key not in scope and before[key] != value}}
        for subscription in self._subscribers:
            subscription.push(event)

    def bind(self, binding: AccountBinding):
        # Revalidate model_copy callers as well as user JSON.
        binding = AccountBinding.model_validate(binding.model_dump())
        if binding.mode != self.mode:
            raise ValueError('binding mode mismatch')
        with self._lock:
            known_binding = self.store.ensure_binding(self.mode, binding.accountKey, binding.brokerAccount)
            cached = self.store.load(self.mode, binding.accountKey) if known_binding else None
            previous = self._snapshot
            self.revision += 1
            self.binding = binding
            self._snapshot = cached.model_copy(update={'sessionRevision': self.revision, 'sequence': 0, 'state': 'stale', 'connection': 'reconciling', 'detail': '已恢复历史快照；等待券商对账。'}) if cached else empty_snapshot(self.mode, self.revision, binding.accountKey)
            self._publish(previous)

    def accept(self, snapshot: Snapshot) -> bool:
        try:
            snapshot = Snapshot.model_validate(snapshot.model_dump())
        except ValidationError:
            return False
        with self._lock:
            if not self.binding or snapshot.mode != self.mode or snapshot.accountKey != self.binding.accountKey or snapshot.sessionRevision != self.revision or snapshot.sequence <= self._snapshot.sequence:
                return False
            self.store.save(snapshot)
            previous = self._snapshot
            self._snapshot = snapshot
            self._publish(previous)
            return True

    def disconnected(self, detail='券商连接断开；缓存不能代表当前账户。', *, expected_revision=None):
        with self._lock:
            if expected_revision is not None and expected_revision != self.revision:
                return False
            if self._snapshot.connection == 'disconnected':
                return False
            previous = self._snapshot
            self.revision += 1
            self._snapshot = self._snapshot.model_copy(update={'sessionRevision': self.revision, 'connection': 'disconnected', 'state': 'stale' if self._snapshot.snapshotId else 'error', 'detail': detail})
            self._publish(previous)
            return True

    def snapshot(self) -> Snapshot:
        with self._lock:
            return self._snapshot
