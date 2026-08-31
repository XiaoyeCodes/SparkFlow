import { AlertTriangle, Bitcoin, Radio } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import type {
  DailyBriefChartPoint,
  DailyBriefAssetGroup,
  DailyBriefEditorialMetric,
  DailyBriefEditorialSnapshot,
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
  const response = await fetch(url, { headers: { Accept: "application/json" }, ...init });
  const payload = (await response.json()) as T & { detail?: string };
  if (!response.ok) throw new Error(payload.detail || `请求失败（${response.status}）`);
  return payload;
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

function sentimentTone(value: number | null) {
  if (value === null) return "muted";
  if (value < 25) return "negative";
  if (value < 45 || value >= 75) return "warning";
  return "positive";
}

function metricNote(metric: DailyBriefEditorialMetric) {
  if (metric.value === null) return metric.note || "专业数据授权未配置";
  const change = metric.change === null || metric.change === undefined ? "" : ` ${metric.change >= 0 ? "+" : ""}${metric.change.toFixed(1)}`;
  return `${metric.label || metric.note || "已更新"}${change}`.trim();
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
  const level = quote.changePercent === null ? 8 : Math.min(100, Math.max(8, Math.abs(quote.changePercent) * 15));
  return <a
    className={`editorial-asset-card ${changeClass(quote.changePercent)}`}
    href={quote.sourceUrl || "#"}
    target="_blank"
    rel="noreferrer"
    style={{ "--asset-level": `${level}%`, "--asset-delay": `${index * 42}ms` } as CSSProperties}
  >
    <i className="editorial-asset-corner" />
    <div className="editorial-asset-id"><span>{quote.symbol}</span><em>{quote.marketState === "24H" ? "LIVE 24H" : quote.marketState === "UNAVAILABLE" ? "OFFLINE" : "DELAYED"}</em></div>
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
  const level = quote.changePercent === null ? 8 : Math.min(100, Math.max(8, Math.abs(quote.changePercent) * 15));
  const tone = quote.changePercent === null || quote.changePercent === 0 ? "#77908b" : quote.changePercent > 0 ? "#78e9c7" : "#f06b7d";
  return <div className="editorial-stock-row" style={{ "--quote-strength": `${level}%`, "--quote-tone": tone } as CSSProperties}>
    <div className="editorial-stock-id"><b>{quote.symbol}</b><span>{quote.name}</span></div><MiniQuoteChart quote={quote} />
    <div className="editorial-stock-number"><strong>{quote.display || (quote.price === null ? "—" : `$${money.format(quote.price)}`)}</strong><span className={changeClass(quote.changePercent)}>{changeLabel(quote.changePercent)}</span></div>
  </div>;
}

function CryptoQuotePill({ quote }: { quote: DailyBriefUpstreamQuote }) {
  const level = quote.changePercent === null ? 8 : Math.min(100, Math.max(8, Math.abs(quote.changePercent) * 15));
  const tone = quote.changePercent === null || quote.changePercent === 0 ? "#ab8561" : quote.changePercent > 0 ? "#f6c778" : "#f06b7d";
  return <div className="editorial-crypto-row" style={{ "--quote-strength": `${level}%`, "--quote-tone": tone } as CSSProperties}>
    <span><b>{quote.symbol}</b>{quote.name}</span><strong>{quote.display || (quote.price === null ? "—" : `$${money.format(quote.price)}`)} <em className={changeClass(quote.changePercent)}>{changeLabel(quote.changePercent)}</em></strong>
  </div>;
}

function Mag7DataPanel({ data }: { data?: DailyBriefEditorialSnapshot }) {
  return <section className="editorial-market-data-panel is-mag7"><h3>Mag7 数据 <span>DELAYED</span></h3><div className="editorial-index-strip">{(data?.indices || []).map((quote) => <div key={quote.symbol}><span>{quote.name}</span><b className={changeClass(quote.changePercent)}>{changeLabel(quote.changePercent)}</b></div>)}</div>{(data?.stocks || []).map((quote) => <QuotePrice quote={quote} key={quote.symbol} />)}{!data?.stocks.length ? <div className="editorial-empty">美股行情暂不可用</div> : null}</section>;
}

function CryptoDataPanel({ data, btc }: { data?: DailyBriefEditorialSnapshot; btc?: DailyBriefUpstreamQuote }) {
  const signalRows = (["top", "bottom"] as const).map((kind) => ({
    kind,
    value: data?.signals[kind] ?? null,
    label: `BTC ${kind === "top" ? "逃顶" : "抄底"}信号`,
  }));
  return <section className="editorial-market-data-panel is-crypto"><h3>加密 &amp; BTC 链上数据 <span>LIVE / DAILY</span></h3><div className="editorial-btc-hero"><div><strong>{btc?.display || (btc?.price === null || btc?.price === undefined ? "—" : `$${money.format(btc.price)}`)}</strong><span className={changeClass(btc?.changePercent)}>{changeLabel(btc?.changePercent)} · 24H</span></div><MarketChart series={(data?.marketSeries || []).filter((item) => item.symbol === "BTC")} /></div>
    {(data?.crypto || []).filter((item) => item.symbol !== "BTC").map((quote) => <CryptoQuotePill quote={quote} key={quote.symbol} />)}
    <div className="editorial-onchain-table">{data ? <>{signalRows.map(({ kind, label, value }) => <div className={`editorial-onchain-signal is-${kind}`} key={kind} title={data.signals.methodology}><span>{label}</span><b>{signalLabel(value, kind)} · {value === null ? "—" : `${value}/100`}<i className={value === null ? "is-off" : ""} /></b></div>)}{[
      ["200周均线倍数", data.onchain.wma200Multiple], ["Puell Multiple", data.onchain.puellMultiple], ["资金费率", data.onchain.fundingRate],
      ["未平仓合约", data.onchain.openInterest], ["市值占比", data.onchain.dominance],
    ].map(([label, metric]) => { const item = metric as DailyBriefEditorialMetric; return <a href={item.sourceUrl} target="_blank" rel="noreferrer" key={label as string}><span>{label as string}</span><b>{item.display}<i className={item.value === null ? "is-off" : ""} /></b></a>; })}</> : null}</div>
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
  const [modelSummaryError, setModelSummaryError] = useState("");

  const load = useCallback(async (refresh = false) => {
    setLoading(true);
    setError("");
    try {
      const payload = refresh ? await requestJson<DailyBriefResponse>("/api/daily-brief/refresh", { method: "POST" }) : await requestJson<DailyBriefResponse>("/api/daily-brief");
      setBrief(payload);
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
      setModelSummaryError("项目 AI 尚未配置完整，当前展示规则结论。");
      return;
    }
    const cacheKey = `sparkflow.daily-brief.ai-summary.v2:${snapshot.date}:${snapshot.slot}:${snapshot.generatedAt}:${settings.ai.provider}:${settings.ai.model}`;
    try {
      const cached = window.localStorage.getItem(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached) as DailyBriefSummary;
        if (parsed?.assessment?.advice?.length) {
          setModelSummary(parsed);
          setModelSummaryState("ready");
          setModelSummaryError("");
          return;
        }
      }
    } catch {
      // A malformed convenience cache should never block a fresh model result.
    }
    const controller = new AbortController();
    setModelSummary(null);
    setModelSummaryState("loading");
    setModelSummaryError("");
    void requestJson<{ summary: DailyBriefSummary }>("/api/daily-brief/ai-summary", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildAiPayload(settings, "生成每日简报结构化结论")),
      signal: controller.signal,
    }).then((payload) => {
      setModelSummary(payload.summary);
      setModelSummaryState("ready");
      try { window.localStorage.setItem(cacheKey, JSON.stringify(payload.summary)); } catch { /* Optional cache only. */ }
    }).catch((reason) => {
      if (controller.signal.aborted) return;
      setModelSummaryState("fallback");
      setModelSummaryError(reason instanceof Error ? reason.message : String(reason));
    });
    return () => controller.abort();
  }, [snapshot?.generatedAt]);

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
  const alerts = [summary?.headline, ...(snapshot?.news || []).slice(0, 5).map((item) => item.title)].filter(Boolean) as string[];
  const aiLines = [["宏观", summary?.highlights[0]], ["加密", summary?.highlights[1]], ["链上", summary?.highlights[2]], ["策略", summary?.regime]].filter((item): item is string[] => Boolean(item[1]));
  const day1Analysis = snapshot?.day1?.analysis;
  const assetGroups = data?.assetGroups || [];
  const leftAssetGroups = assetGroups.filter((group) => group.id !== "crypto").sort((left, right) => (left.id === "technology" ? 0 : 1) - (right.id === "technology" ? 0 : 1));
  const rightAssetGroups = assetGroups.filter((group) => group.id === "crypto");

  return <div className="daily-brief-editorial">
    {assetGroups.length ? <>
      <aside className="editorial-side-dock is-left" aria-label="市场数据左侧轨道"><Mag7DataPanel data={data} />{leftAssetGroups.map((group) => <AssetGroupPanel group={group} key={group.id} />)}</aside>
      <aside className="editorial-side-dock is-right" aria-label="市场数据右侧轨道">{rightAssetGroups.map((group) => <AssetGroupPanel group={group} key={group.id} />)}<CryptoDataPanel data={data} btc={btc} /></aside>
    </> : null}
    <div className="editorial-wrap">
      {error ? <div className="editorial-error">{error}</div> : null}

      <section className="editorial-lead" aria-label="预留数据区域">
        <div className="editorial-lead-metrics"><div className="editorial-tile-grid">{data ? [
          ["美股 F&G", data.sentiment.stockFearGreed], ["VIX 波动率", data.sentiment.vix],
          ["CNN F&G 变化", fearGreedChangeMetric(data.sentiment.stockFearGreed, "CNN Fear & Greed"), changeClass(data.sentiment.stockFearGreed.change).replace("is-", "")],
          ["加密 F&G", data.sentiment.cryptoFearGreed], ["MVRV Z-Score", data.sentiment.mvrvZScore],
          ["Crypto F&G 变化", fearGreedChangeMetric(data.sentiment.cryptoFearGreed, "Crypto Fear & Greed"), changeClass(data.sentiment.cryptoFearGreed.change).replace("is-", "")],
        ].map(([label, metric, tone]) => { const item = metric as DailyBriefEditorialMetric; return <a className={`editorial-tile is-${tone || sentimentTone(item.value)}`} href={item.sourceUrl} target="_blank" rel="noreferrer" key={label as string}><span>{label as string}</span><strong>{item.display}</strong><small>{metricNote(item)}</small></a>; }) : Array.from({ length: 6 }, (_, index) => <div className="editorial-tile" key={index}><span>同步中</span><strong>—</strong><small>等待数据</small></div>)}</div></div>
        <div className="editorial-added-visuals"><DailyBriefVisualDashboard data={data} analysis={day1Analysis} summary={summary} btc={btc} /></div>
        <div className="editorial-intelligence">
          <div className="editorial-intelligence-head"><div><span>AI MARKET READING</span><b>{day1Analysis ? "Day1 Global 深度解读" : "今日市场要点"}</b></div>{day1Analysis ? <a href={snapshot?.day1?.sourceUrl} target="_blank" rel="noreferrer">查看原始简报</a> : <em>{snapshot?.summaryMode === "ai" ? "项目 AI" : "规则结论"}</em>}</div>
          {day1Analysis ? <>
            <div className="editorial-intelligence-grid">
              <article><header><span>01 / MACRO</span><b>宏观市场</b></header><p><Highlight text={day1Analysis.macroAnalysis} /></p></article>
              {day1Analysis.cryptoAnalysis ? <article><header><span>02 / CRYPTO</span><b>加密市场</b></header><p><Highlight text={day1Analysis.cryptoAnalysis} /></p></article> : null}
            </div>
            {day1Analysis.actionSuggestions ? <article className="editorial-intelligence-action"><header><span>03 / PLAYBOOK</span><b>行动建议</b></header><p><Highlight text={day1Analysis.actionSuggestions} /></p></article> : null}
          </> : <div className="editorial-intelligence-list">{aiLines.map(([label, text], index) => <article key={label}><span>{String(index + 1).padStart(2, "0")}</span><div><b>{label}</b><p><Highlight text={text} /></p></div></article>)}</div>}
          <div className="editorial-intelligence-foot"><span>{day1Analysis ? "新闻与 AI 摘要 · Day1 Global" : `来源 · ${snapshot?.sources.filter((item) => item.ok).length || 0} 组专业接口`}</span><span>生成 · {shanghaiTime(day1Analysis?.generatedAt || snapshot?.generatedAt)}</span></div>
        </div>
        <div className="editorial-lead-foot"><AlertTriangle size={13} /><span>以上内容仅用于信息整理与风险检查，不构成任何投资建议。</span></div>
        {modelSummaryError ? <div className="editorial-model-note">{modelSummaryError}</div> : null}
        <div className="editorial-chip-row">{(data?.events || []).map((event) => <a href={event.url} target="_blank" rel="noreferrer" key={event.id}><b>{event.date.slice(5).replace("-", "/")}</b>{event.title}</a>)}</div>
      </section>

      <div className="editorial-report-grid"><main className="editorial-main-column">
        <section><div className="editorial-section-head"><h2>市场情绪 &amp; 抄底逃顶信号</h2><small>CRYPTO · STOCKS · ON-CHAIN</small></div>
          <div className="editorial-tile-grid">{data ? [
            ["加密 F&G", data.sentiment.cryptoFearGreed], ["美股 F&G", data.sentiment.stockFearGreed], ["VIX 波动率", data.sentiment.vix],
            ["MVRV Z-Score", data.sentiment.mvrvZScore],
            ["CNN F&G 变化", fearGreedChangeMetric(data.sentiment.stockFearGreed, "CNN Fear & Greed"), changeClass(data.sentiment.stockFearGreed.change).replace("is-", "")],
            ["Crypto F&G 变化", fearGreedChangeMetric(data.sentiment.cryptoFearGreed, "Crypto Fear & Greed"), changeClass(data.sentiment.cryptoFearGreed.change).replace("is-", "")],
          ].map(([label, metric, tone]) => { const item = metric as DailyBriefEditorialMetric; return <a className={`editorial-tile is-${tone || sentimentTone(item.value)}`} href={item.sourceUrl} target="_blank" rel="noreferrer" key={label as string}><span>{label as string}</span><strong>{item.display}</strong><small>{metricNote(item)}</small></a>; }) : Array.from({ length: 6 }, (_, index) => <div className="editorial-tile" key={index}><span>同步中</span><strong>—</strong><small>等待数据</small></div>)}</div>

          {(["top", "bottom"] as const).map((kind) => { const value = data?.signals[kind] ?? null; return <div className={`editorial-signal-row is-${kind}`} key={kind}><div><span>BTC {kind === "top" ? "逃顶" : "抄底"}信号强度</span><strong>{signalLabel(value, kind)} · {value === null ? "—" : `${value}/100`} <em>覆盖 {data?.signals.coverage ?? 0}%</em></strong></div><div className="editorial-signal-track"><i style={{ width: `${value || 0}%` }} /></div></div>; })}

          <div className="editorial-charts-row"><div className="editorial-chart-box"><h4>情绪构成 · CNN 7 项指标</h4><div className="editorial-donut-wrap">
            <div className="editorial-donut" style={{ background: donut }}><div><b>{data?.sentiment.stockFearGreed.display || "—"}</b><span>{data?.sentiment.stockFearGreed.label || "待更新"}</span></div></div>
            <div className="editorial-legend">{components.map((item) => <span key={item.id}><i style={{ background: item.color }} />{item.label}<b>{item.share}%</b></span>)}{!components.length ? <small>暂无分项数据</small> : null}</div>
          </div></div><div className="editorial-chart-box"><h4>7日加密恐惧贪婪指数走势</h4><TrendBars points={data?.sentiment.cryptoHistory || []} /></div></div>

          <div className="editorial-chart-wrap"><div><h3>MAG7 + BTC 对数股价走势 · 30D</h3><span>BTC {btc?.price === null || btc?.price === undefined ? "—" : `$${money.format(btc.price)}`}</span></div><MarketChart series={data?.marketSeries || []} /></div>
        </section>

        <section className="editorial-assets-section"><div className="editorial-section-head"><h2>跨资产数据矩阵</h2><small>YAHOO FINANCE · BINANCE · COINGECKO · COIN METRICS</small></div>
          <div className="editorial-asset-groups">{assetGroups.map((group) => <AssetGroupPanel group={group} key={group.id} />)}{!assetGroups.length ? <div className="editorial-assets-loading"><Radio size={17} />正在建立跨资产数据链路…</div> : null}</div>

        </section>

        <section className="editorial-original-market-section"><div className="editorial-section-head"><h2>Mag7 &amp; 加密数据</h2><small>YAHOO FINANCE · BINANCE · COIN METRICS · GLASSNODE</small></div><div className="editorial-table-pair"><Mag7DataPanel data={data} /><CryptoDataPanel data={data} btc={btc} /></div></section>
      </main>

      <aside className="editorial-rail"><section><div className="editorial-rail-head"><h3>{day1Analysis ? "Day1 今日必看" : "今日必看"} {snapshot?.news.length || 0} 条</h3></div>{(snapshot?.news || []).map((item) => <a className="editorial-news-item" href={item.url} target="_blank" rel="noreferrer" key={item.id}><div><i className={item.weight >= 80 ? "is-high" : item.weight >= 60 ? "is-mid" : "is-low"} /><time>{shanghaiTime(item.publishedAt)}</time><span>{item.category}</span></div><strong>{item.title}</strong></a>)}{loading && !snapshot?.news.length ? <div className="editorial-empty">正在聚合专业新闻源</div> : null}</section>
        <section><div className="editorial-rail-head"><h3>本周关注</h3></div>{(data?.events || []).map((event) => <a className="editorial-calendar-item" href={event.url} target="_blank" rel="noreferrer" key={event.id}><b>{event.date.slice(5).replace("-", "/")}</b><span>{event.title}<small>{event.time} · {event.source}</small></span></a>)}</section>
      </aside></div>
    </div>

    <footer className="editorial-ticker"><div><i />GLOBAL ALERT</div><div className="editorial-ticker-track">{[...alerts, ...alerts].map((alert, index) => <span key={`${index}-${alert}`}><b>{index % 3 === 0 ? "市场" : index % 3 === 1 ? "热点" : "观察"}</b>{alert}</span>)}</div></footer>
  </div>;
}
