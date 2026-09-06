"""Deterministic, source-linked account risk analysis with no AI calls."""
from datetime import datetime, timezone
from decimal import Decimal, localcontext
from typing import Literal

from pydantic import AwareDatetime

from .schemas import Contract, Snapshot


class RiskEvidence(Contract):
    snapshotId: str
    field: str
    value: str
    source: str
    observedAt: str | None


class RiskMetric(Contract):
    value: str | None
    unit: str
    state: Literal['ready', 'missing', 'stale', 'unavailable']
    evidence: tuple[RiskEvidence, ...] = ()


class RiskMetrics(Contract):
    grossExposure: RiskMetric
    netExposure: RiskMetric
    largestPositionWeight: RiskMetric
    marginUsage: RiskMetric


class RiskFinding(Contract):
    code: str
    severity: Literal['info', 'warning', 'error']
    explanation: str


class AccountRiskAnalysis(Contract):
    accountKey: str
    mode: str
    snapshotId: str
    source: str
    testData: bool
    generatedAt: AwareDatetime
    asOf: str | None
    ageSeconds: int | None
    status: Literal['ready', 'partial', 'stale', 'unavailable']
    metrics: RiskMetrics
    cashByCurrency: dict[str, str]
    cashEvidence: tuple[RiskEvidence, ...]
    totalCashBase: str | None
    positionCount: int | None
    openOrderCount: int | None
    openOrderEvidence: tuple[RiskEvidence, ...]
    findings: tuple[RiskFinding, ...]


def _number(value):
    value = Decimal(value)
    return '0' if not value else format(value.normalize(), 'f')


def _evidence(snapshot, field, value):
    stamp = snapshot.provenance.get(field)
    return RiskEvidence(snapshotId=snapshot.snapshotId, field=field, value=str(value),
        source=stamp.source if stamp else snapshot.source,
        observedAt=(stamp.observedAt or stamp.brokerAsOf or stamp.requestCompletedAt) if stamp else snapshot.asOf)


def _empty_metric(unit, state):
    return RiskMetric(value=None, unit=unit, state=state)


def _parse_time(value):
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace('Z', '+00:00')).astimezone(timezone.utc)
    except (ValueError, TypeError):
        return None


