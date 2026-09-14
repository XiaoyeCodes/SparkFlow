import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir, readFile, writeFile } from 'node:fs/promises';
import ts from 'typescript';
import os from 'node:os';
import path from 'node:path';
import { createPublicDataCache, createPublicSnapshotStore } from '../server/publicDataCache.ts';
import { isPublicSourceRefresh, withPublicSourceRefresh } from '../server/publicSourceContext.ts';

assert.equal(isPublicSourceRefresh(), false);
await Promise.all([
  withPublicSourceRefresh(async () => {
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(isPublicSourceRefresh(), true, 'public refresh context survives async boundaries');
  }),
  (async () => {
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(isPublicSourceRefresh(), false, 'public refresh must not change concurrent legacy/private calls');
  })(),
]);
await assert.rejects(withPublicSourceRefresh(async () => { throw Error('upstream'); }));
assert.equal(isPublicSourceRefresh(), false, 'context resets after failure');

// Exercise the actual legacy loader bodies, with only the upstream transport
// stubbed. Importing vite.config.ts would start unrelated application services.
const configSource = await readFile(new URL('../vite.config.ts', import.meta.url), 'utf8');
function loaderBody(start, end, dependencies) {
  const from = configSource.indexOf(start);
  const to = configSource.indexOf(end, from);
  assert.ok(from >= 0 && to > from);
  const compiled = ts.transpile(`const extracted = ${configSource.slice(from, to)};`, { target: ts.ScriptTarget.ES2022 });
  return new Function(...Object.keys(dependencies), compiled + '\nreturn extracted;')(...Object.values(dependencies));
}
const yahooLoader = loaderBody('async function getYahooMacroQuote(', 'async function getYahooMacroSnapshot(', {
  isPublicSourceRefresh, yahooMacroQuoteCache: new Map([['TEST:1mo', {price:100}]]),
  readYahooMacroQuote: async () => { throw Error('offline'); }, setTimeout: resolve => resolve(),
});
assert.equal((await yahooLoader('TEST')).price,100,'legacy fallback preserved');
await assert.rejects(withPublicSourceRefresh(() => yahooLoader('TEST')), /offline/,'public refresh cannot renew an old Yahoo response');
let sourceNow = 10000;
const budgeted = loaderBody('function createBudgetedFastQuoteSource<T>', 'const readFastEquitySource', {
  isPublicSourceRefresh, setTimeout, clearTimeout, Date: { now: () => sourceNow },
});
let upstreamFails = false;
const readBudgeted = budgeted(async () => { if (upstreamFails) throw Error('offline'); return {price:100}; });
assert.equal((await readBudgeted()).data.price,100);
upstreamFails = true;
sourceNow += 3001;
assert.equal((await withPublicSourceRefresh(readBudgeted)).data,undefined,'public refresh awaits the source instead of returning last-good immediately');

let now = 1_000_000;
let calls = 0;
let release;
let failing = false;
const saved = new Map();
const store = { read: async key => saved.get(key) ?? null, write: async (key, value) => { saved.set(key, value); } };
const resource = { key: '/public', warm: true, refreshMs: 100, maxAgeMs: 1_000,
  validate: data => data?.value > 0,
  load: async () => { calls++; if (failing) throw Error('offline'); await new Promise(resolve => { release = resolve; }); return { value: calls }; },
};
const cache = createPublicDataCache({ resources: [resource], store, now: () => now });
const flush = async () => { for (let i = 0; i < 10; i++) await new Promise(resolve => setImmediate(resolve)); };
const first = Array.from({ length: 30 }, () => cache.read('/public'));
await flush(); assert.equal(calls, 1); release();
assert.equal((await Promise.all(first))[0].data.value, 1);
now += 101;
const stale = await cache.read('/public');
assert.equal(stale.meta.state, 'stale'); assert.equal(stale.data.value, 1); assert.equal(calls, 2);
release(); await flush();
assert.equal((await cache.read('/public')).data.value, 2);
failing = true; now += 101; await cache.tick(); await flush();
const before = calls;
assert.equal((await cache.read('/public')).meta.state, 'stale');
await cache.tick(); await flush(); assert.equal(calls, before, 'failure backoff prevents visitor-triggered storms');
now += 1_001;
await assert.rejects(cache.read('/public'));
cache.stop();

