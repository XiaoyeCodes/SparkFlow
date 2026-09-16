import { getMarketSessionStatus } from '../marketSessions';

const SESSION_WINDOWS = {
  overnight: { label: '夜盘', hours: '20:00–次日 04:00' },
  preopen: { label: '盘前', hours: '04:00–09:30' },
  trading: { label: '常规', hours: '09:30–16:00' },
  'after-hours': { label: '盘后', hours: '16:00–20:00' },
} as const;

export const US_TRADING_SESSION_SCHEDULE = '盘前 04:00–09:30 · 常规 09:30–16:00 · 盘后 16:00–20:00 · 夜盘 20:00–次日 04:00（美东）';

export function getUsTradingSessionDisplay(now: Date | number) {
  const status = getMarketSessionStatus('us', new Date(now));
  const active = status.state in SESSION_WINDOWS
    ? SESSION_WINDOWS[status.state as keyof typeof SESSION_WINDOWS]
    : undefined;
  return {
    state: status.state,
    tone: status.tone,
    label: status.label,
    detail: status.detail,
    nextLabel: status.nextLabel,
    localTime: status.localTime,
    title: active
      ? `当前：${active.label} · ${active.hours} 美东`
      : `当前：${status.label} · ${status.detail}`,
    schedule: US_TRADING_SESSION_SCHEDULE,
  };
}