def analyze_snapshot(snapshot: Snapshot, *, now: datetime, max_age_seconds=60):
    snapshot = Snapshot.model_validate(snapshot.model_dump())
    now = now.astimezone(timezone.utc)
    findings = []
    if snapshot.testData:
        findings.append(RiskFinding(code='TEST_DATA', severity='info', explanation='工程测试数据，不代表 IBKR 账户事实。'))
    observed = _parse_time(snapshot.asOf)
    age = int((now - observed).total_seconds()) if observed is not None else None
    connected = snapshot.connection == 'connected' and snapshot.state in ('ready', 'empty') and observed is not None
    if not connected:
        findings.append(RiskFinding(code='SNAPSHOT_UNAVAILABLE', severity='error', explanation='账户未连接或缺少有效观察时间，拒绝给出当前风险数字。'))
        missing = _empty_metric('USD', 'unavailable')
        ratios = _empty_metric('ratio', 'unavailable')
        return AccountRiskAnalysis(accountKey=snapshot.accountKey, mode=snapshot.mode, snapshotId=snapshot.snapshotId,
            source=snapshot.source, testData=snapshot.testData, generatedAt=now, asOf=snapshot.asOf, ageSeconds=age,
            status='unavailable', metrics=RiskMetrics(grossExposure=missing, netExposure=missing,
                largestPositionWeight=ratios, marginUsage=ratios), cashByCurrency={}, cashEvidence=(), totalCashBase=None,
            positionCount=None, openOrderCount=None, openOrderEvidence=(), findings=tuple(findings))

    stale = age is None or age < 0 or age > max_age_seconds or snapshot.state == 'stale'
    metric_state = 'stale' if stale else 'ready'
    if stale:
        findings.append(RiskFinding(code='STALE_SNAPSHOT', severity='warning', explanation='快照超出允许时效；数字仅作为带时间的历史观察。'))

    cash = {}
    cash_evidence = []
    for row in sorted(snapshot.cash, key=lambda item: item.currency):
        cash[row.currency] = _number(Decimal(cash.get(row.currency, '0')) + Decimal(row.amount))
        cash_evidence.append(_evidence(snapshot, f'cash.{row.currency}', row.amount))
    total_cash = None
    if snapshot.baseCurrency and all(currency == snapshot.baseCurrency for currency in cash):
        total_cash = _number(sum((Decimal(value) for value in cash.values()), Decimal(0)))
    elif cash:
        findings.append(RiskFinding(code='MISSING_FX', severity='warning', explanation='多币种现金缺少可追溯汇率，未合成基础币种总额。'))

    position_evidence = []
    values = []
    position_values_complete = all(row.marketValue is not None and row.currency == snapshot.baseCurrency for row in snapshot.positions)
    if position_values_complete:
        for row in snapshot.positions:
            values.append(Decimal(row.marketValue))
            position_evidence.append(_evidence(snapshot, f'positions.{row.conId}.marketValue', row.marketValue))
        gross, net = sum((abs(value) for value in values), Decimal(0)), sum(values, Decimal(0))
        gross_metric = RiskMetric(value=_number(gross), unit=snapshot.baseCurrency or 'unknown', state=metric_state, evidence=tuple(position_evidence))
        net_metric = RiskMetric(value=_number(net), unit=snapshot.baseCurrency or 'unknown', state=metric_state, evidence=tuple(position_evidence))
    else:
        findings.append(RiskFinding(code='MISSING_POSITION_VALUES', severity='warning', explanation='仓位市值或基础币种换算缺失，未计算敞口。'))
        gross_metric = _empty_metric(snapshot.baseCurrency or 'unknown', 'missing')
        net_metric = _empty_metric(snapshot.baseCurrency or 'unknown', 'missing')

    net_liquidation = snapshot.metrics.netLiquidation
    net_evidence = (_evidence(snapshot, 'metrics.netLiquidation', net_liquidation),) if net_liquidation is not None else ()
    if net_liquidation is None or Decimal(net_liquidation) <= 0:
        findings.append(RiskFinding(code='MISSING_NET_LIQUIDATION', severity='warning', explanation='净清算值缺失或无效，未计算权重和保证金比例。'))
        largest = margin = _empty_metric('ratio', 'missing')
    else:
        net_value = Decimal(net_liquidation)
        largest = (RiskMetric(value=_number(max((abs(value) for value in values), default=Decimal(0)) / net_value), unit='ratio',
            state=metric_state, evidence=tuple(position_evidence) + net_evidence) if position_values_complete else _empty_metric('ratio', 'missing'))
        maintenance = snapshot.metrics.maintenanceMargin
        if maintenance is None:
            findings.append(RiskFinding(code='MISSING_MARGIN', severity='warning', explanation='维持保证金缺失，未计算保证金使用率。'))
            margin = _empty_metric('ratio', 'missing')
        else:
            margin = RiskMetric(value=_number(Decimal(maintenance) / net_value), unit='ratio', state=metric_state,
                evidence=(_evidence(snapshot, 'metrics.maintenanceMargin', maintenance),) + net_evidence)

    order_evidence = tuple(_evidence(snapshot, f'orders.{row.clientIntentId}.state', f'{row.submission}/{row.execution}') for row in snapshot.orders)
    if any(row.submission in ('UNKNOWN', 'RECONCILING') or row.execution == 'UNKNOWN' or row.remaining is None for row in snapshot.orders):
        findings.append(RiskFinding(code='UNKNOWN_ORDER_STATE', severity='warning', explanation='至少一个订单状态或剩余量未知；未推断未决风险为零。'))
    partial = any(metric.value is None for metric in (gross_metric, net_metric, largest, margin)) or total_cash is None and bool(cash)
    status = 'stale' if stale else 'partial' if partial else 'ready'
    return AccountRiskAnalysis(accountKey=snapshot.accountKey, mode=snapshot.mode, snapshotId=snapshot.snapshotId,
        source=snapshot.source, testData=snapshot.testData, generatedAt=now, asOf=snapshot.asOf, ageSeconds=age,
        status=status, metrics=RiskMetrics(grossExposure=gross_metric, netExposure=net_metric,
            largestPositionWeight=largest, marginUsage=margin), cashByCurrency=cash, cashEvidence=tuple(cash_evidence),
        totalCashBase=total_cash, positionCount=len(snapshot.positions), openOrderCount=len(snapshot.orders),
        openOrderEvidence=order_evidence, findings=tuple(findings))
