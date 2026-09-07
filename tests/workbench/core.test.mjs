import test from 'node:test';
import assert from 'node:assert/strict';
import { defaults, latestDueSession, newYorkClock, accountRisk, sizeScenario, validateAnalysis, analysisPrompt, numeric } from '../../server/ibkrWorkbenchCore.ts';
import { normalizeMcpSnapshot } from '../../server/ibkrMcp.ts';
import { IbkrMarket, parseEastmoneyRow } from '../../server/ibkrMarket.ts';
import { extractEvidence } from '../../server/ibkrWorkbench.ts';

export const snapshot = () => normalizeMcpSnapshot('U12345', [{ accountId: 'U12345', conid: 1, ticker: 'AAPL', assetClass: 'STK', currency: 'USD', position: 10, avgCost: 100, mktValue: 2000, unrealizedPnl: 1000, exchange: 'NASDAQ' }], { accountId: 'U12345', baseCurrency: 'USD', netliquidation: { amount: 10000, currency: 'USD' }, cash: [{ currency: 'USD', amount: 8000 }] });
const content = () => ({ brief: '账户简报', accountSummary: '净值来自账户', portfolioRisk: '集中度', marketContext: '证据不足', holdings: [{ symbol: 'AAPL', background: '待核实', shortTerm: '观察', longTerm: '等待证据' }], opportunities: [], risks: [], gaps: ['缺少基本面数据'], actions: [{ symbol: 'AAPL', action: 'watch', horizon: 'short', rationale: '持仓快照', counterEvidence: '缺少背景', trigger: '有新证据', invalidation: '数据失效', targetWeight: null, evidenceIds: [] }] });

