import type {
  ValuationContribution, ValuationCoverage, ValuationDashboard, ValuationInputs,
  ValuationLookback, ValuationMetric, ValuationMetricId, ValuationPoint,
  ValuationRules, ValuationSeries, ValuationSeriesId, ValuationSnapshot,
} from '../src/lib/ibkr/valuationTypes.ts';

const DAY = 86_400_000;
const YEAR = 365.2425 * DAY;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const INDEX_IDS = new Set(['spx', 'ndx', 'vix']);
const MAX_AGE: Record<ValuationSeriesId | 'erp', number> = {
  spx: 7, ndx: 7, vix: 7, pe: 45, forwardYield: 45, treasury10y: 7, fearGreed: 7, erp: 7,
};
const LABELS: Record<ValuationMetricId, string> = {
  vix: 'VIX 恐慌指数', spx: '标普 500 · 趋势偏离', ndx: '纳斯达克 100 · 趋势偏离',
  pe: '标普 500 TTM 市盈率', forwardYield: '前瞻盈利收益率', erp: '股权风险溢价（ERP）',
};

export const VALUATION_RULES: ValuationRules = {
  version: 'valuation-v1.1.0',
  formula: '买点评分 = 17.5%×(100−标普偏离分位) + 17.5%×(100−纳指偏离分位) + 35%×(100−TTM市盈率分位) + 15%×clamp((ERP+2)/6×100,0,100) + 7.5%×VIX偏离分位 + 7.5%×(100−CNN恐惧贪婪指数)',
  weights: { spx: 17.5, ndx: 17.5, pe: 35, erp: 15, vix: 7.5, fearGreed: 7.5 },
  methodology: [
    '所有日期以 UTC 处理；窗口起点为快照时间减去 1 / 3 / 5 / 10 个日历年。快照之后的数据和指标自身时间戳之后的数据不参与计算。',
    '标普、纳指和 VIX 使用窗口内历史价格的自然对数，按实际经过的日数做普通最小二乘回归；偏离 = (当前价 / 当日拟合趋势价 − 1) × 100%。',
    '分位 = 100 × (小于当前值的历史样本数 + 0.5 × 等于当前值的历史样本数) / 历史样本数。趋势指标比较各日自身拟合趋势的偏离；浮点差异在 1e−9 相对容差内视为相等。',
    '指数要求历史起点距窗口起点不超过 7 天、年均最少 150 条记录、连续缺口不超过 14 天。估值及 ERP 起点允许 45 天、年均至少 6 条且总计至少 8 条记录、连续缺口不超过 75 天。历史末端须满足各指标的新鲜度要求；不足完整窗口时分位和对应得分均留空。',
    '实时/延迟/冻结/收盘/快照均保留源状态。指数、CNN 和十年美债超过 7 天失效；TTM 市盈率与前瞻盈利收益率超过 45 天失效；明确标为过期或缺失的数据不计分。',
    'ERP 为标普 500 前瞻盈利收益率减十年期美债收益率，单位为百分点。历史按日期合并，仅向前沿用当时已知的前瞻数据最多 45 天、美债数据最多 7 天；不从未来回填。月度基本面的历史日期必须是该值可获知的日期，历史修订仍可能影响回溯。',
    'TTM 市盈率采用自身水平分位；前瞻盈利收益率显示自身水平分位但不单独加权，避免与 ERP 重复计分。CNN 使用最新 0–100 快照的反向值，不将快照伪装为历史分位。',
    'ERP 子分 = clamp((ERP + 2) / 6 × 100, 0, 100)，ERP 单位为百分点。−2% → 0 分，0% → 33.33 分，+2% → 66.67 分，+4% → 100 分；两端截断。该固定参考刻度是公开的规则选择，并非经验分位、获利概率或经过回测验证的参数。ERP 历史分位不足时仍留空，规则位置独立标注。',
    '固定权重合计 100%。任一计分所需的当前值缺失或过期时总分为空；趋势和 TTM 分位另要求完整历史，ERP 固定参考子分仅要求其两个当前分量有效。缺失时不重分配权重；覆盖率只表示有效权重占比。显示总分在最终一步四舍五入至一位小数。',
    '评分 ≥75 该贪婪；55–<75 偏向贪婪；45–<55 保持中性；25–<45 偏向恐惧；<25 该恐惧。判断使用未四舍五入的总分，高分代表按本规则衡量的相对买点更好。',
    '图中的趋势线在整个所选窗口重新拟合，用于描述当前相对位置；并非逐日可交易回测、收益预测或已验证的择时策略。',
  ],
};

