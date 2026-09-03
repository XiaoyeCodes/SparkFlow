import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildFinancialConditionMetric, createFinancialConditionsService } from '../server/financialConditions.ts';

// Synthetic observations test index direction and units; never shipped as market data.
const point = (day, value) => ({ time: `2026-08-${day}T00:00:00.000Z`, value });
const now = Date.parse('2026-08-29T12:00:00Z');
const nfci = [point('14', -0.44), point('21', -0.4), point('28', -0.32)];
const oas = [point('20', 2.9), point('21', 3), point('24', 3.05), point('28', 3.12)];

const negative = buildFinancialConditionMetric('NFCI', nfci, now);
assert.equal(negative.value, -0.32);
assert.equal(negative.changeWeek, 0.08, 'A negative level can still tighten week over week');
assert.equal(negative.comparisonAt, point('21', 0).time);
assert.equal(buildFinancialConditionMetric('NFCI', [point('21', 0.2), point('28', 0.15)], now).changeWeek, -0.05);
assert.equal(buildFinancialConditionMetric('NFCI', [point('21', 0), point('28', 0)], now).changeWeek, 0);
assert.equal(buildFinancialConditionMetric('NFCI', [point('14', -0.4), point('28', -0.32)], now).changeWeek, null, 'Do not label a two-week change as weekly');
assert.equal(buildFinancialConditionMetric('NFCI', [point('21', -0.402), point('28', -0.4)], now).changeWeek, 0.002);
const spread = buildFinancialConditionMetric('BAMLH0A0HYM2', oas, now);
assert.equal(spread.value * 100, 312);
assert.equal(spread.changeWeek * 100, 12, 'Percentage points convert to basis points by multiplying by 100');
assert.equal(buildFinancialConditionMetric('BAMLH0A0HYM2', [point('21', 3), point('27', 3.12)], now).comparisonAt, null);
assert.equal(buildFinancialConditionMetric('BAMLH0A0HYM2', [point('20', 3), point('28', 3.12)], now).changeWeek, 0.12, 'Holiday comparison uses most recent prior close');
assert.equal(buildFinancialConditionMetric('NFCI', [...nfci].reverse(), now).value, -0.32);
assert.equal(buildFinancialConditionMetric('NFCI', [...nfci, point('31', 99), { time: 'invalid', value: 99 }], now).value, -0.32);
assert.throws(() => buildFinancialConditionMetric('BAMLH0A0HYM2', [point('28', -1)], now));
assert.throws(() => buildFinancialConditionMetric('NFCI', [point('28', NaN)], now));
assert.equal(buildFinancialConditionMetric('NFCI', nfci, now + 15 * 86400000).stale, true);
assert.equal(buildFinancialConditionMetric('BAMLH0A0HYM2', oas, now + 8 * 86400000).stale, true);

const stateDir = await mkdtemp(path.join(tmpdir(), 'sparkflow-conditions-test-'));
try {
  let calls = 0;
  let failNfci = false;
  let failSpread = false;
  let clock = now;
  const options = {
    stateDir,
    now: () => clock,
    getSeries: async id => {
      calls++;
      if ((id === 'NFCI' && failNfci) || (id !== 'NFCI' && failSpread)) throw new Error('test outage');
      return id === 'NFCI' ? nfci : oas;
    },
  };
  const service = createFinancialConditionsService(options);
  const simultaneous = await Promise.all([service.get(), service.get()]);
  assert.equal(calls, 2, 'Concurrent consumers share one upstream request per series');
  assert.deepEqual(simultaneous[0], simultaneous[1]);
  assert.equal(simultaneous[0].nfci.value, -0.32);
  await service.get();
  assert.equal(calls, 2, 'Cache hit must not refetch');
  assert.ok(JSON.parse(await readFile(path.join(stateDir, 'financial-conditions.json'), 'utf8')).NFCI);
  const restored = await createFinancialConditionsService(options).get();
  assert.equal(calls, 2, 'Process restart uses durable cache');
  assert.equal(restored.nfci.changeWeek, 0.08);

  failSpread = true;
  clock += 60_000;
  const partial = await service.get(true);
  assert.equal(partial.creditSpread.value, 3.12);
  assert.equal(partial.creditSpread.stale, true);
  assert.equal(partial.creditSpread.fetchedAt, spread.fetchedAt, 'Failure does not restamp old data');
  assert.equal(partial.nfci.stale, false);
  failNfci = true;
  const failed = await service.get(true);
  assert.equal(failed.nfci.stale, true);
  assert.equal(failed.creditSpread.stale, true);
  failNfci = false;
  failSpread = false;
  const recovered = await service.get(true);
  assert.equal(recovered.nfci.stale, false);
  assert.equal(recovered.creditSpread.stale, false);

  const firstPartial = createFinancialConditionsService({ ...options, stateDir: path.join(stateDir, 'partial') });
  failSpread = true;
  const noSpread = await firstPartial.get();
  assert.equal(noSpread.creditSpread, null);
  assert.equal(noSpread.nfci.value, -0.32, 'Unavailable secondary metric must not blank main metric');
  const firstFailure = createFinancialConditionsService({ ...options, stateDir: path.join(stateDir, 'empty') });
  failNfci = true;
  assert.deepEqual(await firstFailure.get(), { nfci: null, creditSpread: null });
  const beforeRetry = calls;
  await firstFailure.get();
  assert.equal(calls, beforeRetry, 'Outages use retry backoff');
  failNfci = false;
  failSpread = false;
  clock += 16 * 60_000;
  assert.equal((await firstFailure.get()).nfci.value, -0.32);
  console.log('✓ NFCI level/direction, weekly baselines, OAS basis points, dates, cache/restart, deduplication, partial failures and recovery');
} finally {
  await rm(stateDir, { recursive: true, force: true }); // Only the mkdtemp-created test directory.
}

if (process.env.SPARKFLOW_URL) {
  const response = await fetch(`${process.env.SPARKFLOW_URL}/api/financial-conditions?fresh=1`, { signal: AbortSignal.timeout(70_000) });
  assert.equal(response.status, 200);
  const { conditions } = await response.json();
  assert.ok(conditions.nfci, 'NFCI live source unavailable');
  assert.ok(conditions.creditSpread, 'Credit spread live source unavailable');
  console.log('✓ Live sources:', JSON.stringify(conditions));
}
