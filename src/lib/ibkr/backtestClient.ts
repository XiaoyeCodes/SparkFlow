const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const digest = (value: unknown) => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const amount = (value: unknown, signed = false) => typeof value === 'string'
  && (signed ? /^-?(0|[1-9][0-9]{0,17})(\.[0-9]{1,18})?$/.test(value) : /^(0|[1-9][0-9]{0,17})(\.[0-9]{1,18})?$/.test(value));
const time = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value));

export type StrategyDefinition = { strategyId: string; version: string; origin: 'fixture' | 'user'; name: string; universe: number[];
  barInterval: '1D' | '1h'; entryRule: string; exitRule: string; parameters: Record<string, string>;
  signal: { kind: 'sma_cross'; priceField: 'close'; fastWindow: number; slowWindow: number; entryWhen: 'FAST_ABOVE_SLOW'; exitWhen: 'FAST_AT_OR_BELOW_SLOW' };
  positionSizing: { kind: 'fixed_quantity'; targetQuantity: string };
  costs: { commissionPerOrder: string; commissionPerShare: string; slippageBps: string };
  risk: { allowShort: false; maxPositionQuantity: string }; versionNotes: string };

export type StrategyRecord = {
  definition: StrategyDefinition;
  strategyHash: string; createdAt: string;
};

export type BacktestResult = {
  strategyId: string; strategyVersion: string; strategyHash: string; datasetHash: string; configHash: string; runHash: string;
  startedAt: string; barCount: number; testData: boolean; executions: unknown[]; corporateActions: unknown[]; logs: string[];
  equityCurve: { timestamp: string; cash: string; marketValue: string; equity: string; drawdown: string }[];
  metrics: { initialCash: string; finalCash: string; finalMarketValue: string; finalEquity: string; totalReturn: string;
    totalFees: string; slippageCost: string; dividends: string; maxDrawdown: string; benchmarkReturn: string; turnover: string;
    returnVolatility: string | null; riskAdjustedReturn: string | null; riskFormulaVersion: 'period-return-v1'; tradeCount: number };
};

export type BacktestJob = {
  jobId: string; state: 'PENDING' | 'RUNNING' | 'CANCEL_REQUESTED' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'INTERRUPTED';
  createdAt: string; updatedAt: string; testData: boolean; runHash: string | null; errorCode: string | null; workerThreadId: number | null;
};

export function validStrategyRecord(value: unknown): value is StrategyRecord {
  if (!object(value) || !object(value.definition) || !digest(value.strategyHash) || !time(value.createdAt)) return false;
  const row = value.definition;
  const origin = row.origin;
  if (!object(row.signal) || !object(row.positionSizing) || !object(row.costs) || !object(row.risk)) return false;
  const signal = row.signal; const sizing = row.positionSizing; const costs = row.costs; const risk = row.risk;
  return (origin === 'fixture' || origin === 'user') && typeof row.strategyId === 'string'
    && row.strategyId.startsWith(origin === 'fixture' ? 'example:' : 'user:')
    && typeof row.version === 'string' && /^[0-9]+\.[0-9]+\.[0-9]+$/.test(row.version)
    && typeof row.name === 'string' && row.name.length > 0
    && Array.isArray(row.universe) && row.universe.length > 0 && row.universe.every(id => Number.isInteger(id) && id > 0)
    && (row.barInterval === '1D' || row.barInterval === '1h')
    && typeof row.entryRule === 'string' && typeof row.exitRule === 'string' && object(row.parameters)
    && Object.values(row.parameters).every(item => typeof item === 'string')
    && signal.kind === 'sma_cross' && signal.priceField === 'close'
    && Number.isInteger(signal.fastWindow) && Number(signal.fastWindow) >= 1 && Number(signal.fastWindow) <= 100
    && Number.isInteger(signal.slowWindow) && Number(signal.slowWindow) >= 2 && Number(signal.slowWindow) <= 500
    && Number(signal.fastWindow) < Number(signal.slowWindow) && signal.entryWhen === 'FAST_ABOVE_SLOW' && signal.exitWhen === 'FAST_AT_OR_BELOW_SLOW'
    && sizing.kind === 'fixed_quantity' && amount(sizing.targetQuantity)
    && ['commissionPerOrder', 'commissionPerShare', 'slippageBps'].every(key => amount(costs[key]))
    && risk.allowShort === false && amount(risk.maxPositionQuantity)
    && typeof row.versionNotes === 'string' && row.versionNotes.length > 0;
}

