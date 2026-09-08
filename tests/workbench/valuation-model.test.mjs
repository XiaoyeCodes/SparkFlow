import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeValuationDashboard, empiricalPercentile, fitLogTrend,
  joinErpHistory, normalizeValuationPoints, erpReferenceScore, VALUATION_RULES,
} from '../../server/ibkrValuationModel.ts';

const NOW = '2026-09-08T00:00:00.000Z';
const DAY = 86_400_000;
const keys = ['vix', 'spx', 'ndx', 'pe', 'forwardYield', 'treasury10y', 'fearGreed'];
const levels = { vix: 20, spx: 100, ndx: 100, pe: 20, forwardYield: 5, treasury10y: 4, fearGreed: 50 };

function fixture(years = 1) {
  const points = [];
  const start = new Date(NOW);
  start.setUTCFullYear(start.getUTCFullYear() - years);
  for (let date = +start; date <= Date.parse(NOW); date += DAY) points.push(new Date(date).toISOString().slice(0, 10));
  return {
    fetchedAt: NOW,
    series: Object.fromEntries(keys.map(id => [id, {
      points: points.map(date => ({ date, value: levels[id] })), current: levels[id], asOf: NOW,
      source: 'TEST FIXTURE', sourceUrl: 'https://example.com/test-only', status: 'snapshot', note: '',
    }])),
  };
}

test('empirical percentile uses midrank for ties, supports bounds, and rejects absent history', () => {
  assert.equal(empiricalPercentile([1, 2, 2, 4], 2), 50);
  assert.equal(empiricalPercentile([1, 1, 1], 1), 50);
  assert.equal(empiricalPercentile([1, 2, 3], 0), 0);
  assert.equal(empiricalPercentile([1, 2, 3], 4), 100);
  assert.equal(empiricalPercentile([0, 1e-12, -1e-12], 0), 50);
  assert.equal(empiricalPercentile([], 1), null);
  assert.equal(empiricalPercentile([NaN, Infinity], 1), null);
  assert.equal(empiricalPercentile([1], NaN), null);
});

test('log trend uses elapsed time instead of row number and handles flat levels', () => {
  const start = Date.parse('2026-01-01');
  const points = [0, 1, 5, 11, 50].map(days => ({ date: new Date(start + days * DAY).toISOString(), value: 100 * Math.exp(days * 0.003) }));
  const fit = fitLogTrend(points);
  assert.ok(fit);
  for (const point of fit.points) assert.ok(Math.abs(point.value / point.trend - 1) < 1e-12);
  assert.ok(Math.abs(fit.at('2026-03-02') - 100 * Math.exp(60 * 0.003)) < 1e-9);
  const flat = fitLogTrend(points.map(point => ({ ...point, value: 20 })));
  assert.ok(Math.abs(flat.at('2027-01-01') - 20) < 1e-12);
  assert.equal(fitLogTrend([{ date: '2026-01-01', value: 0 }]), null);
  assert.equal(fitLogTrend([{ date: '2026-01-01', value: 1 }, { date: '2026-01-01', value: 2 }]), null);
});

test('history normalization drops invalid and future observations and preserves caller input', () => {
  const points = [{ date: '2026-01-02', value: 2 }, { date: '2026-01-01', value: 1 }, { date: '2026-01-02', value: 3 },
    { date: '2026-02-30', value: 7 }, { date: '2026-01-03T01:00:00Z', value: 8 }, { date: 'garbage', value: 9 }, { date: '2026-01-02', value: -4 }];
  const saved = structuredClone(points);
  assert.deepEqual(normalizeValuationPoints(points, '2026-01-03', 'spx'), [{ date: '2026-01-01', value: 1 }, { date: '2026-01-02', value: 3 }]);
  assert.deepEqual(points, saved);
  assert.deepEqual(normalizeValuationPoints([{ date: '2026-01-01', value: -2 }], '2026-01-02', 'erp'), [{ date: '2026-01-01', value: -2 }]);
});

test('ERP joins only already-known data, caps both carry periods, and preserves percent-point units', () => {
  const f = [{ date: '2026-01-03', value: 5 }, { date: '2026-03-01', value: 6 }];
  const t = [{ date: '2026-01-01', value: 4 }, { date: '2026-01-05', value: 4.5 }, { date: '2026-02-18', value: 3 }, { date: '2026-02-28', value: 4 }];
  assert.deepEqual(joinErpHistory(f, t, '2026-03-01'), [
    { date: '2026-01-03', value: 1 }, { date: '2026-01-05', value: 0.5 }, { date: '2026-03-01', value: 2 },
  ]);
  assert.deepEqual(joinErpHistory([{ date: '2026-01-10', value: 5 }], [{ date: '2026-01-01', value: 4 }], NOW), []);
  assert.deepEqual(joinErpHistory([{ date: '2026-01-10', value: 5 }], [{ date: '2026-01-11', value: 4 }], '2026-01-10'), []);
});

