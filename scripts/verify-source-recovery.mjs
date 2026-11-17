import assert from 'node:assert/strict';
import { createDailyBriefCryptoMarket } from '../server/dailyBriefCryptoMarket.ts';
import { createDailyBriefRepairTasks } from '../server/dailyBriefRepairTasks.ts';
import { runDailyBriefRepairs } from '../server/dailyBriefRepair.ts';
import { createNewsFeedService } from '../server/newsFeed.ts';
import { statsListingRss } from '../server/newsOfficialListing.ts';

let now = Date.parse('2026-11-17T08:00:00Z');
const day = 86_400_000;
const candles = Array.from({ length: 90 }, (_, i) => [Math.floor(now / day) * day - (89 - i) * day, 100 + i, 105 + i, 95 + i, 101 + i, 10]);
const disk = new Map();
const store = { read: async key => disk.get(key) ?? null, write: async (key, value) => { disk.set(key, value); } };
let offline = false, wrongPair = false, badCandle = false;
const calls = [];
const request = async (url, route) => {
  calls.push([url, route]);
  if (offline || !url.includes('okx.com')) throw new Error('primary unavailable');
  const u = new URL(url), symbol = u.searchParams.get('instId');
  if (u.pathname.endsWith('/candles')) return JSON.stringify({ code: '0', data: badCandle ? [[now, 100, 90, 110, 100, 10]] : [...candles].reverse() });
  return JSON.stringify({ code: '0', data: [{ instId: wrongPair ? 'DOGE-USDT' : symbol, last: '101', open24h: '100', ts: String(now) }] });
};
const market = createDailyBriefCryptoMarket({ request, store, now: () => now });
const quotes = JSON.parse(await market.spot());
assert.deepEqual(quotes.map(row => row.symbol), ['BTCUSDT', 'ETHUSDT', 'SOLUSDT']);
assert.ok(quotes.every(row => row.lastPrice === 101 && Math.abs(row.priceChangePercent - 1) < 1e-9 && row.source === 'OKX'));
const baselineCalls = calls.length;
await market.spot(['BTC']);
assert.equal(calls.length, baselineCalls, 'a healthy cached quote does not trigger upstream work');
const histories = await Promise.all(Array.from({ length: 5 }, () => market.history('BTC')));
assert.equal(new Set(histories).size, 1);
assert.equal(calls.filter(([url]) => url.includes('okx.com') && url.includes('/candles')).length, 1, 'concurrent readers share one history flight');
const history = JSON.parse(histories[0]);
assert.equal(history.provider, 'OKX');
assert.equal(history.rows.length, 90);
assert.ok(history.rows.every((row, i) => row[0] % day === 0 && (!i || row[0] - history.rows[i - 1][0] === day)));
now += 70_000; offline = true;
assert.equal(JSON.parse(await market.history('BTC')).cached, true, 'a bounded last-good history survives a source outage');
const afterFailure = calls.length;
await market.history('BTC');
assert.equal(calls.length, afterFailure, 'outage cooldown does not hammer upstream');
const restart = createDailyBriefCryptoMarket({ request, store, now: () => now });
assert.equal(JSON.parse(await restart.history('BTC')).cached, true, 'last-good history survives restart');
now += 31_000; offline = false;
assert.equal(Boolean(JSON.parse(await market.history('BTC')).cached), false, 'source recovery replaces stale cache automatically');
const invalid = createDailyBriefCryptoMarket({ request, now: () => now });
wrongPair = true;
await assert.rejects(invalid.spot(['BTC']), /暂不可用/);
wrongPair = false; badCandle = true;
await assert.rejects(invalid.history('ETH'));
badCandle = false;
const expired = createDailyBriefCryptoMarket({ request: async () => { throw new Error('offline'); }, store, now: () => now + 2 * day });
await assert.rejects(expired.history('BTC'), 'expired disk history cannot be presented as fresh');
let quoteClock = now;
const agedQuote = createDailyBriefCryptoMarket({ now: () => quoteClock, request: async url => {
  if (quoteClock !== now) throw new Error('offline');
  return JSON.stringify({ symbol: 'BTCUSDT', lastPrice: '101', priceChangePercent: '1', closeTime: quoteClock - 14 * 60_000 });
} });
await agedQuote.spot(['BTC']);
quoteClock += 61_000;
await assert.rejects(agedQuote.spot(['BTC']), 'the original quote timestamp also expires, even if it was cached recently');

