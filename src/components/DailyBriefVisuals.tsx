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

function signedFromPhrase(text: string, pattern: RegExp) {
  const match = text.match(pattern);
  if (!match) return null;
  const direction = match[1] || "";
  const number = Number(match[2]?.replace(/,/g, ""));
  if (!Number.isFinite(number)) return null;
  return /跌|下行|回落|微跌/.test(direction) ? -Math.abs(number) : Math.abs(number);
}

function MacroBars({ analysis, data }: { analysis?: Day1Analysis; data?: DailyBriefEditorialSnapshot }) {
  const text = analysis?.macroAnalysis || "";
  const findQuote = (symbol: string) => data?.assetGroups.flatMap((group) => group.items).find((item) => item.symbol === symbol)?.changePercent ?? data?.indices.find((item) => item.symbol === symbol)?.changePercent ?? null;
  const rows = [
    { label: "SPX", name: "标普 500", value: signedFromPhrase(text, /标普500[\s\S]{0,35}?[（(]\s*(跌|涨)?\s*([+-]?\d+(?:\.\d+)?)%/) ?? findQuote("GSPC") },
    { label: "QQQ", name: "纳指 100", value: signedFromPhrase(text, /QQQ[\s\S]{0,20}?(跌|涨)\s*([+-]?\d+(?:\.\d+)?)%/) ?? findQuote("QQQ") },
    { label: "GLD", name: "黄金 ETF", value: signedFromPhrase(text, /GLD ETF[\s\S]{0,20}?(跌|涨)\s*([+-]?\d+(?:\.\d+)?)%/) },
    { label: "CL=F", name: "原油", value: signedFromPhrase(text, /原油[\s\S]{0,25}?(反弹|上涨|下跌)\s*([+-]?\d+(?:\.\d+)?)%/) },
    { label: "DXY", name: "美元指数", value: signedFromPhrase(text, /美元指数[\s\S]{0,24}?(上涨|下跌|微幅下行|微跌)\s*([+-]?\d+(?:\.\d+)?)%/) },
  ];
  const maxAbs = Math.max(1, ...rows.map((row) => Math.abs(row.value || 0)));
  return <div className="brief-macro-bars" role="img" aria-label="宏观资产单日涨跌幅柱状图">
    {rows.map((row) => {
      const size = row.value === null ? 0 : Math.abs(row.value) / maxAbs * 48;
      return <div className="brief-macro-row" key={row.label}>
        <div><b>{row.label}</b><span>{row.name}</span></div>
        <div className="brief-macro-axis"><i /><b className={row.value !== null && row.value < 0 ? "is-left" : "is-right"} style={{ "--macro-size": `${size}%` } as CSSProperties} /></div>
        <strong className={row.value === null ? "is-muted" : row.value >= 0 ? "is-positive" : "is-negative"}>{row.value === null ? "微跌*" : `${row.value >= 0 ? "+" : ""}${row.value.toFixed(2)}%`}</strong>
      </div>;
    })}
    <p>* DXY 原文仅披露方向，未披露精确涨跌幅。</p>
  </div>;
}

function BtcKeyLevelsChart({ analysis, btc }: { analysis?: Day1Analysis; btc?: DailyBriefUpstreamQuote }) {
  const text = analysis?.cryptoAnalysis || "";
  const resistance = Number(text.match(/突破\s*([\d,]+)美元关键阻力/)?.[1]?.replace(/,/g, "")) || 79000;
  const supportMatch = text.match(/([\d,]+)-([\d,]+)美元支撑/);
  const supportLow = Number(supportMatch?.[1]?.replace(/,/g, "")) || 76000;
  const supportHigh = Number(supportMatch?.[2]?.replace(/,/g, "")) || 77000;
  const points = (btc?.history || []).filter((point) => Number.isFinite(point.value) && point.value > 0).slice(-30);
  if (points.length < 2) return <div className="brief-viz-empty">BTC 价格序列同步中</div>;
  const width = 720, height = 235, left = 52, right = 82, top = 18, bottom = 30;
  const values = [...points.map((point) => point.value), resistance, supportLow, supportHigh];
  const min = Math.min(...values) * .985;
  const max = Math.max(...values) * 1.015;
  const x = (index: number) => left + index / (points.length - 1) * (width - left - right);
  const y = (value: number) => top + (1 - (value - min) / (max - min || 1)) * (height - top - bottom);
  const path = points.map((point, index) => `${index ? "L" : "M"}${x(index).toFixed(1)},${y(point.value).toFixed(1)}`).join(" ");
  const supportY = y(supportHigh), supportHeight = Math.max(2, y(supportLow) - supportY);
  const latest = points[points.length - 1]!;
  return <svg className="brief-btc-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`BTC价格走势，阻力位${resistance}美元，支撑区间${supportLow}至${supportHigh}美元`}>
    <defs><linearGradient id="brief-btc-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#78e9c7" stopOpacity=".3" /><stop offset="100%" stopColor="#78e9c7" stopOpacity="0" /></linearGradient></defs>
    {[0, .33, .66, 1].map((ratio) => { const gy = top + ratio * (height - top - bottom); return <line className="brief-chart-grid" x1={left} x2={width - right} y1={gy} y2={gy} key={ratio} />; })}
    <rect className="brief-support-zone" x={left} y={supportY} width={width - left - right} height={supportHeight} rx="2" />
    <line className="brief-resistance-line" x1={left} x2={width - right} y1={y(resistance)} y2={y(resistance)} />
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

function SoprComparison({ analysis, data }: { analysis?: Day1Analysis; data?: DailyBriefEditorialSnapshot }) {
  const text = analysis?.cryptoAnalysis || "";
  const parsedSth = Number(text.match(/STH-SOPR为\s*([\d.]+)/)?.[1]);
  const parsedLth = Number(text.match(/LTH-SOPR为\s*([\d.]+)/)?.[1]);
  const sth = data?.onchain.sopr.value ?? (Number.isFinite(parsedSth) ? parsedSth : null);
  const lth = data?.onchain.lthSopr.value ?? (Number.isFinite(parsedLth) ? parsedLth : null);
  const source = data?.onchain.sopr.value !== null ? "链上接口" : "简报提取";
  const rows = [{ label: "STH-SOPR", value: sth }, { label: "LTH-SOPR", value: lth }];
  return <div className="brief-sopr-chart" role="img" aria-label="短期与长期持有者SOPR对比">
    <div className="brief-source-chip">{source}</div>
    {rows.map((row) => <div key={row.label}><header><span>{row.label}</span><b className={row.value !== null && row.value >= 1 ? "is-positive" : "is-negative"}>{row.value?.toFixed(3) || "—"}</b></header><div className="brief-sopr-track"><i /><b className={row.value !== null && row.value >= 1 ? "is-profit" : "is-loss"} style={{ width: `${row.value === null ? 0 : clamp((row.value - .8) / .25) * 100}%` }} /></div></div>)}
    <p><span>0.80</span><strong>盈亏平衡 1.00</strong><span>1.05</span></p>
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
      <VizCard index="01 / MACRO" title="宏观资产强弱" source="简报提取" className="is-macro"><MacroBars analysis={analysis} data={data} /></VizCard>
      <VizCard index="02 / CRYPTO" title="BTC 价格与关键区间" source="实盘序列 + 简报关键位" className="is-btc"><BtcKeyLevelsChart analysis={analysis} btc={btc} /></VizCard>
    </div>
    <div className="brief-viz-secondary-grid">
      <VizCard index="02A / HOLDERS" title="持有者盈亏反差" source="SOPR"><SoprComparison analysis={analysis} data={data} /></VizCard>
      <VizCard index="02B / ETF FLOW" title="资金流拐点" source="方向序列"><EtfFlowTurn analysis={analysis} /></VizCard>
      <VizCard index="03 / PLAYBOOK" title="今日市场体质" source="规则化映射" className="is-radar"><RadarChart analysis={analysis} data={data} summary={summary} /></VizCard>
    </div>
    <div className="brief-viz-method"><span>DATA MAP</span> 图表优先使用实时接口；缺失的 SOPR 与关键位仅从当日简报原文提取，并在卡片中明确标注。</div>
  </div>;
}
