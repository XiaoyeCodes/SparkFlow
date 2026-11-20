export type PeTicker = 'VOO' | 'QQQ';
export type PeRange = 5 | 10 | 'all';
export type PePoint = { date: string; value: number };
type ChartPoint = PePoint & { source: '历史一致预期' | 'Nasdaq 报告' };
type MonthlyPe = { month: string; value: number };
export type PeHistory = {
  ticker: PeTicker;
  consensus: PePoint[];
  reports: (PePoint & { url: string })[];
  checkFailed?: boolean;
  _publicCache?: { state: string; expiresAt?: string };
};

export const peSources = {
  VOO: { index: '标普 500', page: 'https://historyofmarket.com/sp500/forward-pe/' },
  QQQ: { index: '纳斯达克 100', page: 'https://historyofmarket.com/nasdaq/ndx-forward-pe/' },
};

export const ndxMonthlySource = 'https://trendonify.com/united-states/stock-market/nasdaq-100/forward-pe-ratio';
// Published NDX next-12-month multiples from the monthly table. The source gives no observation day.
const ndxMonthlyHistory: MonthlyPe[] = [
  { month: '2005-01', value: 25.65 }, { month: '2005-02', value: 25.57 }, { month: '2005-03', value: 24.62 },
  { month: '2005-04', value: 23.84 }, { month: '2005-05', value: 25.86 }, { month: '2005-06', value: 25.59 },
  { month: '2005-07', value: 26.97 }, { month: '2005-08', value: 26.91 }, { month: '2005-09', value: 27.12 },
  { month: '2005-10', value: 26.14 }, { month: '2005-11', value: 27.65 }, { month: '2005-12', value: 27.60 },
  { month: '2006-01', value: 26.63 }, { month: '2006-02', value: 25.75 }, { month: '2006-03', value: 26.67 },
  { month: '2006-04', value: 26.58 }, { month: '2006-05', value: 24.98 }, { month: '2006-06', value: 24.64 },
];

export function peWindow(history: PeHistory, years: PeRange) {
  const latest = history.reports[history.reports.length - 1];
  const cutoff = new Date(latest.date);
  if (years !== 'all') cutoff.setUTCFullYear(cutoff.getUTCFullYear() - years);
  const start = years === 'all' ? '' : cutoff.toISOString().slice(0, 10);
  const points: ChartPoint[] = [];
  for (const p of history.consensus) {
    if (p.date >= start && p.date < history.reports[0].date) points.push({ ...p, source: '历史一致预期' });
  }
  for (const p of history.reports) {
    if (p.date >= start) points.push({ ...p, source: 'Nasdaq 报告' });
  }

  // Give each sampled month equal weight despite different publication frequencies.
  const months = new Map<string, number>();
  for (const point of points) {
    const month = point.date.slice(0, 7);
    if (month < latest.date.slice(0, 7)) months.set(month, point.value);
  }
  const sorted = [...months.values()].sort((a, b) => a - b);
  const quantile = (p: number) => {
    const i = (sorted.length - 1) * p;
    return sorted[Math.floor(i)] + (sorted[Math.ceil(i)] - sorted[Math.floor(i)]) * (i % 1);
  };
  const stats = sorted.length >= 2 ? {
    count: sorted.length, lastMonth: [...months.keys()][months.size - 1],
    q1: quantile(0.25), median: quantile(0.5), q3: quantile(0.75),
    percentile: 100 * sorted.filter(v => v <= latest.value).length / sorted.length,
  } : null;
  const observedMonths = new Set(history.consensus.map(point => point.date.slice(0, 7)));
  const monthlyReference = history.ticker === 'QQQ' ? ndxMonthlyHistory.filter(point =>
    point.month >= start.slice(0, 7) && point.month <= latest.date.slice(0, 7) && !observedMonths.has(point.month)) : [];
  const gaps = new Map<string, string>();
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1], next = points[i];
    const maxDays = next.source === 'Nasdaq 报告' ? 45 : 100;
    if (Date.parse(next.date) - Date.parse(prev.date) > maxDays * 86400_000
      || monthlyReference.some(p => prev.date.slice(0, 7) < p.month && p.month < next.date.slice(0, 7))) {
      gaps.set(next.date, prev.date);
    }
  }
  return { points, gaps, monthlyReference, latest, stats };
}
