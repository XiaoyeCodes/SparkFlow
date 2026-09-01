import { AlertTriangle, Bitcoin, Radio, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type {
  DailyBriefChartPoint,
  DailyBriefAssetGroup,
  DailyBriefEditorialEvent,
  DailyBriefEditorialMetric,
  DailyBriefEditorialSnapshot,
  DailyBriefNews,
  DailyBriefResponse,
  DailyBriefSummary,
  DailyBriefUpstreamQuote,
  DailyBriefVisualSeries,
} from "../lib/dailyBriefTypes";
import { DailyBriefVisualDashboard } from "../components/DailyBriefVisuals";
import { buildAiPayload, loadIntegrationSettings } from "../lib/integrations";
import "./DailyBrief.css";

const money = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

async function requestJson<T>(url: string, init?: RequestInit) {
  const attempts = !init?.method || init.method === "GET" ? 2 : 1;
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { Accept: "application/json" }, ...init });
      const text = await response.text();
      if (!text.trim()) throw new Error(`接口返回空内容（${response.status}）`);
      let payload: T & { detail?: string };
      try {
        payload = JSON.parse(text) as T & { detail?: string };
      } catch {
        throw new Error(response.ok ? "接口返回的数据不完整，请重试" : `请求失败（${response.status}）`);
      }
      if (!response.ok) throw new Error(payload.detail || `请求失败（${response.status}）`);
      return payload;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("请求失败，请重试");
}

function shanghaiTime(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}