function millis(date: string | null): number {
  if (!date) return NaN;
  if (DATE_ONLY.test(date)) {
    const time = Date.parse(`${date}T00:00:00.000Z`);
    return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === date ? time : NaN;
  }
  return Date.parse(date);
}
function isoDay(time: number): string { return new Date(time).toISOString().slice(0, 10); }
function finite(value: number | null): value is number { return typeof value === 'number' && Number.isFinite(value); }
function validLevel(id: ValuationSeriesId | 'erp', value: number | null): value is number {
  if (!finite(value)) return false;
  if (INDEX_IDS.has(id) || id === 'pe' || id === 'forwardYield') return value > 0;
  return id === 'fearGreed' ? value >= 0 && value <= 100 : true;
}

/** Sort, deduplicate by UTC day, discard invalid/future observations; never mutate inputs. */
export function normalizeValuationPoints(points: ValuationPoint[], cutoff: string, id: ValuationSeriesId | 'erp'): ValuationPoint[] {
  const end = millis(cutoff);
  const byDay = new Map<string, { time: number; value: number }>();
  for (const point of points) {
    const time = millis(point.date);
    if (!Number.isFinite(time) || time > end || !validLevel(id, point.value)) continue;
    const day = isoDay(time);
    const previous = byDay.get(day);
    if (!previous || time >= previous.time) byDay.set(day, { time, value: point.value });
  }
  return [...byDay].sort(([a], [b]) => a.localeCompare(b)).map(([date, { value }]) => ({ date, value }));
}

/** Midrank empirical CDF; an all-equal history has percentile 50. */
export function empiricalPercentile(history: number[], current: number): number | null {
  const samples = history.filter(Number.isFinite);
  if (!samples.length || !Number.isFinite(current)) return null;
  let smaller = 0;
  let equal = 0;
  for (const value of samples) {
    const tolerance = 1e-9 * Math.max(1, Math.abs(value), Math.abs(current));
    if (Math.abs(value - current) <= tolerance) equal++;
    else if (value < current) smaller++;
  }
  return 100 * (smaller + 0.5 * equal) / samples.length;
}

/** A log-linear OLS fit with centered time; it describes this window, not a backtest. */
export function fitLogTrend(points: ValuationPoint[]): { at: (date: string) => number; points: { date: string; value: number; trend: number }[] } | null {
  if (points.length < 2 || points.some(point => !Number.isFinite(millis(point.date)) || !finite(point.value) || point.value <= 0)) return null;
  const origin = millis(points[0].date);
  const xs = points.map(point => (millis(point.date) - origin) / YEAR);
  const ys = points.map(point => Math.log(point.value));
  const meanX = xs.reduce((sum, x) => sum + x, 0) / xs.length;
  const meanY = ys.reduce((sum, y) => sum + y, 0) / ys.length;
  const variance = xs.reduce((sum, x) => sum + (x - meanX) ** 2, 0);
  if (variance === 0) return null;
  const slope = xs.reduce((sum, x, index) => sum + (x - meanX) * (ys[index] - meanY), 0) / variance;
  const at = (date: string) => Math.exp(meanY + slope * ((millis(date) - origin) / YEAR - meanX));
  return { at, points: points.map(point => ({ ...point, trend: at(point.date) })) };
}

function freshness(series: ValuationSeries, id: ValuationSeriesId | 'erp', now: number): string | null {
  if (series.status === 'missing') return '数据缺失';
  if (series.status === 'stale') return '数据已过期';
  if (!validLevel(id, series.current)) return '当前值缺失或无效';
  const asOf = millis(series.asOf);
  if (!Number.isFinite(asOf)) return '缺少有效数据时间';
  if (asOf > now) return '数据时间晚于快照时间';
  if (now - asOf > MAX_AGE[id] * DAY) return `数据距快照超过 ${MAX_AGE[id]} 天`;
  return null;
}

