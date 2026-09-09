import type { AccountSchedules, Preferences } from './workbenchTypes';

export function accountSchedules(preferences: Preferences): AccountSchedules {
  const analysis = preferences.schedules?.analysis ?? { enabled: false, mode: 'clock', timeZone: 'Asia/Shanghai', times: ['09:00'] };
  return {
    // Kept disabled in the persisted shape so older local state can still be parsed safely.
    brief: { enabled: false, mode: 'clock', timeZone: 'Asia/Shanghai', times: ['09:00'] },
    analysis: { ...analysis, times: [...analysis.times] },
  };
}