const metric = { value: null, display: '—', source: 'fixture', sourceUrl: 'https://example.com', status: 'unavailable' };
const points = candles.map(row => ({ time: new Date(row[0]).toISOString().slice(0, 10), value: row[4] }));
const technical = { source: 'OKX', calculatedAt: new Date(now).toISOString(), lookbackDays: 89, atr14: 10, resistance: null, supportLow: null, supportHigh: null };
const snapshot = { markets: [], editorial: {
  crypto: [{ symbol: 'BTC', price: 99, history: points.slice(0, 1) }],
  assetGroups: [{ id: 'crypto', items: [{ symbol: 'BTC', price: 88, history: points.slice(0, 1) }] }],
  stocks: [{ symbol: 'AAPL', price: 123 }], macroAssets: [], indices: [], marketSeries: [], events: [],
  btcTechnical: { ...technical, atr14: NaN },
  sentiment: { cryptoFearGreed: metric, stockFearGreed: metric, mvrvZScore: metric },
  onchain: { fundingRate: metric, openInterest: metric, dominance: metric, sopr: metric, lthSopr: metric, wma200Multiple: metric, puellMultiple: metric },
  signals: { coverage: 0 },
} };
const repaired = { crypto: [{ symbol: 'BTC', price: 200, history: points }], btcTechnical: technical };
const tasks = createDailyBriefRepairTasks({ yahooConfigs: [], crypto: async () => repaired });
const btcTask = tasks.find(task => task.id === 'crypto:10');
assert.ok(btcTask.needed(snapshot));
(await btcTask.load(snapshot))(snapshot);
assert.equal(btcTask.needed(snapshot), false, 'valid null pivot levels complete repair; they do not imply a transport failure');
assert.equal(snapshot.editorial.crypto[0].history.length, 90, 'a nonempty but insufficient series is repaired');
assert.equal(snapshot.editorial.assetGroups[0].items[0].history.length, 90);
assert.equal(snapshot.editorial.crypto[0].price, 99, 'valid frozen quote is preserved');
assert.equal(snapshot.editorial.assetGroups[0].items[0].price, 88);
assert.equal(snapshot.editorial.stocks[0].price, 123, 'other asset data is untouched');

let state = {}, release;
const blocked = new Promise(resolve => { release = resolve; });
const pool = runDailyBriefRepairs({ get: () => state, commit: async change => change(state), tasks: [
  ...['slow-a', 'slow-b'].map(id => ({ id, label: id, needed: () => true, load: async () => { await blocked; return () => {}; } })),
  { id: 'spot', lane: 'crypto-spot', label: 'spot', needed: value => !value.spot, load: async () => draft => { draft.spot = true; } },
] });
for (let i = 0; i < 20 && !state.spot; i++) await new Promise(resolve => setTimeout(resolve, 5));
assert.equal(state.spot, true, 'slow unrelated repairs do not occupy the crypto recovery worker');
release(); await pool;

const source = id => ({ id, label: id, category: 'finance', sourceWeight: 70, origin: 'domestic', route: 'direct', kind: 'rss', url: `https://example.com/${id}` });
const newsCalls = { healthy: 0, broken: 0 };
let broken = true;
const news = createNewsFeedService([source('healthy'), source('broken')], async s => {
  newsCalls[s.id]++;
  if (s.id === 'broken' && broken) throw new Error('temporary outage');
  return [{ title: `${s.id} economic release`, url: `https://example.com/article/${s.id}`, publishedAt: new Date(now).toISOString() }];
}, '', { additionalSources: [], now: () => now, transport: async () => { throw new Error('unused'); } });
const first = await news();
assert.equal(first.sources.find(s => s.id === 'broken').ok, false);
assert.ok(first.sources.find(s => s.id === 'broken').nextRetryAt);
now += 16_000; await news();
assert.equal(newsCalls.broken, 1, 'a cached failure observes source backoff');
now += 15_000; broken = false;
const recovered = await news();
assert.equal(recovered.sources.find(s => s.id === 'broken').ok, true);
assert.equal(recovered.sources.find(s => s.id === 'broken').nextRetryAt, undefined);
assert.equal(recovered.items.length, 2);
assert.equal(newsCalls.healthy, 1, 'retrying a failed news source does not reload a healthy one');
now += 121_000; broken = true;
const staleNews = await news();
assert.equal(staleNews.sources.find(s => s.id === 'broken').stale, true);
assert.ok(staleNews.items.find(item => item.sourceId === 'broken').stale, 'retained articles are explicitly marked as cached');
let midnightClock = Date.parse('2026-11-17T15:59:00Z'), midnightCalls = 0;
const midnightNews = createNewsFeedService([source('midnight')], async () => {
  midnightCalls++;
  if (midnightCalls > 1) throw new Error('offline after midnight');
  return [{ title: 'Previous release', url: 'https://example.com/release', publishedAt: new Date(midnightClock).toISOString() }];
}, '', { additionalSources: [], now: () => midnightClock, transport: async () => { throw new Error('unused'); } });
await midnightNews();
midnightClock += 121_000; await midnightNews();
midnightClock += 31_000; await midnightNews();
assert.equal(midnightCalls, 3);
midnightClock += 31_000; await midnightNews();
assert.equal(midnightCalls, 3, 'a prior-day cache must not bypass the failed source backoff every poll');

const listing = `<li><a href="./202611/t20261116_123.html" title="CPI &amp; PPI">release</a><a href="./202611/t20261116_123.html">mobile duplicate</a><span>2026-11-16</span></li>`;
const rss = statsListingRss(listing + listing + '<li><a href="https://evil.example/sj/zxfb/t20261116_4.html">wrong origin</a><span>2026-11-16</span></li>', 'https://www.stats.gov.cn/sj/zxfb/', now);
assert.equal((rss.match(/<item>/g) || []).length, 1);
assert.match(rss, /CPI &amp; PPI/);
assert.doesNotMatch(rss, /evil.example/);
assert.match(rss, /15 Nov 2026 16:00:00 GMT/);
assert.throws(() => statsListingRss('<li><a href="./202611/t20261118_1.html">future</a><span>2026-11-18</span></li>', 'https://www.stats.gov.cn/sj/zxfb/', now));
console.log('Source recovery passed: independent Binance/OKX fallbacks, UTC OHLC validation, deduplication, bounded disk cache, recovery/backoff, isolated workers, partial-series repair, news recovery and official article provenance.');