export function validBacktestResult(value: unknown): value is BacktestResult {
  if (!object(value) || !object(value.metrics)) return false;
  const metrics = value.metrics;
  return ['strategyHash', 'datasetHash', 'configHash', 'runHash'].every(key => digest(value[key]))
    && typeof value.strategyId === 'string' && typeof value.strategyVersion === 'string' && time(value.startedAt)
    && Number.isInteger(value.barCount) && Number(value.barCount) > 0 && typeof value.testData === 'boolean'
    && Array.isArray(value.executions) && Array.isArray(value.corporateActions) && Array.isArray(value.logs) && value.logs.every(row => typeof row === 'string')
    && Array.isArray(value.equityCurve) && value.equityCurve.length === value.barCount && value.equityCurve.every((point, index, all) => object(point)
      && time(point.timestamp) && (index === 0 || Date.parse(String(all[index - 1].timestamp)) < Date.parse(String(point.timestamp)))
      && ['cash', 'marketValue', 'equity', 'drawdown'].every(key => amount(point[key])))
    && ['initialCash', 'finalCash', 'finalMarketValue', 'finalEquity', 'totalFees', 'slippageCost', 'dividends', 'maxDrawdown', 'turnover'].every(key => amount(metrics[key]))
    && amount(metrics.totalReturn, true) && amount(metrics.benchmarkReturn, true)
    && (metrics.returnVolatility === null || amount(metrics.returnVolatility))
    && (metrics.riskAdjustedReturn === null || amount(metrics.riskAdjustedReturn, true)) && metrics.riskFormulaVersion === 'period-return-v1'
    && Number.isInteger(metrics.tradeCount) && Number(metrics.tradeCount) >= 0;
}

export function validBacktestJob(value: unknown): value is BacktestJob {
  if (!object(value)) return false;
  return typeof value.jobId === 'string' && /^backtest:[0-9a-f]{32}$/.test(value.jobId)
    && ['PENDING', 'RUNNING', 'CANCEL_REQUESTED', 'COMPLETED', 'FAILED', 'CANCELLED', 'INTERRUPTED'].includes(String(value.state))
    && time(value.createdAt) && time(value.updatedAt) && typeof value.testData === 'boolean'
    && (value.runHash === null || digest(value.runHash)) && (value.errorCode === null || typeof value.errorCode === 'string')
    && (value.workerThreadId === null || Number.isInteger(value.workerThreadId));
}

async function json(path: string, init?: RequestInit) {
  const response = await fetch(path, init);
  const value: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(object(value) && typeof value.detail === 'string' ? value.detail : 'BACKTEST_SERVICE_UNAVAILABLE');
  return value;
}

export async function loadBacktestWorkspace(signal?: AbortSignal) {
  const [strategies, runs, jobs] = await Promise.all([
    json('/api/ibkr-terminal/strategies', { signal }), json('/api/ibkr-terminal/backtests', { signal }),
    json('/api/ibkr-terminal/backtests/jobs', { signal }),
  ]);
  if (!Array.isArray(strategies) || !strategies.every(validStrategyRecord)
    || !Array.isArray(runs) || !runs.every(validBacktestResult)
    || !Array.isArray(jobs) || !jobs.every(validBacktestJob)) throw new Error('BACKTEST_RESPONSE_INVALID');
  return { strategies, runs, jobs };
}

export async function cancelBacktestJob(jobId: string, signal?: AbortSignal) {
  const value = await json(`/api/ibkr-terminal/backtests/jobs/${encodeURIComponent(jobId)}/cancel`, { method: 'POST', signal });
  if (!validBacktestJob(value) || value.jobId !== jobId) throw new Error('BACKTEST_RESPONSE_INVALID');
  return value;
}
