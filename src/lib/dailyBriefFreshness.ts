/** A briefing edition runs from 09:00 Beijing time until the next 09:00. */
export function dailyBriefDate(value: string | number | Date = Date.now()): string {
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? new Date(time + 8 * 3600_000).toISOString().slice(0, 10) : '';
}

export function isCurrentDailyBrief(snapshot: { date?: string; generatedAt?: string } | undefined, now = Date.now()) {
  return Boolean(snapshot?.date && snapshot.date === dailyBriefEditionDate(now)
    && snapshot.generatedAt && dailyBriefDate(snapshot.generatedAt) === snapshot.date);
}

export function dailyBriefDayEnd(date: string) {
  return Date.parse(`${date}T09:00:00+08:00`) + 24 * 3600_000;
}

export function dailyBriefEditionDate(now = Date.now()) {
  return dailyBriefDate(now - 9 * 3600_000);
}
