from datetime import datetime, timedelta, timezone

import pytest

from src.ibkr_terminal.backtests import BacktestBar, BacktestConfig, BacktestError, StrategySignal, run_backtest
from src.ibkr_terminal.strategy import StrategyCatalog
from test_strategy import NOW, definition


def bar(day, open, close=None, **changes):
    timestamp = datetime(2026, 1, day, 14, 30, tzinfo=timezone.utc)
    value = dict(conId=12, timestamp=timestamp, open=str(open), high=str(max(open, close or open)),
        low=str(min(open, close or open)), close=str(close or open), volume='1000', currency='USD',
        source='fixture.bars', dataVersion='fixture-v1', splitRatio=None, dividendPerShare='0')
    value.update(changes)
    return BacktestBar.model_validate(value)


def signal(day, target):
    return StrategySignal(conId=12, observedAt=datetime(2026, 1, day, 14, 30, tzinfo=timezone.utc), targetQuantity=str(target))


def config(**changes):
    value = dict(initialCash='1000', commissionPerOrder='0', commissionPerShare='0', slippageBps='0',
        baseCurrency='USD', corporateActionsComplete=True, maxBars=100)
    value.update(changes)
    return BacktestConfig.model_validate(value)


def strategy(tmp_path):
    catalog = StrategyCatalog(tmp_path / 'strategies.sqlite', allow_fixtures=True, clock=lambda: NOW)
    record = catalog.save(definition())
    catalog.close()
    return record


def test_no_signal_has_no_trade_and_repeats_bit_for_bit(tmp_path):
    item = strategy(tmp_path)
    first = run_backtest(item, config(), [bar(2, 100), bar(3, 101)], [], clock=lambda: NOW)
    second = run_backtest(item, config(), [bar(2, 100), bar(3, 101)], [], clock=lambda: NOW)
    assert first == second
    assert first.metrics.finalEquity == '1000' and first.metrics.tradeCount == 0
    assert first.strategyHash == item.strategyHash and len(first.datasetHash) == len(first.runHash) == 64


def test_signal_executes_at_next_bar_open_without_lookahead(tmp_path):
    result = run_backtest(strategy(tmp_path), config(), [bar(2, 100), bar(3, 110, 115), bar(4, 120)], [signal(2, 2)], clock=lambda: NOW)
    assert len(result.executions) == 1
    assert result.executions[0].executedAt == bar(3, 110).timestamp
    assert result.executions[0].price == '110' and result.executions[0].quantity == '2'
    assert result.metrics.finalEquity == '1020'
    assert [point.equity for point in result.equityCurve] == ['1000', '1010', '1020']
    assert result.metrics.benchmarkReturn == '0.2'
    assert result.metrics.turnover == '0.22'
    assert result.metrics.returnVolatility is not None and result.metrics.riskAdjustedReturn is not None
    assert result.metrics.riskFormulaVersion == 'period-return-v1'


def test_commission_and_slippage_match_manual_cash_calculation(tmp_path):
    result = run_backtest(strategy(tmp_path), config(commissionPerOrder='1', commissionPerShare='0.5', slippageBps='100'),
        [bar(2, 90), bar(3, 100), bar(4, 110)], [signal(2, 2), signal(3, 0)], clock=lambda: NOW)
    assert [(row.side, row.price, row.fee) for row in result.executions] == [('BUY', '101', '2'), ('SELL', '108.9', '2')]
    assert result.metrics.finalEquity == '1011.8'
    assert result.metrics.totalFees == '4' and result.metrics.slippageCost == '4.2'


def test_insufficient_cash_records_rejection_without_a_phantom_execution(tmp_path):
    result = run_backtest(strategy(tmp_path), config(initialCash='100'), [bar(2, 90), bar(3, 100)], [signal(2, 2)], clock=lambda: NOW)
    assert result.executions == () and result.metrics.finalEquity == '100'
    assert len(result.logs) == 1 and 'INSUFFICIENT_CASH' in result.logs[0]


def test_split_and_dividend_are_explicit_before_next_bar_execution(tmp_path):
    result = run_backtest(strategy(tmp_path), config(), [bar(2, 90), bar(3, 100),
        bar(4, 60, splitRatio='2', dividendPerShare='1')], [signal(2, 2), signal(3, 0)], clock=lambda: NOW)
    assert [(row.kind, row.amount) for row in result.corporateActions] == [('SPLIT', '2'), ('DIVIDEND', '4')]
    assert result.executions[-1].quantity == '4'
    assert result.metrics.finalEquity == '1044' and result.metrics.dividends == '4'


def test_missing_corporate_action_completeness_and_invalid_bar_data_fail_closed(tmp_path):
    with pytest.raises(BacktestError, match='INCOMPLETE_CORPORATE_ACTIONS'):
        run_backtest(strategy(tmp_path), config(corporateActionsComplete=False), [bar(2, 100)], [], clock=lambda: NOW)
    with pytest.raises(ValueError):
        BacktestBar.model_validate({**bar(2, 100).model_dump(), 'close': None})
    with pytest.raises(ValueError):
        BacktestBar.model_validate({**bar(2, 100).model_dump(), 'high': '99'})


def test_timezone_normalization_and_resource_limit_are_deterministic(tmp_path):
    first = bar(2, 100, timestamp=datetime(2026, 1, 2, 9, 30, tzinfo=timezone(timedelta(hours=-5))))
    second = bar(3, 101, timestamp=datetime(2026, 1, 3, 14, 30, tzinfo=timezone.utc))
    result = run_backtest(strategy(tmp_path), config(), [first, second], [], clock=lambda: NOW)
    assert result.startedAt == NOW and result.barCount == 2
    with pytest.raises(BacktestError, match='BAR_LIMIT_EXCEEDED'):
        run_backtest(strategy(tmp_path), config(maxBars=1), [first, second], [], clock=lambda: NOW)


def test_unverified_multi_asset_and_tampered_strategy_hash_fail_closed(tmp_path):
    item = strategy(tmp_path)
    with pytest.raises(BacktestError, match='STRATEGY_HASH_INVALID'):
        run_backtest(item.model_copy(update={'strategyHash': '0' * 64}), config(), [bar(2, 100)], [], clock=lambda: NOW)
    multi = item.model_copy(update={'definition': item.definition.model_copy(update={'universe': (12, 13)})})
    import hashlib
    from src.ibkr_terminal.risk import canonical
    multi = multi.model_copy(update={'strategyHash': hashlib.sha256(canonical(multi.definition).encode()).hexdigest()})
    with pytest.raises(BacktestError, match='MULTI_ASSET_NOT_VERIFIED'):
        run_backtest(multi, config(), [bar(2, 100)], [], clock=lambda: NOW)