function windowStart(now: number, years: ValuationLookback): number {
  const end = new Date(now);
  const year = end.getUTCFullYear() - years;
  const month = end.getUTCMonth();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return Date.UTC(year, month, Math.min(end.getUTCDate(), lastDay));
}

function assessCoverage(points: ValuationPoint[], start: number, end: number, years: ValuationLookback, id: ValuationSeriesId | 'erp'): ValuationCoverage {
  const daily = INDEX_IDS.has(id);
  const allowedStartGap = daily ? 7 : 45;
  const maxInteriorGap = daily ? 14 : 75;
  const minSamples = daily ? 150 * years : Math.max(8, 6 * years);
  let reason: string | null = null;
  if (!points.length) reason = '无可用历史';
  else if (millis(points[0].date) - start > allowedStartGap * DAY) reason = `历史不足完整 ${years} 年`;
  else if (end - millis(points[points.length - 1].date) > MAX_AGE[id] * DAY) reason = '历史末端已过期';
  else if (points.length < minSamples) reason = `历史样本不足（${points.length} / 最少 ${minSamples}）`;
  else if (points.some((point, index) => index > 0 && millis(point.date) - millis(points[index - 1].date) > maxInteriorGap * DAY)) reason = `历史存在超过 ${maxInteriorGap} 天的缺口`;
  return { complete: reason === null, start: points[0]?.date ?? null, end: points[points.length - 1]?.date ?? null, samples: points.length, requiredStart: isoDay(start), reason };
}

/** ERP observations use the latest already-known inputs and bounded carry-forward. */
export function joinErpHistory(forward: ValuationPoint[], treasury: ValuationPoint[], cutoff: string): ValuationPoint[] {
  const f = normalizeValuationPoints(forward, cutoff, 'forwardYield');
  const t = normalizeValuationPoints(treasury, cutoff, 'treasury10y');
  const days = [...new Set([...f, ...t].map(point => point.date))].sort();
  let fi = -1;
  let ti = -1;
  const joined: ValuationPoint[] = [];
  for (const date of days) {
    while (fi + 1 < f.length && f[fi + 1].date <= date) fi++;
    while (ti + 1 < t.length && t[ti + 1].date <= date) ti++;
    if (fi < 0 || ti < 0) continue;
    const time = millis(date);
    if (time - millis(f[fi].date) > 45 * DAY || time - millis(t[ti].date) > 7 * DAY) continue;
    joined.push({ date, value: f[fi].value - t[ti].value });
  }
  return joined;
}

function erpSeries(inputs: ValuationInputs, now: number): ValuationSeries {
  const forward = inputs.series.forwardYield;
  const treasury = inputs.series.treasury10y;
  const forwardReason = freshness(forward, 'forwardYield', now);
  const treasuryReason = freshness(treasury, 'treasury10y', now);
  const reason = forwardReason ? `前瞻盈利收益率${forwardReason}` : treasuryReason ? `十年美债收益率${treasuryReason}` : null;
  const forwardAt = millis(forward.asOf);
  const treasuryAt = millis(treasury.asOf);
  const latest = Math.max(forwardAt, treasuryAt);
  const lagReason = !reason && (latest - forwardAt > 45 * DAY || latest - treasuryAt > 7 * DAY) ? '两项输入时间差超出允许范围' : null;
  const failure = reason ?? lagReason;
  const cutoff = Number.isFinite(latest) && latest <= now ? new Date(latest).toISOString() : inputs.fetchedAt;
  return {
    points: joinErpHistory(
      normalizeValuationPoints(forward.points, Number.isFinite(forwardAt) ? new Date(Math.min(forwardAt, now)).toISOString() : inputs.fetchedAt, 'forwardYield'),
      normalizeValuationPoints(treasury.points, Number.isFinite(treasuryAt) ? new Date(Math.min(treasuryAt, now)).toISOString() : inputs.fetchedAt, 'treasury10y'),
      cutoff,
    ),
    current: !failure && finite(forward.current) && finite(treasury.current) ? forward.current - treasury.current : null,
    asOf: !failure ? cutoff : null,
    source: `${forward.source} − ${treasury.source}`,
    sourceUrl: forward.sourceUrl,
    status: failure ? (forward.status === 'stale' || treasury.status === 'stale' ? 'stale' : 'missing') : 'snapshot',
    note: failure ?? `前瞻盈利收益率（${forward.asOf}）减十年美债收益率（${treasury.asOf}），单位为百分点；历史仅向前沿用已知值。`,
  };
}

