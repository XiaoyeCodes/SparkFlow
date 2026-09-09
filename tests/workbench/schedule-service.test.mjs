import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { IbkrWorkbenchService } from '../../server/ibkrWorkbench.ts';
import { normalizeMcpSnapshot } from '../../server/ibkrMcp.ts';
import { defaults, newYorkClock } from '../../server/ibkrWorkbenchCore.ts';

const model = { provider: 'fixture', model: 'offline', fingerprint: 'schedule-fixture', configured: true };
async function fixture(allowCurrentSlot = true) {
  await mkdir('tmp/workbench-service', { recursive: true });
  const directory = await mkdtemp(path.resolve('tmp/workbench-service/schedules-'));
  const service = new IbkrWorkbenchService(process.cwd(), directory, async () => ({}), async () => ({}));
  await service.start(); clearTimeout(service.timer);
  if (allowCurrentSlot) service.scheduleStartedAt = new Date(Date.now() - 120000).toISOString();
  const snapshot = normalizeMcpSnapshot('SCHEDULE_TEST', [], { baseCurrency: 'USD', netLiquidation: 100, cash: [{ currency: 'USD', amount: 100 }] });
  const config = { enabled: true, mode: 'clock', timeZone: 'UTC', times: [new Date().toISOString().slice(11, 16)] };
  const record = { snapshot, preferences: { ...defaults, schedules: { brief: { ...config }, analysis: { ...config } } }, alerts: [], jobs: [], reports: [], usage: [], grant: { fingerprint: model.fingerprint } };
  service.saved.selectedKey = snapshot.accountKey; service.saved.records[snapshot.accountKey] = record;
  service.nextSync = Date.now() + 86400000;
  service.ai = { status: async () => model, close() {} };
  const launches = [];
  service.analyze = async (kind, _question, key) => { assert.equal(kind, 'daily'); launches.push(['analysis', key]); };
  return { service, record, launches, directory };
}

test('only the explicit daily analysis schedule dispatches and each slot runs once', async () => {
  const f = await fixture();
  try {
    await Promise.all([f.service.tick(), f.service.tick()]);
    await f.service.tick();
    assert.deepEqual(f.launches.map(call => call[0]), ['analysis']);
    assert.equal(Object.keys(f.record.scheduleRuns).length, 1);
    assert.match(Object.keys(f.record.scheduleRuns)[0], /^analysis:/);
  } finally { await f.service.close(); }
});

test('starting the service after a scheduled time never catches up that missed slot', async () => {
  const f = await fixture(false);
  try {
    await f.service.tick();
    assert.equal(f.launches.length, 0);
    assert.equal(f.record.scheduleRuns, undefined);
  } finally { await f.service.close(); }
});

test('disabled schedule, stale snapshot, revoked consent and total budget prevent dispatch', async () => {
  const f = await fixture();
  try {
    f.record.preferences.schedules.analysis.enabled = false;
    await f.service.tick(); assert.equal(f.launches.length, 0);
    f.record.preferences.schedules.analysis.enabled = true;
    f.record.snapshot.asOf = 'invalid'; await f.service.tick(); assert.equal(f.launches.length, 0);
    f.record.snapshot.asOf = new Date().toISOString(); f.record.grant.fingerprint = 'revoked'; await f.service.tick();
    f.record.grant.fingerprint = model.fingerprint;
    f.record.preferences.maxAiCalls = 1; f.record.usage = [{ at: new Date().toISOString(), kind: 'manual' }];
    assert.equal(newYorkClock(new Date(f.record.usage[0].at)).date, newYorkClock(new Date()).date);
    await f.service.tick(); assert.equal(f.launches.length, 0); assert.equal(f.record.scheduleRuns, undefined);
    f.record.usage = []; await f.service.tick(); assert.deepEqual(f.launches.map(call => call[0]), ['analysis']);
  } finally { await f.service.close(); }
});

test('a failed scheduled analysis is claimed and is not retried on every tick', async () => {
  const f = await fixture(); let attempts = 0;
  try {
    f.service.analyze = async () => { attempts++; throw new Error('TEST_FAILED'); };
    await f.service.tick(); await f.service.tick(); await f.service.tick();
    assert.equal(attempts, 1);
    assert.equal(Object.values(f.record.scheduleRuns).find(run => run.error)?.error, 'TEST_FAILED');
  } finally { await f.service.close(); }
});

test('settings keep one analysis schedule and force legacy automatic paths off', async () => {
  const f = await fixture();
  try {
    f.record.performance = { fixture: true };
    const analysis = { ...f.record.preferences.schedules.analysis, times: ['23:59'] };
    await f.service.preferences({ ...f.record.preferences, daily: true, eventAnalysis: true, maxAutomatic: 4, schedules: { ...f.record.preferences.schedules, analysis } });
    assert.equal(f.record.preferences.daily, false);
    assert.equal(f.record.preferences.eventAnalysis, false);
    assert.equal(f.record.preferences.maxAutomatic, 0);
    assert.equal(f.record.preferences.schedules.brief.enabled, false);
    assert.ok(f.record.scheduleEffectiveAt.analysis);
    assert.deepEqual(f.record.performance, { fixture: true });
    const saved = JSON.parse(await readFile(path.join(f.directory, 'state.json'), 'utf8'));
    assert.equal(saved.records[f.record.snapshot.accountKey].preferences.schedules.analysis.times[0], '23:59');
  } finally { await f.service.close(); }
});
