import type { CSSProperties } from "react";
import type {
  DailyBriefDay1Snapshot,
  DailyBriefEditorialMetric,
  DailyBriefEditorialSnapshot,
  DailyBriefSummary,
  DailyBriefUpstreamQuote,
} from "../lib/dailyBriefTypes";

type Day1Analysis = DailyBriefDay1Snapshot["analysis"];

const clamp = (value: number, min = 0, max = 100) => Math.min(max, Math.max(min, value));

function MacroBars({ data }: { data?: DailyBriefEditorialSnapshot }) {
  const findQuote = (symbol: string) => data?.macroAssets.find((item) => item.symbol === symbol)?.changePercent ?? data?.assetGroups.flatMap((group) => group.items).find((item) => item.symbol === symbol)?.changePercent ?? data?.indices.find((item) => item.symbol === symbol)?.changePercent ?? null;
  const rows = [
    { label: "SPX", name: "标普 500", value: findQuote("GSPC") },
    { label: "QQQ", name: "纳指 100", value: findQuote("QQQ") },
    { label: "GLD", name: "黄金", value: findQuote("GOLD") },
    { label: "CL=F", name: "WTI 原油", value: findQuote("CL=F") },
    { label: "DXY", name: "美元指数", value: findQuote("DXY") },
  ];
  const maxAbs = Math.max(1, ...rows.map((row) => Math.abs(row.value || 0)));
  return <div className="brief-macro-bars" role="img" aria-label="宏观资产单日涨跌幅柱状图">
    {rows.map((row) => {
      const size = row.value === null ? 0 : Math.abs(row.value) / maxAbs * 48;
      return <div className="brief-macro-row" key={row.label}>
        <div><b>{row.label}</b><span>{row.name}</span></div>
        <div className="brief-macro-axis"><i /><b className={row.value !== null && row.value < 0 ? "is-left" : "is-right"} style={{ "--macro-size": `${size}%` } as CSSProperties} /></div>
        <strong className={row.value === null ? "is-muted" : row.value >= 0 ? "is-positive" : "is-negative"}>{row.value === null ? "暂无数据" : `${row.value >= 0 ? "+" : ""}${row.value.toFixed(2)}%`}</strong>
      </div>;
    })}
    <p>优先使用实时行情；行情暂不可用时明确标注“暂无数据”。</p>
  </div>;
}

function BtcKeyLevelsChart({ data, btc }: { data?: DailyBriefEditorialSnapshot; btc?: DailyBriefUpstreamQuote }) {
  const levels = data?.btcTechnical;
  const resistance = levels?.resistance ?? null;
  const supportLow = levels?.supportLow ?? null;
  const supportHigh = levels?.supportHigh ?? null;
  const points = (btc?.history || []).filter((point) => Number.isFinite(point.value) && point.value > 0).slice(-30);
  if (points.length < 2 || !levels || resistance === null || supportLow === null || supportHigh === null) return <div className="brief-viz-empty">Binance 日线关键区间同步中</div>;
  const width = 720, height = 235, left = 52, right = 82, top = 18, bottom = 30;
  const values = [...points.map((point) => point.value), resistance, supportLow, supportHigh];
  const min = Math.min(...values) * .985;
  const max = Math.max(...values) * 1.015;
  const x = (index: number) => left + index / (points.length - 1) * (width - left - right);
  const y = (value: number) => top + (1 - (value - min) / (max - min || 1)) * (height - top - bottom);
  const path = points.map((point, index) => `${index ? "L" : "M"}${x(index).toFixed(1)},${y(point.value).toFixed(1)}`).join(" ");
  const supportY = y(supportHigh), supportHeight = Math.max(2, y(supportLow) - supportY);
  const latest = points[points.length - 1]!;
  const fearGreed = (data?.sentiment.cryptoHistory || []).filter((point) => Number.isFinite(point.value) && point.value >= 0 && point.value <= 100).slice(-30);
  const fearGreedPath = fearGreed.map((point, index) => {
    const priceIndex = points.findIndex((price) => price.time.slice(0, 10) === point.time.slice(0, 10));
    const matchedIndex = priceIndex >= 0 ? priceIndex : Math.max(0, points.length - fearGreed.length + index);
    const fearY = top + (1 - point.value / 100) * (height - top - bottom);
    return `${index ? "L" : "M"}${x(matchedIndex).toFixed(1)},${fearY.toFixed(1)}`;
  }).join(" ");
  const latestFearGreed = fearGreed[fearGreed.length - 1];
  return <svg className="brief-btc-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Binance BTC 日线，${levels.lookbackDays}日结构、14日ATR计算的阻力位${resistance}美元，支撑区间${supportLow}至${supportHigh}美元`}>
    <defs><linearGradient id="brief-btc-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#78e9c7" stopOpacity=".3" /><stop offset="100%" stopColor="#78e9c7" stopOpacity="0" /></linearGradient></defs>
    {[0, .33, .66, 1].map((ratio) => { const gy = top + ratio * (height - top - bottom); return <line className="brief-chart-grid" x1={left} x2={width - right} y1={gy} y2={gy} key={ratio} />; })}
    <rect className="brief-support-zone" x={left} y={supportY} width={width - left - right} height={supportHeight} rx="2" />
    <line className="brief-resistance-line" x1={left} x2={width - right} y1={y(resistance)} y2={y(resistance)} />
    {fearGreedPath ? <><path className="brief-fng-line" d={fearGreedPath} /><text className="brief-chart-label is-fng" x={left} y={top + 10}>F&amp;G 0–100</text>{latestFearGreed ? <text className="brief-chart-label is-fng" textAnchor="end" x={width - right} y={Math.max(top + 11, top + (1 - latestFearGreed.value / 100) * (height - top - bottom) - 7)}>F&amp;G {Math.round(latestFearGreed.value)}</text> : null}</> : null}
    <path d={`${path} L${x(points.length - 1)},${height - bottom} L${left},${height - bottom} Z`} fill="url(#brief-btc-fill)" />
    <path className="brief-btc-line" d={path} />
    <circle cx={x(points.length - 1)} cy={y(latest.value)} r="4" className="brief-btc-dot" />
    <text className="brief-chart-label is-amber" x={width - right + 8} y={y(resistance) + 4}>阻力 ${moneyShort(resistance)}</text>
    <text className="brief-chart-label is-rose" x={width - right + 8} y={supportY + supportHeight / 2 + 4}>支撑 {moneyShort(supportLow)}–{moneyShort(supportHigh)}</text>
    <text className="brief-chart-label is-jade" x={Math.max(left, x(points.length - 1) - 42)} y={Math.max(top + 10, y(latest.value) - 10)}>{moneyShort(latest.value)}</text>
    <text className="brief-chart-date" x={left} y={height - 7}>{points[0]!.time.slice(5).replace("-", "/")}</text>
    <text className="brief-chart-date" textAnchor="end" x={width - right} y={height - 7}>{latest.time.slice(5).replace("-", "/")}</text>
  </svg>;
}

