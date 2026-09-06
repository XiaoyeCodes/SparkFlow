from datetime import datetime, timedelta, timezone

import pytest
from pydantic import ValidationError

from src.ibkr_terminal.market_data import HistoricalBar, HistoricalDataset, MarketDataStore, dataset


NOW = datetime(2026, 9, 5, 12, 0, tzinfo=timezone.utc)


def bars(count=3):
    return [HistoricalBar(time=NOW - timedelta(minutes=count-index), open=str(100 + index), high=str(101 + index),
        low=str(99 + index), close=str(100 + index), volume=str(1000 + index)) for index in range(count)]


def sample(**changes):
    values = dict(accountKey='paper:engineering', mode='paper', snapshotId='fixture-risk-v1', conId=12,
        period='1D', barSize='1 min', timezone='UTC', source='fixture.historical', testData=True,
        asOf=NOW, state='ready', missing=(), bars=bars())
    values.update(changes)
    return dataset(**values)


def test_dataset_uses_decimal_text_sorted_aware_times_and_immutable_hash():
    value = sample()
    assert len(value.dataHash) == 64 and value.bars[0].time < value.bars[-1].time
    assert value.dataHash == sample().dataHash
    with pytest.raises(ValidationError):
        sample(bars=[HistoricalBar(time=NOW, open=1.0, high='2', low='1', close='2', volume='1')])
    with pytest.raises(ValueError, match='strictly increasing'):
        sample(bars=list(reversed(bars())))


def test_store_is_account_scoped_rejects_fixtures_in_production_and_marks_old_cache_stale(tmp_path):
    with MarketDataStore(tmp_path / 'production.sqlite') as store:
        with pytest.raises(ValueError, match='fixture rejected'):
            store.save(sample())
    with MarketDataStore(tmp_path / 'fixture.sqlite', allow_fixtures=True) as store:
        stored = store.save(sample())
        assert store.get('paper', 'paper:engineering', 12, '1D', now=NOW).dataHash == stored.dataHash
        assert store.get('paper', 'paper:other', 12, '1D', now=NOW) is None
        stale = store.get('paper', 'paper:engineering', 12, '1D', now=NOW + timedelta(minutes=10), max_age_seconds=60)
        assert stale.state == 'stale' and stale.dataHash == stored.dataHash


def test_empty_and_permission_required_are_distinct_from_ready_data():
    empty = sample(state='empty', bars=[])
    blocked = sample(state='permission-required', bars=[], missing=('historical-market-data',))
    assert empty.state == 'empty' and not empty.missing
    assert blocked.state == 'permission-required' and blocked.missing == ('historical-market-data',)


def test_resolved_watch_contract_can_load_history_without_inventing_a_position(api_event_loop):
    from types import SimpleNamespace as NS
    from src.ibkr_terminal.market_data import fetch_ibkr_historical, bind_snapshot
    from src.ibkr_terminal.schemas import Snapshot
    from pathlib import Path
    import json
    raw=json.loads((Path(__file__).resolve().parents[5]/'tests/ibkr/fixtures/snapshots.json').read_text(encoding='utf-8'))
    snapshot=Snapshot.model_validate(next(v for v in raw.values() if v['mode']=='paper'))
    snapshot=snapshot.model_copy(update={'positions':()})
    class SDK:
        async def reqHistoricalDataAsync(self,contract,*args,**kwargs):
            assert contract.conId==12
            return [NS(date=NOW,open=100,high=101,low=99,close=100,volume=5)]
    async def run():
        contract=NS(conId=12,secType='STK',currency='USD')
        value=await fetch_ibkr_historical(SDK(),snapshot,12,'1D',now=NOW,test_data=True,resolved_contract=contract)
        assert len(value.bars)==1 and snapshot.positions==()
        rebound=bind_snapshot(value,snapshot.model_copy(update={'snapshotId':'next-snapshot'}))
        assert rebound.snapshotId=='next-snapshot' and rebound.asOf==value.asOf
        assert rebound.dataHash!=value.dataHash
        assert rebound.bars==value.bars
    api_event_loop.run_until_complete(run())
