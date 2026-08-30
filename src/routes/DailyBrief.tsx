import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  BellRing,
  Bot,
  BrainCircuit,
  ChevronRight,
  CircleAlert,
  Clock3,
  ExternalLink,
  Gauge,
  Newspaper,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  TrendingUp,
  WalletCards,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type {
  DailyBriefFlowDetails,
  DailyBriefMarket,
  DailyBriefResponse,
} from "../lib/dailyBriefTypes";
import "./DailyBrief.css";

type LiveQuotePayload = {
  generatedAt?: string;
  ticker?: Array<Record<string, unknown>>;
  coreIndices?: Array<Record<string, unknown>>;
  macro?: Array<Record<string, unknown>>;
  commodities?: Array<Record<string, unknown>>;
};
type WatchlistQuote = {
  symbol: string;
  name: string;
  display: string;
  changePercent: number | null;
  updatedAt?: string;
};
type WatchlistPayload = { generatedAt?: string; items?: WatchlistQuote[] };
const liveMarketIds = [
  "china",
  "hongkong",
  "nasdaq",
  "sp500",
  "vix",
  "gold",
  "bitcoin",
];
const formatNumber = new Intl.NumberFormat("zh-CN", {
  maximumFractionDigits: 2,
});

async function requestJson<T>(url: string) {
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  const payload = (await response.json()) as T & { detail?: string };
  if (!response.ok)
    throw new Error(payload.detail || `请求失败（${response.status}）`);
  return payload;
}
function toFinite(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function normalizeLiveMarket(
  item: Record<string, unknown>,
  id: string,
): DailyBriefMarket {
  const value = toFinite(item.price ?? item.value);
  return {
    id,
    name: String(item.name || item.label || item.symbol || id),
    symbol: String(item.symbol || "").replace(/^\^/, ""),
    value,
    display:
      typeof item.display === "string"
        ? item.display
        : value === null
          ? "—"
          : formatNumber.format(value),
    changePercent: toFinite(item.changePercent ?? item.change),
    updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : undefined,
    sourceUrl: typeof item.sourceUrl === "string" ? item.sourceUrl : undefined,
    status: typeof item.status === "string" ? item.status : undefined,
  };
}
function extractLiveMarkets(payload: LiveQuotePayload) {
  const pools = [
    payload.ticker || [],
    payload.coreIndices || [],
    payload.macro || [],
    payload.commodities || [],
  ].flat();
  return liveMarketIds.flatMap((id) => {
    const item = pools.find((candidate) => candidate.id === id);
    return item ? [normalizeLiveMarket(item, id)] : [];
  });
}
function marketById(markets: DailyBriefMarket[], id: string) {
  return markets.find((market) => market.id === id);
}
function formatDate(value?: string, includeDate = false) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    ...(includeDate ? { month: "2-digit", day: "2-digit" } : {}),
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}
function percentLabel(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}
function movementClass(value: number | null | undefined) {
  return value === null || value === undefined || value === 0
    ? "is-flat"
    : value > 0
      ? "is-up"
      : "is-down";
}

function Metric({
  market,
  compact = false,
}: {
  market?: DailyBriefMarket;
  compact?: boolean;
}) {
  const movement = movementClass(market?.changePercent);
  const Icon =
    movement === "is-up"
      ? ArrowUpRight
      : movement === "is-down"
        ? ArrowDownRight
        : Activity;
  return (
    <div className={compact ? "strategy-mini-metric" : "strategy-stat"}>
      <span>{market?.name || "数据加载中"}</span>
      <strong>{market?.display || "—"}</strong>
      <small className={movement}>
        <Icon size={11} /> {percentLabel(market?.changePercent)}
      </small>
    </div>
  );
}
function SignalRow({
  label,
  value,
  tone = "teal",
}: {
  label: string;
  value: number;
  tone?: "teal" | "violet" | "amber";
}) {
  const safeValue = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className="strategy-signal-row">
      <div>
        <span>{label}</span>
        <strong>
          {safeValue}
          <small>/100</small>
        </strong>
      </div>
      <div className={`strategy-signal-track is-${tone}`}>
        <i style={{ width: `${safeValue}%` }} />
      </div>
    </div>
  );
}
function LineSpark({
  points,
}: {
  points: Array<{ time: string; value: number }>;
}) {
  const values = points
    .slice(-28)
    .map((point) => point.value)
    .filter(Number.isFinite);
  if (values.length < 2)
    return <div className="strategy-chart-empty">历史样本加载后显示</div>;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const path = values
    .map(
      (value, index) =>
        `${(index / (values.length - 1)) * 100},${90 - ((value - min) / range) * 76}`,
    )
    .join(" ");
  return (
    <svg
      className="strategy-spark"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-label="近期趋势"
    >
      <polyline points={path} />
    </svg>
  );
}

