import { previousMacroPeriod } from './usMacroRelease.ts';
import { buildFredCpiRelease } from './usCpiFallback.ts';
type Point = { time: string; value: number };

export function buildFredEmploymentReport(payrolls: Point[], unemployment: Point[], now = Date.now()) {
  const monthly = (points: Point[], rate = false) => new Map(points.filter(point =>
    Number.isFinite(Date.parse(point.time)) && Date.parse(point.time) <= now && Number.isFinite(point.value)
    && point.value >= 0 && (!rate || point.value <= 100)).map(point => [point.time.slice(0, 7), point.value]));
  const jobs = monthly(payrolls), rates = monthly(unemployment, true);
  const change = (period: string) => {
    const current = jobs.get(period), previous = jobs.get(previousMacroPeriod(period));
    return current === undefined || previous === undefined ? undefined : current - previous;
  };
  const period = [...jobs.keys()].sort().reverse().find(month => rates.has(month) && change(month) !== undefined);
  if (!period) throw new Error('FRED 就业数据缺少同月观测或紧邻上月基准');
  const prior = previousMacroPeriod(period);
  return { family: 'employment' as const, period, storedAt: now,
    nonfarm: change(period)!, nonfarmPrevious: change(prior),
    unemployment: rates.get(period)!, unemploymentPrevious: rates.get(prior),
    nonfarmHistory: [...jobs.keys()].sort().filter(month => month <= period).flatMap(month => {
      const value = change(month); return value === undefined ? [] : [{ time: `${month}-01T00:00:00.000Z`, value }];
    }).slice(-48),
    unemploymentHistory: [...rates].sort(([a], [b]) => a.localeCompare(b)).filter(([month]) => month <= period)
      .slice(-48).map(([month, value]) => ({ time: `${month}-01T00:00:00.000Z`, value })),
    sourceUrl: 'https://fred.stlouisfed.org/series/PAYEMS',
    source: 'FRED（原始来源 BLS）', sourceUrls: ['https://fred.stlouisfed.org/series/PAYEMS', 'https://fred.stlouisfed.org/series/UNRATE'],
    methodology: '非农为季调 PAYEMS 与紧邻上月之差，单位千人；失业率为同月季调 UNRATE，单位百分比。',
  };
}

export function buildFredPpiReport(adjusted: Point[], unadjusted: Point[], now = Date.now()) {
  // Final-demand PPI uses the same exact-month index arithmetic as CPI.
  const derived = buildFredCpiRelease(adjusted, unadjusted, now);
  return { family: 'ppi' as const, period: derived.period, storedAt: now,
    ppi: derived.cpi, ppiYoy: derived.cpiYoy, ppiPreviousYoy: derived.cpiPreviousYoy, ppiHistory: derived.cpiHistory,
    sourceUrl: 'https://fred.stlouisfed.org/series/PPIFID', source: 'FRED（原始来源 BLS）',
    sourceUrls: ['https://fred.stlouisfed.org/series/PPIFID', 'https://fred.stlouisfed.org/series/PPIFIS'],
    methodology: '最终需求 PPI 同比按未季调 PPIFID 与去年同月计算；环比按季调 PPIFIS 与上月计算。',
  };
}

export function buildFredPceMetric(points: Point[], now = Date.now()) {
  const values = new Map(points.filter(point => Number.isFinite(Date.parse(point.time)) && Date.parse(point.time) <= now
    && Number.isFinite(point.value) && point.value > 0).map(point => [point.time.slice(0, 7), point.value]));
  const history = [...values.keys()].sort().flatMap(period => {
    const prior = values.get(previousMacroPeriod(period));
    // BEA publishes headline monthly changes to one decimal; match that
    // precision when reconstructing them from its rounded FRED index levels.
    return prior === undefined ? [] : [{ time: `${period}-01T00:00:00.000Z`, value: Number(((values.get(period)! / prior - 1) * 100).toFixed(1)) }];
  });
  const latest = history.at(-1);
  if (!latest) throw new Error('FRED PCE 缺少紧邻上月指数');
  return { id: 'us-pce-mom', label: '美国 PCE 月率', value: latest.value, display: `${latest.value.toFixed(2)}%`, change: null,
    updatedAt: latest.time, sourceUrl: 'https://fred.stlouisfed.org/series/PCEPI', source: 'FRED（原始来源 BEA）',
    status: 'delayed' as const, history: history.slice(-48) };
}
