import assert from 'node:assert/strict';
import {
  parseBinanceMarketTickers,
  parseCoinGeckoMarketUniverse,
  parseCoinPaprikaMarketUniverse,
  parseOkxMarketTickers,
} from '../server/cryptoMarketUniverse.ts';
import { mergeCryptoMiniTickers, parseCryptoMiniTickerMessage } from '../src/lib/cryptoHeatmapStream.ts';
import { resolvePublicDataPolicy } from '../src/lib/publicDataPolicy.ts';

const gecko = parseCoinGeckoMarketUniverse([{
  id: 'bitcoin', symbol: 'btc', name: 'Bitcoin', image: 'https://img.example/btc.png',
  current_price: 60_000, market_cap: 1_200_000_000_000, market_cap_rank: 1,
  price_change_percentage_24h: 1.25, last_updated: '2026-09-14T00:00:00Z',
}]);
assert.equal(gecko.length, 1);
assert.equal(gecko[0].symbol, 'BTC');
assert.equal(gecko[0].sourceUrl, 'https://www.coingecko.com/zh/数字货币/bitcoin');

const paprika = parseCoinPaprikaMarketUniverse([{
  id: 'btc-bitcoin', symbol: 'btc', name: 'Bitcoin', rank: 1,
  last_updated: '2026-09-14T00:00:00Z',
  quotes: { USD: { price: 60_100, market_cap: 1_201_000_000_000, percent_change_24h: 1.3 } },
}, {
  id: 'broken', symbol: 'NOPE', name: 'Broken', quotes: { USD: { price: null, market_cap: 0 } },
}]);
assert.equal(paprika.length, 1, 'invalid fallback rows are rejected');
assert.equal(paprika[0].symbol, 'BTC');
assert.equal(paprika[0].market_cap, 1_201_000_000_000);
assert.equal(paprika[0].price_change_percentage_24h, 1.3);
assert.equal(paprika[0].sourceUrl, 'https://coinpaprika.com/coin/btc-bitcoin/');

const binance = parseBinanceMarketTickers([
  { symbol: 'BTCUSDT', lastPrice: '60100.5', openPrice: '59000', closeTime: 1_789_344_000_000 },
  { symbol: 'BTCUSDC', lastPrice: '60101' },
]);
assert.equal(binance.length, 1);
assert.deepEqual(binance[0], {
  symbol: 'BTC', price: 60_100.5, openPrice: 59_000, updatedAt: '2026-09-14T00:00:00.000Z',
});

const okx = parseOkxMarketTickers({ data: [
  { instId: 'BTC-USDT', last: '60102.5', open24h: '59010', ts: '1789344000000' },
  { instId: 'BTC-USDC', last: '60103' },
] });
assert.equal(okx.length, 1);
assert.deepEqual(okx[0], {
  symbol: 'BTC', price: 60_102.5, openPrice: 59_010, updatedAt: '2026-09-14T00:00:00.000Z',
});

const stream = parseCryptoMiniTickerMessage({ data: [
  { s: 'BTCUSDT', c: '60105', o: '59020', E: 1_789_344_000_000 },
  { s: 'BTCUSDC', c: '60106', o: '59020', E: 1_789_344_000_000 },
] });
assert.deepEqual(stream, [{
  symbol: 'BTC', price: 60_105, openPrice: 59_020, updatedAt: '2026-09-14T00:00:00.000Z',
}]);
const merged = mergeCryptoMiniTickers([
  { code: 'BTC', price: 60_000, changePercent: 0, updatedAt: '2026-09-13T00:00:00.000Z' },
  { code: 'ETH', price: 2_500, changePercent: 1 },
], stream);
assert.equal(merged.changed, true);
assert.equal(merged.stocks[0].price, 60_105);
assert.equal(merged.stocks[0].changePercent, (60_105 - 59_020) / 59_020 * 100);
assert.equal(merged.stocks[1].price, 2_500, 'symbols missing from a delta frame keep their previous quote');
assert.equal(merged.latestUpdatedAt, '2026-09-14T00:00:00.000Z');

const policy = resolvePublicDataPolicy('/api/crypto-market-heatmap');
assert.equal(policy?.warm, true, 'crypto heatmap is preloaded before the first visitor');
assert.equal(policy?.refreshMs, 60_000, 'REST fallback avoids duplicating the browser live stream');
assert.equal(policy?.maxAgeMs, 900_000, 'last-good crypto snapshot bridges short provider outages');

console.log('Crypto market universe: primary/fallback normalization and warm cache policy passed.');