test('NYSE calendar accounts for DST, holidays, half days and unknown years', () => {
  assert.deepEqual(newYorkClock(new Date('2026-03-09T20:30:00Z')), { date: '2026-03-09', minutes: 990 });
  assert.equal(latestDueSession(new Date('2026-03-09T20:29:00Z')), '2026-03-06');
  assert.equal(latestDueSession(new Date('2026-03-09T20:30:00Z')), '2026-03-09');
  assert.equal(latestDueSession(new Date('2026-09-07T22:00:00Z')), '2026-09-04');
  assert.equal(latestDueSession(new Date('2026-11-27T18:29:00Z')), '2026-11-25');
  assert.equal(latestDueSession(new Date('2026-11-27T18:30:00Z')), '2026-11-27');
  assert.equal(latestDueSession(new Date('2027-01-05T22:00:00Z')), null);
});
test('MCP normalization enforces account identity, missing values and duplicate contracts', () => {
  const value = snapshot(); assert.equal(value.positions[0].marketValue, '2000'); assert.equal(value.metrics.buyingPower, null); assert.equal(value.positions[0].assetType, 'STK'); assert.equal(value.testData, false); assert.ok(!JSON.stringify(value).includes('U12345'));
  assert.throws(() => normalizeMcpSnapshot('U12345', [{ account: 'U999', conId: 1 }], { baseCurrency: 'USD' }), /IDENTITY/);
  assert.throws(() => normalizeMcpSnapshot('U12345', [{ conId: 1, symbol: 'A', currency: 'USD', position: 1 }, { conId: 1, symbol: 'A', currency: 'USD', position: 1 }], { baseCurrency: 'USD' }), /DUPLICATE/);
  assert.equal(normalizeMcpSnapshot('U12345', [], {}).state, 'empty');
  for (const missing of [null, undefined, '', '-', false]) assert.equal(numeric(missing), null);
});
test('risk uses broker valuations and never adds unconverted foreign currencies', () => {
  const value = snapshot(); value.quotes = [{ conId: 1, price: '999', source: 'external' }];
  assert.equal(accountRisk(value).weights[0].weight, 0.2);
  value.positions[0].currency = 'HKD'; assert.equal(accountRisk(value).gross, null); assert.equal(accountRisk(value).weights[0].weight, null);
  value.metrics.netLiquidation = null; assert.equal(accountRisk(value).nav, null);
});
test('position sizing requires complete preferences, preserves cash floor and cannot oversell', () => {
  const base = content().actions[0]; const value = snapshot();
  assert.equal(sizeScenario({ ...base, action: 'increase', targetWeight: 0.4 }, value, defaults).shares, undefined);
  const prefs = { ...defaults, targetWeight: 0.4, cashFloor: 0.7, maxDrawdown: 0.2 };
  const increase = sizeScenario({ ...base, action: 'increase', targetWeight: 0.4 }, value, prefs);
  assert.equal(increase.shares, 5); assert.equal(increase.estimatedCashAfter, 7000);
  const reduction = sizeScenario({ ...base, action: 'reduce', targetWeight: 0 }, value, prefs); assert.equal(reduction.shares, -10);
  assert.equal(sizeScenario({ ...base, action: 'reduce', targetWeight: 0.9 }, value, prefs).shares, 0);
});
test('AI cannot supply invented trade quantities, holdings or citations', () => {
  const value = snapshot(); const raw = content();
  assert.equal(validateAnalysis(JSON.stringify(raw), value, [], defaults).brief, '账户简报');
  raw.actions[0].shares = 999; assert.throws(() => validateAnalysis(JSON.stringify(raw), value, [], defaults)); delete raw.actions[0].shares;
  raw.actions[0].evidenceIds = ['invented']; assert.throws(() => validateAnalysis(JSON.stringify(raw), value, [], defaults), /UNKNOWN/);
  raw.actions[0].evidenceIds = []; raw.holdings[0].symbol = 'UNKNOWN'; assert.throws(() => validateAnalysis(JSON.stringify(raw), value, [], defaults), /UNKNOWN/);
  value.accountKey = 'U_PRIVATE'; value.positions[0].accountKey = 'U_PRIVATE';
  assert.ok(!analysisPrompt(value, [], [], defaults).includes('U_PRIVATE'));
});
test('market batch deduplicates requests, distinguishes ambiguity and retains stale quote timestamp', async () => {
  let count = 0; let fail = false;
  const market = new IbkrMarket(async () => { count++; if (fail) throw new Error('offline'); return { data: { diff: [{ f12: 'AAPL', f13: 105, f2: 200, f3: 1, f124: 1788552000 }] } }; });
  const holdings = snapshot().positions; const [a, b] = await Promise.all([market.quotes(holdings), market.quotes(holdings)]);
  assert.equal(count, 1); assert.equal(a[0].price, 200); assert.equal(a, b);
  fail = true; for (const row of market.cache.values()) row.at = 0;
  const old = await market.quotes(holdings); assert.equal(old[0].status, 'stale'); assert.equal(old[0].asOf, a[0].asOf);
  const ambiguous = new IbkrMarket(async () => ({ data: { diff: [{ f12: 'AAPL', f13: 105, f2: 1 }, { f12: 'AAPL', f13: 106, f2: 2 }] } }));
  const q = await ambiguous.quotes([{ ...holdings[0], exchange: '' }]); assert.equal(q[0].status, 'unmapped'); assert.equal(q[0].price, null);
  assert.equal(parseEastmoneyRow({ f2: '-', f3: null }).price, null);
});
test('news linking requires ticker boundaries and safe URLs, retains evidence timestamps', () => {
  const value = snapshot(); value.positions[0].symbol = 'A';
  const evidence = extractEvidence({ items: [{ title: 'MARKET rally', url: 'https://example.com/1' }, { title: 'A earnings', url: 'https://example.com/2', publishedAt: '2026-09-04T14:00:00Z' }, { title: 'A', url: 'javascript:alert(1)' }] }, null, value);
  assert.equal(evidence.length, 2); assert.equal(evidence[0].title, 'A earnings'); assert.deepEqual(evidence[1].symbols, []); assert.equal(evidence[0].publishedAt, '2026-09-04T14:00:00Z');
});
