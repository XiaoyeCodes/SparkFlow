import assert from 'node:assert/strict';
import { buildGravityHistory } from '../server/etfGravity.ts';

// Continuous weekday fixtures exercise the natural-week window independently
// of upstream data revisions, including the shift to daily plotting in 2020.
const day = 86_400_000;
const sessionEnd = Date.parse('2020-01-07T21:00:00Z');
function fixture(symbol) {
  const first = symbol === 'SPY' ? '1993-01-29' : '1999-03-10';
  const timestamp = [], adjusted = [], close = [], high = [], low = [], volume = [];
  for (let time = Date.parse(first); time < sessionEnd; time += day) {
    if ([0, 6].includes(new Date(time).getUTCDay())) continue;
    const i = timestamp.length;
    timestamp.push(time / 1000 + 14.5 * 3600);
    adjusted.push(50 + i * 0.01 + Math.sin(i / 52) * 9);
    close.push(adjusted[i] * 2);
    high.push(close[i] + 2);
    low.push(close[i] - 1);
    volume.push(100 + i % 30);
  }
  return { chart: { result: [{ timestamp, meta: { symbol, currency: 'USD',
    currentTradingPeriod: { regular: { end: sessionEnd / 1000 } } },
    indicators: { adjclose: [{ adjclose: adjusted }], quote: [{ close, high, low, volume }] } }] } };
}
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} vs ${expected}`);
for (const symbol of ['SPY', 'QQQ']) {
  const payload = fixture(symbol);
  const { timestamp, indicators } = payload.chart.result[0];
  const dates = timestamp.map(stamp => new Date(stamp * 1000).toISOString().slice(0, 10));
  const adjusted = indicators.adjclose[0].adjclose;
  const { points } = buildGravityHistory(symbol, payload, sessionEnd);
  const last = points.at(-1);
  assert.equal(last.date, '2020-01-07');
  assert.equal(buildGravityHistory(symbol, payload, sessionEnd - 1).points.at(-1).date, '2020-01-06');
  assert.deepEqual(points.slice(-6).map(point => point.date),
    ['2019-12-31', '2020-01-01', '2020-01-02', '2020-01-03', '2020-01-06', '2020-01-07']);
  const inWindow = adjusted.filter((_, index) => Date.parse(dates[index]) > Date.parse(last.date) - 1400 * day);
  near(last.twap, inWindow.reduce((sum, value) => sum + value, 0) / inWindow.length);
  near(last.premium, (adjusted.at(-1) / last.twap - 1) * 100);
  assert.equal(points[0].vwap, null);
  if (symbol === 'SPY') {
    const q = indicators.quote[0];
    let turnover = 0, shares = 0;
    for (const [i, date] of dates.entries()) {
      if (date < '2020-01-01') continue;
      shares += q.volume[i];
      turnover += q.volume[i] * (q.high[i] + q.low[i] + q.close[i]) / 6;
    }
    near(last.vwap, turnover / shares);
  } else assert.equal(last.vwap, null);
  assert.ok(points.some(p => p.score === 0 && p.level === 1));
  assert.ok(points.some(p => p.score === 100 && p.level === 10));
  assert.throws(() => buildGravityHistory(symbol, payload, sessionEnd + 9 * day), /尚未更新/);
  adjusted[300] = null;
  assert.throws(() => buildGravityHistory(symbol, payload, sessionEnd), /不完整/);
}
console.log('SPY and QQQ gravity model checks passed.');
