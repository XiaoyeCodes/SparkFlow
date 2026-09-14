import assert from 'node:assert/strict';
import { createNewsPageCache } from '../server/newsPageCache.ts';

let now = Date.parse('2026-09-14T04:00:00Z');
let subscriptions = [];
let calls = 0;
let data;
const store = { read: async () => data ?? null, write: async (_, value) => { data = value; } };
const feed = () => ({ generatedAt: new Date(now).toISOString(), proxy: 'secret-proxy', categories: [],
  sources: [{ id: 'test', ok: true, proxy: 'secret-proxy', fetchedAt: new Date(now).toISOString() }],
  items: [{ title: `snapshot-${calls}` }] });
let loader = async () => { calls++; return feed(); };
const stops = [];
function create() {
  const cache = createNewsPageCache({ now: () => now, subscriptions: async () => subscriptions, load: force => {
    assert.equal(force, true); return loader();
  }, store });
  stops.push(cache.start());
  return cache;
}
try {
  let cache = create();
  const [first, duplicate] = await Promise.all([cache.get(), cache.get()]);
  assert.equal(calls, 1, 'prewarm and concurrent visitors share one fetch');
  assert.deepEqual(first, duplicate);
  assert.equal(first._pageCache.state, 'fresh');
  assert.ok(data);
  assert.equal(data.includes('secret-proxy'), false, 'connection configuration is not persisted');
  stops.pop()();
  cache = create();
  assert.equal((await cache.get()).items[0].title, 'snapshot-1');
  assert.equal(calls, 1, 'restart restores valid disk snapshot without fetching');
  now += 121_000;
  let finish;
  loader = async () => { calls++; await new Promise(resolve => { finish = resolve; }); return feed(); };
  const stale = await cache.get();
  assert.equal(stale._pageCache.state, 'stale', 'soft expiry renders immediately');
  assert.equal(stale.items[0].title, 'snapshot-1');
  assert.equal(calls, 2);
  const manual = cache.get(true);
  await new Promise(resolve => setImmediate(resolve));
  finish();
  await manual;
  assert.equal(calls, 2, 'manual refresh joins active revalidation');
  await cache.get(true);
  assert.equal(calls, 2, 'manual refresh throttle');
  now += 16_000;
  loader = async () => { calls++; return feed(); };
  await cache.get(true);
  assert.equal(calls, 3);
  subscriptions = [{ id: 'new', url: 'https://example.com/feed' }];
  assert.equal((await cache.get()).items[0].title, 'snapshot-4', 'changed subscriptions cannot restore old snapshot');
  assert.equal(calls, 4);

  now += 121_000;
  loader = async () => { calls++; return { ...feed(), sources: [{ ok: false }] }; };
  const retained = await cache.get();
  await assert.rejects(cache.get(true));
  assert.equal(retained.items[0].title, 'snapshot-4');
  now += 1800_000;
  await assert.rejects(cache.get(), 'all-source failure cannot renew a snapshot beyond its hard deadline');

  stops.pop()(); data = undefined;
  now = Date.parse('2026-09-14T15:59:59Z');
  loader = async () => { calls++; return feed(); };
  cache = create();
  const evening = await cache.get();
  assert.equal(evening._pageCache.expiresAt, '2026-09-14T16:00:00.000Z');
  now += 1000;
  const before = calls;
  await cache.get();
  assert.equal(calls, before + 1, 'midnight requires new feed');
} finally { stops.forEach(stop => stop()); }
console.log('News page cache: prewarm, disk restore, subscription isolation, SWR, manual refresh, failure and midnight expiry passed.');
