import type { AccountSchedules, Preferences } from './workbenchTypes';

export const accountScheduleWeekdays = [
  [1, '周一'], [2, '周二'], [3, '周三'], [4, '周四'], [5, '周五'], [6, '周六'], [7, '周日']
] as const;

function normalizedSchedule(schedule: AccountSchedules['analysis']): AccountSchedules['analysis'] {
  return {
    ...schedule,
    times: [...schedule.times],
    frequency: schedule.frequency ?? 'daily',
    weekday: schedule.weekday ?? 1,
    monthDay: schedule.monthDay ?? 1,
  };
}

export function accountSchedules(preferences: Preferences): AccountSchedules {
  const analysis = preferences.schedules?.analysis ?? { enabled: false, mode: 'clock', timeZone: 'Asia/Shanghai', times: ['09:00'] };
  return {
    // Kept disabled in the persisted shape so older local state can still be parsed safely.
    brief: normalizedSchedule({ enabled: false, mode: 'clock', timeZone: 'Asia/Shanghai', times: ['09:00'] }),
    analysis: normalizedSchedule(analysis),
  };
}

export function accountScheduleDescription(schedule: AccountSchedules['analysis']) {
  if (schedule.mode === 'market-close') return '美股收盘后 30 分钟';
  const frequency = schedule.frequency ?? 'daily';
  const cadence = frequency === 'weekly'
    ? `每${accountScheduleWeekdays.find(([value]) => value === (schedule.weekday ?? 1))?.[1] ?? '周一'}`
    : frequency === 'monthly'
      ? `每月 ${schedule.monthDay ?? 1} 日`
      : '每天';
  return `${cadence} · ${schedule.times.join('、')}`;
}
