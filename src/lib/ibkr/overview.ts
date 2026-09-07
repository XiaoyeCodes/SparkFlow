import type { AccountSnapshot, PortfolioPerformance, PerformancePoint } from './workbenchTypes';

export const finite = (v: unknown): number | null => (typeof v !== 'number' && (typeof v !== 'string' || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(v))) || !Number.isFinite(Number(v)) ? null : Number(v);
const day = 86400000;
const iso = (date: Date) => date.toISOString().slice(0, 10);
export function chartSeries(history?: PortfolioPerformance): PerformancePoint[] {
  const points = history?.points ?? [];
  if (new Set(points.map(p => p.date)).size !== points.length) return [];
  return points.filter(p => /^\d{4}-\d{2}-\d{2}$/.test(p.date) && Number.isFinite(Date.parse(p.date)) && iso(new Date(p.date)) === p.date)
    .map(p => ({ ...p, nav: finite(p.nav), cumulativeReturn: finite(p.cumulativeReturn) !== null && Number(p.cumulativeReturn) > -1 ? Number(p.cumulativeReturn) : null, benchmarkReturn: finite(p.benchmarkReturn) !== null && Number(p.benchmarkReturn) > -1 ? Number(p.benchmarkReturn) : null }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
const compound = (a?: PerformancePoint, b?: PerformancePoint) => a?.cumulativeReturn != null && b?.cumulativeReturn != null && a.date < b.date ? (1 + b.cumulativeReturn) / (1 + a.cumulativeReturn) - 1 : null;
export function periodReturn(history: PortfolioPerformance | undefined, days: number) {
  const points = chartSeries(history), end = points.slice(-1)[0];
  const target = end ? Date.parse(end.date) - days * day : 0;
  const start = points.filter(p => Date.parse(p.date) <= target).slice(-1)[0];
  return { value: history?.returnMethod === 'TWR' && start && target - Date.parse(start.date) <= 4 * day ? compound(start, end) : null, start: start?.date, end: end?.date };
}
export function monthlyReturns(history?: PortfolioPerformance) {
  const points = chartSeries(history), latest = points.slice(-1)[0];
  if (!latest) return [];
  const endDate = new Date(latest.date);
  return Array.from({ length: 6 }, (_, i) => {
    const first = new Date(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth() - 5 + i, 1));
    const month = iso(first).slice(0, 7);
    const next = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 1));
    const prior = points.filter(p => p.date < iso(first)).slice(-1)[0];
    const last = points.filter(p => p.date >= iso(first) && p.date < iso(next)).slice(-1)[0];
    const partial = month === latest.date.slice(0, 7);
    // Use actual month-boundary observations, never fill absent months or infer returns from NAV.
    const covered = prior && last && first.getTime() - Date.parse(prior.date) <= 7 * day && (partial || next.getTime() - Date.parse(last.date) <= 7 * day);
    return { month, partial, start: prior?.date, end: last?.date, value: history?.returnMethod === 'TWR' && covered ? compound(prior, last) : null };
  });
}
export function overviewAllocation(snapshot: AccountSnapshot) {
  const nav = finite(snapshot.metrics.netLiquidation);
  const validNav = nav !== null && nav > 0;
  const rows = snapshot.positions.flatMap(p => {
    const value = finite(p.marketValue);
    return value !== null && p.currency === snapshot.baseCurrency ? [{ holding: p, value, weight: validNav ? value / nav! : null }] : [];
  }).sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  const excluded = snapshot.positions.length - rows.length;
  const cash = finite(snapshot.cash.find(c => c.currency === snapshot.baseCurrency)?.amount);
  const complete = validNav && excluded === 0;
  return { rows, excluded, complete, cash, cashWeight: validNav && cash !== null ? cash / nav! : null, topFive: complete ? rows.slice(0, 5).reduce((sum, p) => sum + Math.abs(p.value), 0) / nav! : null };
}
