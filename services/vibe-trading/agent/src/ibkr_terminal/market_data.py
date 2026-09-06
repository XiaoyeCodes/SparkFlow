"""Account-scoped historical bars with explicit source, freshness and cache state."""
from __future__ import annotations

from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import sqlite3
import threading
from typing import Literal

from pydantic import AwareDatetime, Field, model_validator

from .schemas import Contract, DecimalText, Snapshot
from .broker_views import decimal_text


Period = Literal['1D', '5D', '1M', '6M', '1Y']
MarketState = Literal['ready', 'empty', 'error', 'stale', 'permission-required']


class HistoricalBar(Contract):
    time: AwareDatetime
    open: DecimalText
    high: DecimalText
    low: DecimalText
    close: DecimalText
    volume: DecimalText | None = None

    @model_validator(mode='after')
    def valid_ohlc(self):
        from decimal import Decimal
        values = [Decimal(self.open), Decimal(self.high), Decimal(self.low), Decimal(self.close)]
        if min(values) < 0 or Decimal(self.high) < max(Decimal(self.open), Decimal(self.close), Decimal(self.low)) \
            or Decimal(self.low) > min(Decimal(self.open), Decimal(self.close), Decimal(self.high)):
            raise ValueError('invalid OHLC bar')
        if self.volume is not None and Decimal(self.volume) < 0:
            raise ValueError('negative volume')
        return self