function metric(series: ValuationSeries, id: ValuationMetricId, now: number, start: number, years: ValuationLookback): ValuationMetric {
  const freshReason = freshness(series, id, now);
  const asOf = millis(series.asOf);
  const cutoff = Number.isFinite(asOf) && asOf <= now ? Math.min(asOf, now) : now;
  const points = normalizeValuationPoints(series.points, new Date(cutoff).toISOString(), id).filter(point => millis(point.date) >= start);
  const coverage = assessCoverage(points, start, now, years, id);
  const fit = INDEX_IDS.has(id) ? fitLogTrend(points) : null;
  const current = validLevel(id, series.current) ? series.current : null;
  const trendValue = fit && current !== null && Number.isFinite(asOf) && asOf <= now ? fit.at(series.asOf!) : null;
  const deviationPercent = trendValue !== null && current !== null ? (current / trendValue - 1) * 100 : null;
  const eligible = !freshReason && coverage.complete && (!INDEX_IDS.has(id) || deviationPercent !== null);
  const percentile = eligible && current !== null ? fit && deviationPercent !== null
    ? empiricalPercentile(fit.points.map(point => (point.value / point.trend - 1) * 100), deviationPercent)
    : empiricalPercentile(points.map(point => point.value), current) : null;
  const note = [series.note, freshReason, coverage.reason].filter(Boolean).join('；');
  return {
    id, label: LABELS[id], current, unit: INDEX_IDS.has(id) ? 'index' : id === 'pe' ? 'times' : 'percent',
    percentile, deviationPercent, trendValue, asOf: series.asOf, source: series.source,
    sourceUrl: series.sourceUrl, status: freshReason ? series.status === 'missing' ? 'missing' : 'stale' : series.status,
    note, coverage, eligible,
  };
}

function snapshot(series: ValuationSeries, id: ValuationSeriesId, now: number): ValuationSnapshot {
  const reason = freshness(series, id, now);
  return { current: validLevel(id, series.current) ? series.current : null, asOf: series.asOf,
    status: reason ? series.status === 'missing' ? 'missing' : 'stale' : series.status,
    source: series.source, sourceUrl: series.sourceUrl, note: [series.note, reason].filter(Boolean).join('；'), eligible: !reason };
}

/** Explicit fixed reference scale in percentage points, not an empirical percentile. */
export function erpReferenceScore(erp: number | null): number | null {
  return finite(erp) ? Math.max(0, Math.min(100, (erp + 2) / 6 * 100)) : null;
}

