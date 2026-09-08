import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createValuationService } from '../../server/ibkrValuation.ts';
import { VALUATION_RULES } from '../../server/ibkrValuationModel.ts';

const NOW = '2026-09-08T00:00:00.000Z';
const DAY = 86_400_000;
const levels = { vix: 20, spx: 100, ndx: 100, pe: 20, forwardYield: 5, treasury10y: 4, fearGreed: 50 };

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
  assert.equal(calls, 1);
  release();
  const [a, b, all] = await Promise.all([one, five, bundle]);
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
  clock += 54_000;
  await service.get(10);
  assert.equal(requests.length, 2);
  clock += 2_000;
  await service.get(1);
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
  const second = await service.get(1);
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
  assert.deepEqual(await service.get(1), preserved.windows[1]);
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
