"""Deterministic Decimal event ledger for terminal backtest goldens."""
from contextlib import contextmanager
from datetime import datetime, timezone
from decimal import Decimal, localcontext
import hashlib
import json
from pathlib import Path
import sqlite3
from threading import RLock
from typing import Annotated, Literal

from pydantic import AwareDatetime, Field, StringConstraints, model_validator

from .risk import Amount, Identifier, canonical
from .schemas import Contract
from .signals import SignalObservation, generate_target_signals
from .strategy import StrategyRecord


SignedAmount = Annotated[str, StringConstraints(strict=True, max_length=39, pattern=r'^-?(0|[1-9][0-9]{0,17})(\.[0-9]{1,18})?$')]
Digest = Annotated[str, StringConstraints(strict=True, pattern=r'^[0-9a-f]{64}$')]


class BacktestError(ValueError):
    def __init__(self, code):
        self.code = code
        super().__init__(code)


class BacktestBar(Contract):
    conId: int = Field(gt=0, strict=True)
    timestamp: AwareDatetime
    open: Amount
    high: Amount
    low: Amount
    close: Amount
    volume: Amount
    currency: Literal['USD']
    source: Identifier
    dataVersion: Identifier
    splitRatio: Amount | None
    dividendPerShare: Amount

    @model_validator(mode='after')
    def valid_bar(self):
        values = [Decimal(getattr(self, key)) for key in ('open', 'high', 'low', 'close')]
        if any(value <= 0 for value in values) or Decimal(self.volume) < 0:
            raise ValueError('invalid market data')
        if Decimal(self.high) < max(Decimal(self.open), Decimal(self.close)) or Decimal(self.low) > min(Decimal(self.open), Decimal(self.close)) or Decimal(self.low) > Decimal(self.high):
            raise ValueError('invalid OHLC range')
        if self.splitRatio is not None and Decimal(self.splitRatio) <= 0:
            raise ValueError('invalid split ratio')
        return self


class StrategySignal(Contract):
    conId: int = Field(gt=0, strict=True)
    observedAt: AwareDatetime
    targetQuantity: Amount

    @model_validator(mode='after')
    def whole_long_only(self):
        quantity = Decimal(self.targetQuantity)
        if quantity != quantity.to_integral_value():
            raise ValueError('whole-share target required')
        return self


class BacktestConfig(Contract):
    initialCash: Amount
    commissionPerOrder: Amount
    commissionPerShare: Amount
    slippageBps: Amount
    baseCurrency: Literal['USD']
    corporateActionsComplete: bool
    maxBars: int = Field(gt=0, le=1_000_000, strict=True)

    @model_validator(mode='after')
    def valid_config(self):
        if Decimal(self.initialCash) <= 0 or Decimal(self.slippageBps) > 1000:
            raise ValueError('invalid backtest configuration')
        return self


class BacktestExecution(Contract):
    conId: int
    side: Literal['BUY', 'SELL']
    quantity: Amount
    signalObservedAt: AwareDatetime
    executedAt: AwareDatetime
    rawPrice: Amount
    price: Amount
    fee: Amount
    cashAfter: Amount


class CorporateAction(Contract):
    conId: int
    timestamp: AwareDatetime
    kind: Literal['SPLIT', 'DIVIDEND']
    amount: Amount


class EquityPoint(Contract):
    timestamp: AwareDatetime
    cash: Amount
    marketValue: Amount
    equity: Amount
    drawdown: Amount


class BacktestMetrics(Contract):
    initialCash: Amount
    finalCash: Amount
    finalMarketValue: Amount
    finalEquity: Amount
    totalReturn: SignedAmount
    totalFees: Amount
    slippageCost: Amount
    dividends: Amount
    maxDrawdown: Amount
    benchmarkReturn: SignedAmount
    turnover: Amount
    returnVolatility: Amount | None
    riskAdjustedReturn: SignedAmount | None
    riskFormulaVersion: Literal['period-return-v1'] = 'period-return-v1'
    tradeCount: int


