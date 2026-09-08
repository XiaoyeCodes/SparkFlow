import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { IbkrWorkbenchService } from '../../server/ibkrWorkbench.ts';
import { normalizeMcpSnapshot } from '../../server/ibkrMcp.ts';
import { defaults, newYorkClock } from '../../server/ibkrWorkbenchCore.ts';

const model = { provider: 'fixture', model: 'offline', fingerprint: 'schedule-fixture', configured: true };
async function fixture() {
  await mkdir('tmp/workbench-service', { recursive: true });
  const directory = await mkdtemp(path.resolve('tmp/workbench-service/schedules-'));
  const service = new IbkrWorkbenchService(process.cwd(), directory, async () => ({}), async () => ({}));
  await service.start(); clearTimeout(service.timer);
  const snapshot = normalizeMcpSnapshot('SCHEDULE_TEST', [], { baseCurrency: 'USD', netLiquidation: 100, cash: [{ currency: 'USD', amount: 100 }] });
  const config = { enabled: true, mode: 'clock', timeZone: 'UTC', times: [new Date().toISOString().slice(11, 16)] };
  const record = { snapshot, preferences: { ...defaults, eventAnalysis: false, schedules: { brief: { ...config }, analysis: { ...config } } }, alerts: [], jobs: [], reports: [], usage: [], grant: { fingerprint: model.fingerprint } };
  service.saved.selectedKey = snapshot.accountKey; service.saved.records[snapshot.accountKey] = record;
  service.nextSync = Date.now() + 86400000;
  service.ai = { status: async () => model, close() {} };
  const launches = [];
  service.generateBrief = async (_automatic, key) => { const saved = JSON.parse(await readFile(path.join(directory, 'state.json'), 'utf8')); assert.ok(saved.records[snapshot.accountKey].scheduleRuns[key]); launches.push(['brief', key]); };
  service.analyze = async (kind, _question, key) => { assert.equal(kind, 'daily'); launches.push(['analysis', key]); };
  return { service, record, launches, directory };
}

test('simultaneous due schedules execute sequentially, claim before work, and never repeat a slot', async () => {
  const f = await fixture();
  try {
    await Promise.all([f.service.tick(), f.service.tick()]);
    assert.equal(f.launches.length, 1);
    f.service.activeAnalysis = Promise.resolve(); await f.service.tick(); assert.equal(f.launches.length, 1);
    f.service.activeAnalysis = undefined;
    await f.service.tick(); await f.service.tick();
    assert.deepEqual(f.launches.map(call => call[0]), ['brief', 'analysis']);
    assert.equal(Object.keys(f.record.scheduleRuns).length, 2);
    await f.service.close();
    const restarted = new IbkrWorkbenchService(process.cwd(), f.directory, async () => ({}), async () => ({}));
    try { await restarted.start(); clearTimeout(restarted.timer); assert.equal(Object.keys(restarted.saved.records[f.record.snapshot.accountKey].scheduleRuns).length, 2); }
    finally { await restarted.close(); }
  } finally { await f.service.close(); }
});

test('disabled schedules, stale snapshots, revoked consent and total budget prevent dispatch without consuming a slot', async () => {
  const f = await fixture();
  try {
    f.record.preferences.schedules.brief.enabled = false; f.record.preferences.schedules.analysis.enabled = false;
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

test('failed dispatch is persisted and not retried on every tick; other scheduled task remains independent', async () => {
  const f = await fixture(); let attempts = 0;
  try {
    f.service.generateBrief = async () => { attempts++; throw new Error('TEST_FAILED'); };
    await f.service.tick(); await f.service.tick(); await f.service.tick();
    assert.equal(attempts, 1); assert.equal(f.launches[0][0], 'analysis');
    assert.equal(Object.values(f.record.scheduleRuns).find(run => run.error)?.error, 'TEST_FAILED');
  } finally { await f.service.close(); }
});

test('settings changes persist per account and start after saving without resetting unrelated performance', async () => {
  const f = await fixture();
  try {
    f.record.performance = { fixture: true };
    await f.service.preferences({ ...f.record.preferences, schedules: { ...f.record.preferences.schedules, brief: { ...f.record.preferences.schedules.brief, enabled: false } } });
    assert.equal(f.record.preferences.daily, false); assert.ok(f.record.scheduleEffectiveAt.brief); assert.equal(f.record.scheduleEffectiveAt.analysis, undefined);
    assert.deepEqual(f.record.performance, { fixture: true });
    const saved = JSON.parse(await readFile(path.join(f.directory, 'state.json'), 'utf8'));
    assert.equal(saved.records[f.record.snapshot.accountKey].preferences.schedules.brief.enabled, false);
    f.service.saved.selectedKey = 'different-account'; await f.service.tick(); assert.equal(f.launches.length, 0);
  } finally { await f.service.close(); }
});
