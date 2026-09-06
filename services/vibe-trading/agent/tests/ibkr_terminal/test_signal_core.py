from datetime import datetime, timedelta, timezone

import pytest

from src.ibkr_terminal.backtests import BacktestBar, backtest_signals_from_definition
from src.ibkr_terminal.signals import SignalObservation, generate_target_signals
from src.ibkr_terminal.strategy import StrategyCatalog
from src.ibkr_terminal.strategy_runtime import runtime_signals_from_definition
from test_strategy import NOW, definition


def observations():
    start = datetime(2026, 1, 1, 14, 30, tzinfo=timezone.utc)
    prices = ('10', '9', '12', '8', '7')
    return [SignalObservation(conId=12, observedAt=start + timedelta(days=index), close=price)
            for index, price in enumerate(prices)]


def test_whitelisted_signal_core_is_deterministic_and_emits_only_target_changes(tmp_path):
    with StrategyCatalog(tmp_path / 'strategies.sqlite', allow_fixtures=True, clock=lambda: NOW) as catalog:
        record = catalog.save(definition())
    first = generate_target_signals(record, observations())
    second = generate_target_signals(record, observations())
    assert first == second
    assert [(row.observedAt, row.targetQuantity, row.reason) for row in first] == [
        (observations()[2].observedAt, '10', 'SMA_FAST_ABOVE_SLOW'),
        (observations()[3].observedAt, '0', 'SMA_FAST_AT_OR_BELOW_SLOW'),
    ]


def test_runtime_adapter_uses_the_exact_shared_core_output(tmp_path):
    with StrategyCatalog(tmp_path / 'strategies.sqlite', allow_fixtures=True, clock=lambda: NOW) as catalog:
        record = catalog.save(definition())
    core = generate_target_signals(record, observations())
    runtime = runtime_signals_from_definition(record, observations(), account_key='paper:engineering', mode='paper',
        source='fixture', snapshot_id=lambda value: f'snapshot-{value.observedAt.day}')
    assert [(row.conId, row.observedAt, row.targetQuantity) for row in runtime] == [
        (row.conId, row.observedAt, row.targetQuantity) for row in core]
    assert [row.sequence for row in runtime] == [1, 2]
    assert [row.snapshotId for row in runtime] == ['snapshot-3', 'snapshot-4']

    bars = [BacktestBar(conId=row.conId, timestamp=row.observedAt, open=row.close, high=row.close,
        low=row.close, close=row.close, volume='1', currency='USD', source='fixture.bars',
        dataVersion='fixture-v1', splitRatio=None, dividendPerShare='0') for row in observations()]
    backtest = backtest_signals_from_definition(record, bars)
    assert [(row.conId, row.observedAt, row.targetQuantity) for row in backtest] == [
        (row.conId, row.observedAt, row.targetQuantity) for row in core]


@pytest.mark.parametrize('change', [
    {'signal': {'kind': 'python', 'source': 'future_dataframe'}},
    {'signal': {'kind': 'sma_cross', 'priceField': 'close', 'fastWindow': 3, 'slowWindow': 2,
                'entryWhen': 'FAST_ABOVE_SLOW', 'exitWhen': 'FAST_AT_OR_BELOW_SLOW'}},
    {'positionSizing': {'kind': 'fixed_quantity', 'targetQuantity': '1.5'}},
    {'risk': {'allowShort': True, 'maxPositionQuantity': '10'}},
])
def test_structured_definition_rejects_code_future_access_fractional_or_short_scope(change):
    with pytest.raises(ValueError):
        definition(**change)