test('constant history produces a neutral score and VIX uses its trend deviation percentile', () => {
  const result = computeValuationDashboard(fixture(), 1);
  assert.equal(result.score.value, 50);
  assert.equal(result.score.coverageWeight, 100);
  assert.deepEqual(result.score.missing, []);
  assert.equal(result.score.label, '保持中性');
  for (const metric of result.metrics) assert.equal(metric.percentile, 50, metric.id);
  assert.ok(Math.abs(result.metrics.find(metric => metric.id === 'vix').deviationPercent) < 1e-9);
  assert.equal(result.metrics.find(metric => metric.id === 'erp').current, 1);
  assert.equal(result.score.contributions.reduce((sum, row) => sum + row.weight, 0), 100);
  assert.equal(result.score.contributions.some(row => row.id === 'forwardYield'), false);
  assert.deepEqual(Object.keys(result.charts), ['spx', 'ndx', 'vix']);
  assert.deepEqual(result.chart, result.charts.spx);
  assert.equal(result.charts.ndx.points.length, result.charts.vix.points.length);
  assert.equal(result.charts.vix.points[0].value, 20);
});

test('fixed weights reach exact buy/sell limits with transparent additive contributions', () => {
  const buy = fixture();
  for (const id of ['spx', 'ndx', 'pe']) buy.series[id].current = levels[id] / 2;
  buy.series.vix.current = 40;
  buy.series.forwardYield.current = 8;
  buy.series.fearGreed.current = 0;
  const result = computeValuationDashboard(buy, 1);
  assert.equal(result.score.value, 100);
  assert.equal(result.score.label, '该贪婪');
  for (const row of result.score.contributions) assert.equal(row.points, VALUATION_RULES.weights[row.id]);

  const sell = fixture();
  for (const id of ['spx', 'ndx', 'pe']) sell.series[id].current = levels[id] * 2;
  sell.series.vix.current = 10;
  sell.series.forwardYield.current = 2;
  sell.series.fearGreed.current = 100;
  const low = computeValuationDashboard(sell, 1);
  assert.equal(low.score.value, 0);
  assert.equal(low.score.label, '该恐惧');
});

test('missing or stale input suppresses score without renormalizing remaining weights', () => {
  const input = fixture();
  input.series.pe.status = 'missing';
  input.series.pe.current = null;
  const result = computeValuationDashboard(input, 1);
  assert.equal(result.score.value, null);
  assert.equal(result.score.coverageWeight, 65);
  assert.equal(result.score.contributions.find(row => row.id === 'spx').points, 8.75);
  assert.equal(result.score.missing.length, 1);
  input.series.fearGreed.asOf = '2026-08-01';
  const older = computeValuationDashboard(input, 1);
  assert.equal(older.score.coverageWeight, 57.5);
  assert.equal(older.sentiment.status, 'stale');
  assert.equal(older.sentiment.eligible, false);
});

test('ten-year selection cannot silently reuse a shorter window; sparse and gapped data are rejected', () => {
  const input = fixture();
  const result = computeValuationDashboard(input, 10);
  assert.equal(result.window.start, '2016-09-08');
  assert.equal(result.score.value, null);
  assert.equal(result.score.coverageWeight, 22.5);
  for (const metric of result.metrics) {
    assert.equal(metric.percentile, null, metric.id);
    assert.equal(metric.coverage.complete, false);
  }
  const sparse = fixture();
  sparse.series.spx.points = sparse.series.spx.points.filter((_, index) => index % 10 === 0);
  assert.equal(computeValuationDashboard(sparse, 1).metrics.find(metric => metric.id === 'spx').eligible, false);
  const gapped = fixture();
  gapped.series.spx.points = gapped.series.spx.points.filter(point => point.date < '2026-04-01' || point.date > '2026-05-01');
  assert.match(computeValuationDashboard(gapped, 1).metrics.find(metric => metric.id === 'spx').coverage.reason, /缺口/);
});

test('future-dated quote blocks scoring and future history cannot change a valid result', () => {
  const input = fixture();
  const expected = computeValuationDashboard(input, 1);
  input.series.spx.points.push({ date: '2030-01-01', value: 1000000 });
  assert.deepEqual(computeValuationDashboard(input, 1).metrics, expected.metrics);
  input.series.spx.asOf = '2026-09-09';
  const result = computeValuationDashboard(input, 1);
  assert.equal(result.score.value, null);
  assert.match(result.score.missing[0], /晚于快照/);
  assert.equal(result.metrics.find(metric => metric.id === 'spx').trendValue, null);
});

