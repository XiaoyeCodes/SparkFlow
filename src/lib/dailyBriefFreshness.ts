export const DAILY_BRIEF_REFRESH_MS = 3600_000;
export const DAILY_BRIEF_MAX_AGE_MS = 24 * DAILY_BRIEF_REFRESH_MS;

/** Dates describe the snapshot itself; an hourly update never relabels old data. */
export function dailyBriefDate(value: string | number | Date = Date.now()): string {
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? new Date(time + 8 * 3600_000).toISOString().slice(0, 10) : '';
}

export function isCurrentDailyBrief(snapshot: { date?: string; generatedAt?: string } | undefined, now = Date.now()) {
  const generatedAt = Date.parse(snapshot?.generatedAt || '');
  return Boolean(snapshot?.date && dailyBriefDate(generatedAt) === snapshot.date
    && Number.isFinite(generatedAt) && generatedAt <= now && now - generatedAt < DAILY_BRIEF_MAX_AGE_MS);
}

export function dailyBriefExpiresAt(snapshot: { generatedAt?: string }) {
  return Date.parse(snapshot.generatedAt || '') + DAILY_BRIEF_MAX_AGE_MS;
}

export function isFreshDailyBrief(snapshot: { date?: string; generatedAt?: string } | undefined, now = Date.now()) {
  return isCurrentDailyBrief(snapshot, now)
    && Math.floor(Date.parse(snapshot!.generatedAt!) / DAILY_BRIEF_REFRESH_MS) === Math.floor(now / DAILY_BRIEF_REFRESH_MS);
}

export function nextDailyBriefUpdateAt(now = Date.now()) {
  return (Math.floor(now / DAILY_BRIEF_REFRESH_MS) + 1) * DAILY_BRIEF_REFRESH_MS;
}

export function dailyBriefEditionDate(now = Date.now()) {
  return dailyBriefDate(now);
}
