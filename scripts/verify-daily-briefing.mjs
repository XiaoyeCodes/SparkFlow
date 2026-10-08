import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createDailyBriefService, getDailyBriefWindow, getNextDailyBriefRun } from '../server/dailyBriefService.ts';

let now = Date.parse('2026-10-08T02:10:00Z');
let calls = 0;
let fail = false;
let release;
let gated = false;
const snapshot = (window, index) => ({ version: 18, date: window.date, slot: window.slot,
  generatedAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString(), summaryMode: 'rules',
  summary: { headline: `snapshot-${index}`, regime: 'test', tone: 'balanced', highlights: [], risks: [], watchlist: [], portfolioNotes: [] },
  markets: [], macro: [], news: [], sources: [], errors: [], portfolio: { connected: false, positions: [] } });
const until = async predicate => {
  for (let i = 0; i < 200; i++) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 5)); }
  throw new Error('timed out');
};
assert.deepEqual(getDailyBriefWindow(new Date('2026-10-08T00:00:00Z')), { date: '2026-10-08', slot: 'morning' });
assert.deepEqual(getDailyBriefWindow(new Date('2026-10-08T16:00:00Z')), { date: '2026-10-09', slot: 'morning' });
assert.equal(getNextDailyBriefRun(new Date('2026-10-08T02:01:00Z')).toISOString(), '2026-10-08T03:00:00.000Z');
assert.equal(getNextDailyBriefRun(new Date('2026-10-08T15:59:59Z')).toISOString(), '2026-10-08T16:00:00.000Z');
assert.equal(getNextDailyBriefRun(new Date('2026-10-08T03:00:00Z')).toISOString(), '2026-10-08T04:00:00.000Z');
const root = await mkdtemp(path.join(tmpdir(), 'sparkflow-hourly-brief-'));
const warmed = [];
const service = createDailyBriefService({ stateDir: root, now: () => new Date(now),
  onSnapshot: async value => { warmed.push(value.generatedAt); },
  generate: async window => {
    calls++;
    if (gated) await new Promise(resolve => { release = resolve; });
    if (fail) throw Error('offline');
    return snapshot(window, calls);
  },
});
try {
  const visitors = await Promise.all(Array.from({ length: 20 }, () => service.getForPage()));
  assert.equal(calls, 1, 'cold readers and scheduler share one generation');
  assert.equal(visitors[0]._pageCache.state, 'fresh');
  assert.equal(visitors[0]._pageCache.expiresAt, '2026-10-09T02:10:00.000Z');
  await until(() => warmed.length === 1);
  await service.refreshIfDue();
  assert.equal(calls, 1, 'recovery/cron in the same hour never regenerate a complete snapshot');
  now = Date.parse('2026-10-08T03:00:00Z'); gated = true;
  const refresh = service.refreshIfDue(); await until(() => Boolean(release));
  const old = await Promise.all(Array.from({ length: 30 }, () => service.getForPage()));
  assert.equal(calls, 2);
  assert.equal(old[0].snapshot.summary.headline, 'snapshot-1', 'readers get the last success during a slow hourly update');
  assert.equal(old[0]._pageCache.state, 'stale');
  assert.equal(service.status().refreshing, true);
  release(); gated = false; await refresh;
  assert.equal((await service.getForPage()).snapshot.summary.headline, 'snapshot-2');
  await until(() => warmed.length === 2);
  const file = path.join(root, 'daily-brief', '2026-10-08', 'morning.json');
  assert.equal(JSON.parse(await readFile(file, 'utf8')).summary.headline, 'snapshot-2');
  const restart = createDailyBriefService({ stateDir: root, now: () => new Date(now), generate: async () => { throw Error('must restore'); } });
  const stop = restart.schedule();
  assert.equal((await restart.getForPage()).snapshot.summary.headline, 'snapshot-2');
  await restart.refreshIfDue(); stop();
  now = Date.parse('2026-10-08T04:00:00Z'); fail = true;
  const failed = await service.refreshIfDue();
  assert.equal(failed.snapshot.summary.headline, 'snapshot-2');
  assert.equal(failed._pageCache.state, 'stale');
  const failedCalls = calls;
  await Promise.all(Array.from({ length: 30 }, () => service.getForPage()));
  await service.refreshIfDue();
  assert.equal(calls, failedCalls, 'visitors cannot bypass failed generation backoff');
  now += 60_000; fail = false; await service.refreshIfDue();
  assert.equal(calls, failedCalls + 1);
  now = Date.parse('2026-10-08T16:00:00Z'); gated = true; release = undefined;
  const midnight = service.refreshIfDue(); await until(() => Boolean(release));
  assert.equal((await service.getForPage()).snapshot.date, '2026-10-08', 'midnight preserves the real date of the previous cache');
  release(); gated = false; await midnight;
  assert.equal((await service.getForPage()).snapshot.date, '2026-10-09');
  await service.get(getDailyBriefWindow(new Date(now)), true);
  assert.equal((await service.getForPage())._pageCache.state, 'fresh', 'manual refresh remains supported');
  now += 25 * 3600_000; fail = true;
  await assert.rejects(service.getForPage(), /过期/, 'snapshots cannot stay usable forever');
  assert.equal((await service.latest()).date, '2026-10-09');
  console.log('Hourly briefing: background generation, immediate stale reads, coalescing, disk recovery, hourly/midnight updates, model prewarm and backoff passed.');
} finally {
  const cleanupTarget = path.resolve(root);
  const cleanupParent = path.resolve(tmpdir());
  assert.equal(path.dirname(cleanupTarget), cleanupParent);
  assert.ok(path.basename(cleanupTarget).startsWith('sparkflow-hourly-brief-'));
  await rm(cleanupTarget, { recursive: true, force: true });
}
