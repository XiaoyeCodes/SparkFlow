import test from 'node:test';
import assert from 'node:assert/strict';
import { externalBriefFacts } from '../../server/ibkrBriefFacts.ts';

const evidence = (content, overrides = {}) => ({ id: 'E1', title: 'Synthetic SEC data', summary: '', content: JSON.stringify(content), symbols: ['AAPL'], url: 'https://www.sec.gov/fixture', source: 'SEC fixture', publishedAt: null, fetchedAt: '2026-09-08T00:00:00Z', read: true, kind: 'filing', ...overrides });
const period = (REPORT_DATE, FISCAL_PERIOD = 'Q3', overrides = {}) => ({ REPORT_DATE, FISCAL_PERIOD, RevenueFromContractWithCustomerExcludingAssessedTax: 94_036_000_000, NetIncomeLoss: -5_250_000, OperatingIncomeLoss: 123.4, GrossProfit: 0, EarningsPerShareDiluted: 1.57, _units: { RevenueFromContractWithCustomerExcludingAssessedTax: 'USD', NetIncomeLoss: 'USD', OperatingIncomeLoss: 'USD', GrossProfit: 'USD', EarningsPerShareDiluted: 'USD/shares' }, ...overrides });
const statement = periods => ({ data: { 'AAPL.US': { currency: 'USD', periods } } });

test('external filing facts preserve unit provenance, negative values, zero and separate EPS from monetary scaling', () => {
  const facts = externalBriefFacts([evidence(statement([period('2026-06-27')]))]);
  assert.equal(facts.externalE1P0Revenue.display, '940.36 亿美元');
  assert.equal(facts.externalE1P0NetIncome.display, '-525.00 万美元');
  assert.equal(facts.externalE1P0OperatingIncome.display, '123.40 USD');
  assert.equal(facts.externalE1P0GrossProfit.display, '0.00 USD');
  assert.equal(facts.externalE1P0DilutedEPS.display, '1.57 USD/股');
  assert.equal(facts.externalE1P0Revenue.rawValue, 94_036_000_000);
  assert.equal(facts.externalE1P0Revenue.asOf, '2026-06-27');
  assert.match(facts.externalE1P0Revenue.label, /Q3 财季，非发布日期/);
  assert.match(facts.externalE1P0Revenue.source, /USD ÷ 100000000/);
  assert.equal(facts.externalE1P0Period.display, '截至2026-06-27的Q3财季');
  assert.equal(facts.externalE1P0Period.asOf, '2026-06-27');
  assert.equal('rawValue' in facts.externalE1P0Period, false);
  assert.ok(Object.keys(facts).every(key => /^[A-Za-z0-9]+$/.test(key)));
  assert.ok(Object.values(facts).every(fact => fact.evidenceId === 'E1'));
});

test('external filing facts include the newest two periods and the matching prior-year fiscal periods, capped at four', () => {
  const rows = [period('2025-12-27', 'Q1'), period('2025-03-29', 'Q2'), period('2026-03-28', 'Q2'), period('2025-06-28', 'Q3'), period('2026-06-27', 'Q3'), period('2024-06-29', 'Q3'), period('2025-09-27', 'FY')];
  const facts = externalBriefFacts([evidence(statement(rows))]);
  assert.deepEqual([...new Set(Object.values(facts).map(fact => fact.asOf))], ['2026-06-27', '2026-03-28', '2025-06-28', '2025-03-29']);
  assert.equal(Object.keys(facts).length, 24);
  assert.ok(Object.values(facts).every(fact => !/同比|增长率/.test(fact.label)));
});

test('FY is explicitly annual and is never relabeled as a quarter or release date', () => {
  const facts = externalBriefFacts([evidence(statement([period('2025-09-27', 'FY')]))]);
  assert.match(facts.externalE1P0Revenue.label, /报告期截至 2025-09-27（FY 全年，非发布日期）/);
  assert.doesNotMatch(facts.externalE1P0Revenue.label, /财季|季度/);
  assert.equal(facts.externalE1P0Period.display, '截至2025-09-27的FY全年');
});

