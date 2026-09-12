import test from 'node:test';
import assert from 'node:assert/strict';
import { scheduleWindow } from '../../server/ibkrSchedules.ts';
import { accountSchedules } from '../../src/lib/ibkr/accountSchedules.ts';
import { preferencesSchema, defaults } from '../../server/ibkrWorkbenchCore.ts';

const clock = (times = ['09:00', '18:00'], timeZone = 'Asia/Shanghai', recurrence = {}) => ({ enabled: true, mode: 'clock', timeZone, times, frequency: 'daily', weekday: 1, monthDay: 1, ...recurrence });
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
test('weekly schedules run on the selected weekday in the configured timezone', () => {
  const schedule = clock(['09:00'], 'Asia/Shanghai', { frequency: 'weekly', weekday: 1 });
  const window = scheduleWindow(schedule, new Date('2026-09-07T02:00:00Z'));
  assert.equal(window.due.at, '2026-09-07T01:00:00.000Z');
  assert.equal(window.nextRunAt, '2026-09-14T01:00:00.000Z');
});
test('monthly schedules clamp dates beyond a short month to that month end', () => {
  const schedule = clock(['09:00'], 'Asia/Shanghai', { frequency: 'monthly', monthDay: 31 });
  const february = scheduleWindow(schedule, new Date('2027-02-28T02:00:00Z'));
  assert.equal(february.due.at, '2027-02-28T01:00:00.000Z');
  assert.equal(february.nextRunAt, '2027-03-31T01:00:00.000Z');
  assert.equal(scheduleWindow(schedule, new Date('2027-04-30T02:00:00Z')).due.at, '2027-04-30T01:00:00.000Z');
});
test('retired brief scheduling stays disabled and daily analysis requires an explicit opt-in', () => {
  const settings = accountSchedules(defaults);
  assert.equal(settings.brief.enabled, false);
  assert.equal(settings.analysis.enabled, false);
  assert.equal(accountSchedules({ ...defaults, daily: true, eventAnalysis: true }).brief.enabled, false);
});
test('schedule schema migrates old daily settings and rejects malformed recurrence fields', () => {
  const legacy = { enabled: true, mode: 'clock', timeZone: 'Asia/Shanghai', times: ['09:00'] };
  const migrated = preferencesSchema.parse({ ...defaults, schedules: { brief: legacy, analysis: legacy } });
  assert.deepEqual({ frequency: migrated.schedules.analysis.frequency, weekday: migrated.schedules.analysis.weekday, monthDay: migrated.schedules.analysis.monthDay }, { frequency: 'daily', weekday: 1, monthDay: 1 });
  for (const config of [clock(['25:00']), clock(['9:00']), clock(['09:00', '09:00']), clock([]), clock(['09:00'], 'invalid'), clock(Array.from({ length: 13 }, (_, i) => `${String(i).padStart(2, '0')}:00`)), clock(['09:00'], 'UTC', { frequency: 'weekly', weekday: 0 }), clock(['09:00'], 'UTC', { frequency: 'monthly', monthDay: 32 })]) {
    assert.throws(() => preferencesSchema.parse({ ...defaults, schedules: { brief: config, analysis: clock() } }));
  }
  assert.deepEqual(preferencesSchema.parse({ ...defaults, schedules: { brief: clock(['18:00', '09:00']), analysis: clock() } }).schedules.brief.times, ['09:00', '18:00']);
});