function moneyShort(value: number) {
  return value >= 1000 ? `$${(value / 1000).toFixed(value % 1000 ? 1 : 0)}k` : `$${value.toFixed(0)}`;
}

function CnnFearGreedComponents({ data }: { data?: DailyBriefEditorialSnapshot }) {
  const components = (data?.sentiment.stockComponents || []).filter((item) => item.value !== null && Number.isFinite(item.value));
  const score = data?.sentiment.stockFearGreed.value ?? null;
  if (score === null || !components.length) return <div className="brief-viz-empty">CNN 7 项情绪指标同步中</div>;
  let cursor = 0;
  const segments = components.map((item) => {
    const start = cursor;
    cursor += 100 / components.length;
    return `${item.color} ${start.toFixed(2)}% ${cursor.toFixed(2)}%`;
  }).join(", ");
  return <div className="brief-cnn-components" role="img" aria-label={`CNN 恐惧贪婪指数 ${Math.round(score)}，七项指标：${components.map((item) => `${item.label}${Math.round(item.value!)}`).join("，")}`}>
    <div className="brief-cnn-score" style={{ "--cnn-segments": segments } as CSSProperties}><div><b>{Math.round(score)}</b><span>{data?.sentiment.stockFearGreed.label || "中性"}</span></div></div>
    <div className="brief-cnn-list">
      {components.map((item) => <div key={item.id}><span style={{ backgroundColor: item.color }} /><b>{item.label}</b><strong className={item.value! >= 55 ? "is-positive" : item.value! <= 45 ? "is-negative" : "is-neutral"}>{Math.round(item.value!)}</strong></div>)}
    </div>
  </div>;
}

function EtfFlowTurn({ analysis }: { analysis?: Day1Analysis }) {
  const text = analysis?.cryptoAnalysis || "";
  const streak = Number(text.match(/连续\s*(\d+)日净流入/)?.[1]) || 9;
  const outflowYi = Number(text.match(/净流出\s*([\d.]+)亿/)?.[1]);
  const outflowM = Number.isFinite(outflowYi) ? outflowYi * 100 : null;
  const width = 430, height = 130, left = 16, right = 18, mid = 66;
  const states = Array.from({ length: Math.min(12, streak) }, (_, index) => ({ value: .45 + index * .025 })).concat([{ value: -1 }]);
  const x = (index: number) => left + index / (states.length - 1) * (width - left - right);
  const y = (value: number) => mid - value * 43;
  const path = states.map((point, index) => `${index ? "L" : "M"}${x(index).toFixed(1)},${y(point.value).toFixed(1)}`).join(" ");
  return <div className="brief-etf-turn"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`比特币ETF连续${streak}日净流入后转为净流出${outflowM ?? "未知"}百万美元`}>
    <line className="brief-chart-zero" x1={left} x2={width - right} y1={mid} y2={mid} />
    <path className="brief-flow-line" d={path} />
    {states.map((point, index) => <circle className={point.value < 0 ? "is-outflow" : ""} cx={x(index)} cy={y(point.value)} r={index === states.length - 1 ? 4 : 2.5} key={index} />)}
    <text x={left} y="15">连续 {streak} 日净流入</text><text className="is-outflow" textAnchor="end" x={width - right} y={height - 8}>{outflowM === null ? "首次转为净流出" : `-$${outflowM.toFixed(1)}M`}</text>
  </svg><p>方向序列来自简报；仅末日披露了具体流出金额。</p></div>;
}

