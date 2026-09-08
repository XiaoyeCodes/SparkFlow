import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPortfolioAnalysisPrompt, displayAssistantPrompt, portfolioAnalysisStarterPrompt } from '../../src/lib/ibkr/assistantPrompt.ts';

const readyState = () => ({
  snapshot: {
    snapshotId: 'snapshot-1', accountKey: 'live:secret-account', state: 'ready', asOf: '2026-09-08T03:00:00Z', baseCurrency: 'USD',
    metrics: { netLiquidation: '1000', unrealizedPnl: '25', buyingPower: '300', maintenanceMargin: '50' },
    cash: [{ currency: 'USD', amount: '100' }],
    positions: [
      { conId: 1, symbol: 'AAPL', name: 'Apple Inc.', instrumentType: 'STK', sector: 'Technology', industry: 'Consumer Electronics', currency: 'USD', quantity: '2', averageCost: '180', marketValue: '400', unrealizedPnl: '40' },
      { conId: 2, symbol: 'QQQ', name: 'Invesco QQQ Trust', instrumentType: 'ETF', currency: 'USD', quantity: '1', averageCost: '500', marketValue: '500', unrealizedPnl: '-15' },
    ],
  },
  quotes: [{ conId: 1, price: 200, currency: 'USD', status: 'delayed', source: '测试行情', asOf: '2026-09-05T04:00:00Z' }],
  metrics: { riskLevel: '中等', reasons: ['单一持仓偏高'] },
});

test('portfolio assistant prompt includes every holding and omits the account identifier', () => {
  const prompt = buildPortfolioAnalysisPrompt(readyState());
  assert.match(prompt, new RegExp(portfolioAnalysisStarterPrompt));
  assert.match(prompt, /1\. AAPL.*科技 · 消费电子.*数量 2.*参考价 200 USD/);
  assert.match(prompt, /2\. QQQ.*ETF（不穿透）.*市值 500 USD/);
  assert.match(prompt, /持仓数量：2/);
  assert.match(prompt, /单一持仓偏高/);
  assert.doesNotMatch(prompt, /secret-account/);
  assert.doesNotMatch(prompt, /undefined|null/);
  assert.equal(displayAssistantPrompt(prompt), portfolioAnalysisStarterPrompt);
  assert.equal(displayAssistantPrompt('普通研究问题'), '普通研究问题');
});

test('portfolio assistant prompt rejects unsynchronized or empty accounts', () => {
  const unsynchronized = readyState();
  unsynchronized.snapshot.snapshotId = '';
  assert.throws(() => buildPortfolioAnalysisPrompt(unsynchronized), /尚未同步/);
  const empty = readyState();
  empty.snapshot.positions = [];
  assert.throws(() => buildPortfolioAnalysisPrompt(empty), /没有可分析的持仓/);
});