test('invalid dates, unknown fiscal periods, missing units, unsupported currencies and nonnumeric objects cannot become facts', () => {
  const rows = [period('2026-02-30'), period('2026-06-27', 'H1'), period('2026-03-28', 'Q2', { RevenueFromContractWithCustomerExcludingAssessedTax: {}, NetIncomeLoss: null, OperatingIncomeLoss: '123', GrossProfit: false, EarningsPerShareDiluted: {}, _units: { RevenueFromContractWithCustomerExcludingAssessedTax: 'USD', NetIncomeLoss: 'USD', OperatingIncomeLoss: 'USD', GrossProfit: 'USD', EarningsPerShareDiluted: 'USD/shares' } }), period('2025-12-27', 'Q1', { _units: { RevenueFromContractWithCustomerExcludingAssessedTax: 'EUR', EarningsPerShareDiluted: 'USD' } })];
  assert.deepEqual(externalBriefFacts([evidence(statement(rows))]), {});
  assert.deepEqual(externalBriefFacts([evidence(statement([period('2026-06-27')]), { read: false })]), {});
  assert.deepEqual(externalBriefFacts([evidence({}, { content: '{broken' })]), {});
  assert.deepEqual(externalBriefFacts([evidence({ data: { 'MSFT.US': { periods: [period('2026-06-27')] } } })]), {});
});

test('revenue concept fallback requires a finite value with the matching unit', () => {
  const row = period('2026-06-27', 'Q3', { RevenueFromContractWithCustomerExcludingAssessedTax: null, Revenues: 12_500, _units: { Revenues: 'USD' } });
  const facts = externalBriefFacts([evidence(statement([row]))]);
  assert.equal(facts.externalE1P0Revenue.display, '1.25 万美元');
  assert.match(facts.externalE1P0Revenue.source, /原字段 Revenues/);
});

test('profile facts are finite source values with unknown timing, a maximum of five fields, and no fabricated currency', () => {
  const content = { statistics: { forwardPE: 22.5, trailingPE: 31.72, forwardEps: 8.44, trailingEps: 6.2, beta: 1.1 }, financials: { currentPrice: 199.91, financialCurrency: 'USD', totalCash: 12345 } };
  const facts = externalBriefFacts([evidence(content, { id: 'E2', kind: 'profile' })]);
  assert.equal(Object.keys(facts).length, 5);
  assert.equal(facts.externalE2ForwardPE.display, '22.50 倍');
  assert.equal(facts.externalE2CurrentPrice.display, '199.91 （币种未核实）');
  assert.ok(Object.values(facts).every(fact => fact.asOf === null && fact.evidenceId === 'E2' && /预期修订时间未核实/.test(fact.label)));
  content.currency = 'USD';
  assert.equal(externalBriefFacts([evidence(content, { kind: 'profile' })]).externalE1CurrentPrice.display, '199.91 USD');
  assert.equal(externalBriefFacts([evidence(content, { kind: 'profile' })]).externalE1ForwardEPS.display, '8.44 USD/股');
});

test('empty objects, nulls, booleans, numeric strings and nonfinite profile fields never coerce to zero', () => {
  const content = { statistics: { forwardPE: {}, trailingPE: null, forwardEps: false, trailingEps: '0' }, financials: { currentPrice: null } };
  assert.deepEqual(externalBriefFacts([evidence(content, { kind: 'profile' })]), {});
  const malformed = '{"statistics":{"forwardPE":1e309},"financials":{"currentPrice":{}}}';
  assert.deepEqual(externalBriefFacts([evidence({}, { kind: 'profile', content: malformed })]), {});
});

test('daily market facts keep provider prices, signed changes and observed time for the Markdown prompt', () => {
  const content = { source: 'TradingView', symbol: 'VIX', observedAt: '2026-09-09T04:10:39.001Z', price: 15.72, changePercent: 8.18995, high: 15.94, low: 15.22 };
  const facts = externalBriefFacts([evidence(content, { kind: 'market', symbols: [], source: 'tradingview.com' })]);
  assert.equal(facts.externalE1VIXPrice.display, '15.72');
  assert.equal(facts.externalE1VIXChange.display, '+8.19%');
  assert.equal(facts.externalE1VIXHigh.display, '15.94');
  assert.equal(facts.externalE1VIXLow.display, '15.22');
  assert.equal(facts.externalE1VIXChange.asOf, content.observedAt);
});