function changeLabel(value: number | null | undefined, digits = 2) {
  return value === null || value === undefined ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

function changeClass(value: number | null | undefined) {
  return value === null || value === undefined || value === 0 ? "is-neutral" : value > 0 ? "is-positive" : "is-negative";
}

function eventChipLabel(event: DailyBriefEditorialEvent) {
  if (/\bFOMC\b/i.test(event.title)) return "FOMC 会议";
  const ticker = event.title.match(/^\s*([A-Z][A-Z.\-]*)\s*·/i)?.[1]?.toUpperCase();
  if (ticker && /财报/.test(event.title)) {
    const estimated = event.time === "预计" || /预计|市场预期/.test(`${event.title} ${event.source}`);
    return `${ticker} 财报${estimated ? "（预计）" : ""}`;
  }
  return event.title;
}

function sentimentTone(value: number | null) {
  if (value === null) return "muted";
  if (value < 25) return "negative";
  if (value < 45 || value >= 75) return "warning";
  return "positive";
}

function metricCurrentStatus(label: string, metric: DailyBriefEditorialMetric) {
  const value = metric.value;
  if (value === null || value === undefined) return "暂不可用";
  if (label === "美股 F&G" || label === "加密 F&G") {
    if (value <= 25) return "极度恐惧";
    if (value < 45) return "偏恐惧";
    if (value <= 55) return "中性观望";
    if (value < 75) return "轻度贪婪";
    return "极度贪婪";
  }
  if (label === "VIX 波动率") {
    if (value < 15) return "波动偏低";
    if (value < 20) return "波动正常";
    if (value < 30) return "波动抬升";
    return "高波动预警";
  }
  if (label === "MVRV Z-Score") {
    if (value < 1) return "估值偏低";
    if (value < 3) return "估值合理";
    if (value < 5) return "估值偏高";
    return "高估警戒";
  }
  if (/变化$/.test(label)) {
    if (value <= -10) return "情绪快速降温";
    if (value < -1) return "情绪降温";
    if (value <= 1) return "情绪稳定";
    if (value < 10) return "情绪升温";
    return "情绪快速升温";
  }
  return metric.label || "持续观察";
}

function fearGreedChangeMetric(metric: DailyBriefEditorialMetric, sourceLabel: string): DailyBriefEditorialMetric {
  const value = metric.change ?? null;
  return {
    ...metric,
    value,
    display: value === null ? "暂无数据" : `${value >= 0 ? "+" : ""}${value.toFixed(1)}p`,
    label: `当前 ${metric.display} · ${metric.label || sourceLabel}`,
    note: `${sourceLabel} 较前值变化`,
    change: null,
    status: value === null ? "unavailable" : metric.status,
  };
}

function AssetCard({ quote, index }: { quote: DailyBriefUpstreamQuote; index: number }) {
  const displaySymbol = quote.symbol === "HYPE" ? "HYP" : quote.symbol;
  const marketState = quote.marketState === "24H" ? "24H" : quote.marketState === "UNAVAILABLE" ? "OFFLINE" : "DELAYED";
  return <a
    className={`editorial-asset-card ${changeClass(quote.changePercent)}`}
    href={quote.sourceUrl || "#"}
    target="_blank"
    rel="noreferrer"
    style={{ "--asset-delay": `${index * 42}ms` } as CSSProperties}
  >
    <i className="editorial-asset-corner" />
    <div className="editorial-asset-id"><span>{displaySymbol}</span><em>{marketState}</em></div>
    <small>{quote.name}</small>
    <MiniQuoteChart quote={quote} />
    <div className="editorial-asset-price"><strong>{quote.display || (quote.price === null ? "—" : `$${money.format(quote.price)}`)}</strong><div className="editorial-asset-change"><b>{changeLabel(quote.changePercent)}</b><span>Δ SESSION</span></div></div>
    <div className="editorial-asset-meter"><i /></div>
  </a>;
}

function AssetGroupPanel({ group }: { group: DailyBriefAssetGroup }) {
  return <section className={`editorial-asset-group is-${group.id}`}>
    <header><h3>{group.label}<span>{group.items.filter((item) => item.price !== null).length}/{group.items.length} ONLINE</span></h3></header>
    <div className="editorial-asset-grid">{group.items.map((quote, index) => <AssetCard quote={quote} index={index} key={quote.symbol} />)}</div>
  </section>;
}

function MiniQuoteChart({ quote }: { quote: DailyBriefUpstreamQuote }) {
  const points = (quote.history || []).filter((point) => Number.isFinite(point.value) && point.value > 0);
  if (points.length < 2) return <span className="editorial-stock-chart-empty">3M 同步中</span>;
  const width = 152;
  const height = 42;
  const padding = 4;
  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const path = points.map((point, index) => {
    const x = points.length === 1 ? 0 : index / (points.length - 1) * width;
    const y = padding + (1 - (point.value - min) / range) * (height - padding * 2);
    return `${index ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");
  const latest = points[points.length - 1]!;
  const first = points[0]!;
  const change = (latest.value / first.value - 1) * 100;
  const color = change >= 0 ? "#78e9c7" : "#f06b7d";
  const gradientId = `stock-chart-${quote.symbol.replace(/[^a-z0-9]/gi, "-")}`;
  const lastX = width;
  const lastY = padding + (1 - (latest.value - min) / range) * (height - padding * 2);
  return <div className="editorial-stock-chart">
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${quote.symbol} 近 3 个月价格走势`}>
      <defs><linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity=".24" /><stop offset="100%" stopColor={color} stopOpacity="0" /></linearGradient></defs>
      <path className="editorial-stock-chart-baseline" d={`M0,${(height / 2).toFixed(2)} L${width},${(height / 2).toFixed(2)}`} />
      <path d={`${path} L${width},${height} L0,${height} Z`} fill={`url(#${gradientId})`} />
      <path d={path} fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
      <circle cx={lastX} cy={lastY} r="4.5" fill={color} opacity=".2" /><circle cx={lastX} cy={lastY} r="2" fill={color} />
    </svg>
    <small className={changeClass(change)}>{changeLabel(change, 1)} · 3M</small>
  </div>;
}

function QuotePrice({ quote }: { quote: DailyBriefUpstreamQuote }) {
  return <div className="editorial-stock-row">
    <div className="editorial-stock-id"><b>{quote.symbol}</b><span>{quote.name}</span></div><MiniQuoteChart quote={quote} />
    <div className="editorial-stock-number"><strong>{quote.display || (quote.price === null ? "—" : `$${money.format(quote.price)}`)}</strong><span className={changeClass(quote.changePercent)}>{changeLabel(quote.changePercent)}</span></div>
  </div>;
}

function Mag7DataPanel({ data }: { data?: DailyBriefEditorialSnapshot }) {
  return <section className="editorial-market-data-panel is-mag7"><h3>Mag7 数据 <span>DELAYED</span></h3>{(data?.stocks || []).map((quote) => <QuotePrice quote={quote} key={quote.symbol} />)}{!data?.stocks.length ? <div className="editorial-empty">美股行情暂不可用</div> : null}</section>;
}

function compactUsd(value: number) {
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${Math.round(value)}`;
}

function CryptoDataPanel({ data, btc }: { data?: DailyBriefEditorialSnapshot; btc?: DailyBriefUpstreamQuote }) {
  const signalRows = (["top", "bottom"] as const).map((kind) => ({
    kind,
    value: data?.signals[kind] ?? null,
    label: `BTC ${kind === "top" ? "逃顶" : "抄底"}信号`,
  }));
  const liquidations = data?.binanceLiquidations;
  const hasLiquidations = liquidations?.totalUsd !== null && liquidations?.totalUsd !== undefined
    && liquidations.longUsd !== null && liquidations.longUsd !== undefined
    && liquidations.shortUsd !== null && liquidations.shortUsd !== undefined;
  return <section className="editorial-market-data-panel is-crypto"><h3>加密 &amp; BTC 链上数据 <span>LIVE / DAILY</span></h3><div className="editorial-btc-hero"><div><strong>{btc?.display || (btc?.price === null || btc?.price === undefined ? "—" : `$${money.format(btc.price)}`)}</strong><span className={changeClass(btc?.changePercent)}>{changeLabel(btc?.changePercent)} · 24H</span></div><MarketChart series={(data?.marketSeries || []).filter((item) => item.symbol === "BTC")} /></div>
    <div className="editorial-onchain-table">{data ? <>{signalRows.map(({ kind, label, value }) => <div className={`editorial-onchain-signal is-${kind}`} key={kind} title={data.signals.methodology}><span>{label}</span><b>{signalLabel(value, kind)} · {value === null ? "—" : `${value}/100`}<i className={value === null ? "is-off" : ""} /></b></div>)}{[
      ["200周均线倍数", data.onchain.wma200Multiple], ["Puell Multiple", data.onchain.puellMultiple], ["资金费率", data.onchain.fundingRate],
      ["未平仓合约", data.onchain.openInterest], ["市值占比", data.onchain.dominance],
    ].map(([label, metric]) => { const item = metric as DailyBriefEditorialMetric; return <a href={item.sourceUrl} target="_blank" rel="noreferrer" key={label as string}><span>{label as string}</span><b>{item.display}<i className={item.value === null ? "is-off" : ""} /></b></a>; })}{hasLiquidations && liquidations ? <a className="editorial-liquidation-summary" href={liquidations.sourceUrl} target="_blank" rel="noreferrer" title="由公开 Binance 爆仓流聚合，统计窗口为过去 24 小时"><span>Binance 24H 爆仓</span><b>{compactUsd(liquidations.totalUsd!)}</b><small><em>多单 {compactUsd(liquidations.longUsd!)}</em><em>空单 {compactUsd(liquidations.shortUsd!)}</em></small></a> : null}</> : null}</div>
  </section>;
}

type Day1MetricRow = { label: string; value: string; signal: string; tone?: "positive" | "negative" | "neutral" };

function Day1BtcMetricsPanel({ data }: { data?: DailyBriefEditorialSnapshot }) {
  const metrics = data?.day1BtcMetrics;
  const hasMetrics = Boolean(metrics && [metrics.etfFlowUsd, metrics.fundingRate, metrics.longShortRatio, metrics.lthMvrv, metrics.nupl, metrics.lthSopr, metrics.sthSopr].some((value) => value !== null));
  if (!metrics || !hasMetrics) return null;
  const metricUsd = (value: number | null) => value === null ? "—" : compactUsd(Math.abs(value));
  const fixed = (value: number | null, digits = 2) => value === null ? "—" : value.toFixed(digits);
  const flowRows: Day1MetricRow[] = [
    { label: "ETF 净流入", value: metrics.etfFlowUsd === null ? "—" : `${metrics.etfFlowUsd >= 0 ? "+" : "-"}${metricUsd(metrics.etfFlowUsd)}`, signal: metrics.etfFlowUsd === null ? "待更新" : metrics.etfFlowUsd >= 0 ? "净流入" : "净流出", tone: metrics.etfFlowUsd === null ? "neutral" : metrics.etfFlowUsd >= 0 ? "positive" : "negative" },
    { label: "Funding Rate", value: metrics.fundingRate === null ? "—" : `${metrics.fundingRate >= 0 ? "+" : ""}${fixed(metrics.fundingRate, 3)}%`, signal: metrics.fundingRate === null ? "待更新" : Math.abs(metrics.fundingRate) < 0.03 ? "中性" : metrics.fundingRate > 0 ? "多头付费" : "空头付费" },
    { label: "多空比", value: fixed(metrics.longShortRatio, 2), signal: metrics.longShortRatio === null ? "待更新" : metrics.longShortRatio > 1.08 ? "多头略强" : metrics.longShortRatio < 0.92 ? "空头略强" : "多空均衡" },
    { label: "恐惧贪婪指数", value: metrics.fearGreed === null ? "—" : `${Math.round(metrics.fearGreed)} / 100`, signal: metrics.fearGreed === null ? "待更新" : metrics.fearGreed >= 75 ? "未到极端" : metrics.fearGreed >= 55 ? "情绪偏热" : metrics.fearGreed <= 25 ? "情绪偏冷" : "中性" },
  ];
  const onchainRows: Day1MetricRow[] = [
    { label: "LTH-MVRV", value: fixed(metrics.lthMvrv), signal: metrics.lthMvrv === null ? "待更新" : metrics.lthMvrv < 1 ? "LTH 低估区" : metrics.lthMvrv < 2.5 ? "LTH 正常盈利" : "LTH 盈利偏高" },
    { label: "NUPL", value: fixed(metrics.nupl, 3), signal: metrics.nupl === null ? "待更新" : metrics.nupl < 0 ? "投降区" : metrics.nupl < 0.25 ? "复苏阶段" : metrics.nupl < 0.5 ? "乐观阶段" : "盈利偏高" },
    { label: "LTH-SOPR", value: fixed(metrics.lthSopr, 3), signal: metrics.lthSopr === null ? "待更新" : metrics.lthSopr > 1 ? "正常分配" : "LTH 亏损实现" },
    { label: "STH-SOPR", value: fixed(metrics.sthSopr, 3), signal: metrics.sthSopr === null ? "待更新" : metrics.sthSopr > 1 ? "短线获利" : "短线承压" },
    { label: "LTH 持有量", value: metrics.lthSupplyPercent === null ? "—" : `${fixed(metrics.lthSupplyPercent, 1)}%`, signal: metrics.lthSupplyPercent === null ? "待更新" : metrics.lthSupplyPercent >= 75 ? "长期持仓高" : "长期持仓回落" },
    { label: "365日均线", value: metrics.ma365Ratio === null ? "—" : `${fixed(metrics.ma365Ratio)}x`, signal: metrics.ma365Ratio === null ? "待更新" : metrics.ma365Ratio >= 1 ? "高于年均线" : "低于年均线" },
    { label: "200周均线", value: metrics.wma200Multiple === null ? "—" : `${fixed(metrics.wma200Multiple)}x`, signal: metrics.wma200Multiple === null ? "待更新" : metrics.wma200Multiple >= 1 ? "高于长期均线" : "低于长期均线" },
    { label: "周线 RSI", value: fixed(metrics.weeklyRsi, 1), signal: metrics.weeklyRsi === null ? "待更新" : metrics.weeklyRsi >= 70 ? "周线偏热" : metrics.weeklyRsi <= 30 ? "周线偏冷" : "正常区间" },
    { label: "24H 成交量", value: metricUsd(metrics.volume24h), signal: metrics.volumeChangePercent === null ? "待更新" : `${metrics.volumeChangePercent >= 0 ? "+" : ""}${fixed(metrics.volumeChangePercent, 0)}% vs 30D` },
  ];
  const rows = [...flowRows, ...onchainRows];
  return <section className="editorial-day1-metrics" aria-label="Day1 Global BTC 指标">
    <header><strong>BTC 关键指标</strong><a href={metrics.sourceUrl} target="_blank" rel="noreferrer">DAY1 · LIVE</a></header>
    <div className="editorial-day1-column-head"><span>指标</span><span>当前</span><span>信号</span></div>
    <div className="editorial-day1-rows">{rows.map((row) => <div className="editorial-day1-row" key={row.label}><b>{row.label}</b><strong className={row.tone ? `is-${row.tone}` : ""}>{row.value}</strong><span>{row.signal}</span></div>)}</div>
  </section>;
}

function SideNewsPanel({ news, fillHeight }: { news: DailyBriefNews[]; fillHeight?: number }) {
  const items = news.slice(0, 4);
  return <section
    className="editorial-side-news"
    style={fillHeight ? { "--side-news-fill-height": `${fillHeight}px` } as CSSProperties : undefined}
  >
    <header><div><Radio size={13} /><span>市场快讯</span></div><em><i />LIVE WIRE</em></header>
    <div className="editorial-side-news-list">
      {items.map((item, index) => <a href={item.url || "#"} target="_blank" rel="noreferrer" key={item.id}>
        <div><i className={index === 0 ? "is-primary" : ""} /><span>{item.category || "市场"}</span><time>{item.publishedAt ? shanghaiTime(item.publishedAt) : "LIVE"}</time></div>
        <strong>{item.title}</strong>
        <small>{item.source || "GLOBAL WIRE"}</small>
      </a>)}
      {!items.length ? <div className="editorial-side-news-empty">正在同步市场快讯…</div> : null}
    </div>
  </section>;
}

function TrendBars({ points }: { points: DailyBriefChartPoint[] }) {
  return <div className="editorial-bar-chart" role="img" aria-label="7日加密恐惧贪婪指数走势">
    {points.length ? points.slice(-7).map((point, index, all) => <div className="editorial-bar-column" key={point.time}>
      <i className={index === all.length - 1 ? "is-today" : ""} style={{ height: `${Math.max(6, Math.min(100, point.value))}%` }}><b>{Math.round(point.value)}</b></i>
      <span>{point.time.slice(5).replace("-", "/")}</span>
    </div>) : <div className="editorial-empty">暂无历史序列</div>}
  </div>;
}

function pathFor(points: DailyBriefChartPoint[], width: number, height: number, min: number, max: number) {
  const spread = max - min || 1;
  return points.map((point, index) => {
    const x = points.length <= 1 ? 0 : index / (points.length - 1) * width;
    const y = 6 + (1 - (point.value - min) / spread) * (height - 12);
    return `${index ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");
}

function MarketChart({ series }: { series: DailyBriefVisualSeries[] }) {
  const values = series.flatMap((item) => item.points.map((point) => point.value));
  const min = values.length ? Math.min(...values) : 95;
  const max = values.length ? Math.max(...values) : 105;
  const mag7 = series.find((item) => item.symbol === "MAG7");
  const btc = series.find((item) => item.symbol === "BTC");
  return <div className="editorial-market-chart">{series.length ? <svg viewBox="0 0 600 90" preserveAspectRatio="none" role="img" aria-label="MAG7 与 BTC 近30日归一化走势">
    <defs><linearGradient id="editorial-jade-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#6fae8d" stopOpacity=".3" /><stop offset="100%" stopColor="#6fae8d" stopOpacity="0" /></linearGradient></defs>
    {mag7?.points.length ? <><path className="area" d={`${pathFor(mag7.points, 600, 90, min, max)} L600,90 L0,90 Z`} /><path className="mag7" d={pathFor(mag7.points, 600, 90, min, max)} /></> : null}
    {btc?.points.length ? <path className="btc" d={pathFor(btc.points, 600, 90, min, max)} /> : null}
  </svg> : <div className="editorial-empty">30 日价格序列暂不可用</div>}</div>;
}

function Highlight({ text }: { text: string }) {
  const pattern = /(风险|承压|下跌|谨慎|极度恐惧|恐惧|改善|上涨|回暖|机会|贪婪|中性|未触发|观察|等待|暂无数据|\$?[\d,.]+(?:%|x)?)/g;
  return <>{text.split(pattern).filter(Boolean).map((part, index) => {
    const tone = /风险|承压|下跌|谨慎|极度恐惧/.test(part) ? "negative" : /改善|上涨|回暖|机会|未触发/.test(part) ? "positive" : /恐惧|贪婪|观察|等待|\d/.test(part) ? "warning" : "";
    return tone ? <span className={`editorial-highlight is-${tone}`} key={`${index}-${part}`}>{part}</span> : <span key={`${index}-${part}`}>{part}</span>;
  })}</>;
}

function signalLabel(value: number | null, kind: "top" | "bottom") {
  if (value === null) return "数据不足";
  if (value >= 70) return kind === "top" ? "高位预警" : "信号增强";
  if (value >= 45) return "观察中";
  return "未触发";
}

export function DailyBrief() {
  const [brief, setBrief] = useState<DailyBriefResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modelSummary, setModelSummary] = useState<DailyBriefSummary | null>(null);
  const [, setModelSummaryState] = useState<"idle" | "loading" | "ready" | "fallback">("idle");
  const [aiRefreshNonce, setAiRefreshNonce] = useState(0);
  const leftDockRef = useRef<HTMLElement>(null);
  const rightDockRef = useRef<HTMLElement>(null);
  const sideNewsRef = useRef<HTMLDivElement>(null);
  const assetGroupsRef = useRef<HTMLDivElement>(null);
  const [sideNewsFillHeight, setSideNewsFillHeight] = useState<number>();

  const load = useCallback(async (refresh = false) => {
    setLoading(true);
    setError("");
    if (refresh) {
      setModelSummary(null);
    }
    try {
      const payload = refresh ? await requestJson<DailyBriefResponse>("/api/daily-brief/refresh", { method: "POST" }) : await requestJson<DailyBriefResponse>("/api/daily-brief?retry-content=1");
      setBrief(payload);
      if (refresh) setAiRefreshNonce((current) => current + 1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const snapshot = brief?.snapshot;
  const data: DailyBriefEditorialSnapshot | undefined = snapshot?.editorial;

  useEffect(() => {
    if (!snapshot) return;
    const settings = loadIntegrationSettings();
    if (!settings.ai.apiKey.trim() || !settings.ai.model.trim()) {
      setModelSummary(null);
      setModelSummaryState("fallback");
      return;
    }
    const cacheKey = `sparkflow.daily-brief.ai-summary.v3:${snapshot.date}:${snapshot.slot}:${settings.ai.provider}:${settings.ai.model}`;
    try {
      const cached = window.localStorage.getItem(cacheKey);
      if (cached && aiRefreshNonce === 0) {
        const parsed = JSON.parse(cached) as DailyBriefSummary;
        if (parsed?.assessment?.advice?.length) {
          setModelSummary(parsed);
          setModelSummaryState("ready");
          return;
        }
      }
    } catch {
      // A malformed convenience cache should never block a fresh model result.
    }
    const controller = new AbortController();
    setModelSummary(null);
    setModelSummaryState("loading");
    void requestJson<{ summary: DailyBriefSummary }>("/api/daily-brief/ai-summary", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildAiPayload(settings, "生成每日简报结构化结论")),
      signal: controller.signal,
    }).then((payload) => {
      setModelSummary(payload.summary);
      setModelSummaryState("ready");
      try { window.localStorage.setItem(cacheKey, JSON.stringify(payload.summary)); } catch { /* Optional cache only. */ }
    }).catch(() => {
      if (controller.signal.aborted) return;
      setModelSummaryState("fallback");
    });
    return () => controller.abort();
  }, [snapshot?.generatedAt, aiRefreshNonce]);

  const summary = modelSummary || snapshot?.summary;
  const btc = data?.crypto.find((item) => item.symbol === "BTC");
  const components = useMemo(() => {
    const order = [
      "market_momentum_sp500",
      "put_call_options",
      "safe_haven_demand",
      "junk_bond_demand",
      "market_volatility_vix",
    ];
    const byId = new Map((data?.sentiment.stockComponents || []).map((item) => [item.id, item]));
    const selected = order.map((id) => byId.get(id)).filter((item) => item?.value !== null && item?.value !== undefined);
    const total = selected.reduce((sum, item) => sum + Math.max(0, item?.value || 0), 0);
    return selected.map((item) => ({ ...item!, share: total ? Math.round(Math.max(0, item?.value || 0) / total * 100) : 0 }));
  }, [data?.sentiment.stockComponents]);
  const donut = useMemo(() => {
    const total = components.reduce((sum, item) => sum + Math.max(0, item.value || 0), 0);
    if (!total) return "conic-gradient(rgba(255,255,255,.08) 0 100%)";
    let cursor = 0;
    return `conic-gradient(${components.map((item) => { const start = cursor; cursor += Math.max(0, item.value || 0) / total * 100; return `${item.color} ${start}% ${cursor}%`; }).join(",")})`;
  }, [components]);
  const tickerAlerts = [
    summary?.headline ? { title: summary.headline, category: "市场" } : null,
    ...(snapshot?.news || []).slice(0, 5).map((item) => ({ title: item.title, category: item.category || "热点", url: item.url })),
  ].filter((item): item is { title: string; category: string; url?: string } => Boolean(item));
  const aiLines = [["宏观", summary?.highlights[0]], ["加密", summary?.highlights[1]], ["链上", summary?.highlights[2]], ["策略", summary?.regime]].filter((item): item is string[] => Boolean(item[1]));
  const day1Analysis = snapshot?.day1?.analysis;
  const hasDailyCoreJudgment = Boolean(day1Analysis || modelSummary || snapshot?.summaryMode === "ai");
  const assetGroups = data?.assetGroups || [];
  const leftAssetGroups = assetGroups.filter((group) => group.id !== "crypto").sort((left, right) => (left.id === "technology" ? 0 : 1) - (right.id === "technology" ? 0 : 1));
  const rightAssetGroups = assetGroups.filter((group) => group.id === "crypto");

  useLayoutEffect(() => {
    const leftDock = leftDockRef.current;
    const rightDock = rightDockRef.current;
    const sideNews = sideNewsRef.current;
    if (!leftDock || !rightDock || !sideNews) return;
    const syncHeight = () => {
      const leftHeight = leftDock.getBoundingClientRect().height;
      const rightHeight = rightDock.getBoundingClientRect().height;
      const newsHeight = sideNews.getBoundingClientRect().height;
      if (!leftHeight || !rightHeight || !newsHeight) return;
      const target = Math.max(210, Math.round(leftHeight - (rightHeight - newsHeight)));
      setSideNewsFillHeight((current) => current === target ? current : target);
    };
    const observer = new ResizeObserver(syncHeight);
    observer.observe(leftDock);
    observer.observe(rightDock);
    observer.observe(sideNews);
    syncHeight();
    return () => observer.disconnect();
  }, [assetGroups, snapshot?.news]);

  useLayoutEffect(() => {
    const container = assetGroupsRef.current;
    if (!container) return;
    const groups = Array.from(container.querySelectorAll<HTMLElement>(".editorial-asset-group"));
    const defensive = groups.find((group) => group.classList.contains("is-defensive"));
    const comparisonGroups = groups.filter((group) => !group.classList.contains("is-defensive"));
    if (!defensive || !comparisonGroups.length) return;

    let frame = 0;
    const syncAssetGroupHeight = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const isThreeColumnLayout = window.matchMedia("(min-width: 1081px) and (max-width: 1799px)").matches;
        defensive.style.removeProperty("--asset-group-height");
        if (!isThreeColumnLayout) return;
        const targetHeight = Math.round(Math.max(...comparisonGroups.map((group) => group.getBoundingClientRect().height)));
        if (!targetHeight) return;
        defensive.style.setProperty("--asset-group-height", `${targetHeight}px`);
      });
    };

    const observer = new ResizeObserver(syncAssetGroupHeight);
    comparisonGroups.forEach((group) => observer.observe(group));
    window.addEventListener("resize", syncAssetGroupHeight);
    syncAssetGroupHeight();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", syncAssetGroupHeight);
    };
  }, [assetGroups]);

  return <div className="daily-brief-editorial">
    {assetGroups.length ? <>
      <aside className="editorial-side-dock is-left" aria-label="市场数据左侧轨道" ref={leftDockRef}><Mag7DataPanel data={data} />{leftAssetGroups.map((group) => <AssetGroupPanel group={group} key={group.id} />)}</aside>
      <aside className="editorial-side-dock is-right" aria-label="市场数据右侧轨道" ref={rightDockRef}>{rightAssetGroups.map((group) => <AssetGroupPanel group={group} key={group.id} />)}<CryptoDataPanel data={data} btc={btc} /><Day1BtcMetricsPanel data={data} /><div ref={sideNewsRef}><SideNewsPanel news={snapshot?.news || []} fillHeight={sideNewsFillHeight} /></div></aside>
    </> : null}
    <div className="editorial-wrap">
      {error ? <div className="editorial-error">{error}</div> : null}

      <section className="editorial-lead" aria-label="预留数据区域">
        <div className="editorial-lead-metrics"><div className="editorial-tile-grid">{data ? [
          ["美股 F&G", data.sentiment.stockFearGreed], ["VIX 波动率", data.sentiment.vix],
          ["CNN F&G 变化", fearGreedChangeMetric(data.sentiment.stockFearGreed, "CNN Fear & Greed"), changeClass(data.sentiment.stockFearGreed.change).replace("is-", "")],
          ["加密 F&G", data.sentiment.cryptoFearGreed], ["MVRV Z-Score", data.sentiment.mvrvZScore],
          ["Crypto F&G 变化", fearGreedChangeMetric(data.sentiment.cryptoFearGreed, "Crypto Fear & Greed"), changeClass(data.sentiment.cryptoFearGreed.change).replace("is-", "")],
        ].map(([label, metric, tone]) => { const item = metric as DailyBriefEditorialMetric; return <a className={`editorial-tile is-${tone || sentimentTone(item.value)}`} href={item.sourceUrl} target="_blank" rel="noreferrer" key={label as string}><span>{label as string}</span><strong>{item.display}</strong><small className="editorial-tile-status">{metricCurrentStatus(label as string, item)}</small></a>; }) : Array.from({ length: 6 }, (_, index) => <div className="editorial-tile" key={index}><span>同步中</span><strong>—</strong><small>等待数据</small></div>)}</div></div>
        <div className="editorial-added-visuals"><DailyBriefVisualDashboard data={data} analysis={day1Analysis} summary={summary} btc={btc} /></div>
        {hasDailyCoreJudgment ? <div className="editorial-intelligence">
          <div className="editorial-intelligence-head"><div><span>AI MARKET READING</span><b>{day1Analysis ? "Day1 Global 深度解读" : "今日核心判断"}</b></div>{day1Analysis ? <a href={snapshot?.day1?.sourceUrl} target="_blank" rel="noreferrer">查看原始简报</a> : <em>AI 生成</em>}</div>
          {day1Analysis ? <>
            <div className="editorial-intelligence-grid">
              <article><header><span>01 / MACRO</span><b>宏观市场</b></header><p><Highlight text={day1Analysis.macroAnalysis} /></p></article>
              {day1Analysis.cryptoAnalysis ? <article><header><span>02 / CRYPTO</span><b>加密市场</b></header><p><Highlight text={day1Analysis.cryptoAnalysis} /></p></article> : null}
            </div>
            {day1Analysis.actionSuggestions ? <article className="editorial-intelligence-action"><header><span>03 / PLAYBOOK</span><b>行动建议</b></header><p><Highlight text={day1Analysis.actionSuggestions} /></p></article> : null}
          </> : <div className="editorial-intelligence-list">{aiLines.map(([label, text], index) => <article key={label}><span>{String(index + 1).padStart(2, "0")}</span><div><b>{label}</b><p><Highlight text={text} /></p></div></article>)}</div>}
          <div className="editorial-intelligence-foot"><span>{day1Analysis ? "新闻与 AI 摘要 · Day1 Global" : `来源 · ${snapshot?.sources.filter((item) => item.ok).length || 0} 组专业接口`}</span><span>生成 · {shanghaiTime(day1Analysis?.generatedAt || snapshot?.generatedAt)}</span></div>
        </div> : null}
        <div className="editorial-lead-foot"><AlertTriangle size={13} /><span>以上内容仅用于信息整理与风险检查，不构成任何投资建议。</span></div>
        <div className="editorial-chip-row">{(data?.events || []).slice(0, 5).map((event) => <a href={event.url} target="_blank" rel="noreferrer" key={event.id} title={`${event.date} ${event.title}`}><b>{event.date.slice(5).replace("-", "/")}</b><span>{eventChipLabel(event)}</span></a>)}<button className="editorial-refresh-all" type="button" onClick={() => void load(true)} disabled={loading} title="重新拉取行情、新闻、链上指标与 AI 摘要"><RefreshCw size={15} className={loading ? "is-spinning" : ""} /><span>{loading ? "正在刷新数据" : "刷新全部数据"}</span><small>LIVE</small></button></div>
      </section>

      <div className="editorial-report-grid"><main className="editorial-main-column is-full">

        <section className="editorial-assets-section"><div className="editorial-section-head"><h2>跨资产数据矩阵</h2><small>YAHOO FINANCE · BINANCE · COINGECKO · COIN METRICS</small></div>
          <div className="editorial-asset-groups" ref={assetGroupsRef}>{assetGroups.map((group) => <AssetGroupPanel group={group} key={group.id} />)}{!assetGroups.length ? <div className="editorial-assets-loading"><Radio size={17} />正在建立跨资产数据链路…</div> : null}</div>

        </section>

        <section className="editorial-original-market-section"><div className="editorial-section-head"><h2>Mag7 &amp; 加密数据</h2><small>YAHOO FINANCE · BINANCE · COIN METRICS · GLASSNODE</small></div><div className="editorial-table-pair"><Mag7DataPanel data={data} /><CryptoDataPanel data={data} btc={btc} /></div></section>
      </main>

      </div>
    </div>

    <footer className="editorial-ticker"><div><i />GLOBAL ALERT</div><div className="editorial-ticker-window"><div className="editorial-ticker-track">{[...tickerAlerts, ...tickerAlerts].map((alert, index) => alert.url ? <a href={alert.url} target="_blank" rel="noreferrer" title={`打开：${alert.title}`} key={`${index}-${alert.title}`}><b>{alert.category}</b>{alert.title}</a> : <span key={`${index}-${alert.title}`}><b>{alert.category}</b>{alert.title}</span>)}</div></div></footer>
  </div>;
}