def _hash_payload(value) -> str:
    body = value.model_dump(mode='json', exclude={'dataHash', 'state', 'missing'}) if hasattr(value, 'model_dump') else value
    return sha256(json.dumps(body, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()


class HistoricalDataset(Contract):
    schemaVersion: Literal[1] = 1
    accountKey: str
    mode: Literal['paper', 'live']
    snapshotId: str
    conId: int = Field(gt=0)
    period: Period
    barSize: str
    timezone: str
    source: str
    testData: bool
    asOf: AwareDatetime
    state: MarketState
    missing: tuple[str, ...] = ()
    bars: tuple[HistoricalBar, ...] = ()
    dataHash: str = Field(pattern=r'^[0-9a-f]{64}$')

    @model_validator(mode='after')
    def integrity(self):
        if not self.accountKey.startswith(f'{self.mode}:'):
            raise ValueError('dataset namespace mismatch')
        if any(left.time >= right.time for left, right in zip(self.bars, self.bars[1:])):
            raise ValueError('bar times must be strictly increasing')
        if self.state == 'ready' and not self.bars:
            raise ValueError('ready dataset requires bars')
        if self.state not in ('ready', 'stale') and self.bars:
            raise ValueError('unavailable dataset cannot carry bars')
        if _hash_payload(self) != self.dataHash:
            raise ValueError('dataset hash mismatch')
        return self


def dataset(**values) -> HistoricalDataset:
    normalized = {**values, 'schemaVersion': 1, 'bars': tuple(values.get('bars', ())), 'missing': tuple(values.get('missing', ())), 'dataHash': '0' * 64}
    unchecked = HistoricalDataset.model_construct(**normalized)
    normalized['dataHash'] = _hash_payload(unchecked)
    return HistoricalDataset.model_validate(normalized)


class MarketDataStore:
    def __init__(self, path: Path, *, allow_fixtures=False):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.allow_fixtures = allow_fixtures
        self._lock = threading.RLock()
        self._db = sqlite3.connect(path, check_same_thread=False)
        with self._db:
            self._db.execute('PRAGMA journal_mode=WAL')
            self._db.execute('''CREATE TABLE IF NOT EXISTS historical_market_data (
                mode TEXT NOT NULL, account_key TEXT NOT NULL, con_id INTEGER NOT NULL, period TEXT NOT NULL,
                payload TEXT NOT NULL, PRIMARY KEY(mode,account_key,con_id,period))''')

    def save(self, value: HistoricalDataset):
        value = HistoricalDataset.model_validate(value.model_dump())
        if value.testData and not self.allow_fixtures:
            raise ValueError('fixture rejected by production market data store')
        payload = value.model_dump_json()
        with self._lock, self._db:
            row = self._db.execute('SELECT payload FROM historical_market_data WHERE mode=? AND account_key=? AND con_id=? AND period=?',
                (value.mode, value.accountKey, value.conId, value.period)).fetchone()
            if row is not None:
                current = HistoricalDataset.model_validate_json(row[0])
                if value.asOf < current.asOf:
                    raise ValueError('older market dataset rejected')
            self._db.execute('''INSERT INTO historical_market_data VALUES(?,?,?,?,?)
                ON CONFLICT(mode,account_key,con_id,period) DO UPDATE SET payload=excluded.payload''',
                (value.mode, value.accountKey, value.conId, value.period, payload))
        return value

    def get(self, mode, account_key, con_id, period, *, now: datetime, max_age_seconds=300):
        now = now.astimezone(timezone.utc)
        with self._lock:
            row = self._db.execute('SELECT payload FROM historical_market_data WHERE mode=? AND account_key=? AND con_id=? AND period=?',
                (mode, account_key, con_id, period)).fetchone()
        if row is None:
            return None
        value = HistoricalDataset.model_validate_json(row[0])
        if value.testData and not self.allow_fixtures:
            raise ValueError('fixture rejected by production market data store')
        age = (now - value.asOf.astimezone(timezone.utc)).total_seconds()
        if (age < 0 or age > max_age_seconds) and value.state in ('ready', 'empty'):
            return value.model_copy(update={'state': 'stale', 'missing': tuple(sorted(set(value.missing) | {'stale-cache'}))})
        return value

    def close(self):
        with self._lock:
            self._db.close()

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()


_requests = {
    '1D': ('1 D', '1 min'),
    '5D': ('5 D', '15 mins'),
    '1M': ('1 M', '1 hour'),
    '6M': ('6 M', '1 day'),
    '1Y': ('1 Y', '1 day'),
}


def _bar_time(value):
    from datetime import date, time
    if isinstance(value, datetime):
        if value.tzinfo is None:
            raise ValueError('IBKR historical bar timestamp lacks timezone')
        return value.astimezone(timezone.utc)
    if isinstance(value, date):
        return datetime.combine(value, time.min, tzinfo=timezone.utc)
    if isinstance(value, str):
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
        return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed.astimezone(timezone.utc)
    raise ValueError('unsupported IBKR historical bar timestamp')


def bind_snapshot(value, snapshot):
    if (value.accountKey,value.mode,value.testData)!=(snapshot.accountKey,snapshot.mode,snapshot.testData):
        raise ValueError('historical account scope mismatch')
    fields=value.model_dump(exclude={'dataHash','schemaVersion'})
    fields.update(snapshotId=snapshot.snapshotId,bars=value.bars)
    return dataset(**fields)


async def fetch_ibkr_historical(sdk, snapshot, con_id: int, period: str, *, now: datetime, test_data: bool, resolved_contract=None):
    """Call the SDK's historical read method with a fixed first-phase contract."""
    from ib_async import Contract
    snapshot = Snapshot.model_validate(snapshot.model_dump())
    if period not in _requests:
        raise ValueError('unsupported period')
    matches = [position for position in snapshot.positions if position.conId == con_id]
    if resolved_contract is not None:
        if resolved_contract.conId!=con_id or resolved_contract.secType!='STK' or resolved_contract.currency!='USD':
            raise ValueError('unsupported resolved contract')
        currency=resolved_contract.currency
    elif len(matches) != 1:
        raise ValueError('contract is not in current account snapshot')
    else:
        currency=matches[0].currency
    if currency != 'USD':
        raise ValueError('first phase historical data supports USD stock/ETF positions only')
    duration, bar_size = _requests[period]
    contract = Contract(conId=con_id, secType='STK', exchange='SMART', currency=currency)
    returned = await sdk.reqHistoricalDataAsync(contract, '', duration, bar_size, 'TRADES', True,
        formatDate=2, keepUpToDate=False, timeout=8)
    bars = []
    for row in returned:
        values = {name: decimal_text(getattr(row, name, None)) for name in ('open', 'high', 'low', 'close')}
        if any(value is None for value in values.values()):
            raise ValueError('IBKR historical bar contains invalid OHLC')
        volume = decimal_text(getattr(row, 'volume', None))
        if volume is not None and volume.startswith('-'):
            volume = None
        bars.append(HistoricalBar(time=_bar_time(getattr(row, 'date', None)), volume=volume, **values))
    return dataset(accountKey=snapshot.accountKey, mode=snapshot.mode, snapshotId=snapshot.snapshotId,
        conId=con_id, period=period, barSize=bar_size, timezone='UTC',
        source='fixture.ibkr.historicalData' if test_data else 'ibkr.historicalData', testData=test_data,
        asOf=now, state='ready' if bars else 'empty', missing=(), bars=bars)