class BacktestResult(Contract):
    strategyId: Identifier
    strategyVersion: Identifier
    strategyHash: Digest
    datasetHash: Digest
    configHash: Digest
    runHash: Digest
    startedAt: AwareDatetime
    barCount: int
    testData: bool
    executions: tuple[BacktestExecution, ...]
    corporateActions: tuple[CorporateAction, ...]
    equityCurve: tuple[EquityPoint, ...]
    logs: tuple[str, ...]
    metrics: BacktestMetrics


class BacktestPackage(Contract):
    strategy: StrategyRecord
    config: BacktestConfig
    bars: tuple[BacktestBar, ...]
    signals: tuple[StrategySignal, ...]
    result: BacktestResult


def _number(value):
    value = Decimal(value)
    if not value:
        return '0'
    return format(value.normalize(), 'f')


def _stat_number(value):
    return _number(Decimal(value).quantize(Decimal('0.000000000000000001')))


def _models(values):
    return json.dumps([value.model_dump(mode='json') for value in values], sort_keys=True, separators=(',', ':'), ensure_ascii=False)


def backtest_signals_from_definition(strategy: StrategyRecord, bars):
    decisions = generate_target_signals(strategy, [SignalObservation(conId=bar.conId, observedAt=bar.timestamp, close=bar.close) for bar in bars])
    return tuple(StrategySignal(conId=row.conId, observedAt=row.observedAt, targetQuantity=row.targetQuantity) for row in decisions)


