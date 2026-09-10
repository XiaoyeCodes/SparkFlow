import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePerformance, comparePerformance, localPerformance, gatewayPerformance } from '../../server/ibkrPortfolio.ts';

const description = 'cumulative returns expressed as fractions';
function fixture() {
  const period = { start_date: '20260702', start_nav: 0, dates: ['20260703', '20260908'], nav: [100, 500], cps: [-.05, -.08149961] };
  return { portfolio_measure: 'TWR', accounts: { account: { base_currency: 'USD', start: '20260703', end: '20260908', periods: { '1Y': structuredClone(period), YTD: structuredClone(period) } } } };
}
const normalize = raw => normalizePerformance(raw, description, 'USD');
test('inception retains the broker cumulative return including first-day loss, not NAV growth or rebased return', () => {
  const result = normalize(fixture());
  assert.deepEqual(result.inception, { value: -.08149961, start: '2026-07-03', end: '2026-09-08', note: 'IBKR 时间加权累计回报 · 保留首日收益，非年化' });
  assert.deepEqual(comparePerformance(result, [], 'SPY').inception, result.inception);
});
test('rolling one-year history, missing boundaries and zero NAV alone never imply inception', () => {
  for (const change of [
    a => { delete a.start; },
    a => { a.start = '20250703'; },
    a => { a.end = '20260909'; },
    a => { delete a.periods.YTD; },
    a => { a.periods['1Y'].start_nav = 100; },
    a => { a.periods.YTD.cps[0] = 0; },
    a => { a.periods.YTD.start_date = a.periods['1Y'].start_date = '20251231'; },
    a => { a.start = '20260230'; },
  ]) {
    const raw = fixture(); change(raw.accounts.account);
    assert.equal(normalize(raw).inception.value, null);
  }
  assert.equal(localPerformance([], 'USD').inception, undefined);
});
test('unknown return units are withheld; MWR and zero returns retain their explicit broker measure', () => {
  assert.equal(normalizePerformance(fixture(), 'unknown units', 'USD').inception.value, null);
  const raw = fixture(); raw.portfolio_measure = 'MWR';
  assert.match(normalize(raw).inception.note, /资金加权/);
  raw.accounts.account.periods.YTD.cps[1] = raw.accounts.account.periods['1Y'].cps[1] = 0;
  assert.equal(normalize(raw).inception.value, 0);
});
test('gateway performance is explicitly labeled as separate local NAV history', () => {
  const points=[{date:'2026-09-08',nav:1000,cumulativeReturn:null}];
  assert.deepEqual(gatewayPerformance(points,'USD','live'),{
    points,source:'IB Gateway 实盘 · 本地净值快照',currency:'USD',returnMethod:null,benchmark:'SPY',fetchedAt:'2026-09-08',
    note:'当前数据来自 IB Gateway 实盘。历史曲线由 SparkFlow 按日保存净值快照；净值变化包含出入金，不作为投资收益率或盈亏金额。'
  });
  assert.match(gatewayPerformance(points,'USD','paper').source,/模拟盘/);
});
