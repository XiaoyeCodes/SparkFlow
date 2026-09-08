import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanValuationPoints, parseMultplPe, parseDgs10Csv, parseFredCsv,
  parseFactsetForwardPe, parseFactsetPdfText, parseForwardPeImport, parseCnnFearGreed, parseYahooIndex,
} from '../../server/ibkrValuationData.ts';

// Parser-only synthetic inputs. Do not invoke loadValuationInputs here: no
// external requests, local market caches, or account sessions belong in tests.
const NOW = Date.parse('2026-09-08T12:00:00Z');
const freezeClock = context => context.mock.method(Date, 'now', () => NOW);

test('market history normalization rejects impossible dates, future rows and numeric strings', context => {
  freezeClock(context);
  const rows = [
    { date: '2026-09-07', value: 5 }, { date: '2026-09-06', value: 4 },
    { date: '2026-09-07', value: 6 }, { date: '2026-02-30', value: 100 },
    { date: '2026-09-09', value: 7 }, { date: '2026-09-05', value: '8' },
    { date: '2026-09-04', value: NaN }, { date: '2010-01-01', value: 9 },
    { date: '2026-09-03', value: -1 }, { date: 'bad', value: 20 },
  ];
  assert.deepEqual(cleanValuationPoints(rows), [{ date: '2026-09-06', value: 4 }, { date: '2026-09-07', value: 6 }]);
  assert.equal(rows[0].value, 5, 'normalization must not mutate the caller input');
});

test('Multpl TTM dates retain the source calendar day in both Shanghai and New York', context => {
  freezeClock(context);
  const html = '<title>S&amp;P 500 PE Ratio</title><table><tr><td>Jan&#x2002;1, 2026</td><td>27.30</td></tr><tr><td>Sep 1, 2026</td><td>28.40</td></tr></table>';
  const previous = process.env.TZ;
  try {
    for (const zone of ['Asia/Shanghai', 'America/New_York']) {
      process.env.TZ = zone;
      assert.deepEqual(parseMultplPe(html), [{ date: '2026-01-01', value: 27.3 }, { date: '2026-09-01', value: 28.4 }]);
    }
  } finally {
    if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous;
  }
  assert.deepEqual(parseMultplPe(html.replace('S&amp;P 500 PE Ratio', 'Shiller PE Ratio')), []);
});

test('FRED CSV parsing preserves percent units and missing observations never become zero', context => {
  freezeClock(context);
  const csv = 'observation_date,DGS10,OTHER\n2026-09-01,4.12,999\n2026-09-02,.,999\n2026-09-03,,999\n2026-09-04,-0.12,999\n2026-02-30,3,999\n2026-09-05,NaN,999';
  assert.deepEqual(parseDgs10Csv(csv), [{ date: '2026-09-01', value: 4.12 }, { date: '2026-09-04', value: -0.12 }]);
  assert.deepEqual(parseDgs10Csv(csv.replace('DGS10', 'DGS2')), []);
  assert.deepEqual(parseFredCsv('DATE,SP500\n2026-09-01,5300\n2026-09-02,.\n2026-09-03,0', 'SP500'), [{ date: '2026-09-01', value: 5300 }]);
});

test('FactSet parsing requires dated forward-12-month P/E and ignores nearby trailing or average values', context => {
  freezeClock(context);
  const body = '<script type="application/ld+json">{"datePublished":"2026-09-04T09:00:00Z"}</script><p>The trailing P/E ratio is 30. The forward 12-month P/E ratio for the S&amp;P 500 is 21.5. This P/E ratio is above the 5-year average (20.0).</p>';
  assert.deepEqual(parseFactsetForwardPe(body), { date: '2026-09-04', forwardPe: 21.5 });
  assert.equal(parseFactsetForwardPe(body.replace('forward 12-month', 'trailing')), null);
  assert.equal(parseFactsetForwardPe(body.replace('datePublished', 'modified')), null);
  assert.equal(parseFactsetForwardPe(body.replace('2026-09-04', '2027-09-04')), null);
});

