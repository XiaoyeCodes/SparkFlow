import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseSinaTerminalIndices, parseTencentTerminalIndices, createTerminalRegionalIndexLoader, SINA_TERMINAL_INDEX_URL, TENCENT_TERMINAL_INDEX_URL } from '../server/terminalRegionalIndices.ts';
import { reconcileTerminalRegionalIndices } from '../src/lib/terminalRegionalIndices.ts';
import { resolvePublicDataPolicy, validatePublicResource } from '../src/lib/publicDataPolicy.ts';

let now = Date.parse('2026-10-15T02:00:00Z');
const cn = Array(34).fill('0');
Object.assign(cn, { 2: '3767.23', 3: '3713.74', 30: '2026-10-15', 31: '09:54:42' });
const hk = Array(26).fill('0');
Object.assign(hk, { 3: '24314.170', 6: '24106.520', 7: '-207.650', 8: '-0.850', 17: '2026/10/15', 18: '09:54:42' });
const sina = (code, fields) => `var hq_str_${code}="${fields.join(',')}";`;
const fixture = sina('sh000001', cn) + sina('rt_hkHSI', hk);
const parsed = parseSinaTerminalIndices(fixture, now);
assert.equal(parsed.length, 2);
assert.equal(parsed[0].name, '上证指数'); assert.equal(parsed[0].symbol, '000001.SS');
assert.equal(parsed[0].price, 3713.74); assert.equal(parsed[0].changePercent.toFixed(2), '-1.42');
assert.equal(parsed[1].price, 24106.52); assert.equal(parsed[1].changePercent, -0.85);
assert.equal(parsed[1].updatedAt, '2026-10-15T01:54:42.000Z');
assert.equal(parseSinaTerminalIndices(sina('hkHSI', hk), now).length, 0, 'must request the realtime rt_hkHSI variant');
for (const [index, value] of [[3, ''], [3, '0'], [2, '0'], [30, '2026-02-30'], [30, '2026-11-15']]) {
  const invalid = [...cn]; invalid[index] = value;
  assert.equal(parseSinaTerminalIndices(sina('sh000001', invalid), now).length, 0);
}
const inconsistent = [...hk]; inconsistent[8] = '5.1';
assert.equal(parseSinaTerminalIndices(sina('rt_hkHSI', inconsistent), now).length, 0, 'last price and return must share the previous-close baseline');
const qt = Array(40).fill('0'); Object.assign(qt, { 3: '24106.52', 4: '24314.17', 30: '2026/10/15 09:54:42', 32: '-0.85' });
const tencent = `v_hkHSI="${qt.join('~')}";`;
assert.equal(parseTencentTerminalIndices(tencent, now)[0].updatedAt, parsed[1].updatedAt);
assert.equal(parseTencentTerminalIndices(`v_s_hkHSI="100~name~HSI~24106.52~-207.65~-0.85";`, now).length, 0, 'simple quotes without timestamps must not freeze the UI');

let calls = [], mode = 'ok';
const loader = createTerminalRegionalIndexLoader(async url => {
  calls.push(url);
  if (mode === 'all-failed') throw Error('all offline');
  if (url === SINA_TERMINAL_INDEX_URL) {
    if (mode === 'fail') throw Error('offline');
    return mode === 'partial' ? sina('sh000001', cn) : fixture;
  }
  assert.equal(url, TENCENT_TERMINAL_INDEX_URL);
  if (mode === 'stale-primary') {
    const fresh = [...qt]; fresh[30] = '2026/10/15 10:30:00';
    return `v_hkHSI="${fresh.join('~')}";`;
  }
  return tencent;
}, () => now);
const concurrent = await Promise.all(Array.from({ length: 20 }, () => loader()));
assert.equal(calls.length, 1, 'simultaneous visitors/fast frame share one direct request');
assert.ok(concurrent.every(quotes => quotes.length === 2));
await loader(); assert.equal(calls.length, 1, 'shared 3-second source cadence');
now += 3001; mode = 'partial';
const partial = await loader(); assert.equal(partial[0].sourceUrl, parsed[0].sourceUrl);
assert.match(partial[1].sourceUrl, /gu\.qq\.com/); assert.equal(calls.length, 3);
now += 3001; mode = 'fail';
assert.equal((await loader())[0].id, 'hongkong', 'available fallback survives primary failure');
now += 30 * 60_000; mode = 'stale-primary';
assert.match((await loader()).find(q => q.id === 'hongkong').sourceUrl, /gu\.qq\.com/, 'stuck Sina timestamps trigger a fresher direct backup');
now += 3001; mode = 'all-failed';
await assert.rejects(loader(), /直连主备/, 'failed fetches never renew cached source success indefinitely');

const old = parsed.map(q => ({ ...q, name: q.id === 'china' ? '上证综指' : q.name, price: 1, changePercent: -0.13,
  updatedAt: '2026-10-15T01:30:00Z', history: [{ time: '2026-10-14', value: 1 }], latitude: 31 }));
// Validation uses the current wall clock, so hold it at this fixture date.
const originalNow = Date.now; Date.now = () => now;
try {
  const result = reconcileTerminalRegionalIndices(old, parsed);
  assert.equal(result.markets[0].name, '上证指数');
  assert.equal(result.markets[0].price, result.ticker[0].price);
  assert.equal(result.markets[1].changePercent, result.ticker[1].changePercent);
  assert.equal(result.markets[1].sourceUrl, result.ticker[1].sourceUrl);
  assert.deepEqual(result.markets[0].history, old[0].history, 'retain historical context and marker position');
  assert.equal(result.markets[0].latitude, 31);
  const restored = reconcileTerminalRegionalIndices(result.markets, old);
  assert.equal(restored.ticker[1].price, parsed[1].price, 'late older Yahoo frames cannot revert either view');
  const key = '/api/global-macro-regional-indices';
  assert.equal(resolvePublicDataPolicy(key).refreshMs, 3000);
  assert.equal(resolvePublicDataPolicy(key).warm, true);
  assert.equal(validatePublicResource(key, { markets: parsed }), true);
  assert.equal(validatePublicResource(key, { markets: [{ ...parsed[0], symbol: '000001.SZ' }] }), false);
  assert.equal(validatePublicResource(key, { markets: [null, parsed[0]] }), false);
} finally { Date.now = originalNow; }
const config = await readFile(new URL('../vite.config.ts', import.meta.url), 'utf8');
const transport = config.slice(config.indexOf('const readTerminalRegionalIndices ='), config.indexOf('async function loadTerminalRegionalIndices()'));
assert.match(transport, /undiciFetch\(url, \{ dispatcher: macroDirectAgent/);
assert.doesNotMatch(transport, /foreignProxy|fetchExternal|fetchRouted/);
console.log('Terminal regional indices: correct Sina fields, source dates, realtime HK variant, direct-only transport, partial failover, dedupe, cadence and synchronized views passed.');
