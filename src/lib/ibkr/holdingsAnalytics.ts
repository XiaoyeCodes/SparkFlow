import type { AccountSnapshot, PortfolioPerformance } from './workbenchTypes';
import { chartSeries, finite, overviewAllocation } from './overview';

export const allocationColors = ['#68d9b6', '#70a8ed', '#c6a6ef', '#e4b969', '#69c7d0', '#ef9684', '#a6c978', '#b58ab8', '#88b8a9', '#cbab96', '#8394c9', '#d4cf8b'];
export type AllocationSlice = { label: string; value: number; color: string };
export type HoldingsRange = 30 | 90 | 0;
export const chartMoney = (value: number | null) => value === null ? '—' : value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const chartPercent = (value: number | null) => value === null ? '—' : `${value > 0 ? '+' : ''}${(value * 100).toFixed(2)}%`;

export function holdingsAllocation(snapshot: AccountSnapshot) {
  const allocation = overviewAllocation(snapshot);
  const total = finite(snapshot.metrics.netLiquidation);
  const invested = allocation.rows.reduce((sum, row) => sum + row.value, 0);
  const gross = allocation.rows.reduce((sum, row) => sum + Math.abs(row.value), 0);
  const short = allocation.rows.some(row => row.value < 0);
  const allSlices: AllocationSlice[] = allocation.rows.filter(row => row.value !== 0).map((row, index) => ({ label: `${row.holding.symbol}${row.value < 0 ? ' · 空头' : ''}`, value: Math.abs(row.value), color: allocationColors[index % allocationColors.length] }));
  const slices = allSlices.length > 12 ? [...allSlices.slice(0, 11), { label: `其他 ${allSlices.length - 11} 项`, value: allSlices.slice(11).reduce((sum, slice) => sum + slice.value, 0), color: allocationColors[11] }] : allSlices;
  const residual = total !== null && allocation.cash !== null && allocation.excluded === 0 ? total - invested - allocation.cash : null;
  // Never normalize negative balances or unconverted currencies into a positive asset pie.
  const canChartAssets = residual !== null && total! > 0 && !short && allocation.cash! >= 0 && residual >= -0.01;
  const assets: AllocationSlice[] = canChartAssets ? [
    { label: '持仓市值', value: invested, color: allocationColors[0] },
    { label: '现金余额', value: allocation.cash!, color: allocationColors[1] },
    ...(residual! > 0.01 ? [{ label: '其他净资产', value: residual!, color: allocationColors[3] }] : []),
  ].filter(slice => slice.value > 0) : [];
  const assetNote = allocation.excluded ? `${allocation.excluded} 项持仓缺少本币市值，资产构成暂不绘制。` : residual === null ? '缺少总资产或本币现金数据，暂无法计算构成。' : !canChartAssets ? '存在空头、负余额或未对齐的账面差额，暂不绘制构成饼图。' : residual > 0.01 ? '其他净资产为净值与持仓、现金的差额，具体项目待券商明细核对。' : '按本币账面值；分项合计与净值可能有分币舍入差异。';
  return { total, invested: allocation.excluded ? null : invested, cash: allocation.cash, gross, short, slices, assets, assetNote, excluded: allocation.excluded, currency: snapshot.baseCurrency || '—' };
}

export function holdingsReturnSeries(performance: PortfolioPerformance | undefined, range: HoldingsRange) {
  const method = performance?.returnMethod;
  const series = chartSeries(performance);
  const end = series[series.length - 1];
  const cutoff = end && range ? Date.parse(end.date) - range * 86400000 : -Infinity;
  const window = series.filter(point => Date.parse(point.date) >= cutoff);
  if (!method) {
    const visible = window.filter(point => point.nav !== null);
    const base = visible[0]?.nav;
    const points = base != null && base !== 0 ? visible.map(point => ({ date: point.date, nav: point.nav, value: point.nav === null ? null : point.nav / base - 1 })) : [];
    const count = points.length;
    return { points, count, start: points[0]?.date, end: points[points.length - 1]?.date, value: count >= 2 ? points[points.length - 1]?.value ?? null : null, method, kind: 'nav' as const,
      note: '本地账户净值变动（含出入金），用于观察资产轨迹，不代表投资收益率或盈亏金额。' };
  }
  const first = window.findIndex(point => point.cumulativeReturn !== null);
  const visible = first < 0 ? [] : window.slice(first);
  const base = visible[0]?.cumulativeReturn;
  const points = method === 'TWR' || method === 'MWR' ? visible.map(point => ({
    date: point.date,
    nav: point.nav,
    value: point.cumulativeReturn === null ? null : method === 'TWR' ? (1 + point.cumulativeReturn) / (1 + base!) - 1 : point.cumulativeReturn,
  })) : [];
  const count = points.filter(point => point.value !== null).length;
  return { points, count, start: points[0]?.date, end: points[points.length - 1]?.date, value: count >= 2 ? points[points.length - 1]?.value ?? null : null, method, kind: 'return' as const,
    note: method === 'TWR' ? '时间加权收益率 · 区间起点归零，剔除出入金影响；非盈亏金额。' : method === 'MWR' ? '资金加权收益率 · 原始累计口径，未按所选区间重算；非盈亏金额。' : '缺少已核实的收益率历史，暂不以资产净值变化代替盈亏。' };
}

export function returnGeometry(points: { date: string; value: number | null }[]) {
  const values = points.flatMap(point => point.value === null ? [] : [point.value]);
  const low = Math.min(0, ...values), high = Math.max(0, ...values);
  const pad = Math.max((high - low) * 0.15, 0.001);
  const min = low - pad, max = high + pad;
  const first = Date.parse(points[0]?.date || '1970-01-01'), last = Date.parse(points[points.length - 1]?.date || '1970-01-01');
  const y = (value: number) => 164 - (value - min) / (max - min) * 146;
  const coordinates = points.map(point => ({ ...point, x: 49 + (Date.parse(point.date) - first) / Math.max(86400000, last - first) * 331, y: point.value === null ? null : y(point.value) }));
  let connected = false;
  const path = coordinates.map(point => {
    if (point.y === null) { connected = false; return ''; }
    const command = connected ? 'L' : 'M'; connected = true;
    return `${command}${point.x.toFixed(2)},${point.y.toFixed(2)}`;
  }).join(' ');
  return { coordinates, path, zero: y(0), ticks: [max, (max + min) / 2, min].map(value => ({ value, y: y(value) })) };
}