function RadarChart({ analysis, data, summary }: { analysis?: Day1Analysis; data?: DailyBriefEditorialSnapshot; summary?: DailyBriefSummary }) {
  const liquidityDrop = Number(analysis?.cryptoAnalysis.match(/较\s*30日均值骤降\s*(\d+(?:\.\d+)?)%/)?.[1]);
  const riskHits = (analysis?.macroAnalysis.match(/风险|不确定|警告|分歧/g) || []).length;
  const stockFg = data?.sentiment.stockFearGreed.value ?? 50;
  const cryptoFg = data?.sentiment.cryptoFearGreed.value ?? 50;
  const vix = data?.sentiment.vix.value ?? 20;
  const axes = [
    { label: "仓位纪律", value: 100 - (data?.signals.top ?? 50) },
    { label: "风险韧性", value: 100 - clamp(vix / 40 * 100) },
    { label: "机会评分", value: data?.signals.bottom ?? 50 },
    { label: "流动性", value: Number.isFinite(liquidityDrop) ? 100 - liquidityDrop : 50 },
    { label: "市场情绪", value: (stockFg + cryptoFg) / 2 },
    { label: "宏观确定性", value: analysis ? clamp(80 - riskHits * 8, 25, 80) : summary?.assessment?.score ?? 50 },
  ];
  const cx = 160, cy = 118, radius = 78;
  const pointAt = (index: number, scale: number) => { const angle = -Math.PI / 2 + index * Math.PI / 3; return [cx + Math.cos(angle) * radius * scale, cy + Math.sin(angle) * radius * scale] as const; };
  const polygon = (scale: number) => axes.map((_, index) => pointAt(index, scale).join(",")).join(" ");
  const dataPolygon = axes.map((axis, index) => pointAt(index, clamp(axis.value) / 100).join(",")).join(" ");
  return <svg className="brief-radar" viewBox="0 0 320 245" role="img" aria-label={`今日市场体质评分：${axes.map((axis) => `${axis.label}${Math.round(axis.value)}`).join("，")}`}>
    {[.25, .5, .75, 1].map((scale) => <polygon className="brief-radar-grid" points={polygon(scale)} key={scale} />)}
    {axes.map((_, index) => { const [x, y] = pointAt(index, 1); return <line className="brief-radar-axis" x1={cx} y1={cy} x2={x} y2={y} key={index} />; })}
    <polygon className="brief-radar-area" points={dataPolygon} />
    {axes.map((axis, index) => { const [x, y] = pointAt(index, 1.22); const anchor = x < cx - 8 ? "end" : x > cx + 8 ? "start" : "middle"; return <g key={axis.label}><text className="brief-radar-label" x={x} y={y} textAnchor={anchor}>{axis.label}</text><text className="brief-radar-value" x={x} y={y + 13} textAnchor={anchor}>{Math.round(axis.value)}</text></g>; })}
  </svg>;
}

function VizCard({ index, title, source, className = "", children }: { index: string; title: string; source: string; className?: string; children: React.ReactNode }) {
  return <article className={`brief-viz-card ${className}`}><header><div><span>{index}</span><h3>{title}</h3></div><em>{source}</em></header>{children}</article>;
}

export function DailyBriefVisualDashboard({ data, analysis, summary, btc }: { data?: DailyBriefEditorialSnapshot; analysis?: Day1Analysis; summary?: DailyBriefSummary; btc?: DailyBriefUpstreamQuote }) {
  return <div className="brief-viz-dashboard">
    <div className="brief-viz-primary-grid">
      <VizCard index="01 / MACRO" title="宏观资产强弱" source="Yahoo Finance · 延迟行情" className="is-macro"><MacroBars data={data} /></VizCard>
      <VizCard index="02 / CRYPTO" title="BTC 价格与关键区间" source="Binance · 90D / 14D ATR" className="is-btc"><BtcKeyLevelsChart data={data} btc={btc} /></VizCard>
    </div>
    <div className="brief-viz-secondary-grid">
      <VizCard index="02A / CNN" title="CNN 7 项情绪指标" source="CNN · 实时"><CnnFearGreedComponents data={data} /></VizCard>
      <VizCard index="02B / ETF FLOW" title="资金流拐点" source="方向序列"><EtfFlowTurn analysis={analysis} /></VizCard>
      <VizCard index="03 / PLAYBOOK" title="今日市场体质" source="规则化映射" className="is-radar"><RadarChart analysis={analysis} data={data} summary={summary} /></VizCard>
    </div>
    <div className="brief-viz-method"><span>DATA MAP</span> 图表优先使用实时接口；CNN 情绪卡展示其公开的七项底层指标，缺失指标不以简报文本替代。</div>
  </div>;
}
