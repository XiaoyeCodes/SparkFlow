import test from 'node:test';
import assert from 'node:assert/strict';
import { scheduleWindow } from '../../server/ibkrSchedules.ts';
import { accountSchedules } from '../../src/lib/ibkr/accountSchedules.ts';
import { preferencesSchema, defaults } from '../../server/ibkrWorkbenchCore.ts';

const clock = (times = ['09:00', '18:00'], timeZone = 'Asia/Shanghai') => ({ enabled: true, mode: 'clock', timeZone, times });
test('daily schedules use explicit zones, include weekends, and return only the most recent missed slot', () => {
  const window = scheduleWindow(clock(), new Date('2026-09-06T12:00:00Z'));
  assert.equal(window.due.at, '2026-09-06T10:00:00.000Z');
  assert.equal(window.nextRunAt, '2026-09-07T01:00:00.000Z');
  assert.equal(scheduleWindow({ ...clock(), enabled: false }, new Date()).due, undefined);
  assert.equal(scheduleWindow({ ...clock(), enabled: false }, new Date()).nextRunAt, null);
});
test('New York DST gaps skip nonexistent time and folds choose the first occurrence once', () => {
  const gap = scheduleWindow(clock(['02:30'], 'America/New_York'), new Date('2026-03-08T07:31:00Z'));
  assert.equal(gap.nextRunAt, '2026-03-09T06:30:00.000Z');
  assert.equal(gap.due.at, '2026-03-07T07:30:00.000Z');
  const fold = scheduleWindow(clock(['01:30'], 'America/New_York'), new Date('2026-11-01T06:45:00Z'));
  assert.equal(fold.due.at, '2026-11-01T05:30:00.000Z');
  assert.equal(fold.nextRunAt, '2026-11-02T06:30:00.000Z');
});
test('saving or enabling a schedule does not immediately replay earlier clock times', () => {
  const window = scheduleWindow(clock(), new Date('2026-09-08T04:00:00Z'), '2026-09-08T03:59:00Z');
  assert.equal(window.due, undefined); assert.equal(window.nextRunAt, '2026-09-08T10:00:00.000Z');
});
test('legacy brief timing and switch survive migration; daily analysis starts disabled', () => {
  const settings = accountSchedules(defaults);
  assert.equal(settings.brief.enabled, defaults.daily); assert.equal(settings.brief.mode, 'market-close');
  assert.equal(settings.analysis.enabled, false);
  assert.equal(scheduleWindow(settings.brief, new Date('2026-09-08T21:00:00Z')).due.at, '2026-09-08T20:30:00.000Z');
  assert.equal(accountSchedules({ ...defaults, daily: false }).brief.enabled, false);
});
test('schedule schema rejects malformed times, duplicates, unknown zones and excessive counts', () => {
  for (const config of [clock(['25:00']), clock(['9:00']), clock(['09:00', '09:00']), clock([]), clock(['09:00'], 'invalid'), clock(Array.from({ length: 13 }, (_, i) => `${String(i).padStart(2, '0')}:00`))]) {
    assert.throws(() => preferencesSchema.parse({ ...defaults, schedules: { brief: config, analysis: clock() } }));
  }
  assert.deepEqual(preferencesSchema.parse({ ...defaults, schedules: { brief: clock(['18:00', '09:00']), analysis: clock() } }).schedules.brief.times, ['09:00', '18:00']);
});
