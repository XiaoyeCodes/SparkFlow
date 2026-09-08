import { getMarketHalfDay, getMarketHolidayName } from '../src/data/marketCalendars.ts';
import type { CloseMarket } from '../src/lib/marketCloseTypes.ts';

export function marketClock(now: Date, market: CloseMarket) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: market === 'cn' ? 'Asia/Shanghai' : 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now).map(p => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

// Calendars are exchange calendars, not working-day calendars. Unknown years fail closed.
// Sources: https://www.sse.com.cn/disclosure/dealinstruc/closed/c/c_20251222_10802510.shtml
// https://www.nyse.com/trade/hours-calendars
export function closeSessionDue(market: CloseMarket, date: string) {
  const noon = new Date(`${date}T12:00:00Z`);
  if (!date.startsWith('2026-') || !Number.isFinite(noon.getTime()) || [0, 6].includes(noon.getUTCDay()) || getMarketHolidayName(market === 'cn' ? 'china' : 'us', date)) return null;
  const close = market === 'cn' ? 900 : getMarketHalfDay('us', date)?.closeMinute ?? 960;
  return new Date(noon.getTime() + (close + 10 - marketClock(noon, market).minutes) * 60000);
}

export function closeSchedule(market: CloseMarket, now = new Date()) {
  const local = marketClock(now, market), calendarSupported = local.date.startsWith('2026-');
  let dueDate: string | null = null, dueAt: string | null = null, nextRunAt: string | null = null;
  if (calendarSupported) for (let offset = -21; offset <= 21; offset++) {
    const day = new Date(`${local.date}T12:00:00Z`); day.setUTCDate(day.getUTCDate() + offset);
    const date = day.toISOString().slice(0, 10), due = closeSessionDue(market, date);
    if (!due) continue;
    if (due <= now) { dueDate = date; dueAt = due.toISOString(); } else if (!nextRunAt) nextRunAt = due.toISOString();
  }
  return { dueDate, dueAt, nextRunAt, calendarSupported };
}