def run_backtest(strategy: StrategyRecord, config: BacktestConfig, bars, signals, *, clock=None, guard=None):
    strategy = StrategyRecord.model_validate(strategy.model_dump())
    config = BacktestConfig.model_validate(config.model_dump())
    bars = tuple(BacktestBar.model_validate(value.model_dump()) for value in bars)
    signals = tuple(StrategySignal.model_validate(value.model_dump()) for value in signals)
    if not config.corporateActionsComplete:
        raise BacktestError('INCOMPLETE_CORPORATE_ACTIONS')
    if not bars:
        raise BacktestError('MISSING_BARS')
    if len(bars) > config.maxBars:
        raise BacktestError('BAR_LIMIT_EXCEEDED')
    universe = set(strategy.definition.universe)
    if strategy.strategyHash != hashlib.sha256(canonical(strategy.definition).encode()).hexdigest():
        raise BacktestError('STRATEGY_HASH_INVALID')
    if len(universe) != 1:
        raise BacktestError('MULTI_ASSET_NOT_VERIFIED')
    if any(bar.conId not in universe for bar in bars) or any(signal.conId not in universe for signal in signals):
        raise BacktestError('UNIVERSE_SCOPE')
    normalized_times = [bar.timestamp.astimezone(timezone.utc) for bar in bars]
    if any(left >= right for left, right in zip(normalized_times, normalized_times[1:])):
        raise BacktestError('BARS_NOT_STRICTLY_ORDERED')
    if len({bar.dataVersion for bar in bars}) != 1:
        raise BacktestError('MIXED_DATA_VERSION')
    bar_keys = {(bar.conId, bar.timestamp.astimezone(timezone.utc)) for bar in bars}
    if any((signal.conId, signal.observedAt.astimezone(timezone.utc)) not in bar_keys for signal in signals):
        raise BacktestError('SIGNAL_NOT_CAUSAL_BAR')
    signal_keys = [(signal.conId, signal.observedAt.astimezone(timezone.utc)) for signal in signals]
    if len(set(signal_keys)) != len(signal_keys):
        raise BacktestError('DUPLICATE_SIGNAL')

    cash = Decimal(config.initialCash)
    initial = cash
    positions = {con_id: Decimal(0) for con_id in universe}
    total_fees = slippage_cost = dividends = Decimal(0)
    executions, actions, logs = [], [], []
    consumed = set()
    last_close = {}
    equity_path = []
    equity_curve = []
    peak = initial
    max_drawdown = Decimal(0)
    turnover_notional = Decimal(0)
    benchmark_units = None
    benchmark_cash = Decimal(0)
    benchmark_path = []
    fixed, per_share = Decimal(config.commissionPerOrder), Decimal(config.commissionPerShare)
    slip = Decimal(config.slippageBps) / Decimal(10000)

    with localcontext() as arithmetic:
        arithmetic.prec = 80
        for bar in bars:
            if guard is not None:
                guard()
            now = bar.timestamp.astimezone(timezone.utc)
            con_id = bar.conId
            quantity = positions[con_id]
            if benchmark_units is not None and bar.splitRatio is not None:
                benchmark_units *= Decimal(bar.splitRatio)
            if benchmark_units is not None and Decimal(bar.dividendPerShare):
                benchmark_cash += benchmark_units * Decimal(bar.dividendPerShare)
            if bar.splitRatio is not None:
                ratio = Decimal(bar.splitRatio)
                adjusted = quantity * ratio
                if adjusted != adjusted.to_integral_value():
                    raise BacktestError('FRACTIONAL_SPLIT_UNSUPPORTED')
                positions[con_id] = quantity = adjusted
                actions.append(CorporateAction(conId=con_id, timestamp=now, kind='SPLIT', amount=_number(ratio)))
            dividend = quantity * Decimal(bar.dividendPerShare)
            if dividend:
                cash += dividend
                dividends += dividend
                actions.append(CorporateAction(conId=con_id, timestamp=now, kind='DIVIDEND', amount=_number(dividend)))

            eligible = [(index, signal) for index, signal in enumerate(signals)
                if index not in consumed and signal.conId == con_id and signal.observedAt.astimezone(timezone.utc) < now]
            if eligible:
                # A target superseded before a tradable bar never creates a phantom round trip.
                for index, _ in eligible:
                    consumed.add(index)
                signal = eligible[-1][1]
                target = Decimal(signal.targetQuantity)
                delta = target - quantity
                if delta:
                    side = 'BUY' if delta > 0 else 'SELL'
                    units = abs(delta)
                    raw = Decimal(bar.open)
                    price = raw * (Decimal(1) + slip if side == 'BUY' else Decimal(1) - slip)
                    fee = fixed + per_share * units
                    executed = False
                    if side == 'BUY':
                        required = units * price + fee
                        if required > cash:
                            logs.append(f'{now.isoformat()} INSUFFICIENT_CASH conId={con_id}')
                        else:
                            cash -= required
                            positions[con_id] = target
                            executed = True
                    else:
                        cash += units * price - fee
                        positions[con_id] = target
                        executed = True
                    if executed:
                        total_fees += fee
                        slippage_cost += units * abs(price - raw)
                        turnover_notional += units * price
                        executions.append(BacktestExecution(conId=con_id, side=side, quantity=_number(units),
                            signalObservedAt=signal.observedAt.astimezone(timezone.utc), executedAt=now,
                            rawPrice=_number(raw), price=_number(price), fee=_number(fee), cashAfter=_number(cash)))
            last_close[con_id] = Decimal(bar.close)
            market_value = sum((positions[key] * last_close.get(key, Decimal(0)) for key in universe), Decimal(0))
            equity = cash + market_value
            equity_path.append(equity)
            peak = max(peak, equity)
            drawdown = (peak - equity) / peak if peak else Decimal(0)
            max_drawdown = max(max_drawdown, drawdown)
            equity_curve.append(EquityPoint(timestamp=now, cash=_number(cash), marketValue=_number(market_value),
                equity=_number(equity), drawdown=_stat_number(drawdown)))
            if benchmark_units is None:
                benchmark_units = initial / Decimal(bar.close)
            benchmark_path.append(benchmark_cash + benchmark_units * Decimal(bar.close))

    if guard is not None:
        guard()

    final_market = sum((positions[key] * last_close.get(key, Decimal(0)) for key in universe), Decimal(0))
    final_equity = cash + final_market
    benchmark_return = (benchmark_path[-1] - initial) / initial
    period_returns = [(current - previous) / previous for previous, current in zip(equity_path, equity_path[1:]) if previous]
    volatility = risk_adjusted = None
    if len(period_returns) >= 2:
        mean = sum(period_returns, Decimal(0)) / Decimal(len(period_returns))
        variance = sum(((value - mean) ** 2 for value in period_returns), Decimal(0)) / Decimal(len(period_returns) - 1)
        volatility = variance.sqrt()
        if volatility:
            risk_adjusted = mean / volatility * Decimal(len(period_returns)).sqrt()
    metrics = BacktestMetrics(initialCash=_number(initial), finalCash=_number(cash), finalMarketValue=_number(final_market),
        finalEquity=_number(final_equity), totalReturn=_stat_number((final_equity - initial) / initial),
        totalFees=_number(total_fees), slippageCost=_number(slippage_cost), dividends=_number(dividends),
        maxDrawdown=_stat_number(max_drawdown), benchmarkReturn=_stat_number(benchmark_return), turnover=_stat_number(turnover_notional / initial),
        returnVolatility=None if volatility is None else _stat_number(volatility),
        riskAdjustedReturn=None if risk_adjusted is None else _stat_number(risk_adjusted), tradeCount=len(executions))
    dataset_hash = hashlib.sha256(_models(bars).encode()).hexdigest()
    config_hash = hashlib.sha256(canonical(config).encode()).hexdigest()
    stable = {'strategyHash': strategy.strategyHash, 'datasetHash': dataset_hash, 'configHash': config_hash,
        'signals': json.loads(_models(signals)), 'executions': [row.model_dump(mode='json') for row in executions],
        'corporateActions': [row.model_dump(mode='json') for row in actions],
        'equityCurve': [row.model_dump(mode='json') for row in equity_curve], 'logs': logs,
        'metrics': metrics.model_dump(mode='json')}
    run_hash = hashlib.sha256(json.dumps(stable, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()
    started = (clock or (lambda: datetime.now(timezone.utc)))()
    return BacktestResult(strategyId=strategy.definition.strategyId, strategyVersion=strategy.definition.version,
        strategyHash=strategy.strategyHash, datasetHash=dataset_hash, configHash=config_hash, runHash=run_hash,
        startedAt=started, barCount=len(bars), testData=strategy.definition.origin == 'fixture' or any(bar.source.startswith('fixture') for bar in bars),
        executions=tuple(executions), corporateActions=tuple(actions), equityCurve=tuple(equity_curve), logs=tuple(logs), metrics=metrics)


class BacktestArchive:
    """Immutable replay-checked run packages and local exports."""

    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = RLock()
        self._db = sqlite3.connect(path, isolation_level=None, check_same_thread=False, timeout=10)
        self._db.execute('PRAGMA journal_mode=WAL')
        self._db.execute('PRAGMA synchronous=FULL')
        with self.transaction():
            version = self._db.execute('PRAGMA user_version').fetchone()[0]
            if version not in (0, 1):
                raise BacktestError('UNSUPPORTED_BACKTEST_DATABASE')
            self._db.execute('''CREATE TABLE IF NOT EXISTS terminal_backtests (
                run_hash TEXT PRIMARY KEY, strategy_id TEXT NOT NULL, strategy_version TEXT NOT NULL,
                dataset_hash TEXT NOT NULL, payload TEXT NOT NULL, created_epoch REAL NOT NULL)''')
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
    def _package(result, strategy, config, bars, signals):
        return BacktestPackage(strategy=strategy, config=config, bars=tuple(bars), signals=tuple(signals), result=result)

    @staticmethod
    def _verified(package, guard=None):
        replay = run_backtest(package.strategy, package.config, package.bars, package.signals,
            clock=lambda: package.result.startedAt, guard=guard)
        if replay != package.result:
            raise BacktestError('RUN_REPLAY_MISMATCH')
        return package

    def save(self, result, strategy, config, bars, signals, *, guard=None):
        package = self._package(result, strategy, config, bars, signals)
        self._verified(package, guard=guard)
        payload = canonical(package)
        with self.transaction():
            row = self._db.execute('SELECT payload FROM terminal_backtests WHERE run_hash=?', (result.runHash,)).fetchone()
            if row:
                try:
                    previous = BacktestPackage.model_validate_json(row[0])
                except Exception as error:
                    raise BacktestError('ARCHIVE_INVALID') from error
                if canonical(previous) != payload:
                    raise BacktestError('RUN_HASH_COLLISION')
                return previous
            self._db.execute('INSERT INTO terminal_backtests VALUES(?,?,?,?,?,?)',
                (result.runHash, result.strategyId, result.strategyVersion, result.datasetHash, payload, result.startedAt.timestamp()))
        return package

    def get(self, run_hash):
        with self._lock:
            row = self._db.execute('SELECT payload FROM terminal_backtests WHERE run_hash=?', (run_hash,)).fetchone()
        if row is None:
            raise BacktestError('RUN_MISSING')
        try:
            package = BacktestPackage.model_validate_json(row[0])
        except Exception as error:
            raise BacktestError('ARCHIVE_INVALID') from error
        if package.result.runHash != run_hash:
            raise BacktestError('ARCHIVE_INVALID')
        try:
            return self._verified(package)
        except BacktestError as error:
            raise BacktestError('ARCHIVE_INVALID') from error

    def list(self, limit=50):
        if not 1 <= limit <= 200:
            raise BacktestError('INVALID_LIMIT')
        with self._lock:
            hashes = [row[0] for row in self._db.execute('SELECT run_hash FROM terminal_backtests ORDER BY created_epoch DESC,run_hash LIMIT ?', (limit,))]
        return [self.get(run_hash) for run_hash in hashes]

    def export(self, run_hash, root: Path):
        package = self.get(run_hash)
        directory = root / run_hash
        directory.mkdir(parents=True, exist_ok=True)
        json_path, markdown_path = directory / 'backtest.json', directory / 'backtest.md'
        payload = json.dumps(package.model_dump(mode='json'), ensure_ascii=False, sort_keys=True, indent=2)
        warning = '工程测试数据；不是用户策略验收。' if package.result.testData else '用户策略回测；结果不代表未来收益。'
        metrics = package.result.metrics
        markdown = f'''# {package.strategy.definition.name}\n\n{warning}\n\n- 策略：`{package.result.strategyId}` / `{package.result.strategyVersion}`\n- 策略哈希：`{package.result.strategyHash}`\n- 数据哈希：`{package.result.datasetHash}`\n- 配置哈希：`{package.result.configHash}`\n- 运行哈希：`{package.result.runHash}`\n- 数据版本：{', '.join(sorted({bar.dataVersion for bar in package.bars}))}\n- 数据来源：{', '.join(sorted({bar.source for bar in package.bars}))}\n\n## 结果\n\n- 最终权益：{metrics.finalEquity} {package.config.baseCurrency}\n- 总收益率：{metrics.totalReturn}\n- 同标的持有基准：{metrics.benchmarkReturn}\n- 换手（成交金额 / 初始资金）：{metrics.turnover}\n- 区间收益波动：{metrics.returnVolatility if metrics.returnVolatility is not None else '样本不足'}\n- 风险调整收益（{metrics.riskFormulaVersion}）：{metrics.riskAdjustedReturn if metrics.riskAdjustedReturn is not None else '样本不足'}\n- 成交次数：{metrics.tradeCount}\n- 费用：{metrics.totalFees}\n- 滑点成本：{metrics.slippageCost}\n- 分红：{metrics.dividends}\n- 最大回撤：{metrics.maxDrawdown}\n'''
        for path, content in ((json_path, payload), (markdown_path, markdown)):
            temporary = path.with_suffix(path.suffix + '.tmp')
            temporary.write_text(content, encoding='utf-8')
            temporary.replace(path)
        return {'json': json_path, 'markdown': markdown_path}

    def close(self):
        with self._lock:
            self._db.close()

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()
