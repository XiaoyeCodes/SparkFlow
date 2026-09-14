import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { SINA_CORE_INDEX_CONFIGS, parseSinaCoreIndexQuotes, coreIndexHistoryQuote } from '../server/macroCoreIndexQuotes.ts';
import { SINA_CURRENCY_CODES, SINA_US10Y_CODE, currencyQuoteTime, parseSinaCurrencyQuotes, parseSinaUs10yQuote } from '../server/macroCurrencyQuotes.ts';

const usFields = ['纳斯达克100', '29368.4389', '0.91', '2026-09-12 09:35:55', '264.9261'];
const cnFields = Array(34).fill('0');
Object.assign(cnFields, { 0: '上证指数', 1: '3867.0216', 2: '3888.1106', 3: '3885.3328', 30: '2026-09-14', 31: '15:35:32' });
const row = (code, fields) => `var hq_str_${code}="${fields.join(',')}";`;
const fixture = SINA_CORE_INDEX_CONFIGS.map(c => row(c.code, c.id === 'shanghai' ? cnFields : usFields)).join('\n');
const parsed = parseSinaCoreIndexQuotes(fixture);
assert.equal(parsed.size, 4, 'parse literal $ in US index feed symbols');
assert.equal(parsed.get('nasdaq').price, 29368.4389);
assert.equal(parsed.get('nasdaq').changePercent, 0.91, 'use reported percent, not the change amount');
assert.equal(parsed.get('nasdaq').updatedAt, '2026-09-12T01:35:55.000Z');
assert.equal(parsed.get('shanghai').price, 3885.3328, 'use last, not open or previous close');
assert.ok(Math.abs(parsed.get('shanghai').changePercent - (-0.07144344587336515)) < 1e-8);
assert.equal(parsed.get('shanghai').updatedAt, '2026-09-14T07:35:32.000Z');
const zero = [...usFields]; zero[2] = '0.00'; zero[4] = '0';
assert.equal(parseSinaCoreIndexQuotes(row('gb_$ndx', zero)).get('nasdaq').changePercent, 0, 'flat quotes are valid');
const preopen = Array(36).fill('0');
Object.assign(preopen, { 0: '纳斯达克100', 1: usFields[1], 2: '0.00', 3: '2026-09-14 21:10:03', 4: '0', 26: usFields[1] });
const pending = parseSinaCoreIndexQuotes(SINA_CORE_INDEX_CONFIGS.filter(c => c.id !== 'shanghai').map(c => row(c.code, preopen)).join('\n'));
assert.equal(pending.size, 0, 'all three US indices must reject reset placeholders even with a newer timestamp');
const openFlat = [...preopen]; openFlat[5] = usFields[1]; openFlat[6] = usFields[1]; openFlat[7] = usFields[1];
assert.equal(parseSinaCoreIndexQuotes(row('gb_$ndx', openFlat)).get('nasdaq').changePercent, 0, 'a genuine flat open replaces previous session');
const openDown = [...openFlat]; openDown[1] = '29000'; openDown[2] = '-1.25'; openDown[4] = '-368.4389';
assert.equal(parseSinaCoreIndexQuotes(row('gb_$ndx', openDown)).get('nasdaq').changePercent, -1.25);
const closeHistory = [{ time: '2026-09-10T13:30:00.000Z', value: 100 }, { time: '2026-09-11T13:30:00.000Z', value: 101 }];
const monday = Date.parse('2026-09-14T13:10:00Z');
assert.ok(Math.abs(coreIndexHistoryQuote('^NDX', closeHistory, monday).changePercent - 1) < 1e-10);
assert.equal(coreIndexHistoryQuote('^NDX', closeHistory, monday).updatedAt, closeHistory[1].time);
assert.equal(coreIndexHistoryQuote('^NDX', closeHistory.slice(1), monday), undefined, 'one close cannot establish previous-day return');
assert.equal(coreIndexHistoryQuote('^NDX', closeHistory, monday + 30 * 86400_000), undefined, 'no indefinitely stale history');
for (const [index, value] of [[1, ''], [1, 'NaN'], [1, '-1'], [2, '--'], [4, ''], [3, '2026-02-30 20:00:00']]) {
  const invalid = [...usFields]; invalid[index] = value;
  assert.equal(parseSinaCoreIndexQuotes(row('gb_$ndx', invalid)).size, 0);
}
const invalidCn = [...cnFields]; invalidCn[2] = '0';
assert.equal(parseSinaCoreIndexQuotes(row('sh000001', invalidCn)).size, 0);
assert.equal(parseSinaCoreIndexQuotes('var hq_str_gb_sox="";').size, 0);
for (const config of SINA_CORE_INDEX_CONFIGS) {
  assert.equal(parsed.get(config.id).sourceUrl, config.sourceUrl);
  assert.doesNotMatch(config.sourceUrl, /hq\.sinajs|qt\.gtimg|push2\.|\/api\//);
}

const source = await readFile(new URL('../vite.config.ts', import.meta.url), 'utf8');
const extract = (a, b) => ts.transpile(source.slice(source.indexOf(a), source.indexOf(b, source.indexOf(a))), { target: ts.ScriptTarget.ES2022 });
// Test production batch wiring, not only the standalone parser.
let requestedUrl;
const batch = new Function('SINA_CURRENCY_CODES', 'SINA_US10Y_CODE', 'SINA_CORE_INDEX_CONFIGS', 'fetchText', 'asFiniteNumber',
  'currencyQuoteTime', 'parseSinaCurrencyQuotes', 'parseSinaUs10yQuote', 'parseSinaCoreIndexQuotes',
  extract('async function getSinaFastAssetQuotes()', 'async function getCoinGeckoFastCryptoQuotes()') + ';return getSinaFastAssetQuotes;')(
  SINA_CURRENCY_CODES, SINA_US10Y_CODE, SINA_CORE_INDEX_CONFIGS, async url => { requestedUrl = url; return fixture; },
  n => Number.isFinite(Number(n)) ? Number(n) : undefined, currencyQuoteTime, parseSinaCurrencyQuotes, parseSinaUs10yQuote, parseSinaCoreIndexQuotes);
assert.equal((await batch()).size, 4);
for (const c of SINA_CORE_INDEX_CONFIGS) assert.ok(requestedUrl.includes(c.code));

const configs = Object.fromEntries(SINA_CORE_INDEX_CONFIGS.map(c => [c.id, { ...c, name: c.id,
  sourceUrl: `https://finance.yahoo.com/quote/${encodeURIComponent(c.symbol)}` }]));
const history = Array.from({ length: 25 }, (_, i) => ({ time: `2026-08-${String(i + 1).padStart(2, '0')}`, value: 100 + i }));
const historyCache = new Map(SINA_CORE_INDEX_CONFIGS.map(c => [`${c.symbol}:1mo`, { history }]));
const lastGood = new Map();
let mode = 'primary', fallbackCalls = 0;
const fallbackQuotes = new Map(SINA_CORE_INDEX_CONFIGS.map(c => [c.symbol, { price: 100, changePercent: -2,
  updatedAt: '2026-09-11T20:00:00.000Z', sourceUrl: configs[c.id].sourceUrl }]));
const load = new Function('globalMacroCoreIndexConfigs', 'readFastAssetSource', 'readFastCoreIndexYahooSource',
  'yahooMacroQuoteCache', 'fastQuoteStatus', 'isolatedCoreIndexLastGood', 'isPublicSourceRefresh', 'coreIndexHistoryQuote',
  extract('async function loadIsolatedGlobalMacroCoreIndex(', 'async function loadIsolatedGlobalMacroFxRate(') + ';return loadIsolatedGlobalMacroCoreIndex;')(
  configs, async () => {
    if (mode === 'timeout') throw Error('Sina timeout');
    return { data: mode === 'primary' ? parsed : new Map() };
  }, async () => { fallbackCalls++; return { data: mode === 'both-failed' ? undefined : fallbackQuotes }; },
  historyCache, () => 'delayed', lastGood, () => true, coreIndexHistoryQuote);
for (const c of SINA_CORE_INDEX_CONFIGS) {
  const q = await load(c.id);
  assert.equal(q.sourceUrl, c.sourceUrl);
  assert.equal(q.symbol, c.symbol, 'UI symbols must remain unchanged');
  assert.deepEqual(q.history, history.slice(-22), 'preserve 1M history');
}
assert.equal(fallbackCalls, 0, 'healthy primary does not wait for Yahoo');
for (const failure of ['missing', 'timeout']) {
  mode = failure;
  const q = await load('nasdaq');
  assert.equal(q.price, 100);
  assert.equal(q.changePercent, -2);
  assert.equal(q.updatedAt, '2026-09-11T20:00:00.000Z');
  assert.equal(q.sourceUrl, configs.nasdaq.sourceUrl);
}
mode = 'both-failed';
await assert.rejects(load('nasdaq'), /最新行情暂不可用/);
historyCache.set('^NDX:1mo', { history: closeHistory });
assert.ok(Math.abs((await load('nasdaq')).changePercent - 1) < 1e-10, 'cached daily closes bridge a fast source failure');
assert.equal((await load('nasdaq')).updatedAt, closeHistory[1].time);
mode = 'primary';
assert.equal((await load('nasdaq')).sourceUrl, SINA_CORE_INDEX_CONFIGS[0].sourceUrl);
historyCache.clear();
assert.deepEqual((await load('nasdaq')).history, [], 'missing history must not block live quote');
const route = new Function('loadIsolatedGlobalMacroCoreIndex', 'validatePublicResource', 'getCachedGlobalMacroFastQuotes',
  extract('async function loadPublicDashboardResource(', 'function allWeatherApiPlugin()') + ';return loadPublicDashboardResource;')(
  load, () => true, () => { throw Error('unrelated slow dashboard'); });
assert.equal((await route('/api/global-macro-core-index?id=nasdaq')).index.sourceUrl, SINA_CORE_INDEX_CONFIGS[0].sourceUrl);
const fastCore = extract('  const coreSources = [', '  const vixQuote = marketById.get');
const buildCore = new Function('assetQuotes', 'yahoo', 'fastQuoteStatus', fastCore + ';return coreIndices;');
assert.equal(buildCore(parsed, fallbackQuotes, () => 'delayed')[0].sourceUrl, SINA_CORE_INDEX_CONFIGS[0].sourceUrl);
assert.equal(buildCore(new Map(), fallbackQuotes, () => 'delayed')[0].sourceUrl, configs.nasdaq.sourceUrl);
console.log('Core indices: Sina batch, quote fields/time, detail links, primary/fallback/recovery, independent routes and 1M history passed.');
