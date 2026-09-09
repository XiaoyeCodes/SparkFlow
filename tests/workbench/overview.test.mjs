import test from 'node:test';
import assert from 'node:assert/strict';
import { overviewAllocation, monthlyReturns, periodReturn, chartSeries } from '../../src/lib/ibkr/overview.ts';

const history = { returnMethod: 'TWR', points: [
  { date: '2026-06-30', nav: 100, cumulativeReturn: 0 },
  { date: '2026-07-31', nav: 250, cumulativeReturn: .1 },
  { date: '2026-08-31', nav: 245, cumulativeReturn: .078 },
  { date: '2026-09-07', nav: 500, cumulativeReturn: .1 },
] };
test('monthly returns compound broker TWR, never infer returns from deposits or NAV', () => {
  const rows = monthlyReturns(history);
  assert.equal(rows.length, 6);
  assert.ok(Math.abs(rows.find(x => x.month === '2026-07').value - .1) < 1e-9);
  assert.ok(Math.abs(rows.find(x => x.month === '2026-08').value + .02) < 1e-9);
  assert.equal(rows.find(x => x.month === '2026-06').value, null);
  assert.equal(rows.at(-1).partial, true);
  assert.ok(Math.abs(periodReturn(history, 7).value - (1.1 / 1.078 - 1)) < 1e-9);
});
test('missing boundaries, MWR, duplicates and invalid values do not produce monthly or interval returns', () => {
  assert.equal(monthlyReturns({ ...history, returnMethod: 'MWR' }).at(-1).value, null);
  assert.equal(periodReturn({ ...history, returnMethod: null }, 7).value, null);
  assert.equal(periodReturn(history, 365).value, null);
  assert.equal(monthlyReturns({ ...history, points: [history.points[0], history.points[2]] }).at(-1).value, null);
  assert.deepEqual(chartSeries({ ...history, points: [history.points[0], history.points[0]] }), []);
  assert.equal(periodReturn({ ...history, points: [{ ...history.points[2], cumulativeReturn: -1 }, history.points[3]] }, 7).value, null);
});
test('all-history returns rebase from the first valid TWR observation without a one-year cutoff', () => {
  const longer = { ...history, points: [{ date: '2020-01-02', nav: 50, cumulativeReturn: .05 }, ...history.points] };
  const result = periodReturn(longer, 'all');
  assert.equal(result.start, '2020-01-02');
  assert.equal(result.end, '2026-09-07');
  assert.ok(Math.abs(result.value - (1.1 / 1.05 - 1)) < 1e-9);
  assert.equal(periodReturn(undefined, 'all').value, null);
  assert.equal(periodReturn({ ...longer, returnMethod: 'MWR' }, 'all').value, null);
  assert.equal(periodReturn({ ...history, points: [history.points[0]] }, 'all').value, null);
});
test('allocation derives top-five exposure from actual holdings and does not combine currencies', () => {
  const snapshot = { baseCurrency: 'USD', metrics: { netLiquidation: '100' }, positions: [{ conId: 1, symbol: 'A', currency: 'USD', marketValue: '40' }, { conId: 2, symbol: 'B', currency: 'USD', marketValue: '20' }], cash: [{ currency: 'USD', amount: '40' }] };
  const result = overviewAllocation(snapshot);
  assert.equal(result.topFive, .6); assert.equal(result.cashWeight, .4);
  assert.equal(result.complete, true);
  const partial = overviewAllocation({ ...snapshot, positions: [...snapshot.positions, { conId: 3, symbol: 'C', currency: 'HKD', marketValue: '200' }] });
  assert.equal(partial.topFive, null); assert.equal(partial.excluded, 1);
  assert.equal(overviewAllocation({ ...snapshot, metrics: { netLiquidation: '0' } }).topFive, null);
});
