import type { AccountSchedules, Preferences } from './workbenchTypes';

export function accountSchedules(preferences: Preferences): AccountSchedules {
  return preferences.schedules ?? {
    brief: { enabled: preferences.daily, mode: 'market-close', timeZone: 'America/New_York', times: ['16:30'] },
    analysis: { enabled: false, mode: 'clock', timeZone: 'Asia/Shanghai', times: ['09:00'] },
  };
}