export function computeValuationDashboard(inputs: ValuationInputs, lookbackYears: ValuationLookback): ValuationDashboard {
  if (![1, 3, 5, 10].includes(lookbackYears)) throw new Error('VALUATION_LOOKBACK_INVALID');
  const now = millis(inputs.fetchedAt);
  if (!Number.isFinite(now)) throw new Error('VALUATION_FETCHED_AT_INVALID');
  const start = windowStart(now, lookbackYears);
  const erp = erpSeries(inputs, now);
  const ids: ValuationMetricId[] = ['vix', 'spx', 'ndx', 'pe', 'forwardYield', 'erp'];
  const metrics = ids.map(id => metric(id === 'erp' ? erp : inputs.series[id], id, now, start, lookbackYears));
  const byId = Object.fromEntries(metrics.map(item => [item.id, item])) as Record<ValuationMetricId, ValuationMetric>;
  const sentiment = snapshot(inputs.series.fearGreed, 'fearGreed', now);
  const treasury = snapshot(inputs.series.treasury10y, 'treasury10y', now);
  const contributions: ValuationContribution[] = (['spx', 'ndx', 'pe', 'erp', 'vix', 'fearGreed'] as const).map(id => {
    const selected = id === 'fearGreed' ? null : byId[id];
    const eligible = id === 'fearGreed' ? sentiment.eligible : id === 'erp' ? !freshness(erp, 'erp', now) : selected!.eligible;
    const raw = id === 'fearGreed' ? sentiment.current : id === 'erp' ? erpReferenceScore(erp.current) : selected!.percentile;
    const signal = eligible && raw !== null ? id === 'erp' || id === 'vix' ? raw : 100 - raw : null;
    const weight = VALUATION_RULES.weights[id];
    return { id, label: id === 'fearGreed' ? 'CNN 恐惧贪婪指数' : LABELS[id], weight, signal,
      points: signal === null ? null : signal * weight / 100,
      reason: signal !== null ? id === 'erp' ? '固定参考子分 clamp((ERP + 2) / 6 × 100, 0, 100)，非历史分位' : null : id === 'fearGreed' ? sentiment.note || 'CNN 快照不可用' : selected!.note || '分位不可用' };
  });
  const coverageWeight = contributions.reduce((sum, row) => sum + (row.points === null ? 0 : row.weight), 0);
  const missing = contributions.filter(row => row.points === null).map(row => `${row.label}：${row.reason}`);
  const rawScore = missing.length ? null : contributions.reduce((sum, row) => sum + row.points!, 0);
  const value = rawScore === null ? null : Math.round(rawScore * 10) / 10;
  const label = rawScore === null ? '等待完整数据' : rawScore >= 75 ? '该贪婪' : rawScore >= 55 ? '偏向贪婪' : rawScore >= 45 ? '保持中性' : rawScore >= 25 ? '偏向恐惧' : '该恐惧';
  const conclusion = rawScore === null ? `有效指标覆盖 ${coverageWeight}% 权重，数据尚不完整，暂不判断当前该贪婪还是该恐惧。`
    : rawScore >= 75 ? '当前该贪婪：按固定规则，相对估值与情绪提供较高的买点吸引力，适合审慎分批评估。'
    : rawScore >= 55 ? '当前偏向贪婪：相对买点略占优，可结合自身仓位分批评估。'
    : rawScore >= 45 ? '当前保持中性：估值、趋势与情绪尚未形成明确的买点优势。'
    : rawScore >= 25 ? '当前偏向恐惧：买点吸引力偏低，应降低追涨冲动并关注风险。'
    : '当前该恐惧：按固定规则，估值与情绪的安全边际偏低，宜控制风险。';
  const charts = Object.fromEntries((['spx', 'ndx', 'vix'] as const).map(id => {
    const series = inputs.series[id];
    const asOf = millis(series.asOf);
    const chartCutoff = Number.isFinite(asOf) && asOf <= now ? asOf : now;
    const chartPoints = normalizeValuationPoints(series.points, new Date(chartCutoff).toISOString(), id).filter(point => millis(point.date) >= start);
    const chartFit = fitLogTrend(chartPoints);
    const name = id === 'spx' ? '标普 500' : id === 'ndx' ? '纳斯达克 100' : 'VIX';
    return [id, { label: `${name} 与 ${lookbackYears} 年趋势线`, points: chartFit?.points ?? [],
      note: `对所选窗口重新拟合的描述性趋势，并非历史回测。${byId[id].coverage.complete ? '' : `历史覆盖不足：${byId[id].coverage.reason}。`}` }];
  })) as ValuationDashboard['charts'];
  const rules = structuredClone(VALUATION_RULES);
  return {
    fetchedAt: inputs.fetchedAt, lookbackYears, window: { start: isoDay(start), end: isoDay(now) }, metrics,
    score: { value, label, conclusion, contributions, coverageWeight, missing },
    chart: charts.spx, charts,
    sentiment, treasury, rules,
    audit: { inputs: structuredClone(inputs), lookbackYears, rules: structuredClone(rules), contributions: structuredClone(contributions) },
  };
}