export function DailyBrief() {
  const [brief, setBrief] = useState<DailyBriefResponse | null>(null);
  const [liveMarkets, setLiveMarkets] = useState<DailyBriefMarket[]>([]);
  const [liveUpdatedAt, setLiveUpdatedAt] = useState("");
  const [flows, setFlows] = useState<DailyBriefFlowDetails | null>(null);
  const [watchlist, setWatchlist] = useState<WatchlistQuote[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const loadLiveMarkets = useCallback(async () => {
    const payload = await requestJson<LiveQuotePayload>(
      "/api/global-macro-quotes",
    );
    setLiveMarkets(extractLiveMarkets(payload));
    setLiveUpdatedAt(payload.generatedAt || "");
  }, []);
  const loadSupplemental = useCallback(async () => {
    const [flowResult, watchlistResult] = await Promise.allSettled([
      requestJson<DailyBriefFlowDetails>("/api/daily-brief/details?view=flows"),
      requestJson<WatchlistPayload>("/api/daily-brief/watchlist"),
    ]);
    if (flowResult.status === "fulfilled") setFlows(flowResult.value);
    if (watchlistResult.status === "fulfilled")
      setWatchlist(watchlistResult.value.items || []);
  }, []);
  const load = useCallback(
    async (quiet = false) => {
      if (quiet) setRefreshing(true);
      else setLoading(true);
      setError("");
      const [briefResult, quoteResult] = await Promise.allSettled([
        requestJson<DailyBriefResponse>("/api/daily-brief"),
        loadLiveMarkets(),
      ]);
      if (briefResult.status === "fulfilled") setBrief(briefResult.value);
      if (
        briefResult.status === "rejected" &&
        quoteResult.status === "rejected"
      )
        setError(
          [briefResult.reason, quoteResult.reason]
            .map((reason) =>
              reason instanceof Error ? reason.message : String(reason),
            )
            .join("；"),
        );
      setLoading(false);
      setRefreshing(false);
      void loadSupplemental();
    },
    [loadLiveMarkets, loadSupplemental],
  );
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadLiveMarkets().catch(() => undefined);
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [loadLiveMarkets]);
  const snapshot = brief?.snapshot;
  const markets = liveMarkets.length ? liveMarkets : snapshot?.markets || [];
  const macro = snapshot?.macro || [];
  const vix = marketById(markets, "vix") || marketById(macro, "vix");
  const bitcoin =
    marketById(markets, "bitcoin") || marketById(macro, "bitcoin");
  const sp500 = marketById(markets, "sp500");
  const nasdaq = marketById(markets, "nasdaq");
  const china = marketById(markets, "china");
  const hongkong = marketById(markets, "hongkong");
  const gold = marketById(markets, "gold") || marketById(macro, "gold");
  const toneScore = snapshot?.summary.assessment?.score ?? 50;
  const defensiveScore = Math.max(
    0,
    Math.min(100, Math.round((vix?.value || 15) * 3)),
  );
  const articles = snapshot?.news || [];
  const aiLines = [
    {
      label: "宏观",
      text: snapshot?.summary.headline || "正在汇总今日市场信息。",
    },
    {
      label: "市场",
      text: snapshot?.summary.highlights[0] || "等待核心市场行情完成同步。",
    },
    {
      label: "风险",
      text: snapshot?.summary.risks[0] || "数据不足时不把缺失当作低风险。",
    },
    {
      label: "观察",
      text:
        snapshot?.summary.watchlist[0] ||
        "关注价格、新闻与风险指标是否相互印证。",
    },
  ];
  const alerts = useMemo(
    () =>
      [
        snapshot?.summary.headline,
        ...(snapshot?.summary.risks || []),
        ...articles.slice(0, 2).map((item) => item.title),
      ].filter(Boolean) as string[],
    [articles, snapshot?.summary],
  );
  const stockItems = watchlist.filter((item) =>
    ["AAPL", "MSFT", "AMZN", "GOOGL", "META", "NVDA", "TSLA"].includes(
      item.symbol,
    ),
  );
  const cryptoItems = watchlist.filter((item) =>
    ["ETH-USD", "SOL-USD"].includes(item.symbol),
  );
  return (
    <div className="daily-brief-page strategy-page">
      <div className="daily-brief-orbit daily-brief-orbit--one" />
      <div className="daily-brief-orbit daily-brief-orbit--two" />
      <div className="daily-brief-shell">
        <header className="strategy-header">
          <div>
            <p className="strategy-eyebrow">
              <span /> DAILY STRATEGY · AI 每日情报
            </p>
            <h1>每日策略</h1>
            <p>
              把市场事实、重点新闻和资产表现收束为一页；不提供量化交易指令。
            </p>
          </div>
          <div className="strategy-header__actions">
            <span>
              <Clock3 size={14} />{" "}
              {snapshot?.slot === "evening" ? "晚间简报" : "晨间简报"} ·{" "}
              {snapshot?.date || "同步中"}
            </span>
            <button
              type="button"
              onClick={() => void load(true)}
              disabled={refreshing}
            >
              <RefreshCw
                size={15}
                className={refreshing ? "is-spinning" : ""}
              />{" "}
              {refreshing ? "刷新中" : "刷新行情"}
            </button>
            <Link to="/council/details/judgement">
              <BrainCircuit size={15} /> 查看详细内容
            </Link>
          </div>
        </header>
        <section className="strategy-statbar" aria-label="今日概览">
          <div>
            <span>今日必看新闻</span>
            <strong>{articles.length || "—"}</strong>
            <small>已聚合市场相关资讯</small>
          </div>
          <div>
            <span>VIX 波动率</span>
            <strong>{vix?.display || "—"}</strong>
            <small className={movementClass(vix?.changePercent)}>
              {percentLabel(vix?.changePercent)}
            </small>
          </div>
          <div>
            <span>标普 500 · 24H</span>
            <strong className={movementClass(sp500?.changePercent)}>
              {percentLabel(sp500?.changePercent)}
            </strong>
            <small>{sp500?.display || "行情同步中"}</small>
          </div>
          <div>
            <span>BTC · 24H</span>
            <strong className={movementClass(bitcoin?.changePercent)}>
              {percentLabel(bitcoin?.changePercent)}
            </strong>
            <small>{bitcoin?.display || "行情同步中"}</small>
          </div>
          <div>
            <span>上次同步</span>
            <strong>{formatDate(liveUpdatedAt || snapshot?.updatedAt)}</strong>
            <small>{brief?.cache.hit ? "当日快照缓存" : "刚刚更新"}</small>
          </div>
        </section>
        {error ? (
          <div className="daily-brief-error">
            <CircleAlert size={16} /> {error}
          </div>
        ) : null}
        <main className="strategy-dashboard">
          <aside className="strategy-column strategy-column--left">
            <section className="strategy-panel strategy-panel--violet">
              <div className="strategy-panel__head">
                <div>
                  <p>
                    <Bot size={14} /> AI 摘要
                  </p>
                  <h2>今日判断</h2>
                </div>
                <span>
                  {snapshot?.summaryMode === "ai" ? "AI 生成" : "规则摘要"}
                </span>
              </div>
              <div className="strategy-ai-lines">
                {aiLines.map((line) => (
                  <div key={line.label}>
                    <span>{line.label}</span>
                    <p>{line.text}</p>
                  </div>
                ))}
              </div>
              <div className="strategy-source-note">
                <Activity size={13} />{" "}
                {snapshot?.sources.filter((item) => item.ok).length || 0}/
                {snapshot?.sources.length || 0} 个数据源可用 ·{" "}
                {formatDate(snapshot?.generatedAt)}
              </div>
              <Link
                className="strategy-detail-link"
                to="/council/details/judgement"
              >
                查看详细内容 <ChevronRight size={14} />
              </Link>
            </section>
            <section className="strategy-panel strategy-panel--teal strategy-news-panel">
              <div className="strategy-panel__head">
                <div>
                  <p>
                    <Newspaper size={14} /> TODAY NEWS
                  </p>
                  <h2>今日新闻</h2>
                </div>
                <span>{articles.length} 条</span>
              </div>
              <div className="strategy-news-list">
                {articles.slice(0, 9).map((item, index) => (
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noreferrer"
                    key={item.id}
                  >
                    <i>{String(index + 1).padStart(2, "0")}</i>
                    <div>
                      <small>
                        {item.category} · {item.source}
                      </small>
                      <strong>{item.title}</strong>
                      <time>{formatDate(item.publishedAt, true)}</time>
                    </div>
                    <ExternalLink size={13} />
                  </a>
                ))}
                {loading && !articles.length ? (
                  <div className="strategy-news-empty">正在读取新闻聚合…</div>
                ) : null}
              </div>
            </section>
          </aside>
          <section className="strategy-column strategy-column--center">
            <section className="strategy-panel strategy-panel--teal">
              <div className="strategy-panel__head">
                <div>
                  <p>
                    <Gauge size={14} /> MARKET SENTIMENT
                  </p>
                  <h2>市场情绪与交叉信号</h2>
                </div>
                <span>仅作风险观察</span>
              </div>
              <div className="strategy-metric-grid">
                <Metric market={china} compact />
                <Metric market={hongkong} compact />
                <Metric market={nasdaq} compact />
                <Metric market={sp500} compact />
                <Metric market={vix} compact />
                <Metric market={gold} compact />
              </div>
              <div className="strategy-signals">
                <SignalRow
                  label="综合风险偏好"
                  value={toneScore}
                  tone="violet"
                />
                <SignalRow
                  label="波动防守信号"
                  value={defensiveScore}
                  tone="amber"
                />
              </div>
              <div className="strategy-chart-grid">
                <div className="strategy-dial">
                  <div
                    style={
                      {
                        "--score": `${toneScore * 3.6}deg`,
                      } as React.CSSProperties
                    }
                  >
                    <strong>{toneScore}</strong>
                    <span>
                      {snapshot?.summary.assessment?.rating || "整理中"}
                    </span>
                  </div>
                  <p>综合评级</p>
                </div>
                <div className="strategy-trend">
                  <div>
                    <span>BTC 近 30 日</span>
                    <small>{percentLabel(flows?.metrics.btc30dChange)}</small>
                  </div>
                  <LineSpark points={flows?.price || []} />
                  <p>取自 Coin Metrics 日度价格</p>
                </div>
              </div>
              <Link
                className="strategy-detail-link"
                to="/council/details/flows"
              >
                查看详细内容 <ChevronRight size={14} />
              </Link>
            </section>
            <section className="strategy-panel strategy-panel--amber strategy-conclusion">
              <div className="strategy-panel__head">
                <div>
                  <p>
                    <Sparkles size={14} /> TODAY CONCLUSION
                  </p>
                  <h2>今日结论</h2>
                </div>
                <span>
                  信心 {snapshot?.summary.assessment?.confidence || "低"}
                </span>
              </div>
              <div className="strategy-conclusion__rating">
                <strong>
                  {snapshot?.summary.assessment?.rating ||
                    snapshot?.summary.regime ||
                    "正在整理"}
                </strong>
                <span>
                  {snapshot?.summary.assessment?.rationale ||
                    snapshot?.summary.headline ||
                    "等待每日简报快照。"}
                </span>
              </div>
              <div className="strategy-advice-grid">
                {(snapshot?.summary.assessment?.advice || [])
                  .slice(0, 4)
                  .map((item) => (
                    <div key={item.label}>
                      <span>{item.label}</span>
                      <p>{item.detail}</p>
                    </div>
                  ))}
                {!snapshot?.summary.assessment?.advice?.length ? (
                  <div>
                    <span>说明</span>
                    <p>数据加载后会显示基于当日事实的风险检查。</p>
                  </div>
                ) : null}
              </div>
              <div className="strategy-disclaimer">
                <ShieldAlert size={13} />{" "}
                {snapshot?.summary.assessment?.disclaimer ||
                  "以上内容仅用于信息整理与风险检查，不构成投资建议。"}
              </div>
              <Link
                className="strategy-detail-link"
                to="/council/details/judgement"
              >
                查看详细内容 <ChevronRight size={14} />
              </Link>
            </section>
          </section>
          <aside className="strategy-column strategy-column--right">
            <section className="strategy-panel strategy-panel--indigo">
              <div className="strategy-panel__head">
                <div>
                  <p>
                    <TrendingUp size={14} /> MAG7 DATA
                  </p>
                  <h2>Mag7 数据</h2>
                </div>
                <span>
                  {watchlist.length
                    ? formatDate(watchlist[0]?.updatedAt)
                    : "同步中"}
                </span>
              </div>
              <div className="strategy-index-strip">
                <Metric market={nasdaq} compact />
                <Metric market={sp500} compact />
              </div>
              <div className="strategy-quote-table">
                {stockItems.map((item) => (
                  <div key={item.symbol}>
                    <span>
                      {item.symbol}
                      <small>{item.name}</small>
                    </span>
                    <strong>{item.display}</strong>
                    <em className={movementClass(item.changePercent)}>
                      {percentLabel(item.changePercent)}
                    </em>
                  </div>
                ))}
                {!stockItems.length ? (
                  <div className="strategy-table-empty">
                    正在以独立缓存读取 Mag7 行情…
                  </div>
                ) : null}
              </div>
              <Link
                className="strategy-detail-link"
                to="/council/details/performance"
              >
                查看详细内容 <ChevronRight size={14} />
              </Link>
            </section>
            <section className="strategy-panel strategy-panel--btc">
              <div className="strategy-panel__head">
                <div>
                  <p>
                    <WalletCards size={14} /> CRYPTO & ON-CHAIN
                  </p>
                  <h2>加密与 BTC 链上数据</h2>
                </div>
                <span>日度数据</span>
              </div>
              <div className="strategy-btc-hero">
                <span>BTC</span>
                <strong>{bitcoin?.display || "—"}</strong>
                <em className={movementClass(bitcoin?.changePercent)}>
                  {percentLabel(bitcoin?.changePercent)}
                </em>
              </div>
              <div className="strategy-crypto-pairs">
                {cryptoItems.map((item) => (
                  <div key={item.symbol}>
                    <span>{item.symbol.replace("-USD", "")}</span>
                    <strong>{item.display}</strong>
                    <em className={movementClass(item.changePercent)}>
                      {percentLabel(item.changePercent)}
                    </em>
                  </div>
                ))}
              </div>
              <div className="strategy-onchain-table">
                <div>
                  <span>BTC 30日变化</span>
                  <strong>{percentLabel(flows?.metrics.btc30dChange)}</strong>
                </div>
                <div>
                  <span>活跃地址 30日</span>
                  <strong>
                    {percentLabel(flows?.metrics.activity30dChange)}
                  </strong>
                </div>
                <div>
                  <span>ETF 近 7 日</span>
                  <strong>
                    {flows?.metrics.etf7d === null ||
                    flows?.metrics.etf7d === undefined
                      ? "—"
                      : `${flows.metrics.etf7d >= 0 ? "+" : ""}${flows.metrics.etf7d.toFixed(0)} M`}
                  </strong>
                </div>
              </div>
              <p className="strategy-data-note">
                链上指标采用公开日度数据，非实时交易信号。
              </p>
              <Link
                className="strategy-detail-link"
                to="/council/details/flows"
              >
                查看详细内容 <ChevronRight size={14} />
              </Link>
            </section>
          </aside>
        </main>
      </div>
      <footer className="strategy-alert-ticker">
        <div>
          <BellRing size={14} />
          <strong>GLOBAL ALERT</strong>
        </div>
        <div className="strategy-alert-ticker__rail">
          {alerts.length ? (
            alerts.map((alert, index) => (
              <span key={`${index}-${alert}`}>
                <b>观察</b>
                {alert}
              </span>
            ))
          ) : (
            <span>
              <b>同步中</b>正在读取今日市场简报
            </span>
          )}
        </div>
      </footer>
    </div>
  );
}