test('licensed forward P/E imports use publication dates and convert to percentage earnings yield', context => {
  freezeClock(context);
  const csv = 'date,forwardPE,sourceUrl\n2026-09-01,20,https://example.com/report\n2026-09-02,25,https://example.com/report\n2026-09-03,0,https://example.com/report\n2026-09-04,30,javascript:alert(1)\n2026-02-30,20,https://example.com/report';
  assert.deepEqual(parseForwardPeImport(csv), { points: [{ date: '2026-09-01', value: 5 }, { date: '2026-09-02', value: 4 }], sourceUrl: 'https://example.com/report' });
  assert.deepEqual(parseForwardPeImport(csv.replace('forwardPE', 'trailingPE')), { points: [], sourceUrl: null });
});

test('FactSet PDF parsing joins extraction-fragmented numbers and dates without inventing a valuation', context => {
  freezeClock(context);
  const extracted = 'EARNINGS INSIGHT September 4, 2026 Valuation: The forward 12 - month P/E ratio for the S&P 500 is 19 .5. The five-year average is 20.0.';
  assert.deepEqual(parseFactsetPdfText(extracted), { date: '2026-09-04', forwardPe: 19.5 });
  assert.equal(parseFactsetPdfText(extracted.replace('EARNINGS INSIGHT September 4, 2026', 'No publication date')), null);
  assert.equal(parseFactsetPdfText(extracted.replace('forward 12 - month', 'trailing')), null);
});

test('CNN retains valid zero sentiment while rejecting absent, out-of-range and future snapshots', context => {
  freezeClock(context);
  const good = { fear_and_greed: { score: 0, timestamp: '2026-09-08T11:00:00Z' }, fear_and_greed_historical: { data: [
    { x: Date.parse('2026-09-01'), y: 45 }, { x: Date.parse('2026-09-09'), y: 99 },
  ] } };
  const parsed = parseCnnFearGreed(good);
  assert.equal(parsed.current, 0);
  assert.equal(parsed.status, 'snapshot');
  assert.deepEqual(parsed.points, [{ date: '2026-09-01', value: 45 }]);
  for (const bad of [null, {}, { fear_and_greed: { score: '50', timestamp: '2026-09-08' } }, { fear_and_greed: { score: 101, timestamp: '2026-09-08' } }, { fear_and_greed: { score: 50, timestamp: '2026-09-09' } }]) {
    assert.equal(parseCnnFearGreed(bad).current, null);
    assert.equal(parseCnnFearGreed(bad).status, 'missing');
  }
  assert.equal(parseCnnFearGreed({ fear_and_greed: { score: 50, timestamp: '2026-08-01' } }).status, 'stale');
});

test('Yahoo fallback verifies the requested index identity and never calls delayed public quotes live', context => {
  freezeClock(context);
  const payload = { chart: { result: [{ meta: { symbol: '^GSPC', regularMarketPrice: 5305, regularMarketTime: Date.parse('2026-09-08T11:00:00Z') / 1000 },
    timestamp: ['2026-09-01', '2026-09-02', '2026-09-03'].map(date => Date.parse(date) / 1000), indicators: { quote: [{ close: [5300, null, 5304] }] } }] } };
  const parsed = parseYahooIndex(payload, 'spx');
  assert.equal(parsed.current, 5305);
  assert.equal(parsed.status, 'delayed');
  assert.match(parsed.source, /Yahoo Finance/);
  assert.deepEqual(parsed.points, [{ date: '2026-09-01', value: 5300 }, { date: '2026-09-03', value: 5304 }]);
  assert.equal(parseYahooIndex(payload, 'ndx').status, 'missing');
  delete payload.chart.result[0].meta.regularMarketPrice;
  const close = parseYahooIndex(payload, 'spx');
  assert.equal(close.current, 5304);
  assert.equal(close.asOf, '2026-09-03');
  assert.equal(close.status, 'close');
});
