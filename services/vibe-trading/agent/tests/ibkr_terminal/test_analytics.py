from datetime import datetime, timedelta, timezone

from src.ibkr_terminal.analytics import analyze_snapshot
from src.ibkr_terminal.schemas import Snapshot


NOW = datetime(2026, 9, 5, 12, 0, tzinfo=timezone.utc)


def snapshot(**changes):
    value = dict(schemaVersion=1, snapshotId='fixture-risk-v1', accountKey='paper:engineering', mode='paper',
        sessionRevision=1, sequence=3, source='fixture', testData=True, asOf=NOW.isoformat(), connection='connected',
        state='ready', baseCurrency='USD', metrics=dict(netLiquidation='1000', unrealizedPnl='20', buyingPower='200', maintenanceMargin='200'),
        cash=[dict(currency='USD', amount='200')], positions=[
            dict(accountKey='paper:engineering', conId=12, symbol='AAA', currency='USD', quantity='6', averageCost='90', marketValue='600'),
            dict(accountKey='paper:engineering', conId=13, symbol='BBB', currency='USD', quantity='2', averageCost='90', marketValue='200')],
        orders=[], quotes=[], capabilities=dict(placeOrders=False, shareWithAi=False), missing=[], detail='engineering fixture', executions=[],
        provenance={'metrics.netLiquidation': dict(source='fixture.accountSummary', observedAt=NOW.isoformat(), brokerAsOf=None, requestCompletedAt=None),
            'metrics.maintenanceMargin': dict(source='fixture.accountSummary', observedAt=NOW.isoformat(), brokerAsOf=None, requestCompletedAt=None)})
    value.update(changes)
    return Snapshot.model_validate(value)


def test_complete_snapshot_produces_exact_decimal_metrics_and_evidence():
    result = analyze_snapshot(snapshot(), now=NOW)
    assert result.status == 'ready' and result.testData
    assert result.metrics.grossExposure.value == '800'
    assert result.metrics.netExposure.value == '800'
    assert result.metrics.largestPositionWeight.value == '0.6'
    assert result.metrics.marginUsage.value == '0.2'
    assert result.cashByCurrency == {'USD': '200'}
    evidence = result.metrics.marginUsage.evidence
    assert {row.field for row in evidence} == {'metrics.maintenanceMargin', 'metrics.netLiquidation'}
    assert all(row.snapshotId == 'fixture-risk-v1' and row.source == 'fixture.accountSummary' for row in evidence)


def test_missing_values_remain_missing_and_multi_currency_cash_is_not_summed_without_fx():
    value = snapshot(metrics=dict(netLiquidation=None, unrealizedPnl=None, buyingPower=None, maintenanceMargin=None),
        cash=[dict(currency='USD', amount='200'), dict(currency='HKD', amount='1000')],
        positions=[dict(accountKey='paper:engineering', conId=12, symbol='AAA', currency='USD', quantity='6', averageCost='90', marketValue=None)],
        missing=['netLiquidation', 'positions.marketValue', 'fx'])
    result = analyze_snapshot(value, now=NOW)
    assert result.status == 'partial'
    assert result.metrics.grossExposure.value is None and result.metrics.largestPositionWeight.value is None
    assert result.metrics.marginUsage.value is None
    assert result.cashByCurrency == {'HKD': '1000', 'USD': '200'}
    assert result.totalCashBase is None
    assert {'MISSING_POSITION_VALUES', 'MISSING_NET_LIQUIDATION', 'MISSING_FX'} <= {row.code for row in result.findings}


def test_old_or_disconnected_snapshot_is_never_presented_as_current():
    old = snapshot(asOf=(NOW - timedelta(minutes=5)).isoformat())
    result = analyze_snapshot(old, now=NOW, max_age_seconds=60)
    assert result.status == 'stale' and result.ageSeconds == 300
    assert 'STALE_SNAPSHOT' in {row.code for row in result.findings}
    disconnected = analyze_snapshot(snapshot(connection='disconnected', state='stale'), now=NOW)
    assert disconnected.status == 'unavailable'
    assert disconnected.metrics.grossExposure.value is None
    assert disconnected.metrics.netExposure.value is None
    assert disconnected.metrics.largestPositionWeight.value is None
    assert disconnected.metrics.marginUsage.value is None
    assert disconnected.cashByCurrency == {} and disconnected.openOrderCount is None


def test_orders_are_counted_without_assuming_unknown_remaining_quantity():
    order = dict(accountKey='paper:engineering', clientIntentId='fixture-order', conId=12, quantity='5', filled=None,
        remaining=None, submission='UNKNOWN', execution='UNKNOWN', managed=True)
    result = analyze_snapshot(snapshot(orders=[order]), now=NOW)
    assert result.openOrderCount == 1
    assert 'UNKNOWN_ORDER_STATE' in {row.code for row in result.findings}
