type Point = { time: string; value: number };

function monthShift(period: string, offset: number) {
  const [year, month] = period.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1 + offset, 1)).toISOString().slice(0, 7);
}

export function buildFredCpiRelease(adjusted: Point[], unadjusted: Point[], now = Date.now()) {
  const monthly = (points: Point[]) => {
    const values = new Map<string, number>();
    for (const point of points) {
      const time = Date.parse(point.time);
      if (!Number.isFinite(time) || time > now || !Number.isFinite(point.value) || point.value <= 0) continue;
      const period = new Date(time).toISOString().slice(0, 7);
      if (values.has(period) && values.get(period) !== point.value) throw new Error('CPI 同月指数冲突');
      values.set(period, point.value);
    }
    return values;
  };
  const sa = monthly(adjusted), nsa = monthly(unadjusted);
  const percent = (values: Map<string, number>, period: string, offset: number) => {
    const current = values.get(period), previous = values.get(monthShift(period, offset));
    return current === undefined || previous === undefined ? undefined : (current / previous - 1) * 100;
  };
  // Headline YoY uses NSA; headline MoM uses SA. Both must describe one month.
  const period = [...nsa.keys()].sort().reverse().find(month =>
    percent(nsa, month, -12) !== undefined && percent(sa, month, -1) !== undefined);
  if (!period) throw new Error('FRED CPI 缺少同一统计期的同比或环比基准');
  const history = [...nsa.keys()].sort().filter(month => month <= period).flatMap(month => {
    const value = percent(nsa, month, -12);
    return value === undefined ? [] : [{ time: `${month}-01T00:00:00.000Z`, value }];
  }).slice(-48);
  return {
    family: 'cpi' as const, period, storedAt: now,
    sourceUrl: 'https://fred.stlouisfed.org/series/CPIAUCNS',
    cpi: percent(sa, period, -1)!, cpiYoy: percent(nsa, period, -12)!,
    cpiPreviousYoy: percent(nsa, monthShift(period, -1), -12),
    cpiHistory: history,
    source: 'FRED（原始来源 BLS）',
    sourceUrls: ['https://fred.stlouisfed.org/series/CPIAUCNS', 'https://fred.stlouisfed.org/series/CPIAUCSL'],
    methodology: '同比按未季调 CPIAUCNS 与去年同月计算；环比按季调 CPIAUCSL 与上月计算；统计期取两者最新共同月份。',
  };
}

export async function preferOfficialMacroPrimary<T extends { period: string }>(
  primary: Promise<T>, fallback: Promise<T>, recentPrimary: () => T | undefined, budgetMs = 3000,
): Promise<T> {
  let official: T | undefined, backup: T | undefined, failure: unknown;
  const settled = Promise.allSettled([
    primary.then(value => { official = value; }, error => { failure = error; }),
    fallback.then(value => { backup = value; }, error => { failure ??= error; }),
  ]);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([settled, new Promise<void>(resolve => { timer = setTimeout(resolve, budgetMs); })]);
    // Choose the newest completed period; primary wins equal-period ties.
    const recent = recentPrimary();
    const primaryValue = !official || (recent && recent.period > official.period) ? recent : official;
    if (primaryValue && (!backup || primaryValue.period >= backup.period)) return primaryValue;
    if (backup) return backup;
    throw failure || new Error('主备来源均未在首屏预算内准备好');
  } finally { clearTimeout(timer); }
}

export const preferCpiPrimary = preferOfficialMacroPrimary;
