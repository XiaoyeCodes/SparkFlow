import test from 'node:test';
import assert from 'node:assert/strict';
import { validBacktestJob, validBacktestResult, validStrategyRecord } from '../../src/lib/ibkr/backtestClient.ts';

const hash = 'a'.repeat(64);
const strategy = { definition: { strategyId: 'example:test', version: '1.0.0', origin: 'fixture', name: '工程示例',
  universe: [12], barInterval: '1D', entryRule: '下一根 bar 买入', exitRule: '下一根 bar 卖出', parameters: { targetQuantity: '2' },
  signal: { kind: 'sma_cross', priceField: 'close', fastWindow: 2, slowWindow: 5, entryWhen: 'FAST_ABOVE_SLOW', exitWhen: 'FAST_AT_OR_BELOW_SLOW' },
  positionSizing: { kind: 'fixed_quantity', targetQuantity: '2' }, costs: { commissionPerOrder: '0', commissionPerShare: '0', slippageBps: '0' },
  risk: { allowShort: false, maxPositionQuantity: '2' }, versionNotes: '工程示例。' },
  strategyHash: hash, createdAt: '2026-09-05T00:00:00Z' };
const result = { strategyId: 'example:test', strategyVersion: '1.0.0', strategyHash: hash, datasetHash: hash,
  configHash: hash, runHash: hash, startedAt: '2026-09-05T00:00:00Z', barCount: 3, testData: true,
  executions: [], corporateActions: [], equityCurve: [
    { timestamp: '2026-09-03T00:00:00Z', cash: '1000', marketValue: '0', equity: '1000', drawdown: '0' },
    { timestamp: '2026-09-04T00:00:00Z', cash: '900', marketValue: '105', equity: '1005', drawdown: '0' },
    { timestamp: '2026-09-05T00:00:00Z', cash: '1010', marketValue: '0', equity: '1010', drawdown: '0' },
  ], logs: [], metrics: { initialCash: '1000', finalCash: '1010', finalMarketValue: '0',
    finalEquity: '1010', totalReturn: '0.01', totalFees: '0', slippageCost: '0', dividends: '0', maxDrawdown: '0', benchmarkReturn: '0.02', turnover: '0.2', returnVolatility: null, riskAdjustedReturn: null, riskFormulaVersion: 'period-return-v1', tradeCount: 2 } };
const job = { jobId: `backtest:${'b'.repeat(32)}`, state: 'COMPLETED', createdAt: '2026-09-05T00:00:00Z',
  updatedAt: '2026-09-05T00:00:01Z', testData: true, runHash: hash, errorCode: null, workerThreadId: 9 };

test('backtest client validates source labels, decimal metrics and immutable hashes', () => {
  assert.equal(validStrategyRecord(strategy), true);
  assert.equal(validStrategyRecord({ ...strategy, definition: { ...strategy.definition, strategyId: 'user:wrong' } }), false);
  assert.equal(validBacktestResult(result), true);
  assert.equal(validBacktestResult({ ...result, metrics: { ...result.metrics, finalEquity: 1010 } }), false);
  assert.equal(validBacktestResult({ ...result, runHash: 'short' }), false);
  assert.equal(validBacktestResult({ ...result, equityCurve: [] }), false);
  assert.equal(validBacktestJob(job), true);
  assert.equal(validBacktestJob({ ...job, state: 'MADE_UP' }), false);
});
