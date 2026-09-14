import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { parseSinaCurrencyQuotes, currencyQuoteTime, parseSinaUs10yQuote, SINA_US10Y_CODE } from '../server/macroCurrencyQuotes.ts';

const fixture = `var hq_str_DINIW="20:00:46,99.5083,99.5083,99.0901,5436,99.0977,99.6033,99.0597,99.5083,美元指数,2026-09-14";
var hq_str_fx_susdjpy="20:00:43,154.590000,154.600000,153.540000,14500,153.370000,154.740000,153.290000,154.595000,美元兑日元即期汇率,0.68,1.05,0.009454,,163.98,152.10,,2026-09-14";
var hq_str_fx_susdcny="20:00:14,6.711,6.713,6.7114,231,6.6974,6.7158,6.6927,6.712,在岸人民币,0.0089,0.0006,0.0231,此行情由新浪财经计算得出,0,0,,2026-09-14";
var hq_str_fx_susdeur="20:00:42,0.8659,0.8660,0.8619,51,0.8623,0.8669,0.8618,0.8659,美元兑欧元即期汇率,0.46,0.004,0.005914,,0.883,0.828,,2026-09-14";`;
const quotes = parseSinaCurrencyQuotes(fixture);
assert.equal(quotes.size, 4);
assert.equal(quotes.get('usd-jpy').price, 154.595, 'use last/reference, not bid or ask');
assert.equal(quotes.get('usd-cny').price, 6.712, 'CNY must not silently become CNH or bid');
assert.equal(quotes.get('usd-eur').price, 0.8659);
assert.equal(quotes.get('dxy').updatedAt, '2026-09-14T12:00:46.000Z');
assert.equal(currencyQuoteTime('2026-02-30', '20:00:00'), undefined);
assert.equal(currencyQuoteTime('', '20:00:00'), undefined);
assert.equal(parseSinaCurrencyQuotes(fixture.replaceAll('2026-09-14', '')).size, 0, 'missing source date is not fetch time');
assert.equal(parseSinaCurrencyQuotes(fixture.replace('6.712,在岸', 'NaN,在岸')).has('usd-cny'), false);
assert.equal(parseSinaCurrencyQuotes('var hq_str_fx_susdcnh="anything";').size, 0);

const bondFields = ['美国10年期国债', '4.951', '4.975', '4.978', '4.987', '4.949',
  '0', '0.0481', '0.0024', '0', '0', '1789389743', '2026-09-14', '08:42:23'];
const bondText = fields => `var hq_str_${SINA_US10Y_CODE}="${fields.join(',')}";`;
const bond = parseSinaUs10yQuote(bondText(bondFields));
assert.equal(bond.price, 4.978, 'yield is field 3, not opening yield or bond price');
assert.ok(Math.abs(bond.change - 0.003) < 1e-10, 'change is percentage points, not percent or bp');
assert.equal(bond.updatedAt, '2026-09-14T12:42:23.000Z', 'use Unix seconds, not Beijing interpretation of display clock');
for (const [index, value] of [[3, ''], [3, 'NaN'], [3, '-1'], [2, '0'], [11, ''], [11, 'NaN'], [11, '9999999999999999']]) {
  const invalid = [...bondFields]; invalid[index] = value;
  assert.equal(parseSinaUs10yQuote(bondText(invalid)), undefined);
}
assert.equal(parseSinaUs10yQuote('var hq_str_globalbd_us10yt="";'), undefined);

// Exercise actual route/loader code with a global frame that must never be awaited.
const source = await readFile(new URL('../vite.config.ts', import.meta.url), 'utf8');
const extract = (a, b) => ts.transpile(source.slice(source.indexOf(a), source.indexOf(b, source.indexOf(a))), { target: ts.ScriptTarget.ES2022 });
const display = new Function(extract('function isolatedAssetDisplay(', 'function isolatedAssetMetricFromQuote(') + ';return isolatedAssetDisplay;')();
assert.equal(display('dxy', 99.5083), '99.51', 'preserve original display precision');
assert.equal(display('us10y', 4.971), '4.97%');
// Exercise the real isolated loader and preserve each provider's own baseline.
const assetConfigs = { us10y: { id: 'us10y', label: '美国10年期国债收益率', symbol: '^TNX', changeMode: 'points' } };
let sinaMode = 'healthy', treasuryYahooCalls = 0;
const lastGood = new Map();
const treasuryLoader = new Function('isolatedGlobalMacroAssetConfigs', 'isolatedAssetDisplay', 'fastQuoteStatus',
  'readFastAssetSource', 'readFastIsolatedAssetYahooSource', 'isolatedMarketAssetLastGood', 'isPublicSourceRefresh',
  extract('function isolatedAssetMetricFromQuote(', 'type GlobalRiskSentimentId =') + ';return loadIsolatedGlobalMacroAsset;')(
  assetConfigs, display, () => 'live', async () => {
    if (sinaMode === 'timeout') throw Error('Sina timeout');
    return { data: new Map(sinaMode === 'healthy' ? [['us10y', bond]] : []) };
  }, async () => {
    treasuryYahooCalls++;
    if (sinaMode === 'both-failed') throw Error('Yahoo unavailable');
    return { data: new Map([['^TNX', { price: 4.975, change: 0.031, changePercent: 0.63,
      updatedAt: '2026-09-11T18:59:54.000Z', sourceUrl: 'https://finance.yahoo.com/quote/%5ETNX/' }]]) };
  }, lastGood, () => true);