test('future observations relative to a series own quote date are excluded', () => {
  const input = fixture();
  input.series.spx.asOf = '2026-09-07';
  const expected = computeValuationDashboard(input, 1);
  input.series.spx.points.find(point => point.date === '2026-09-08').value = 1000000;
  assert.deepEqual(computeValuationDashboard(input, 1).chart.points, expected.chart.points);
  assert.deepEqual(computeValuationDashboard(input, 1).metrics.find(metric => metric.id === 'spx'), expected.metrics.find(metric => metric.id === 'spx'));
});

test('monthly fundamental freshness differs from market data and ERP requires valid current components', () => {
  const input = fixture();
  input.series.forwardYield.asOf = '2026-08-15';
  input.series.pe.asOf = '2026-08-15';
  assert.equal(computeValuationDashboard(input, 1).score.value, 50);
  input.series.treasury10y.asOf = '2026-08-30';
  const result = computeValuationDashboard(input, 1);
  assert.equal(result.treasury.eligible, false);
  assert.equal(result.metrics.find(metric => metric.id === 'erp').eligible, false);
  assert.equal(result.score.coverageWeight, 85);
});

test('ERP ignores history after either component own timestamp even if the other component is newer', () => {
  const input = fixture();
  input.series.forwardYield.asOf = '2026-08-15';
  const expected = computeValuationDashboard(input, 1).metrics.find(metric => metric.id === 'erp');
  for (const point of input.series.forwardYield.points) if (point.date > '2026-08-15') point.value = 999;
  assert.deepEqual(computeValuationDashboard(input, 1).metrics.find(metric => metric.id === 'erp'), expected);
});

test('audit contains independent data and versioned rules for exact deterministic replay', () => {
  const input = fixture();
  const saved = structuredClone(input);
  const result = computeValuationDashboard(input, 1);
  assert.deepEqual(input, saved);
  const replay = computeValuationDashboard(result.audit.inputs, result.audit.lookbackYears);
  assert.deepEqual(replay, result);
  result.audit.inputs.series.spx.current = 900;
  result.rules.weights.spx = 0;
  assert.equal(input.series.spx.current, 100);
  assert.equal(VALUATION_RULES.weights.spx, 17.5);
  assert.equal(result.audit.rules.weights.spx, 17.5);
  assert.match(result.chart.note, /并非历史回测/);
  assert.throws(() => computeValuationDashboard(input, 2), /LOOKBACK_INVALID/);
  assert.throws(() => computeValuationDashboard({ ...input, fetchedAt: 'bad' }, 1), /FETCHED_AT_INVALID/);
});

test('leap-day lookback ends on the last valid day of the prior year', () => {
  const input = fixture();
  input.fetchedAt = '2024-02-29T12:00:00.000Z';
  assert.equal(computeValuationDashboard(input, 1).window.start, '2023-02-28');
});

test('ERP fixed reference mapping has explicit anchors, clips extremes and never fills missing with zero', () => {
  assert.equal(erpReferenceScore(-3), 0);
  assert.equal(erpReferenceScore(-2), 0);
  assert.ok(Math.abs(erpReferenceScore(0) - 100 / 3) < 1e-12);
  assert.equal(erpReferenceScore(1), 50);
  assert.ok(Math.abs(erpReferenceScore(2) - 200 / 3) < 1e-12);
  assert.equal(erpReferenceScore(4), 100);
  assert.equal(erpReferenceScore(8), 100);
  assert.equal(erpReferenceScore(null), null);
  assert.equal(erpReferenceScore(NaN), null);
});

test('ERP current reference score works without historical percentile but blocks stale components', () => {
  const input = fixture();
  input.series.forwardYield.points = [{ date: '2026-09-07', value: 5 }];
  const result = computeValuationDashboard(input, 1);
  assert.equal(result.metrics.find(row => row.id === 'erp').percentile, null);
  assert.equal(result.score.contributions.find(row => row.id === 'erp').signal, 50);
  assert.equal(result.score.value, 50);
  assert.equal(result.score.coverageWeight, 100);
  assert.match(result.rules.formula, /clamp/);
  assert.match(result.score.contributions.find(row => row.id === 'erp').reason, /非历史分位/);
  input.series.forwardYield.status = 'stale';
  const stale = computeValuationDashboard(input, 1);
  assert.equal(stale.score.value, null);
  assert.equal(stale.score.coverageWeight, 85);
});
