import assert from 'node:assert/strict';
import { createDailyBriefAiSummaryCache } from '../server/dailyBriefAiSummaryCache.ts';

let now = Date.parse('2026-09-14T04:00:00Z');
const config = { provider: 'test-provider', model: 'test-model', baseUrl: 'https://private.example/api', protocol: 'chat', apiKey: 'never-persist-this-key', useProxy: false };
const summary = (headline = '缓存摘要') => ({ headline, regime: '测试', tone: 'balanced', highlights: ['测试'], risks: [], watchlist: [], portfolioNotes: [],
  assessment: { rating: '中性', score: 50, confidence: '中', rationale: '测试依据', disclaimer: '测试免责声明',
    advice: Array.from({ length: 5 }, (_, index) => ({ label: `建议${index}`, detail: '测试建议内容' })) } });
const snapshot = (overrides = {}) => ({ version: 18, date: '2026-09-14', slot: 'morning', generatedAt: '2026-09-14T01:00:00.000Z', updatedAt: '2026-09-14T01:00:00.000Z',
  summary: summary('基础简报'), summaryMode: 'rules', markets: [], macro: [], news: [], portfolio: { connected: false, positions: [] }, sources: [], errors: [], ...overrides });
const createStore = () => {
  const files = new Map();
  return { files, read: async key => files.get(key) ?? null, write: async (key, value) => { files.set(key, value); } };
};
const create = (store, generate, version = 'v1') => createDailyBriefAiSummaryCache({ store, generate, promptVersion: version, now: () => now });
let calls = 0;
let finish;
const store = createStore();
let cache = create(store, async () => { calls++; await new Promise(resolve => { finish = resolve; }); return summary(); });
const visitors = Array.from({ length: 12 }, () => cache.get(snapshot(), config));
await new Promise(resolve => setImmediate(resolve));
assert.equal(calls, 1, 'different visitors share one model invocation');
finish();
const results = await Promise.all(visitors);
assert.equal(results[0].cache.source, 'generated');
assert.equal(results[1].cache.source, 'shared');
assert.equal(results[0].cache.expiresAt, '2026-09-15T01:00:00.000Z');
assert.equal(store.files.size, 1);
assert.equal(store.files.get('current').includes(config.apiKey), false);
assert.equal(store.files.get('current').includes(config.baseUrl), false);
results[0].summary.headline = 'mutated';
assert.equal((await cache.get(snapshot(), config)).summary.headline, '缓存摘要', 'caller cannot mutate shared cache');
now += 1000;
assert.equal((await cache.get(snapshot(), config)).generatedAt, results[1].generatedAt, 'cache hit preserves generation time');

cache = create(store, async () => { calls++; return summary('新摘要'); });
assert.equal((await cache.get(snapshot(), config)).cache.source, 'disk');
assert.equal(calls, 1, 'host restart does not regenerate an unexpired matching summary');
const refreshed = snapshot({ generatedAt: '2026-09-14T04:00:00.000Z' });
await cache.get(refreshed, config);
assert.equal(calls, 2, 'manual briefing refresh changes the summary key');
await cache.get({ ...refreshed, markets: [{ value: 100 }] }, config);
assert.equal(calls, 3, 'changed content cannot reuse a mismatched summary');
for (const changed of [{ model: 'new-model' }, { provider: 'new-provider' }, { baseUrl: 'https://another.example' },
  { protocol: 'responses' }, { apiKey: 'rotated-secret' }, { useProxy: true }]) {
  const previous = calls;
  await cache.get(refreshed, { ...config, ...changed });
  assert.equal(calls, previous + 1, 'model connection setting invalidates: ' + Object.keys(changed)[0]);
}
cache = create(store, async () => { calls++; return summary(); }, 'v2');
let previous = calls;
await cache.get(refreshed, config);
assert.equal(calls, previous + 1, 'prompt revision invalidates snapshots');

previous = calls;
await assert.rejects(cache.get(snapshot({ portfolio: { connected: true, positions: [] } }), config));
await assert.rejects(cache.get(snapshot({ portfolio: { connected: false, positions: [{ symbol: 'PRIVATE' }] } }), config));
assert.equal(calls, previous, 'personal portfolio summaries are never shared');
now = Date.parse('2026-09-15T01:00:00Z');
await assert.rejects(cache.get(refreshed, config), /版次/);
assert.equal(calls, previous, 'expired edition neither returns cached data nor starts a model call');
await cache.get(snapshot({ date: '2026-09-15', generatedAt: new Date(now).toISOString() }), config);
assert.equal(calls, previous + 1, '09:00 rollover uses a new edition');

// Failed/malformed outputs cannot become shared successes or trigger a retry storm.
now = Date.parse('2026-09-14T04:00:00Z');
const failureStore = createStore();
let failures = 0;
cache = create(failureStore, async () => { failures++; if (failures === 1) return {}; return summary(); });
await assert.rejects(cache.get(snapshot(), config));
assert.equal(failureStore.files.size, 0);
await assert.rejects(cache.get(snapshot(), config));
assert.equal(failures, 1, 'failed key is throttled for 30 seconds');
now += 30_000;
await cache.get(snapshot(), config);
assert.equal(failures, 2);
const brokenStore = createStore(); brokenStore.files.set('current', '{broken');
cache = create(brokenStore, async () => summary());
assert.equal((await cache.get(snapshot(), config)).cache.source, 'generated', 'corrupt disk file is ignored');
cache = create({ read: async () => { throw new Error('disk unavailable'); }, write: async () => { throw new Error('disk full'); } }, async () => summary());
await cache.get(snapshot(), config);
assert.equal((await cache.get(snapshot(), config)).cache.source, 'memory', 'disk failure preserves memory reuse');
cache = create(createStore(), async () => summary('x'.repeat(300_000)));
await assert.rejects(cache.get(snapshot(), config), 'oversized output must not be cached');

// A stale completion must not replace the refreshed edition saved on disk.
const raceStore = createStore();
const complete = new Map();
cache = create(raceStore, async value => {
  await new Promise(resolve => complete.set(value.generatedAt, resolve));
  return summary(value.generatedAt);
});
const old = cache.get(snapshot(), config);
const latest = cache.get(refreshed, config);
await new Promise(resolve => setImmediate(resolve));
await assert.rejects(cache.get(snapshot({ generatedAt: '2026-09-14T03:00:00.000Z' }), config), /正在生成/);
complete.get(refreshed.generatedAt)(); await latest;
complete.get(snapshot().generatedAt)(); await old;
assert.equal(JSON.parse(raceStore.files.get('current')).result.snapshot.generatedAt, refreshed.generatedAt);
assert.equal((await create(raceStore, async () => { throw new Error('should restore'); }).get(refreshed, config)).cache.source, 'disk');

// Midnight does not change the edition; the 09:00 boundary must apply even while generating.
now = Date.parse('2026-09-15T00:59:59Z');
const expiryStore = createStore();
cache = create(expiryStore, async () => { now += 1000; return summary(); });
await assert.rejects(cache.get(snapshot(), config));
assert.equal(expiryStore.files.size, 0);
console.log('Daily brief AI cache: cross-visitor coalescing, disk recovery, model/content/prompt invalidation, expiry, failure backoff, privacy and race checks passed.');
