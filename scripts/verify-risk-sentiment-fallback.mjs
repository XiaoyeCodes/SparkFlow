import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { fetch as undiciFetch, ProxyAgent } from 'undici';
import { parseTradingViewVolatility, TRADINGVIEW_VOLATILITY_COLUMNS } from '../server/tradingViewVolatility.ts';

const source = await readFile(new URL('../vite.config.ts', import.meta.url), 'utf8');
function extract(start, end) {
  const from = source.indexOf(start);
  assert.ok(from >= 0, start);
  const to = source.indexOf(end, from);
  assert.ok(to > from, end);
  return ts.transpile(source.slice(from, to), { target: ts.ScriptTarget.ES2022 });
}
const now = Date.now();
const time = Math.floor((now - 900_000) / 60_000) * 60;
const payload = id => ({ data: [{ s: `CBOE:${id.toUpperCase()}`, d: [id === 'vix' ? 26.65 : 38.26, -1.53, time, 'delayed_streaming_900'] }] });
assert.deepEqual(TRADINGVIEW_VOLATILITY_COLUMNS, ['close', 'change_abs', 'time|1', 'update_mode']);
for (const id of ['vix', 'vxn']) {
  const quote = parseTradingViewVolatility(payload(id), id, now);
  assert.equal(quote.updatedAt, new Date(time * 1000).toISOString());
  assert.equal(quote.sourceDelaySeconds, 900);
  assert.equal(quote.status, 'delayed');
  assert.match(quote.sourceUrl, new RegExp(`CBOE-${id.toUpperCase()}/`));
  for (const bad of [null, { data: [] }, payload(id === 'vix' ? 'vxn' : 'vix')]) {
    assert.throws(() => parseTradingViewVolatility(bad, id, now));
  }
  for (const [field, value] of [[0, null], [0, 0], [0, Infinity], [1, null], [2, null], [2, time - 8 * 86400], [2, Math.floor(now / 1000) + 1000]]) {
    const bad = payload(id);
    bad.data[0].d[field] = value;
    assert.throws(() => parseTradingViewVolatility(bad, id, now));
  }
}

let yahooFails = false, tvFails = false, yahooCalls = 0, tvCalls = 0;
const yahooQuote = { price: 24.2, change: -0.8, updatedAt: new Date(now).toISOString(), sourceUrl: 'https://finance.yahoo.com/quote/%5EVIX', history: [] };
const yahoo = new Function('readYahooMacroQuote', extract('async function getYahooRiskSentimentMetric(', 'async function getResilientRiskSentimentMetric(') + ';return getYahooRiskSentimentMetric;')(async () => {
  yahooCalls++;
  if (yahooFails) throw Error('Yahoo unavailable');
  return yahooQuote;
});
const resilient = new Function('getYahooRiskSentimentMetric', 'getTradingViewRiskSentimentMetric',
  extract('async function getResilientRiskSentimentMetric(', 'async function getTradingViewRiskSentimentMetric(') + ';return getResilientRiskSentimentMetric;')(yahoo, async (id, label) => {
    tvCalls++;
    if (tvFails) throw Error('TradingView unavailable');
    return { ...parseTradingViewVolatility(payload(id), id), id, label };
  });
for (const id of ['vix', 'vxn']) {
  assert.equal((await resilient(id, `^${id.toUpperCase()}`, id)).provider, 'Yahoo Finance');
}
assert.equal(tvCalls, 0, 'healthy Yahoo does not request TradingView');
yahooFails = true;
for (const id of ['vix', 'vxn']) assert.equal((await resilient(id, `^${id.toUpperCase()}`, id)).provider, 'TradingView');
tvFails = true;
await assert.rejects(resilient('vix', '^VIX', 'VIX'), /TradingView unavailable/, 'both sources fail: do not silently fall back to FRED');
yahooFails = false;
assert.equal((await resilient('vix', '^VIX', 'VIX')).provider, 'Yahoo Finance', 'return to Yahoo after recovery');
assert.equal(yahooCalls, 6);

const networkCode = extract('async function getTradingViewRiskSentimentMetric(', 'function cnnFearGreedRating(') + ';return getTradingViewRiskSentimentMetric;';
let networkCalls = 0;
const network = new Function('undiciFetch', 'fastMarketRoutePreference', 'foreignProxyAgent', 'parseTradingViewVolatility', 'TRADINGVIEW_VOLATILITY_COLUMNS', networkCode)(async (_url, init) => {
  networkCalls++;
  if (networkCalls === 1) return new Response('', { status: 503 });
  const body = JSON.parse(init.body);
  assert.deepEqual(body.symbols.tickers, ['CBOE:VXN']);
  assert.deepEqual(body.columns, TRADINGVIEW_VOLATILITY_COLUMNS);
  return Response.json(payload('vxn'));
}, new Map(), {}, parseTradingViewVolatility, TRADINGVIEW_VOLATILITY_COLUMNS);
assert.equal((await network('vxn', 'VXN')).provider, 'TradingView');
assert.equal(networkCalls, 2, 'retry alternate network route');

if (process.argv.includes('--live')) {
  const proxyUrl = process.env.HTTPS_PROXY || 'http://127.0.0.1:7890';
  const proxy = new ProxyAgent(proxyUrl);
  const live = new Function('undiciFetch', 'fastMarketRoutePreference', 'foreignProxyAgent', 'parseTradingViewVolatility', 'TRADINGVIEW_VOLATILITY_COLUMNS', networkCode)(undiciFetch, new Map(), proxy, parseTradingViewVolatility, TRADINGVIEW_VOLATILITY_COLUMNS);
  try {
  for (const id of ['vix', 'vxn']) {
    const quote = await live(id, id.toUpperCase());
    console.log(JSON.stringify({ id, value: quote.value, provider: quote.provider, status: quote.status, updatedAt: quote.updatedAt }));
  }
  } finally { await proxy.close(); }
}
console.log('VIX/VXN: Yahoo priority, TradingView fallback/recovery, no FRED, source time, invalid/stale data and network retry passed.');
