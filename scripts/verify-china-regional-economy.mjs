import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRegionalEconomyService, regionalNextCheck } from '../server/chinaRegionalEconomy.ts';
import { mergeRegionalObservations, latestRegionalObservations, regionalPerCapitaGdp, regionalMetricDetails } from '../src/lib/chinaRegionalEconomy.ts';

const base = JSON.parse(await readFile(new URL('../src/data/chinaRegionalEconomy.json', import.meta.url), 'utf8')).records;
const seed = JSON.parse(await readFile(new URL('../src/data/chinaRegionalVerified.json', import.meta.url), 'utf8'));
const records = mergeRegionalObservations(base, seed.observations);
assert.equal(records['610116'].gdp100mCny, 1593.02);
assert.equal(records['610116'].populationMillion, 1.6584);
assert.equal(records['610116'].gdpPeriod, '2024');
assert.equal(regionalMetricDetails(records['610116'], 'population').note, '常住人口');
assert.ok(Math.abs(regionalPerCapitaGdp(records['610116']) - 96057.646) < 1);
assert.equal(regionalPerCapitaGdp({ ...records['610116'], populationPeriod: '2020', gdpPerCapitaCny: undefined }), null);
assert.equal(regionalPerCapitaGdp({ ...base['610117'], populationMillion: undefined }), null, 'registered population must not generate GDP per capita');

const o = seed.observations.find(o => o.adcode === '610116' && o.metric === 'gdp');
assert.equal(latestRegionalObservations([o, { ...o, period: '2020', value: 1 }])[0].value, 1593.02);
assert.equal(latestRegionalObservations([{ ...o, value: NaN }]).length, 0);
assert.equal(latestRegionalObservations([{ ...o, sourceUrl: 'https://example.com' }]).length, 0);
assert.equal(mergeRegionalObservations({ '610116': { ...base['610116'], gdp100mCny: 2000, gdpPeriod: '2025' } }, [o])['610116'].gdp100mCny, 2000);

const directory = await mkdtemp(path.join(tmpdir(), 'sparkflow-regional-test-'));
let now = Date.parse('2026-09-13T12:00:00Z');
let calls = 0;
let failure = false;
const options = { root: process.cwd(), cacheFile: path.join(directory, 'snapshot.json'),
  seed: { observations: [], scopes: {} }, sources: [{ scope: '61', name: '陕西' }], now: () => now,
  run: async () => { calls++; if (failure) throw new Error('离线'); return { observations: [o], errors: [] }; } };
const service = createRegionalEconomyService(options);
await Promise.all([service.refresh('61'), service.refresh('61')]);
assert.equal(calls, 1, 'only one official job at a time');
let snapshot = await service.snapshot();
assert.equal(snapshot.scopes['61'].nextCheckAt, regionalNextCheck('updated', now));
await service.refresh('61');
assert.equal(calls, 1, 'normal checks are 30 days apart');
now += 31 * 86400000;
failure = true;
await service.refresh('61');
snapshot = await service.snapshot();
assert.equal(snapshot.scopes['61'].status, 'unavailable');
assert.equal(snapshot.observations[0].value, 1593.02, 'offline preserves original observation');
assert.equal(snapshot.scopes['61'].nextCheckAt, regionalNextCheck('unavailable', now));
service.stop();
const restored = createRegionalEconomyService(options);
assert.equal((await restored.snapshot()).observations[0].value, 1593.02);
await restored.refresh('61');
assert.equal(calls, 2, 'restart preserves retry deadline');
restored.stop();
let finish;
const cancelService = createRegionalEconomyService({ ...options, cacheFile: path.join(directory, 'cancel.json'),
  run: () => new Promise(resolve => { finish = resolve; }) });
const cancelled = cancelService.refresh('61');
while (!finish) await new Promise(resolve => setTimeout(resolve, 1));
cancelService.stop();
finish({ observations: [o], errors: [] });
await cancelled;
assert.equal((await cancelService.snapshot()).scopes['61'], undefined, 'shutdown must not postpone an unfinished check');
console.log('Regional observations, units, period isolation, refresh cadence and disk recovery passed');