now = 1_000_250;
const recovered = createPublicDataCache({ resources: [resource], store, now: () => now });
assert.equal((await recovered.read('/public')).data.value, 2, 'restart uses disk without a loader wait');
recovered.stop();
saved.set('/public', '{corrupt');
const corrupt = createPublicDataCache({ resources: [resource], store, now: () => now });
await corrupt.initialize(); assert.equal(corrupt.status().entries, 0); corrupt.stop();

let live = 0, peak = 0;
const releases = [];
const bounded = createPublicDataCache({ now: () => now, concurrency: 2, maxEntries: 3, resources: Array.from({ length: 8 }, (_, index) => ({
  ...resource, key: '/r' + index, load: async () => { peak = Math.max(peak, ++live); await new Promise(resolve => releases.push(resolve)); live--; return { value: 1 }; },
})) });
await bounded.tick(); await flush(); assert.equal(peak, 2);
while (bounded.status().active || bounded.status().queued) { releases.splice(0).forEach(resolve => resolve()); await flush(); }
assert.equal(peak, 2); assert.equal(bounded.status().entries, 3);
bounded.stop();

const deadline = createPublicDataCache({ now: () => now, resources: [{ ...resource,
  load: async () => ({ value: 1, validUntil: new Date(now + 50).toISOString() }),
}] });
const value = await deadline.read('/public'); assert.equal(Date.parse(value.meta.expiresAt), now + 50); deadline.stop();
const invalid = createPublicDataCache({ resources: [{ ...resource, load: async () => ({ value: 0 }) }] });
await assert.rejects(invalid.read('/public')); assert.equal(invalid.status().entries, 0); invalid.stop();

const oversized = createPublicDataCache({ maxEntryBytes: 100, resources: [{ ...resource, load: async () => ({ value: 1, body: 'x'.repeat(101) }) }] });
await assert.rejects(oversized.read('/public')); assert.equal(oversized.status().entries, 0); oversized.stop();
const noDisk = createPublicDataCache({ store: {read:async()=>null,write:async()=>{throw Error('disk full');}}, resources: [{...resource,load:async()=>({value:1})}] });
assert.equal((await noDisk.read('/public')).data.value,1); assert.equal(noDisk.status().diskErrors,1); noDisk.stop();
let idleCalls=0;
const idle = createPublicDataCache({now:()=>now,idleMs:200,resources:[{...resource,warm:false,load:async()=>{idleCalls++;return {value:idleCalls};}}]});
await idle.tick();assert.equal(idleCalls,0,'cold resources are not eagerly crawled');
await idle.read('/public');now+=101;await idle.tick();await flush();assert.equal(idleCalls,2);
now+=201;await idle.tick();await flush();assert.equal(idleCalls,2,'inactive resources stop refreshing');idle.stop();
const stopped = createPublicDataCache({resources:[{...resource,load:async()=>{await new Promise(resolve=>release=resolve);return {value:1};}}]});
const stoppedRead=stopped.read('/public');await flush();stopped.stop();release();await assert.rejects(stoppedRead);assert.equal(stopped.status().entries,0,'late loader cannot repopulate a stopped cache');
let scheduledCalls=0;
const scheduled=createPublicDataCache({resources:[{...resource,refreshMs:20,load:async()=>({value:++scheduledCalls})}]});
scheduled.start(5);
await new Promise(resolve=>setTimeout(resolve,80));
assert.ok(scheduledCalls>=2,'warm data refreshes automatically without visitors');scheduled.stop();
const afterStop=scheduledCalls;await new Promise(resolve=>setTimeout(resolve,30));assert.equal(scheduledCalls,afterStop);
const mutableData={value:1};
const detached=createPublicDataCache({resources:[{...resource,load:async()=>mutableData}]});
await detached.read('/public');mutableData.value=999;const detachedRead=await detached.read('/public');
assert.equal(detachedRead.data.value,1);assert.equal(JSON.parse(detachedRead.body).value,1);detached.stop();

const directory = await mkdtemp(path.join(os.tmpdir(), 'sparkflow-public-cache-test-'));
try {
  const disk = createPublicSnapshotStore(directory, 100);
  await disk.write('../private', 'snapshot');
  assert.equal(await disk.read('../private'), 'snapshot');
  const names = await readdir(directory); assert.equal(names.length, 1); assert.match(names[0], /^[a-f0-9]{64}\.json$/);
  await writeFile(path.join(directory, names[0]), 'x'.repeat(101));
  assert.equal(await disk.read('../private'), null);
} finally { await rm(directory, { recursive: true, force: true }); }
console.log('Public cache: coalescing, stale reads, background refresh, backoff, expiry, disk recovery, limits and safe filenames passed.');
