import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createPagePreloadCache, PAGE_PRELOAD_RESOURCES } from '../server/pagePreloadCache.ts';
import { PUBLIC_DATA_POLICIES } from '../src/lib/publicDataPolicy.ts';

assert.ok(PUBLIC_DATA_POLICIES.every(resource => resource.warm), 'all fixed public page resources warm without visitors');
let now = 1_000_000;
const saved = new Map();
const store = { read: async key => saved.get(key) || null, write: async (key, value) => { saved.set(key, value); } };
let calls = 0;
const blocked = new Map();
const fixture = key => {
  const url = new URL(key, 'http://page.local');
  if (url.pathname.includes('/details')) return { kind: url.searchParams.get('view'), sources: [],
    price: [1, 2], etfFlows: [1, 2], series: [{ points: [1, 2] }] };
  if (url.pathname.includes('/watchlist')) return { items: [{ symbol: 'AAPL', price: calls }] };
  if (url.pathname.includes('/history')) return { ticker: url.searchParams.get('ticker'), events: Array.from({ length: 3 }, () => ({ price: calls, sma: 100 })) };
  return { symbol: url.searchParams.get('symbol'), points: Array.from({ length: 220 }, (_, index) => ({ time: String(index), close: 100 })) };
};
const cache = createPagePreloadCache({ store, now: () => now,
  load: async key => { calls++; if (blocked.has(key)) await blocked.get(key); return fixture(key); },
});
const flush = async () => { for (let i = 0; i < 30; i++) await new Promise(resolve => setImmediate(resolve)); };
await cache.tick(); await flush();
assert.equal(calls, PAGE_PRELOAD_RESOURCES.length, 'startup warms all page dependencies before any read');
assert.equal(cache.status().entries, PAGE_PRELOAD_RESOURCES.length);
const key = '/api/risk-radar/history?ticker=VOO';
let release;
blocked.set(key, new Promise(resolve => { release = resolve; }));
now += 3600_001; await cache.tick(); await flush();
assert.equal((await cache.read(key)).meta.state, 'stale', 'read does not wait for a blocked refresh');
release(); await flush(); blocked.clear();
const before = calls;
await Promise.all(Array.from({ length: 30 }, () => cache.read(key)));
assert.equal(calls, before, 'visitors reuse the ready snapshot');
cache.stop();
const restart = createPagePreloadCache({ store, now: () => now, load: async () => { throw Error('must restore'); } });
assert.ok((await restart.read(key)).data.events.length);
assert.equal(restart.status().entries, PAGE_PRELOAD_RESOURCES.length);
const server = createServer(async (req, res) => { if (!await restart.serve(req, res)) { res.statusCode = 404; res.end(); } });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
try {
  assert.equal((await fetch(base + key)).status, 200);
  assert.equal((await fetch(base + '/api/equity-report-chart?symbol=QQQ&range=2y')).status, 200);
  for (const url of ['/api/ibkr/status', '/api/equity-report-chart?symbol=PRIVATE&range=2y', key + '&user=a']) {
    assert.equal((await fetch(base + url)).status, 404, 'non-allowlisted requests bypass shared preload');
  }
  assert.equal((await fetch(base + key, { headers: { Authorization: 'private' } })).status, 404);
} finally { restart.stop(); await new Promise(resolve => server.close(resolve)); }
console.log('Page preload: startup warming, stale reads, disk restore, visitor reuse, allowlist and HTTP behavior passed.');
