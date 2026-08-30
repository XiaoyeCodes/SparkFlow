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
  DailyBriefDay1Snapshot,
  DailyBriefMarket,
  DailyBriefResponse,
  DailyBriefUpstreamQuote,
} from "../lib/dailyBriefTypes";
import "./DailyBrief.css";

const marketFormatter = new Intl.NumberFormat("zh-CN", {
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
  return value === null || value === undefined
    ? "—"
    : `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}
function movementClass(value: number | null | undefined) {
  return value === null || value === undefined || value === 0
    ? "is-flat"
    : value > 0
      ? "is-up"
      : "is-down";
}
function toMarket(
  id: string,
  quote?: DailyBriefUpstreamQuote,
): DailyBriefMarket | undefined {
  if (!quote) return undefined;
  return {
    id,
    name: quote.name,
    symbol: quote.symbol,
    value: quote.price,
    display: quote.price === null ? "—" : marketFormatter.format(quote.price),
    changePercent: quote.changePercent,
    updatedAt: undefined,
    status: quote.marketState,
  };
}
function numberMetric(data: DailyBriefDay1Snapshot | undefined, key: string) {
  const value = data?.btcMetrics[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function moneyMetric(value: number | null, unit = "") {
  if (value === null) return "—";
  const absolute = Math.abs(value);
  const compact =
    absolute >= 1_000_000_000
      ? `${(value / 1_000_000_000).toFixed(2)} B`
      : absolute >= 1_000_000
        ? `${(value / 1_000_000).toFixed(1)} M`
        : marketFormatter.format(value);
  return `${value >= 0 ? "+" : ""}${compact}${unit}`;
}

function Metric({ market }: { market?: DailyBriefMarket }) {
  const movement = movementClass(market?.changePercent);
  const Icon =
    movement === "is-up"
      ? ArrowUpRight
      : movement === "is-down"
        ? ArrowDownRight
        : Activity;
  return (
    <div className="strategy-mini-metric">
      <span>{market?.name || "数据缺失"}</span>
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
  value: number | null;
  tone?: "teal" | "violet" | "amber";
}) {
  const safeValue =
    value === null ? 0 : Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className="strategy-signal-row">
      <div>
        <span>{label}</span>
        <strong>
          {value === null ? "—" : safeValue}
          <small>{value === null ? "" : "/100"}</small>
        </strong>
      </div>
      <div className={`strategy-signal-track is-${tone}`}>
        <i style={{ width: `${safeValue}%` }} />
      </div>
    </div>
  );
}

export function DailyBrief() {
  const [brief, setBrief] = useState<DailyBriefResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    setError("");
    try {
      setBrief(await requestJson<DailyBriefResponse>("/api/daily-brief"));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const snapshot = brief?.snapshot;
  const day1 = snapshot?.day1;
  const sp500 = toMarket("sp500", day1?.indices.sp500);
  const vix = toMarket("vix", day1?.indices.vix);
  const gold = toMarket("gold", day1?.indices.gold);
  const oil = toMarket("crudeOil", day1?.indices.crudeOil);
  const dxy = toMarket("dxy", day1?.indices.dxy);
  const btc = toMarket(
    "bitcoin",
    day1?.crypto.find((item) => item.symbol === "BTC"),
  );
  const eth = toMarket(
    "eth",
    day1?.crypto.find((item) => item.symbol === "ETH"),
  );
  const sol = toMarket(
    "sol",
    day1?.crypto.find((item) => item.symbol === "SOL"),
  );
  const voo = toMarket(
    "voo",
    day1?.stocks.find((item) => item.symbol === "VOO"),
  );
  const qqq = toMarket(
    "qqq",
    day1?.stocks.find((item) => item.symbol === "QQQ"),
  );
  const totalScore =
    day1?.rating.totalScore ?? snapshot?.summary.assessment?.score ?? null;
  const cryptoFearGreed = day1?.sentiment.cryptoFearGreed ?? null;
  const riskScore =
    vix?.value === null || vix?.value === undefined
      ? null
      : Math.max(0, Math.min(100, Math.round(vix.value * 3)));
  const articles = snapshot?.news || [];
  const actionAdvice = snapshot?.summary.assessment?.advice || [];
  const stockItems = (day1?.stocks || []).filter((item) =>
    [
      "NVDA",
      "TSLA",
      "GOOG",
      "SMH",
      "MRVL",
      "AMD",
      "INTC",
      "TSM",
      "QCOM",
      "COIN",
    ].includes(item.symbol),
  );
  const cryptoItems = (day1?.crypto || []).filter((item) =>
    ["ETH", "SOL", "HYPE", "BNB", "TAO", "XAUT", "VIRTUAL"].includes(
      item.symbol,
    ),
  );
  const aiLines = [
    {
      label: "宏观",
      text: snapshot?.summary.highlights[0] || "等待每日快照。",
    },
    {
      label: "加密",
      text: snapshot?.summary.highlights[1] || "等待每日快照。",
    },
    {
      label: "评级",
      text:
        day1?.rating.suggestion || snapshot?.summary.regime || "等待每日快照。",
    },
    { label: "观察", text: snapshot?.summary.watchlist[0] || "等待每日快照。" },
  ];
  const alerts = useMemo(
    () =>
      [
        snapshot?.summary.headline,
        ...articles.slice(0, 3).map((item) => item.title),
      ].filter(Boolean) as string[],
    [articles, snapshot?.summary.headline],
  );
  const slotLabel =
    snapshot?.slot === "midday"
      ? "午间快照"
      : snapshot?.slot === "evening"
        ? "晚间快照"
        : "晨间快照";

  return (
    <div className="daily-brief-page strategy-page">
      <div className="daily-brief-orbit daily-brief-orbit--one" />
      <div className="daily-brief-orbit daily-brief-orbit--two" />
      <div className="daily-brief-shell">
        <header className="strategy-header">
          <div>
            <p className="strategy-eyebrow">
              <span /> DAILY STRATEGY · DAY1 SNAPSHOT
            </p>
            <h1>每日策略</h1>
            <p>
              仅在北京时间 08:00、12:00、17:00
              更新；页面始终读取最近一次成功快照。
            </p>
          </div>
          <div className="strategy-header__actions">
            <span>
              <Clock3 size={14} /> {slotLabel} · {snapshot?.date || "同步中"}
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
              {refreshing ? "读取中" : "重新读取快照"}
            </button>
            <Link to="/council/details/judgement">
              <BrainCircuit size={15} /> 查看详细内容
            </Link>
          </div>
        </header>
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
                  {snapshot?.summaryMode === "ai" ? "上游 AI 快照" : "等待快照"}
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
                <Activity size={13} /> Day1 market-data / analysis /
                market-rating · {formatDate(day1?.fetchedAt)}
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
                {articles.map((item, index) => (
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
                      <time>
                        {item.summary || formatDate(item.publishedAt, true)}
                      </time>
                    </div>
                    <ExternalLink size={13} />
                  </a>
                ))}
                {loading && !articles.length ? (
                  <div className="strategy-news-empty">
                    正在读取最近成功快照…
                  </div>
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
                <span>Day1 原始指标快照</span>
              </div>
              <div className="strategy-metric-grid">
                <Metric market={voo} />
                <Metric market={qqq} />
                <Metric market={sp500} />
                <Metric market={vix} />
                <Metric market={gold} />
                <Metric market={dxy} />
              </div>
              <div className="strategy-signals">
                <SignalRow
                  label="BTC 综合评级"
                  value={totalScore}
                  tone="violet"
                />
                <SignalRow
                  label="波动防守信号"
                  value={riskScore}
                  tone="amber"
                />
              </div>
              <div className="strategy-chart-grid">
                <div className="strategy-dial">
                  <div
                    style={
                      {
                        "--score": `${(totalScore || 0) * 3.6}deg`,
                      } as React.CSSProperties
                    }
                  >
                    <strong>
                      {totalScore === null ? "—" : Math.round(totalScore)}
                    </strong>
                    <span>{day1?.rating.level || "等待数据"}</span>
                  </div>
                  <p>BTC 抄底/逃顶评级</p>
                </div>
                <div className="strategy-trend">
                  <div>
                    <span>恐慌贪婪与资金面</span>
                    <small>{day1?.rating.suggestion || "—"}</small>
                  </div>
                  <div className="strategy-rating-list">
                    {(day1?.rating.indicators || []).slice(0, 4).map((item) => (
                      <span key={item.name}>
                        {item.name}
                        <b>{item.score === null ? "—" : item.score}</b>
                      </span>
                    ))}
                  </div>
                  <p>评分明细来自上游 market-rating</p>
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
                  <h2>综合评级与仓位建议</h2>
                </div>
                <span>
                  评分 {totalScore === null ? "—" : totalScore.toFixed(1)}
                </span>
              </div>
              <div className="strategy-conclusion__rating">
                <strong>
                  {snapshot?.summary.assessment?.rating ||
                    day1?.rating.level ||
                    "正在整理"}
                </strong>
                <span>
                  加密恐惧贪婪={cryptoFearGreed ?? "—"} ｜ VIX=
                  {vix?.display || "—"}
                </span>
              </div>
              <div className="strategy-advice-grid">
                {actionAdvice.slice(0, 5).map((item) => (
                  <div key={item.label}>
                    <span>{item.label}</span>
                    <p>{item.detail}</p>
                  </div>
                ))}
                {!actionAdvice.length ? (
                  <div>
                    <span>说明</span>
                    <p>等待下一次每日快照完成。</p>
                  </div>
                ) : null}
              </div>
              <div className="strategy-disclaimer">
                <ShieldAlert size={13} />{" "}
                {snapshot?.summary.assessment?.disclaimer ||
                  "以上内容仅供参考，不构成任何投资建议。"}
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
                    <TrendingUp size={14} /> US STOCKS
                  </p>
                  <h2>美股数据</h2>
                </div>
                <span>{formatDate(day1?.fetchedAt)}</span>
              </div>
              <div className="strategy-index-strip">
                <Metric market={sp500} />
                <Metric market={qqq} />
              </div>
              <div className="strategy-quote-table">
                {stockItems.map((item) => (
                  <div key={item.symbol}>
                    <span>
                      {item.symbol}
                      <small>{item.name}</small>
                    </span>
                    <strong>
                      {item.price === null
                        ? "—"
                        : marketFormatter.format(item.price)}
                    </strong>
                    <em className={movementClass(item.changePercent)}>
                      {percentLabel(item.changePercent)}
                    </em>
                  </div>
                ))}
                {!stockItems.length ? (
                  <div className="strategy-table-empty">等待每日美股快照…</div>
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
                <span>Day1 每日快照</span>
              </div>
              <div className="strategy-btc-hero">
                <span>BTC</span>
                <strong>{btc?.display || "—"}</strong>
                <em className={movementClass(btc?.changePercent)}>
                  {percentLabel(btc?.changePercent)}
                </em>
              </div>
              <div className="strategy-crypto-pairs">
                {cryptoItems.slice(0, 6).map((item) => (
                  <div key={item.symbol}>
                    <span>{item.symbol}</span>
                    <strong>
                      {item.price === null
                        ? "—"
                        : marketFormatter.format(item.price)}
                    </strong>
                    <em className={movementClass(item.changePercent)}>
                      {percentLabel(item.changePercent)}
                    </em>
                  </div>
                ))}
              </div>
              <div className="strategy-onchain-table">
                <div>
                  <span>200 周均线</span>
                  <strong>
                    {moneyMetric(numberMetric(day1, "wma200Price"))}
                  </strong>
                </div>
                <div>
                  <span>200 周均线倍数</span>
                  <strong>
                    {numberMetric(day1, "wma200Multiplier") === null
                      ? "—"
                      : `${numberMetric(day1, "wma200Multiplier")!.toFixed(2)}×`}
                  </strong>
                </div>
                <div>
                  <span>ETF 每日净流入</span>
                  <strong>
                    {moneyMetric(numberMetric(day1, "etfFlowUsd"))}
                  </strong>
                </div>
                <div>
                  <span>Funding Rate</span>
                  <strong>
                    {numberMetric(day1, "fundingRate") === null
                      ? "—"
                      : `${numberMetric(day1, "fundingRate")!.toFixed(4)}%`}
                  </strong>
                </div>
              </div>
              <p className="strategy-data-note">
                此处为 Day1 公开 market-data 的当次持久化结果。
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
              <b>同步中</b>正在读取最近一次成功快照
            </span>
          )}
        </div>
      </footer>
    </div>
  );
}
