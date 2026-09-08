import { briefSchedule } from './ibkrBrief.ts';
import type { AccountSchedule } from '../src/lib/ibkr/workbenchTypes.ts';

export type ScheduleSlot = { key: string; at: string };
const formatters = new Map<string, Intl.DateTimeFormat>();
function localClock(date: Date, zone: string) {
  let formatter = formatters.get(zone);
  if (!formatter) { formatter = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }); formatters.set(zone, formatter); }
  const parts = Object.fromEntries(formatter.formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export function scheduleWindow(schedule: AccountSchedule, now: Date, effectiveAt?: string) {
  const calendar = briefSchedule(now);
  const slots: ScheduleSlot[] = [];
  if (schedule.mode === 'market-close') {
    if (calendar.dueAt) slots.push({ key: `close:${calendar.dueSession}`, at: calendar.dueAt });
    if (calendar.nextRunAt) slots.push({ key: `close:${calendar.nextRunAt}`, at: calendar.nextRunAt });
  } else {
    const localDate = localClock(now, schedule.timeZone).slice(0, 10);
    const offsets = schedule.timeZone === 'Asia/Shanghai' ? [8] : schedule.timeZone === 'UTC' ? [0] : [-4, -5];
    for (let back = -1; back <= 2; back++) {
      const day = new Date(`${localDate}T12:00:00Z`); day.setUTCDate(day.getUTCDate() + back);
      for (const time of schedule.times) {
        const wall = `${day.toISOString().slice(0, 10)}T${time}`;
        const matches = offsets.map(offset => new Date(Date.parse(`${wall}:00Z`) - offset * 3600000)).filter(candidate => localClock(candidate, schedule.timeZone) === wall).sort((a, b) => +a - +b);
        // A skipped DST time has no occurrence; a repeated wall time runs only once.
        if (matches[0]) slots.push({ key: `${schedule.timeZone}:${wall}`, at: matches[0].toISOString() });
      }
    }
  }
  const eligible = slots.filter(slot => !effectiveAt || Date.parse(slot.at) > Date.parse(effectiveAt)).sort((a, b) => a.at.localeCompare(b.at));
  return { due: schedule.enabled ? eligible.filter(slot => Date.parse(slot.at) <= +now).slice(-1)[0] : undefined, nextRunAt: schedule.enabled ? eligible.find(slot => Date.parse(slot.at) > +now)?.at ?? null : null, calendarSupported: schedule.mode === 'clock' || calendar.calendarSupported };
}
