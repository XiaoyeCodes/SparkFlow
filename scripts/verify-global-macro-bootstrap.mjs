import assert from 'node:assert/strict';
import { createPublicDataCache } from '../server/publicDataCache.ts';
import { readGlobalMacroBootstrap } from '../server/globalMacroBootstrap.ts';
import { readMarketBootstrap } from '../server/marketBootstrap.ts';
import { marketBootstrapKeys } from '../src/lib/marketPreload.ts';
import { GLOBAL_MACRO_BOOTSTRAP_KEYS } from '../src/lib/globalMacroPreload.ts';
import { PUBLIC_DATA_POLICIES } from '../src/lib/publicDataPolicy.ts';
import { rememberPreparedPublicData, peekPublicData, clearPublicDataMemory } from '../src/lib/publicDataClient.ts';

let now = Date.now(), calls = 0;
const originalNow = Date.now;
Date.now = () => now;
const key = '/api/global-macro-core-index?id=nasdaq';
let release;
const cache = createPublicDataCache({ now: () => now, resources: [{
  key, refreshMs: 3000, maxAgeMs: 90_000, warm: true, validate: () => true,
  load: async () => { calls++; if (calls > 1) await new Promise(resolve => { release = resolve; });
    return { index: { id: 'nasdaq', price: 100 + calls } }; },
}] });
try {
  assert.ok(GLOBAL_MACRO_BOOTSTRAP_KEYS.every(key => PUBLIC_DATA_POLICIES.some(policy => policy.key === key && policy.warm)));
  assert.deepEqual((await readGlobalMacroBootstrap(cache)).resources, {});
  assert.equal(calls, 0, 'empty bootstrap does not load upstream or wait for cold resources');
  await cache.refresh(key);
  const boot = await readGlobalMacroBootstrap(cache);
  assert.equal(boot.resources[key].index.price, 101);
  assert.equal(rememberPreparedPublicData(key, boot.resources[key]), true);
  assert.equal(peekPublicData(key).index.price, 101);
  now += 3001;
  const updating = cache.refresh(key);
  const ready = await Promise.all(Array.from({ length: 20 }, () => readGlobalMacroBootstrap(cache)));
  assert.ok(ready.every(snapshot => snapshot.resources[key]._publicCache.state === 'stale'));
  assert.equal(calls, 2, 'bootstrap visitors do not add upstream loads');
  release(); await updating;
  const newer = (await readGlobalMacroBootstrap(cache)).resources[key];
  assert.ok(rememberPreparedPublicData(key, newer));
  assert.equal(rememberPreparedPublicData(key, boot.resources[key]), false, 'delayed bootstrap cannot replace newer data');
  assert.equal(peekPublicData(key).index.price, 102);
  assert.equal(rememberPreparedPublicData('/api/ibkr/status', newer), false);
  assert.equal(rememberPreparedPublicData('https://external.example' + key, newer), false);
  now += 90_001;
  assert.deepEqual((await readGlobalMacroBootstrap(cache)).resources, {});
  assert.equal(rememberPreparedPublicData(key, newer), false, 'bootstrap never extends source expiry');
  assert.equal(peekPublicData(key), undefined);
  console.log('Macro bootstrap: ready-only reads, no upstream waiting, concurrent visitors, first-paint priming, expiry and isolation passed.');
} finally { cache.stop(); clearPublicDataMemory(); Date.now = originalNow; }

let marketCalls = 0;
const selected = '/api/china-market-heatmap?source=eastmoney';
const excluded = '/api/china-market-heatmap?source=sina';
const privateKey = '/api/integration-settings';
const marketCache = createPublicDataCache({ resources: [selected, excluded, privateKey].map(key => ({
  key, refreshMs: 3000, maxAgeMs: 90_000, warm: true, validate: () => true,
  load: async () => { marketCalls++; return { stocks: [{ name: key }] }; },
})) });
try {
  const sources = { china: 'eastmoney', hongkong: 'sina', us: 'bad', apiKey: 'must-not-be-returned' };
  assert.ok(marketBootstrapKeys(sources).every(key => PUBLIC_DATA_POLICIES.some(policy => policy.key === key && policy.warm)));
  assert.deepEqual((await readMarketBootstrap(marketCache, sources)).resources, {});
  assert.equal(marketCalls, 0, 'cold market preparation does not initiate upstream reads');
  await Promise.all([selected, excluded, privateKey].map(key => marketCache.refresh(key)));
  const boot = await readMarketBootstrap(marketCache, sources);
  assert.deepEqual(Object.keys(boot.resources), [selected]);
  assert.deepEqual(boot.sources, { china: 'eastmoney', hongkong: 'sina', us: 'sina' });
  assert.equal(marketCalls, 3, 'market bootstrap excludes other sources and private settings without loading');
  console.log('Market bootstrap: ready-only reads, selected source, fixed public allowlist and sanitized source choices passed.');
} finally { marketCache.stop(); }
