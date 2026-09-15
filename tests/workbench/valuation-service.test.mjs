import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createValuationService, VALUATION_REFRESH_MS } from '../../server/ibkrValuation.ts';
import { VALUATION_RULES } from '../../server/ibkrValuationModel.ts';
import { allowedPublicReadRequest } from '../../server/localRequest.ts';

const NOW = '2026-09-08T00:00:00.000Z';
const DAY = 86_400_000;
const levels = { vix: 20, spx: 100, ndx: 100, pe: 20, qqqPe: 30, forwardYield: 5, treasury10y: 4, fearGreed: 50,
  marketCap: 80, gdp: 32, cape: 40, treasury2y: 4.6 };

test('public valuation reads allow same-origin and CDN requests but reject cross-site browsers', () => {
  assert.equal(allowedPublicReadRequest({ host: 'risk.example.com', 'sec-fetch-site': 'same-origin' }), true);
  assert.equal(allowedPublicReadRequest({ host: '127.0.0.1:5187' }), true);
  assert.equal(allowedPublicReadRequest({ host: 'internal:5187', 'x-forwarded-host': 'risk.example.com', origin: 'https://risk.example.com' }), true);
  assert.equal(allowedPublicReadRequest({ host: 'risk.example.com', origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' }), false);
  assert.equal(allowedPublicReadRequest({ host: 'risk.example.com', origin: 'https://evil.example' }), false);
});

function fixture(fetchedAt = NOW) {
  const days = [];
  const start = new Date(fetchedAt);
  start.setUTCFullYear(start.getUTCFullYear() - 1);
  for (let date = +start; date <= Date.parse(fetchedAt); date += DAY) days.push(new Date(date).toISOString().slice(0, 10));
  return {
    fetchedAt,
    series: Object.fromEntries(Object.entries(levels).map(([id, value]) => [id, {
      points: days.map(date => ({ date, value })), current: value, asOf: fetchedAt,
      source: 'TEST FIXTURE', sourceUrl: 'https://example.com/test-only', status: 'snapshot', note: '',
    }])),
  };
}

async function temporaryState(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'sparkflow-valuation-service-test-'));
  t.after(async () => {
    const verified = path.resolve(directory);
    const expected = path.resolve(tmpdir()) + path.sep;
    assert.ok(verified.startsWith(expected) && path.basename(verified).startsWith('sparkflow-valuation-service-test-'));
    await rm(verified, { recursive: true, force: true });
  });
  return directory;
}

test('service coalesces simultaneous horizon and snapshot requests into one load', async t => {
  const stateDir = await temporaryState(t);
  let calls = 0;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const service = createValuationService({ stateDir, load: async () => { calls++; await gate; return fixture(); } });
  const one = service.get(1);
  const five = service.get(5, true);
  const bundle = service.snapshot();
  const radar = service.riskRadar();
  release();
  const [a, b, all, compact] = await Promise.all([one, five, bundle, radar]);
  assert.equal(calls, 1);
  assert.equal(a.snapshotId, b.snapshotId);
  assert.equal(a.snapshotId, all.id);
  assert.deepEqual(Object.keys(all.windows), ['1', '3', '5', '10']);
  for (const years of [1, 3, 5, 10]) {
    assert.equal(all.windows[years].lookbackYears, years);
    assert.equal(all.windows[years].fetchedAt, NOW);
    assert.equal(all.windows[years].snapshotId, all.id);
    assert.deepEqual(all.windows[years].audit.inputs, all.windows[1].audit.inputs);
  }
  assert.equal(a.score.value, 50);
  assert.equal(b.score.value, null);
  assert.equal(b.lookbackYears, 5);
  assert.deepEqual(Object.keys(compact), ['fetchedAt', 'treasury', 'sentiment', 'riskRadar', 'complete', 'cache']);
  assert.equal(compact.complete, true);
  assert.equal('audit' in compact, false);
  assert.equal('metrics' in compact, false);
});

test('service uses normal cache and throttles force refresh without discarding force after expiry', async t => {
  const stateDir = await temporaryState(t);
  let clock = Date.parse(NOW);
  t.mock.method(Date, 'now', () => clock);
  const requests = [];
  const service = createValuationService({ stateDir, load: async options => { requests.push(options); return fixture(); } });
  await service.get(1);
  clock += 9_000;
  await service.get(3, true);
  assert.equal(requests.length, 1);
  clock += 2_000;
  await service.get(5, true);
  assert.deepEqual(requests, [{ force: false }, { force: true }]);
  clock += VALUATION_REFRESH_MS - 1_000;
  await service.get(10);
  assert.equal(requests.length, 2);
  clock += 2_000;
  await service.get(1);
  await service.refresh();
  assert.equal(requests.length, 3);
  assert.equal(requests.at(-1).force, false);
});

test('failed concurrent load clears pending state and retries without caching an error', async t => {
  const stateDir = await temporaryState(t);
  let calls = 0;
  const service = createValuationService({ stateDir, load: async () => {
    calls++;
    if (calls === 1) throw new Error('fixture-offline');
    return fixture();
  } });
  const failed = await Promise.allSettled([service.get(1), service.snapshot()]);
  assert.equal(calls, 1);
  assert.ok(failed.every(result => result.status === 'rejected'));
  assert.deepEqual(await service.history(), []);
  const result = await service.get(1);
  assert.equal(calls, 2);
  assert.equal(result.score.value, 50);
  assert.equal((await service.history()).length, 1);
});

test('new snapshots preserve older audit results and survive service recreation without loading data', async t => {
  const stateDir = await temporaryState(t);
  let clock = Date.parse(NOW);
  t.mock.method(Date, 'now', () => clock);
  let input = fixture();
  let calls = 0;
  const service = createValuationService({ stateDir, load: async () => { calls++; return input; } });
  const first = await service.snapshot();
  const preserved = structuredClone(first);
  input = fixture('2026-09-09T00:00:00.000Z');
  input.series.fearGreed.current = 0;
  clock += 60_000;
  const second = await service.get(1, true);
  assert.notEqual(first.id, second.snapshotId);
  assert.notEqual(first.windows[1].score.value, second.score.value);
  assert.deepEqual(await service.audit(first.id), preserved);
  assert.deepEqual((await service.history()).map(row => row.id), [second.snapshotId, first.id]);
  const recreated = createValuationService({ stateDir, load: async () => { throw new Error('audit must not fetch'); } });
  assert.deepEqual(await recreated.audit(first.id), preserved);
  assert.equal((await recreated.history()).length, 2);
  assert.equal(calls, 2);
});

test('cached and persisted snapshots are independent of loader and caller mutations', async t => {
  const stateDir = await temporaryState(t);
  const input = fixture();
  const service = createValuationService({ stateDir, load: async () => input });
  const first = await service.snapshot();
  const preserved = structuredClone(first);
  input.series.spx.current = 99999;
  input.series.spx.points[0].value = 99999;
  first.windows[1].score.value = -999;
  first.windows[1].rules.weights.spx = 0;
  first.windows[1].audit.inputs.series.spx.current = -999;
  assert.deepEqual(await service.snapshot(), preserved);
  assert.deepEqual(await service.audit(preserved.id), preserved);
  const one = await service.get(1);
  one.score.contributions[0].points = -100;
  const { cache, ...display } = await service.get(1);
  assert.deepEqual(display, preserved.windows[1]);
});

test('audit freezes historical model output across rule changes and uses distinct version identities', async t => {
  const stateDir = await temporaryState(t);
  let clock = Date.parse(NOW);
  t.mock.method(Date, 'now', () => clock);
  const input = fixture();
  const service = createValuationService({ stateDir, load: async () => input });
  const first = await service.snapshot();
  const preserved = structuredClone(first);
  const originalVersion = VALUATION_RULES.version;
  const originalWeight = VALUATION_RULES.weights.spx;
  try {
    VALUATION_RULES.version = 'test-next-model-version';
    VALUATION_RULES.weights.spx = 0;
    assert.deepEqual(await service.audit(first.id), preserved);
    clock += 11_000;
    const next = await service.get(1, true);
    assert.notEqual(next.snapshotId, first.id);
    assert.equal(next.rules.version, 'test-next-model-version');
    assert.deepEqual(await service.audit(first.id), preserved);
  } finally {
    VALUATION_RULES.version = originalVersion;
    VALUATION_RULES.weights.spx = originalWeight;
  }
});

test('audit rejects traversal and malformed identifiers before accessing any loader', async t => {
  const stateDir = await temporaryState(t);
  const service = createValuationService({ stateDir, load: async () => { throw new Error('must not load'); } });
  for (const id of ['../outside', '..\\outside', '', 'a'.repeat(23), 'A'.repeat(24), 'a'.repeat(24) + '.json', '%2e%2e%2foutside']) {
    await assert.rejects(() => service.audit(id), /无效快照编号/);
  }
  await assert.rejects(() => service.audit('a'.repeat(24)), { code: 'ENOENT' });
  assert.deepEqual(await service.history(), []);
});

test('malformed persisted entries are ignored by history and cannot break later snapshots', async t => {
  const stateDir = await temporaryState(t);
  const directory = path.join(stateDir, 'valuation-audit');
  await mkdir(directory);
  await Promise.all([
    writeFile(path.join(directory, `${'a'.repeat(24)}.json`), '{broken json'),
    writeFile(path.join(directory, `${'b'.repeat(24)}.json`), '{}'),
    writeFile(path.join(directory, `${'c'.repeat(24)}.json`), JSON.stringify({ id: '../outside', fetchedAt: NOW })),
    writeFile(path.join(directory, `${'d'.repeat(24)}.json`), JSON.stringify({ id: 'd'.repeat(24), fetchedAt: 'invalid' })),
  ]);
  const service = createValuationService({ stateDir, load: async () => fixture() });
  assert.deepEqual(await service.history(), []);
  const result = await service.get(1);
  assert.equal((await service.history()).length, 1);
  const disk = JSON.parse(await readFile(path.join(directory, `${result.snapshotId}.json`), 'utf8'));
  assert.equal(disk.id, result.snapshotId);
  assert.equal(result.score.value, 50);
});


test('restart immediately restores the latest disk cache and stale reads refresh in the background', async t => {
  const stateDir = await temporaryState(t);
  let clock = Date.parse(NOW);
  t.mock.method(Date, 'now', () => clock);
  const original = createValuationService({ stateDir, load: async () => fixture() });
  const first = await original.get(5);
  let calls = 0, release;
  const gate = new Promise(resolve => { release = resolve; });
  const restarted = createValuationService({ stateDir, load: async () => { calls++; await gate; return fixture('2026-09-09T00:00:00Z'); } });
  assert.equal((await restarted.get(5)).snapshotId, first.snapshotId);
  assert.equal(calls, 0);
  clock += VALUATION_REFRESH_MS + 1;
  const cached = await restarted.get(5);
  assert.equal(cached.snapshotId, first.snapshotId);
  assert.equal(cached.cache.refreshing, true);
  assert.equal(calls, 1);
  const finished = restarted.refresh();
  release();
  await finished;
  const updated = await restarted.get(5);
  assert.notEqual(updated.snapshotId, first.snapshotId);
  assert.equal(updated.cache.refreshing, false);
  assert.equal(calls, 1);
});

test('a failed hourly update retains the previous disk snapshot and does not retry every visit', async t => {
  const stateDir = await temporaryState(t);
  let clock = Date.parse(NOW), calls = 0;
  t.mock.method(Date, 'now', () => clock);
  const service = createValuationService({ stateDir, load: async () => { if (++calls > 1) throw new Error('offline'); return fixture(); } });
  const first = await service.get(5);
  clock += VALUATION_REFRESH_MS + 1;
  await assert.rejects(service.refresh(), /offline/);
  const retained = await service.get(5);
  assert.equal(retained.snapshotId, first.snapshotId);
  assert.match(retained.cache.error, /保留/);
  assert.equal(calls, 2);
  assert.equal((await service.history()).length, 1);
});

test('risk radar repairs a fresh-looking persisted snapshot with missing inputs', async t => {
  const stateDir = await temporaryState(t);
  const partial = fixture();
  for (const key of ['marketCap', 'gdp', 'cape', 'treasury2y']) {
    partial.series[key] = { ...partial.series[key], points: [], current: null, asOf: null, status: 'missing' };
  }
  const original = createValuationService({ stateDir, load: async () => partial });
  await original.snapshot();

  let calls = 0;
  const restarted = createValuationService({ stateDir, load: async () => { calls++; return fixture('2026-09-09T00:00:00.000Z'); } });
  const repaired = await restarted.riskRadar();
  assert.equal(calls, 1);
  assert.equal(repaired.complete, true);
  assert.equal(repaired.riskRadar.marketCap.current, 80);
  assert.equal(repaired.riskRadar.treasury2y.current, 4.6);
});

test('an incomplete refresh cannot replace the last complete risk radar snapshot', async t => {
  const stateDir = await temporaryState(t);
  let clock = Date.parse(NOW);
  t.mock.method(Date, 'now', () => clock);
  let input = fixture();
  const service = createValuationService({ stateDir, load: async () => input });
  const first = await service.riskRadar();
  assert.equal(first.complete, true);

  input = fixture('2026-09-09T00:00:00.000Z');
  for (const key of ['marketCap', 'gdp', 'cape', 'treasury2y']) {
    input.series[key] = { ...input.series[key], points: [], current: null, asOf: null, status: 'missing' };
  }
  clock += 11_000;
  await assert.rejects(service.refresh(), /INCOMPLETE_RISK_RADAR_DATA/);
  const retained = await service.riskRadar();
  assert.equal(retained.complete, true);
  assert.equal(retained.riskRadar.marketCap.current, 80);
  assert.equal((await service.history()).length, 1);
});