assert.equal((await treasuryLoader('us10y')).sourceUrl, bond.sourceUrl);
assert.equal(treasuryYahooCalls, 0, 'healthy Sina must not wait for Yahoo');
for (const failure of ['missing', 'timeout']) {
  sinaMode = failure;
  const fallback = await treasuryLoader('us10y');
  assert.equal(fallback.value, 4.975);
  assert.equal(fallback.change, 0.031, 'never compute change from Sina and Yahoo mixed baselines');
  assert.equal(fallback.updatedAt, '2026-09-11T18:59:54.000Z', 'fallback retains actual quote timestamp');
}
sinaMode = 'both-failed';
await assert.rejects(treasuryLoader('us10y'), /Yahoo unavailable/, 'do not renew last good as a successful source refresh');
sinaMode = 'healthy';
assert.equal((await treasuryLoader('us10y')).sourceUrl, bond.sourceUrl, 'return to primary when it recovers');
assert.match(source, /const us10yQuote = assetQuotes\.get\('us10y'\) \|\| yahoo\.get\('\^TNX'\)/, 'global frame uses same source priority');
assert.match(source, /GLOBAL_MACRO_FAST_QUOTE_CADENCE_MS = 3_000/);
assert.match(source, /GLOBAL_MACRO_FAST_QUOTE_CACHE_TTL_MS = 3_000/);
const configs = [{ id: 'usd-eur', label: '美元兑欧元', symbol: 'EURUSD=X', inverse: true, digits: 4 }];
let directAvailable = true, yahooCalls = 0;
const fxLoader = new Function('globalMacroFxRates', 'readFastAssetSource', 'readFastFxYahooSource', 'normalizeFxPrice',
  'normalizeFxChangePercent', 'formatFxRate', 'fastQuoteStatus', 'isolatedFxRateLastGood', 'isPublicSourceRefresh',
  extract('async function loadIsolatedGlobalMacroFxRate(', 'async function refreshIsolatedFedRateExpectation(') + ';return loadIsolatedGlobalMacroFxRate;')(
  configs, async () => ({ data: directAvailable ? quotes : new Map() }), async () => { yahooCalls++; return { data: new Map([['EURUSD=X',
    { price: 1.25, changePercent: 1, updatedAt: '2026-09-14T12:00:00Z', sourceUrl: 'https://finance.yahoo.com' }]]) }; },
  (p, inverse) => inverse ? 1 / p : p, (p, inverse) => inverse ? (1 / (1 + p / 100) - 1) * 100 : p,
  (p, n) => p.toFixed(n), () => 'live', new Map(), () => true);
assert.equal((await fxLoader('usd-eur')).value, 0.8659, 'do not invert a direct USD/EUR quote');
assert.equal(yahooCalls, 0, 'healthy direct source must not wait for Yahoo');
directAvailable = false;
assert.equal((await fxLoader('usd-eur')).value, 0.8, 'Yahoo EUR/USD fallback must still be inverted');
assert.equal(yahooCalls, 1);
const route = new Function('loadIsolatedGlobalMacroFxRate', 'loadIsolatedGlobalMacroAsset', 'getCachedGlobalMacroFastQuotes',
  extract('async function loadPublicDashboardResource(', 'function allWeatherApiPlugin()') + ';return loadPublicDashboardResource;')(
  fxLoader, async id => ({ id, value: 1 }), () => { throw Error('unrelated slow global frame'); });
assert.equal((await route('/api/global-macro-fx-rate?id=usd-eur')).rate.value, 0.8);
assert.equal((await route('/api/global-macro-asset?id=dxy')).asset.id, 'dxy');
assert.equal((await route('/api/global-macro-asset?id=us10y')).asset.id, 'us10y');
console.log('Currency/US10Y quotes: source fields, timestamp validity, direction, original display precision, Sina priority, Yahoo fallback/recovery and independent routes passed.');
