import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { hierarchy, treemap } from 'd3-hierarchy';
import { geoGraticule10, geoNaturalEarth1, geoPath } from 'd3-geo';
import type { FeatureCollection, Geometry } from 'geojson';
import { feature } from 'topojson-client';
import * as THREE from 'three';
import {
  ArrowRight,
  Bitcoin,
  CircleDollarSign,
  Droplets,
  ExternalLink,
  Globe2,
  Landmark,
  Map as MapIcon,
  Maximize2,
  Minus,
  Plus,
  RefreshCw,
  X,
  type LucideIcon,
  type LucideProps,
} from 'lucide-react';
import {
  ChinaMarketHeatmap,
  CryptoMarketHeatmap,
  HongKongMarketHeatmap,
  InternationalMarketHeatmap,
  prefetchInternationalMarketHeatmap,
  prefetchInternationalMarketHeatmaps,
  UsMarketHeatmap,
  type InternationalMarketMode,
} from './ChinaMarketHeatmap';
import './GlobalMacroCommandCenter.css';

export type GlobalMarketMode = 'china' | 'hongkong' | 'us' | 'japan' | 'korea' | 'india' | 'germany' | 'france' | 'uk' | 'crypto';
const INTERNATIONAL_MARKET_IDS = new Set<GlobalMarketMode>(['japan', 'korea', 'india', 'germany', 'france', 'uk']);
type RegionId = 'global' | 'apac' | 'middleEast' | 'europe' | 'americas';

function isInternationalMarketMode(market?: GlobalMarketMode): market is InternationalMarketMode {
  return Boolean(market && INTERNATIONAL_MARKET_IDS.has(market));
}

type HistoryPoint = { time: string; value: number };
type Quote = {
  id: string;
  name: string;
  symbol: string;
  price: number;
  changePercent: number;
  updatedAt?: string;
  sourceUrl: string;
  market?: GlobalMarketMode;
  region: RegionId;
  latitude: number;
  longitude: number;
  session: {
    label: string;
    tone: 'live' | 'closed' | 'pre' | 'unknown';
    detail?: string;
    timezone?: string;
    localTime?: string;
    nextOpenAt?: string;
    nextOpenLabel?: string;
  };
  quoteStale?: boolean;
  history: HistoryPoint[];
};
type TickerIndex = Pick<Quote, 'id' | 'name' | 'symbol' | 'price' | 'changePercent' | 'sourceUrl' | 'updatedAt'>;
type CoreIndex = {
  id: 'nasdaq' | 'sp500' | 'shanghai' | 'sox';
  name: string;
  symbol: string;
  price: number | null;
  changePercent: number | null;
  updatedAt?: string;
  sourceUrl: string;
  history: HistoryPoint[];
  status: 'live' | 'delayed' | 'unavailable';
};
type Metric = {
  id: string;
  label: string;
  value: number | null;
  display: string;
  change?: number | null;
  changeDisplay?: string;
  updatedAt?: string;
  sourceUrl: string;
  status: 'live' | 'delayed' | 'unavailable';
  history: HistoryPoint[];
  parts?: Array<{
    label: string;
    display: string;
    updatedAt?: string;
  }>;
  stats?: Array<{
    label: string;
    display: string;
  }>;
};
type CpiMetric = {
  id: 'china-cpi' | 'us-cpi';
  label: string;
  value: number | null;
  display: string;
  change: number | null;
  period: string;
  releasedAt?: string;
  updatedAt?: string;
  source: string;
  sourceUrl: string;
  status: 'delayed' | 'unavailable';
  history: HistoryPoint[];
};
type KeySignal = {
  id: string;
  label: string;
  value: string;
  change: string;
  rawChange?: number | null;
  note: string;
  url?: string;
};

function GoldBarIcon({ size = 24, color = 'currentColor', strokeWidth = 2 }: LucideProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M3 18 5.5 10h13L21 18H3Z" fill={color} fillOpacity="0.14" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" />
      <path d="m5.5 10 2.6-4h7.8l2.6 4M8.1 6l2 4m5.8-4-2 4M8 14h8" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const KEY_SIGNAL_ICONS: Partial<Record<string, LucideIcon>> = {
  dxy: CircleDollarSign,
  us10y: Landmark,
  brent: Droplets,
  gold: GoldBarIcon as LucideIcon,
};
const HIDDEN_MACRO_RISK_IDS = new Set(['vix', 'dxy', 'us10y', 'ust2y10y', 'fedfunds', 'gscpi']);
type News = {
  id: string;
  title: string;
  source: string;
  url: string;
  publishedAt?: string;
  category: string;
  region: RegionId;
  importance?: 'critical' | 'high' | 'medium';
  importanceScore?: number;
};
type CalendarEvent = {
  id: string;
  date: string;
  time: string;
  title: string;
  source: string;
  url: string;
  kind: 'macro' | 'central-bank' | 'earnings';
  importance: 'high' | 'medium';
};
type FedRateExpectation = {
  meetingDate?: string;
  meetingLabel: string;
  currentRate: number;
  impliedRate: number;
  monthlyAverageRate: number;
  expectedChangeBps: number;
  hikeProbability: number;
  cutProbability: number;
  distribution: Array<{ id: string; label: string; probability: number; direction: 'hike' | 'hold' | 'cut' }>;
  updatedAt: string;
  sourceUrl: string;
  quoteSourceUrl: string;
  contractSymbol: string;
  method: string;
  status: 'delayed' | 'unavailable';
};
type OfficialMacroRelease = {
  id: string;
  family: 'ppi' | 'cpi' | 'employment' | 'pce';
  label: string;
  releaseAt: string;
  expectedPeriod: string;
  sourceUrl: string;
};
type MacroReleaseSync = {
  active: boolean;
  synced: boolean;
  pollAfterMs: number;
  checkedAt: string;
  release?: OfficialMacroRelease;
  nextRelease?: OfficialMacroRelease;
};
type Dashboard = {
  generatedAt: string;
  global: Quote | null;
  ticker: TickerIndex[];
  coreIndices: CoreIndex[];
  markets: Quote[];
  macro: Metric[];
  fedRateExpectation: FedRateExpectation | null;
  pmi: Metric[];
  cpi: CpiMetric[];
  commodities: Metric[];
  news: News[];
  focusNews: News[];
  calendar: CalendarEvent[];
  releaseSync?: MacroReleaseSync;
};
const GLOBAL_MACRO_SECTIONS = ['markets', 'macro', 'pmi', 'commodities', 'news', 'calendar'] as const;
type GlobalMacroSection = (typeof GLOBAL_MACRO_SECTIONS)[number];
type DashboardSectionPayload = Partial<Dashboard> & { generatedAt: string };
type FastQuotePayload = DashboardSectionPayload & {
  cadenceMs: number;
  coverage: {
    yahoo: number;
    equities: number;
    globalIndices?: number;
    assets?: number;
    crypto: number;
    latencyMs?: Record<string, number | null>;
  };
};
const EMPTY_DASHBOARD: Dashboard = {
  generatedAt: '',
  global: null,
  ticker: [],
  coreIndices: [],
  markets: [],
  macro: [],
  fedRateExpectation: null,
  pmi: [],
  cpi: [],
  commodities: [],
  news: [],
  focusNews: [],
  calendar: [],
  releaseSync: undefined,
};

type LiveDashboardItem = { id: string; updatedAt?: string; history?: HistoryPoint[] };

function quoteTimestamp(value?: string) {
  const timestamp = value ? new Date(value).getTime() : Number.NaN;
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function mergeDashboardItems<T extends LiveDashboardItem>(
  current: T[],
  incoming: T[],
  preferFreshest: boolean,
) {
  const byId = new Map(current.map((item) => [item.id, item]));
  const order = current.map((item) => item.id);
  incoming.forEach((nextItem) => {
    const currentItem = byId.get(nextItem.id);
    if (!currentItem) {
      byId.set(nextItem.id, nextItem);
      order.push(nextItem.id);
      return;
    }
    const keepCurrentQuote = preferFreshest
      && quoteTimestamp(currentItem.updatedAt) > quoteTimestamp(nextItem.updatedAt);
    const merged = keepCurrentQuote
      ? { ...nextItem, ...currentItem }
      : { ...currentItem, ...nextItem };
    const history = nextItem.history?.length ? nextItem.history : currentItem.history;
    byId.set(nextItem.id, history ? { ...merged, history } : merged);
  });
  return order.flatMap((id) => {
    const item = byId.get(id);
    return item ? [item] : [];
  });
}

function mergeDashboardPayload(
  current: Dashboard | null,
  payload: DashboardSectionPayload,
  preferFreshest: boolean,
): Dashboard {
  const base = current || EMPTY_DASHBOARD;
  const global = payload.global === undefined || payload.global === null
    ? base.global
    : mergeDashboardItems(base.global ? [base.global] : [], [payload.global], preferFreshest)[0] || null;
  return {
    ...base,
    ...payload,
    generatedAt: payload.generatedAt || base.generatedAt || new Date().toISOString(),
    global,
    ticker: payload.ticker ? mergeDashboardItems(base.ticker, payload.ticker, preferFreshest) : base.ticker,
    coreIndices: payload.coreIndices ? mergeDashboardItems(base.coreIndices, payload.coreIndices, preferFreshest) : base.coreIndices,
    markets: payload.markets ? mergeDashboardItems(base.markets, payload.markets, preferFreshest) : base.markets,
    macro: payload.macro ? mergeDashboardItems(base.macro, payload.macro, preferFreshest) : base.macro,
    cpi: payload.cpi ? mergeDashboardItems(base.cpi, payload.cpi, preferFreshest) : base.cpi,
    commodities: payload.commodities ? mergeDashboardItems(base.commodities, payload.commodities, preferFreshest) : base.commodities,
  };
}
type WorldHeatmapStock = {
  id: string;
  symbol: string;
  name: string;
  sector: string;
  logoUrl?: string;
  fallbackLogoUrl?: string;
  weight: number;
  marketCap?: number;
  marketCapType?: 'actual' | 'representative-weight';
  price: number;
  previousClose?: number;
  changePercent: number;
  updatedAt: string;
  sourceUrl: string;
};
type WorldHeatmapResponse = {
  market: string;
  generatedAt: string;
  coverage?: string;
  refreshIntervalMs?: number;
  quoteStatus?: 'live' | 'delayed' | 'closed';
  sourceDelaySeconds?: number | null;
  session?: {
    label: string;
    tone: 'live' | 'pre' | 'closed';
    detail?: string;
    timezone?: string;
    localTime?: string;
  };
  source: string;
  sourceUrl?: string;
  weightMethod: string;
  quotePolicy?: string;
  stocks: WorldHeatmapStock[];
};

const WORLD_HEATMAP_MARKET_IDS = new Set(['japan', 'korea', 'india', 'australia', 'euro', 'germany', 'france', 'uk', 'saudi']);
const WORLD_HEATMAP_REFRESH_INTERVAL_MS = 3_000;
const WORLD_HEATMAP_CLIENT_CACHE_MS = 1_500;
const worldHeatmapClientCache = new Map<string, { storedAt: number; data: WorldHeatmapResponse }>();
const worldHeatmapClientInFlight = new Map<string, Promise<WorldHeatmapResponse>>();
const worldHeatmapPreloadedLogoUrls = new Set<string>();

function preloadWorldHeatmapLogos(payload: WorldHeatmapResponse) {
  if (typeof Image === 'undefined') return;
  payload.stocks.forEach((stock) => {
    if (!stock.logoUrl || worldHeatmapPreloadedLogoUrls.has(stock.logoUrl)) return;
    worldHeatmapPreloadedLogoUrls.add(stock.logoUrl);
    const image = new Image();
    image.decoding = 'async';
    image.src = stock.logoUrl;
  });
}

function loadWorldHeatmap(market: string) {
  const cached = worldHeatmapClientCache.get(market);
  if (cached && Date.now() - cached.storedAt < WORLD_HEATMAP_CLIENT_CACHE_MS) return Promise.resolve(cached.data);
  const running = worldHeatmapClientInFlight.get(market);
  if (running) return running;
  const requestPromise = request<WorldHeatmapResponse>(`/api/global-market-heatmap?market=${encodeURIComponent(market)}`)
    .then((payload) => {
      worldHeatmapClientCache.set(market, { storedAt: Date.now(), data: payload });
      preloadWorldHeatmapLogos(payload);
      return payload;
    })
    .finally(() => worldHeatmapClientInFlight.delete(market));
  worldHeatmapClientInFlight.set(market, requestPromise);
  return requestPromise;
}

function prefetchWorldHeatmap(market: string) {
  if (!WORLD_HEATMAP_MARKET_IDS.has(market)) return Promise.resolve();
  return loadWorldHeatmap(market).then(() => undefined).catch(() => undefined);
}

const WORLD_SPHERE = { type: 'Sphere' } as const;
const WORLD_GRATICULE = geoGraticule10();
let worldCountriesPromise: Promise<FeatureCollection<Geometry>> | null = null;

function loadWorldCountries() {
  if (!worldCountriesPromise) {
    worldCountriesPromise = fetch('/data/world-countries-50m.json')
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<{ objects: { countries: unknown } }>;
      })
      .then((topology) => feature(
        topology as never,
        topology.objects.countries as never,
      ) as unknown as FeatureCollection<Geometry>);
  }
  return worldCountriesPromise;
}

function request<T>(url: string) {
  return fetch(url, { headers: { Accept: 'application/json' } }).then(async (response) => {
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || `HTTP ${response.status}`);
    }
    return response.json() as Promise<T>;
  });
}

function formatNumber(value?: number | null, digits = 2) {
  if (value === undefined || value === null || !Number.isFinite(value)) return '待更新';
  return new Intl.NumberFormat('zh-CN', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value);
}

function formatCompactNumber(value?: number | null) {
  if (value === undefined || value === null || !Number.isFinite(value)) return '待更新';
  return new Intl.NumberFormat('zh-CN', {
    notation: 'compact',
    maximumFractionDigits: 2,
  }).format(value);
}

function zonedDateKey(value: Date, timezone?: string) {
  if (!timezone) return value.toISOString().slice(0, 10);
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(value);
  } catch {
    return value.toISOString().slice(0, 10);
  }
}

function signed(value?: number | null) {
  if (value === undefined || value === null || !Number.isFinite(value)) return '待更新';
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function trendClass(value?: number | null) {
  if (value === undefined || value === null || !Number.isFinite(value) || Math.abs(value) <= 0.03) return 'macro-flat';
  return value > 0 ? 'macro-up' : 'macro-down';
}

function ppiExpectationState(stats?: Metric['stats']) {
  const parseDisplay = (display?: string) => {
    const normalized = display?.replace(/[^\d+.-]/g, '') || '';
    return normalized ? Number(normalized) : Number.NaN;
  };
  const actual = parseDisplay(stats?.[1]?.display);
  const expected = parseDisplay(stats?.[2]?.display);
  if (!Number.isFinite(actual) || !Number.isFinite(expected)) return { tone: 'pending', label: '预期待更新' };
  const surprise = actual - expected;
  if (Math.abs(surprise) < 0.05) return { tone: 'matched', label: '符合预期' };
  return surprise > 0
    ? { tone: 'above', label: '高于预期' }
    : { tone: 'below', label: '低于预期' };
}

function formatSessionCountdown(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const clock = [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':');
  return days > 0 ? `${days}天 ${clock}` : clock;
}

function formatSessionLocalClock(now: number, timezone?: string, fallback?: string) {
  if (!timezone) return fallback || '';
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).format(new Date(now));
  } catch {
    return fallback || '';
  }
}

function heatmapCellColor(changePercent: number) {
  if (changePercent > 0.03) {
    const intensity = Math.min(Math.abs(changePercent) / 7, 1);
    return `rgb(${Math.round(116 + intensity * 126)} ${Math.round(30 + intensity * 24)} ${Math.round(43 + intensity * 26)})`;
  }
  if (changePercent < -0.03) {
    const intensity = Math.min(Math.abs(changePercent) / 10, 1);
    const mix = (from: number, to: number) => Math.round(from + (to - from) * intensity);
    return `rgb(${mix(4, 11)} ${mix(73, 166)} ${mix(42, 96)})`;
  }
  return 'rgb(62 64 68)';
}

function newsTagClass(category: string) {
  const value = category.toLowerCase();
  if (/(地缘|冲突|战争|geopolit|conflict|war)/.test(value)) return 'macro-tag-geo';
  if (/(灾害|灾难|气候|地震|台风|disaster|climate|quake|storm)/.test(value)) return 'macro-tag-disaster';
  if (/(央行|美联储|利率|货币|central|fed|rate)/.test(value)) return 'macro-tag-central';
  if (/(市场|股市|商品|能源|market|equity|commodity)/.test(value)) return 'macro-tag-market';
  if (/(财经|经济|宏观|数据|财报|finance|econom|data|earnings)/.test(value)) return 'macro-tag-finance';
  if (/(政治|政策|选举|politic|policy|election)/.test(value)) return 'macro-tag-politics';
  return 'macro-tag-neutral';
}

function clock(timeZone: string, date = new Date()) {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function WorldClockTime({ timeZone }: { timeZone: string }) {
  const value = clock(timeZone);
  const separatorIndex = value.indexOf(':');
  if (separatorIndex === -1) return <b>{value}</b>;

  return (
    <b className="macro-clock-time" aria-label={value}>
      <span className="macro-clock-digits">{value.slice(0, separatorIndex)}</span>
      <i className="macro-clock-separator" aria-hidden="true">:</i>
      <span className="macro-clock-digits">{value.slice(separatorIndex + 1)}</span>
    </b>
  );
}

function WorldClockBar({ onRefresh }: { onRefresh: () => void }) {
  const [, setMinuteTick] = useState(() => Date.now());

  useEffect(() => {
    let interval: number | undefined;
    const untilNextMinute = 60_000 - (Date.now() % 60_000) + 20;
    const timeout = window.setTimeout(() => {
      setMinuteTick(Date.now());
      interval = window.setInterval(() => setMinuteTick(Date.now()), 60_000);
    }, untilNextMinute);

    return () => {
      window.clearTimeout(timeout);
      if (interval !== undefined) window.clearInterval(interval);
    };
  }, []);

  return (
    <div className="macro-clock">
      <span>纽约 <WorldClockTime timeZone="America/New_York" /></span>
      <span>伦敦 <WorldClockTime timeZone="Europe/London" /></span>
      <span>东京 <WorldClockTime timeZone="Asia/Tokyo" /></span>
      <span>上海 <WorldClockTime timeZone="Asia/Shanghai" /></span>
      <button type="button" onClick={onRefresh} title="刷新真实数据"><RefreshCw size={15} /></button>
    </div>
  );
}

function IndexTickerTape({ items }: { items: TickerIndex[] }) {
  if (!items.length) return <div className="macro-index-tape macro-index-tape-empty">全球主要指数接入中</div>;

  const renderGroup = (copy: number, hidden = false) => (
    <div className="macro-index-group" aria-hidden={hidden || undefined}>
      {items.map((item) => (
        <a
          className="macro-index-quote"
          href={item.sourceUrl}
          target="_blank"
          rel="noreferrer"
          key={`${copy}-${item.id}`}
          title={`${item.name} ${formatNumber(item.price)} ${signed(item.changePercent)}`}
        >
          <span className={trendClass(item.changePercent)} aria-hidden="true" />
          <div>
            <small>{item.name}</small>
            <strong>{formatNumber(item.price)}</strong>
          </div>
          <b className={trendClass(item.changePercent)}>{signed(item.changePercent)}</b>
        </a>
      ))}
    </div>
  );

  return (
    <div className="macro-index-tape" aria-label="全球主要指数滚动行情">
      <div className="macro-index-track">
        {renderGroup(0)}
        {renderGroup(1, true)}
      </div>
    </div>
  );
}

function formatNewsTime(value?: string) {
  if (!value) return '时间待核验';
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp) || timestamp > Date.now() + 5 * 60_000) return '时间待核验';
  const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60_000));
  if (minutes < 60) return `${minutes}分钟前`;
  if (minutes < 1_440) return `${Math.floor(minutes / 60)}小时前`;
  return `${Math.floor(minutes / 1_440)}天前`;
}

function normalizedNewsTitle(title: string) {
  return title.replace(/[\s\p{P}\p{S}]+/gu, '').toLowerCase();
}

function sameTickerStory(left: string, right: string) {
  const bigrams = (title: string) => {
    const normalized = normalizedNewsTitle(title);
    const grams = new Set<string>();
    for (let index = 0; index < normalized.length - 1; index += 1) grams.add(normalized.slice(index, index + 2));
    return grams;
  };
  const leftGrams = bigrams(left);
  const rightGrams = bigrams(right);
  if (!leftGrams.size || !rightGrams.size) return normalizedNewsTitle(left) === normalizedNewsTitle(right);
  const overlap = [...leftGrams].filter((gram) => rightGrams.has(gram)).length;
  return overlap / Math.min(leftGrams.size, rightGrams.size) >= 0.72;
}

function dedupeTickerNews(items: News[]) {
  return items.filter((item, index) => !items.slice(0, index).some((earlier) => sameTickerStory(earlier.title, item.title)));
}

function tickerNewsSignature(items: News[]) {
  return items.map((item) => `${item.id}:${normalizedNewsTitle(item.title)}`).join('|');
}

function GlobalNewsTicker({ news }: { news: News[] }) {
  const nextNews = useMemo(() => dedupeTickerNews(news), [news]);
  const pendingNewsRef = useRef(nextNews);
  const [visibleNews, setVisibleNews] = useState(nextNews);

  useEffect(() => {
    pendingNewsRef.current = nextNews;
    setVisibleNews((current) => current.length ? current : nextNews);
  }, [nextNews]);

  const commitPendingNews = useCallback(() => {
    setVisibleNews((current) => {
      const pending = pendingNewsRef.current;
      return tickerNewsSignature(current) === tickerNewsSignature(pending) ? current : pending;
    });
  }, []);

  const renderGroup = (groupIndex: number) => (
    <div className="macro-news-group" aria-hidden={groupIndex === 1 ? true : undefined}>
      {visibleNews.map((item) => (
        <a
          key={`${groupIndex}-${item.id}`}
          className="macro-news-item"
          href={item.url}
          target="_blank"
          rel="noreferrer"
          tabIndex={groupIndex === 1 ? -1 : undefined}
        >
          <span className={`macro-tag ${newsTagClass(item.category)}`}>{item.category}</span>
          <time>{formatNewsTime(item.publishedAt)}</time>
          <span>{item.title}</span>
        </a>
      ))}
    </div>
  );

  return (
    <div className="macro-news-track" onAnimationIteration={commitPendingNews}>
      {renderGroup(0)}
      {renderGroup(1)}
    </div>
  );
}

function newsImportanceLabel(item: News) {
  if (item.importance === 'critical') return '最高影响';
  if (item.importance === 'high') return '高影响';
  return '重要';
}

type PulseTone = 'positive' | 'negative' | 'neutral';
type VixTone = 'calm' | 'normal' | 'elevated' | 'stress' | 'unavailable';

const PULSE_REGIONS: Array<{ id: Exclude<RegionId, 'global'>; label: string; shortLabel: string }> = [
  { id: 'apac', label: '亚太', shortLabel: 'APAC' },
  { id: 'europe', label: '欧洲', shortLabel: 'EU' },
  { id: 'americas', label: '美洲', shortLabel: 'US' },
  { id: 'middleEast', label: '中东非', shortLabel: 'MEA' },
];

function average(values: Array<number | null | undefined>) {
  const available = values.filter((value): value is number => value !== null && value !== undefined && Number.isFinite(value));
  return available.length ? available.reduce((sum, value) => sum + value, 0) / available.length : 0;
}

function pulseTone(value: number, threshold = 0.12): PulseTone {
  if (value > threshold) return 'positive';
  if (value < -threshold) return 'negative';
  return 'neutral';
}

function vixTemperature(value?: number | null): { tone: VixTone; label: string; summary: string; percent: number } {
  if (value === undefined || value === null || !Number.isFinite(value)) {
    return { tone: 'unavailable', label: '等待数据', summary: 'VIX 最近收盘值暂未更新', percent: 0 };
  }
  const percent = Math.max(2, Math.min(98, (value / 40) * 100));
  if (value < 12) return { tone: 'calm', label: '低波动', summary: '市场定价平静，注意低波动下的拥挤风险', percent };
  if (value < 20) return { tone: 'normal', label: '常态波动', summary: '风险定价处于历史常态观察区间', percent };
  if (value < 30) return { tone: 'elevated', label: '波动升温', summary: '避险需求上升，注意仓位与流动性', percent };
  return { tone: 'stress', label: '高压波动', summary: '市场压力显著，优先关注尾部风险', percent };
}

function pointChange(value?: number | null) {
  if (value === undefined || value === null || !Number.isFinite(value)) return '待更新';
  return `${value > 0 ? '+' : ''}${value.toFixed(2)} pts`;
}

function signalChange(item?: Metric, basisPoints = false) {
  if (item?.change === undefined || item.change === null || !Number.isFinite(item.change)) return '待更新';
  if (basisPoints) {
    const value = Math.round(item.change * 100);
    return `${value > 0 ? '+' : ''}${value}bp`;
  }
  return signed(item.change);
}

function buildPmiSignals(pmi: Metric[]): KeySignal[] {
  const metric = (id: string) => pmi.find((item) => item.id === id);
  const signal = (item: Metric | undefined, id: string, label: string): KeySignal => ({
    id,
    label,
    value: item?.display || '待更新',
    change: pointChange(item?.change),
    rawChange: item?.change,
    note: item?.value === null || item?.value === undefined ? '等待数据' : item.value >= 50 ? '制造业扩张' : '制造业收缩',
    url: item?.sourceUrl,
  });
  const us = metric('pmi-us');
  const china = metric('pmi-china');
  const europe = metric('pmi-europe');
  const japan = metric('pmi-japan');
  const korea = metric('pmi-korea');
  const asiaValues = [japan?.value, korea?.value].filter((value): value is number => value !== null && value !== undefined && Number.isFinite(value));
  const asiaChanges = [japan?.change, korea?.change].filter((value): value is number => value !== null && value !== undefined && Number.isFinite(value));
  const asiaValue = asiaValues.length === 2 ? average(asiaValues) : null;
  const asiaChange = asiaChanges.length === 2 ? average(asiaChanges) : null;

  return [
    signal(us, 'pmi-us', '美国 PMI'),
    signal(china, 'pmi-china', '中国 PMI'),
    signal(europe, 'pmi-europe', '欧洲 PMI'),
    {
      id: 'pmi-asia',
      label: '日韩 PMI',
      value: asiaValue === null ? '待更新' : asiaValue.toFixed(2),
      change: pointChange(asiaChange),
      rawChange: asiaChange,
      note: japan?.value !== null && japan?.value !== undefined && korea?.value !== null && korea?.value !== undefined
        ? `均值 · 日${japan.display}/韩${korea.display}`
        : '等待日韩数据',
      url: 'https://www.spglobal.com/market-intelligence/en/solutions/products/pmi',
    },
  ];
}

function buildMarketSignals(macro: Metric[], commodities: Metric[]): KeySignal[] {
  const metric = (id: string) => macro.find((item) => item.id === id);
  const commodity = (id: string) => commodities.find((item) => item.id === id);
  const dxy = metric('dxy');
  const us10y = metric('us10y');
  const brent = commodity('brent');
  const gold = commodity('gold');

  return [
    { id: 'dxy', label: '美元指数', value: dxy?.display || '待更新', change: signalChange(dxy), rawChange: dxy?.change, note: dxy?.change === undefined || dxy.change === null ? '等待数据' : dxy.change >= 0 ? '美元走强' : '美元走弱', url: dxy?.sourceUrl },
    { id: 'us10y', label: '美债 10Y', value: us10y?.display || '待更新', change: signalChange(us10y, true), rawChange: us10y?.change, note: us10y?.change === undefined || us10y.change === null ? '等待数据' : us10y.change >= 0 ? '利率上行' : '利率下行', url: us10y?.sourceUrl },
    { id: 'brent', label: '布伦特原油', value: brent?.display || '待更新', change: signalChange(brent), rawChange: brent?.change, note: brent?.change === undefined || brent.change === null ? '等待数据' : brent.change >= 0 ? '能源价格走强' : '能源价格走弱', url: brent?.sourceUrl },
    { id: 'gold', label: '黄金', value: gold?.display || '待更新', change: signalChange(gold), rawChange: gold?.change, note: gold?.change === undefined || gold.change === null ? '等待数据' : gold.change >= 0 ? '避险资产走强' : '避险资产走弱', url: gold?.sourceUrl },
  ];
}

function MacroPulsePanel({
  data,
  loading,
  marketSignals,
  crypto,
  onOpenCrypto,
}: {
  data: Dashboard | null;
  loading: boolean;
  marketSignals: KeySignal[];
  crypto: Metric[];
  onOpenCrypto: () => void;
}) {
  const pulse = useMemo(() => {
    const markets = data?.markets || [];
    const macro = data?.macro || [];
    const metric = (id: string) => macro.find((item) => item.id === id);
    const vix = metric('vix');
    const temperature = vixTemperature(vix?.value);

    const regions = PULSE_REGIONS.map((region) => {
      const items = markets.filter((item) => item.region === region.id);
      const change = average(items.map((item) => item.changePercent));
      const regionBreadth = items.length ? items.filter((item) => item.changePercent > 0.03).length / items.length : 0.5;
      const tone = pulseTone(change, 0.12);
      const strength = Math.max(8, Math.min(96, Math.round(50 + change * 12 + (regionBreadth - 0.5) * 32)));
      return { ...region, change, strength, tone, status: tone === 'positive' ? '偏强' : tone === 'negative' ? '偏弱' : '中性' };
    });

    const sessions = PULSE_REGIONS.slice(0, 3).map((region) => {
      const items = markets.filter((item) => item.region === region.id);
      const tone = items.some((item) => item.session.tone === 'live')
        ? 'live'
        : items.some((item) => item.session.tone === 'pre') ? 'pre' : 'closed';
      return { ...region, tone, status: tone === 'live' ? '交易中' : tone === 'pre' ? '将开盘' : '已收盘' };
    });

    return {
      vix: {
        value: vix?.value,
        display: vix?.display || '待更新',
        change: vix?.change,
        sourceUrl: vix?.sourceUrl,
        sourceStatus: vix?.status === 'live' ? '实时' : vix?.status === 'unavailable' ? '待更新' : '最近收盘',
        ...temperature,
      },
      sessions,
      regions,
      drivers: (data?.focusNews || []).slice(0, 5),
    };
  }, [data]);

  return (
    <aside className="macro-left macro-panel" aria-label="全球宏观脉搏">
      <section
        className={`macro-vix-card ${pulse.vix.tone}`}
        role="meter"
        aria-label="VIX 市场波动温度计"
        aria-valuemin={0}
        aria-valuemax={40}
        aria-valuenow={pulse.vix.value ?? undefined}
        aria-valuetext={`${pulse.vix.display}，${pulse.vix.label}`}
      >
        <div className="macro-vix-thermometer" aria-hidden="true">
          <div className="macro-vix-bulb"><i /></div>
          <div className="macro-vix-tube">
            <i style={{ '--vix-percent': `${pulse.vix.percent}%` } as CSSProperties} />
            <em style={{ left: `${pulse.vix.percent}%` }} />
            <span className="macro-vix-identity"><small>VIX</small><b>市场温度</b></span>
            <span className="macro-vix-reading"><small>{pulse.vix.label}</small><strong>{pulse.vix.display}</strong></span>
          </div>
        </div>
        <div className="macro-vix-scale" aria-hidden="true">
          <span><i />平静 &lt;12</span><span><i />常态 12–20</span><span><i />升温 20–30</span><span><i />高压 30+</span>
        </div>
        <div className="macro-vix-status">
          <small>{pulse.vix.summary}</small>
          <span className={trendClass(pulse.vix.change)}>较前值 {pointChange(pulse.vix.change)}</span>
          {pulse.vix.sourceUrl ? <a href={pulse.vix.sourceUrl} target="_blank" rel="noreferrer">行情 · {pulse.vix.sourceStatus}<ExternalLink size={9} /></a> : <i>{pulse.vix.sourceStatus}</i>}
        </div>
      </section>

      <section className="macro-terminal-section macro-key-change-section">
        <p className="macro-section-title">关键变化 · 24H</p>
        <div className="macro-key-change-grid">
          {marketSignals.map((item) => <KeyChangeCard key={item.id} item={item} />)}
        </div>
      </section>

      <section className="macro-terminal-section macro-core-index-section">
        <p className="macro-section-title">核心指数 · 24H</p>
        <div className="macro-core-index-grid">
          {(data?.coreIndices || []).map((item) => <CoreIndexCard key={item.id} item={item} />)}
        </div>
      </section>

      <section className="macro-terminal-section macro-crypto-section">
        <p className="macro-section-title">加密市场</p>
        <div className="macro-crypto-list">{crypto.map((item) => <CryptoRow key={item.id} item={item} onOpen={onOpenCrypto} />)}</div>
      </section>

      <section className="macro-pulse-section macro-driver-section">
        <p className="macro-section-title">华尔街见闻 · 今日要闻</p>
        <div className="macro-driver-list">
          {pulse.drivers.length ? (
            <div className="macro-driver-track">
              <div className="macro-driver-group">
                {pulse.drivers.map((item, index) => (
                  <a key={item.id} href={item.url} target="_blank" rel="noreferrer">
                    <span>{String(index + 1).padStart(2, '0')}</span>
                    <span><strong>{item.title}</strong><small className={`macro-driver-impact ${item.importance || 'medium'}`}>{newsImportanceLabel(item)} · {item.source} · {item.category} · {formatNewsTime(item.publishedAt)}</small></span>
                    <ExternalLink size={11} />
                  </a>
                ))}
              </div>
            </div>
          ) : (
            <div className="macro-pulse-empty"><span className={loading ? 'macro-pulse-loader' : ''} />{loading ? '正在同步华尔街见闻今日要闻' : '华尔街见闻今日新闻暂未更新'}</div>
          )}
        </div>
      </section>
    </aside>
  );
}

function latLngToVector(lat: number, lon: number, radius: number) {
  const latitude = THREE.MathUtils.degToRad(lat);
  const longitude = THREE.MathUtils.degToRad(lon);
  return new THREE.Vector3(
    radius * Math.cos(latitude) * Math.cos(longitude),
    radius * Math.sin(latitude),
    -radius * Math.cos(latitude) * Math.sin(longitude),
  );
}

const MARKET_MARKER_MERGE_DISTANCE_KM = 50;
const HIDDEN_MARKER_LABEL_IDS = new Set(['euro']);
const MARKER_LABEL_PRIORITY = new Map([
  ['us', 0],
  ['nasdaq', 1],
  ['germany', 0],
]);

type MarketMarkerCluster = {
  id: string;
  primary: Quote;
  quotes: Quote[];
  isLive: boolean;
};

function marketDistanceKm(left: Quote, right: Quote) {
  const latitudeDelta = THREE.MathUtils.degToRad(right.latitude - left.latitude);
  const longitudeDelta = THREE.MathUtils.degToRad(right.longitude - left.longitude);
  const leftLatitude = THREE.MathUtils.degToRad(left.latitude);
  const rightLatitude = THREE.MathUtils.degToRad(right.latitude);
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(leftLatitude) * Math.cos(rightLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(Math.max(0, 1 - haversine)));
}

function clusterMarketMarkers(markets: Quote[]) {
  const groups: Quote[][] = [];
  for (const market of markets) {
    const group = groups.find((items) => marketDistanceKm(items[0], market) < MARKET_MARKER_MERGE_DISTANCE_KM);
    if (group) group.push(market);
    else groups.push([market]);
  }

  return groups.flatMap((items): MarketMarkerCluster[] => {
    const quotes = items
      .filter((market) => !HIDDEN_MARKER_LABEL_IDS.has(market.id))
      .sort((left, right) => (MARKER_LABEL_PRIORITY.get(left.id) ?? 100) - (MARKER_LABEL_PRIORITY.get(right.id) ?? 100));
    const primary = quotes[0];
    return primary ? [{
      id: primary.id,
      primary,
      quotes,
      isLive: quotes.some((quote) => quote.session.tone === 'live'),
    }] : [];
  });
}

function MiniLine({ history, color = '#61dfff' }: { history: HistoryPoint[]; color?: string }) {
  const values = history.filter((item) => Number.isFinite(item.value)).slice(-36);
  if (values.length < 2) return <div className="macro-line-empty">等待序列更新</div>;
  const min = Math.min(...values.map((item) => item.value));
  const max = Math.max(...values.map((item) => item.value));
  const span = Math.max(max - min, 0.0001);
  const points = values.map((item, index) => (
    `${(index / (values.length - 1)) * 100},${92 - ((item.value - min) / span) * 78}`
  )).join(' ');
  const area = `0,100 ${points} 100,100`;
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="macro-line" aria-hidden="true">
      <defs>
        <linearGradient id={`line-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.24" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill={`url(#line-${color.replace('#', '')})`} />
      <polyline points={points} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function HologramGlobe({
  markets,
  selectedId,
  onSelect,
  onPrefetch,
}: {
  markets: Quote[];
  selectedId?: string;
  onSelect: (quote: Quote) => void;
  onPrefetch: (quote: Quote) => void;
}) {
  const markerClusters = useMemo(() => clusterMarketMarkers(markets), [markets]);
  const mount = useRef<HTMLDivElement | null>(null);
  const callbackRef = useRef(onSelect);
  const selectedRef = useRef(selectedId);
  const marketsRef = useRef(markets);
  const quoteMapRef = useRef(new Map(markets.map((quote) => [quote.id, quote])));
  const markerClustersRef = useRef(markerClusters);
  const syncMarkerClustersRef = useRef<((clusters: MarketMarkerCluster[]) => void) | null>(null);
  const [labels, setLabels] = useState<Array<{ quote: Quote; markerY: number; x: number; y: number; visible: boolean }>>([]);

  useEffect(() => { callbackRef.current = onSelect; }, [onSelect]);
  useEffect(() => { selectedRef.current = selectedId; }, [selectedId]);
  useEffect(() => {
    marketsRef.current = markets;
    quoteMapRef.current = new Map(markets.map((quote) => [quote.id, quote]));
  }, [markets]);
  useEffect(() => {
    markerClustersRef.current = markerClusters;
    syncMarkerClustersRef.current?.(markerClusters);
  }, [markerClusters]);

  useEffect(() => {
    const host = mount.current;
    if (!host) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(31, 1, 0.1, 40);
    camera.position.set(0, 0, 6.7);
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(renderer.domElement);

    const root = new THREE.Group();
    // Center East Asia slightly north of the equator on first load.
    root.rotation.set(0.21, 2.92, 0);
    scene.add(root);

    const texture = new THREE.TextureLoader().load('/textures/earth-day.jpg');
    texture.colorSpace = THREE.SRGBColorSpace;
    const earthGeometry = new THREE.SphereGeometry(1.72, 96, 96);
    const earthMaterial = new THREE.MeshPhongMaterial({
      map: texture,
      color: '#8ddfff',
      emissive: '#031421',
      emissiveIntensity: 0.72,
      shininess: 24,
      transparent: true,
      opacity: 0.88,
    });
    const earth = new THREE.Mesh(earthGeometry, earthMaterial);
    root.add(earth);

    const graticuleMaterial = new THREE.LineBasicMaterial({ color: '#5adbf7', transparent: true, opacity: 0.16 });
    const graticuleGeometries: THREE.BufferGeometry[] = [];
    for (let latitude = -80; latitude <= 80; latitude += 20) {
      const points = Array.from({ length: 121 }, (_, index) => latLngToVector(latitude, -180 + index * 3, 1.735));
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      graticuleGeometries.push(geometry);
      root.add(new THREE.Line(geometry, graticuleMaterial));
    }
    for (let longitude = -160; longitude <= 180; longitude += 20) {
      const points = Array.from({ length: 61 }, (_, index) => latLngToVector(-90 + index * 3, longitude, 1.735));
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      graticuleGeometries.push(geometry);
      root.add(new THREE.Line(geometry, graticuleMaterial));
    }

    const haloGeometry = new THREE.SphereGeometry(1.83, 64, 64);
    const haloMaterial = new THREE.MeshBasicMaterial({
      color: '#3edcff',
      transparent: true,
      opacity: 0.045,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
    });
    root.add(new THREE.Mesh(haloGeometry, haloMaterial));

    scene.add(new THREE.AmbientLight('#84deff', 1.65));
    const keyLight = new THREE.DirectionalLight('#d9f7ff', 2.3);
    keyLight.position.set(3, 2, 5);
    scene.add(keyLight);

    type GlobeMarkerNode = {
      id: string;
      quoteIds: string[];
      longitude: number;
      group: THREE.Group;
      markerGeometry: THREE.SphereGeometry;
      markerMaterial: THREE.MeshBasicMaterial;
      pulse: THREE.Mesh;
      pulseGeometry: THREE.RingGeometry;
      pulseMaterial: THREE.MeshBasicMaterial;
      isLive: boolean;
    };
    let nodes: GlobeMarkerNode[] = [];

    const createMarkerNode = (cluster: MarketMarkerCluster): GlobeMarkerNode => {
      const quote = cluster.primary;
      const group = new THREE.Group();
      group.position.copy(latLngToVector(quote.latitude, quote.longitude, 1.79));
      const color = quote.changePercent >= 0 ? '#ff667d' : '#38e7b2';
      const markerGeometry = new THREE.SphereGeometry(0.038, 20, 20);
      const markerMaterial = new THREE.MeshBasicMaterial({ color });
      const marker = new THREE.Mesh(markerGeometry, markerMaterial);
      const pulseGeometry = new THREE.RingGeometry(0.056, 0.078, 28);
      const pulseMaterial = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.48, side: THREE.DoubleSide });
      const pulse = new THREE.Mesh(pulseGeometry, pulseMaterial);
      pulse.lookAt(group.position.clone().multiplyScalar(2));
      pulse.visible = cluster.isLive;
      group.add(marker, pulse);
      root.add(group);
      return {
        id: cluster.id,
        quoteIds: cluster.quotes.map((item) => item.id),
        longitude: quote.longitude,
        group,
        markerGeometry,
        markerMaterial,
        pulse,
        pulseGeometry,
        pulseMaterial,
        isLive: cluster.isLive,
      };
    };
    const disposeMarkerNode = (node: GlobeMarkerNode) => {
      root.remove(node.group);
      node.markerGeometry.dispose();
      node.markerMaterial.dispose();
      node.pulseGeometry.dispose();
      node.pulseMaterial.dispose();
    };
    const syncMarkerClusters = (clusters: MarketMarkerCluster[]) => {
      const remaining = new Map(nodes.map((node) => [node.id, node]));
      nodes = clusters.map((cluster) => {
        const existing = remaining.get(cluster.id);
        if (!existing) return createMarkerNode(cluster);
        remaining.delete(cluster.id);
        existing.quoteIds = cluster.quotes.map((quote) => quote.id);
        existing.longitude = cluster.primary.longitude;
        existing.isLive = cluster.isLive;
        existing.group.position.copy(latLngToVector(cluster.primary.latitude, cluster.primary.longitude, 1.79));
        existing.pulse.lookAt(existing.group.position.clone().multiplyScalar(2));
        return existing;
      });
      remaining.forEach(disposeMarkerNode);
    };
    syncMarkerClustersRef.current = syncMarkerClusters;
    syncMarkerClusters(markerClustersRef.current);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const drag = { active: false, moved: false, x: 0, y: 0 };
    const target = { x: root.rotation.x, y: root.rotation.y };
    const zoom = { current: 1, target: 1 };
    let baseCameraZ = 6.7;

    const resize = () => {
      const rect = host.getBoundingClientRect();
      const aspect = rect.width / Math.max(rect.height, 1);
      const cssPixels = Math.max(1, rect.width * rect.height);
      const adaptivePixelRatio = Math.sqrt(4_000_000 / cssPixels);
      renderer.setPixelRatio(Math.max(1, Math.min(window.devicePixelRatio || 1, 1.75, adaptivePixelRatio)));
      camera.aspect = aspect;
      baseCameraZ = 6.7 * Math.max(1, aspect < 1 ? 1.08 / aspect : 1);
      camera.position.z = baseCameraZ / zoom.current;
      camera.updateProjectionMatrix();
      renderer.setSize(rect.width, rect.height, false);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);

    const handleDown = (event: PointerEvent) => {
      drag.active = true;
      drag.moved = false;
      drag.x = event.clientX;
      drag.y = event.clientY;
      host.setPointerCapture(event.pointerId);
    };
    const handleMove = (event: PointerEvent) => {
      if (!drag.active) return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true;
      target.y += dx * 0.008;
      target.x = THREE.MathUtils.clamp(target.x + dy * 0.006, -0.78, 0.78);
      drag.x = event.clientX;
      drag.y = event.clientY;
    };
    const handleUp = (event: PointerEvent) => {
      drag.active = false;
      if (host.hasPointerCapture(event.pointerId)) host.releasePointerCapture(event.pointerId);
      if (drag.moved) return;
      const rect = host.getBoundingClientRect();
      pointer.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -(((event.clientY - rect.top) / rect.height) * 2 - 1),
      );
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(nodes.map((item) => item.group.children[0]))[0];
      if (!hit) return;
      const node = nodes.find((item) => item.group.children[0] === hit.object);
      const quote = node ? marketsRef.current.find((item) => item.id === node.id) : undefined;
      if (quote) callbackRef.current(quote);
    };
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      zoom.target = THREE.MathUtils.clamp(
        zoom.target * Math.exp(-event.deltaY * 0.001),
        0.72,
        1.62,
      );
    };
    host.addEventListener('pointerdown', handleDown);
    host.addEventListener('pointermove', handleMove);
    host.addEventListener('pointerup', handleUp);
    host.addEventListener('wheel', handleWheel, { passive: false });

    let animationFrame = 0;
    let tick = 0;
    const clock = new THREE.Clock();
    const markerWorld = new THREE.Vector3();
    const markerNormal = new THREE.Vector3();
    const markerToCamera = new THREE.Vector3();
    const animate = () => {
      const delta = Math.min(clock.getDelta(), 0.05);
      if (!drag.active) target.y += delta * 0.018;
      const rotationBlend = 1 - Math.exp(-delta * 4.35);
      const zoomBlend = 1 - Math.exp(-delta * 7);
      root.rotation.x += (target.x - root.rotation.x) * rotationBlend;
      root.rotation.y += (target.y - root.rotation.y) * rotationBlend;
      zoom.current += (zoom.target - zoom.current) * zoomBlend;
      camera.position.z = baseCameraZ / zoom.current;
      camera.updateMatrixWorld();
      root.updateMatrixWorld(true);
      const quoteMap = quoteMapRef.current;
      nodes.forEach(({ id, quoteIds, longitude, group, markerMaterial, pulse, pulseMaterial, isLive }) => {
        const quote = quoteMap.get(id);
        if (!quote) return;
        group.getWorldPosition(markerWorld);
        const facing = markerNormal.copy(markerWorld).normalize()
          .dot(markerToCamera.copy(camera.position).sub(markerWorld).normalize());
        group.visible = facing > 0.08;
        const color = quote.changePercent >= 0 ? '#ff667d' : '#38e7b2';
        markerMaterial.color.set(color);
        pulseMaterial.color.set(color);
        pulse.visible = isLive;
        const active = Boolean(selectedRef.current && quoteIds.includes(selectedRef.current));
        const scale = (active ? 1.35 : 1) + Math.sin(Date.now() * 0.003 + longitude) * 0.08;
        pulse.scale.setScalar(scale);
        pulseMaterial.opacity = active ? 0.9 : 0.42;
      });
      if (tick++ % 3 === 0) {
        const rect = host.getBoundingClientRect();
        const projectedLabels = nodes.flatMap(({ quoteIds, group }) => {
          const world = group.getWorldPosition(new THREE.Vector3());
          const facing = world.clone().normalize().dot(camera.position.clone().sub(world).normalize());
          const projected = world.clone().project(camera);
          const rawX = (projected.x * 0.5 + 0.5) * rect.width;
          const rawY = (-projected.y * 0.5 + 0.5) * rect.height;
          const visible = facing > 0.18
            && projected.z < 1
            && rawX > 68
            && rawX < rect.width - 68
            && rawY > 34
            && rawY < rect.height - 42;
          return quoteIds.flatMap((quoteId, index) => {
            const quote = quoteMap.get(quoteId);
            return quote ? [{
              quote,
              x: rawX,
              markerY: rawY,
              y: rawY + 30 + index * 19,
              visible,
            }] : [];
          });
        });
        setLabels(projectedLabels);
      }
      renderer.render(scene, camera);
      animationFrame = requestAnimationFrame(animate);
    };
    resize();
    animate();

    return () => {
      cancelAnimationFrame(animationFrame);
      syncMarkerClustersRef.current = null;
      observer.disconnect();
      host.removeEventListener('pointerdown', handleDown);
      host.removeEventListener('pointermove', handleMove);
      host.removeEventListener('pointerup', handleUp);
      host.removeEventListener('wheel', handleWheel);
      if (renderer.domElement.parentElement === host) host.removeChild(renderer.domElement);
      texture.dispose();
      earthGeometry.dispose();
      earthMaterial.dispose();
      graticuleGeometries.forEach((geometry) => geometry.dispose());
      graticuleMaterial.dispose();
      haloGeometry.dispose();
      haloMaterial.dispose();
      nodes.forEach(disposeMarkerNode);
      renderer.dispose();
    };
  }, []);

  return (
    <div ref={mount} className="macro-holo" aria-label="可旋转全球市场地球">
      {labels.map(({ quote, markerY, x, y, visible }) => visible ? (
        <button
          key={quote.id}
          type="button"
          className={`macro-holo-label ${selectedId === quote.id ? 'active' : ''}`}
          style={{ transform: `translate3d(${x}px, ${y}px, 0) translateX(-50%)` }}
          onPointerEnter={() => onPrefetch(quote)}
          onFocus={() => onPrefetch(quote)}
          onClick={(event) => { event.stopPropagation(); onSelect(quote); }}
        >
          <i className="macro-holo-leader" style={{ height: Math.max(9, y - markerY - 3) }} />
          <span>{quote.name}</span>
          <b className={trendClass(quote.changePercent)}>{signed(quote.changePercent)}</b>
        </button>
      ) : null)}
    </div>
  );
}

function MarketHeatmap({ mode }: { mode: GlobalMarketMode }) {
  if (mode === 'china') return <ChinaMarketHeatmap />;
  if (mode === 'hongkong') return <HongKongMarketHeatmap />;
  if (mode === 'us') return <UsMarketHeatmap />;
  if (mode === 'crypto') return <CryptoMarketHeatmap />;
  return <InternationalMarketHeatmap market={mode as InternationalMarketMode} />;
}

type HeatmapTreeNode = {
  name: string;
  weight?: number;
  stock?: WorldHeatmapStock;
  children?: HeatmapTreeNode[];
};

function WorldMarketHeatmap({ market }: { market: string }) {
  const [data, setData] = useState<WorldHeatmapResponse | null>(() => worldHeatmapClientCache.get(market)?.data || null);
  const [error, setError] = useState('');
  const [selectedStockId, setSelectedStockId] = useState<string | null>(null);
  const [hoveredStockId, setHoveredStockId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let refreshTimer = 0;
    const cached = worldHeatmapClientCache.get(market)?.data || null;
    setData(cached);
    setError('');
    setSelectedStockId(null);
    setHoveredStockId(null);
    const refresh = async () => {
      if (!active) return;
      if (!document.hidden) {
        try {
          const payload = await loadWorldHeatmap(market);
          if (active) {
            setData(payload);
            setError('');
          }
        } catch (reason) {
          if (active && !worldHeatmapClientCache.get(market)) {
            setError(reason instanceof Error ? reason.message : '热力图数据暂时不可用');
          }
        }
      }
      if (active) refreshTimer = window.setTimeout(refresh, WORLD_HEATMAP_REFRESH_INTERVAL_MS);
    };
    void refresh();
    return () => {
      active = false;
      window.clearTimeout(refreshTimer);
    };
  }, [market]);

  const layout = useMemo(() => {
    if (!data?.stocks.length) return null;
    const grouped = new Map<string, WorldHeatmapStock[]>();
    data.stocks.forEach((stock) => grouped.set(stock.sector, [...(grouped.get(stock.sector) || []), stock]));
    const root = hierarchy<HeatmapTreeNode>({
      name: market,
      children: [...grouped.entries()].map(([sector, stocks]) => ({
        name: sector,
        children: stocks.map((stock) => ({ name: stock.name, stock, weight: stock.weight })),
      })),
    }).sum((node) => node.weight || 0).sort((left, right) => (right.value || 0) - (left.value || 0));
    return treemap<HeatmapTreeNode>().size([1000, 620]).paddingOuter(4).paddingInner(3).paddingTop((node) => node.depth === 1 ? 25 : 0)(root);
  }, [data, market]);

  if (error) return <div className="macro-world-heatmap-state"><Globe2 size={28} /><strong>{error}</strong></div>;
  if (!layout || !data) return <div className="macro-world-heatmap-state"><span className="macro-world-loader" /><strong>正在读取成分股行情</strong></div>;
  const latestQuoteAt = data.stocks.reduce((latest, stock) => stock.updatedAt > latest ? stock.updatedAt : latest, '');
  const latestQuoteDate = latestQuoteAt ? new Date(latestQuoteAt) : null;
  const latestQuoteMs = latestQuoteDate?.getTime() || Number.NaN;
  const latestQuoteTime = latestQuoteAt
    ? new Date(latestQuoteAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
    : '--:--:--';
  const refreshSeconds = Math.max(1, Math.round((data.refreshIntervalMs || WORLD_HEATMAP_REFRESH_INTERVAL_MS) / 1000));
  const refreshLabel = data.quoteStatus === 'delayed' && data.sourceDelaySeconds
    ? `源延迟约${Math.max(1, Math.round(data.sourceDelaySeconds / 60))}分钟 · 每${refreshSeconds}秒检查`
    : data.quoteStatus === 'closed'
      ? `${data.session?.label || '已收盘'} · 每${refreshSeconds}秒检查`
      : `盘中 · 每${refreshSeconds}秒刷新`;
  const selectedStock = data.stocks.find((stock) => stock.id === selectedStockId) || null;
  const hoveredStock = data.stocks.find((stock) => stock.id === hoveredStockId) || null;
  const focusedStock = hoveredStock || selectedStock;
  const quoteAgeSeconds = Number.isFinite(latestQuoteMs) ? Math.max(0, Math.round((Date.now() - latestQuoteMs) / 1000)) : null;
  const quoteFromCurrentMarketDate = latestQuoteDate
    ? zonedDateKey(latestQuoteDate, data.session?.timezone) === zonedDateKey(new Date(), data.session?.timezone)
    : false;
  const freshnessSummary = data.quoteStatus === 'delayed'
    ? `非实时：行情授权延迟约 ${Math.max(1, Math.round((data.sourceDelaySeconds || quoteAgeSeconds || 0) / 60))} 分钟`
    : data.quoteStatus === 'closed'
      ? quoteFromCurrentMarketDate
        ? '市场已收盘，显示今日收盘快照'
        : '当前休市，显示上一交易日收盘快照'
      : quoteAgeSeconds !== null && quoteAgeSeconds > 90
        ? `行情已 ${Math.max(2, Math.round(quoteAgeSeconds / 60))} 分钟未更新`
        : '实时行情';
  const freshnessNotice = `${freshnessSummary} · 每 ${refreshSeconds} 秒检查`;
  const freshnessWarning = data.quoteStatus === 'delayed'
    || (data.quoteStatus === 'closed' && !quoteFromCurrentMarketDate)
    || (data.quoteStatus === 'live' && quoteAgeSeconds !== null && quoteAgeSeconds > 90);

  return (
    <div className="macro-world-heatmap">
      <div className="macro-world-plot">
        {layout.descendants().filter((node) => node.depth === 1).map((node) => (
          <div
            key={node.data.name}
            className="macro-world-sector"
            style={{ left: `${node.x0 / 10}%`, top: `${node.y0 / 6.2}%`, width: `${(node.x1 - node.x0) / 10}%`, height: `${(node.y1 - node.y0) / 6.2}%` }}
          ><span>{node.data.name}</span></div>
        ))}
        {layout.leaves().map((node) => {
          const stock = node.data.stock;
          if (!stock) return null;
          const area = (node.x1 - node.x0) * (node.y1 - node.y0);
          return (
            <button
              type="button"
              key={stock.id}
              className={`macro-world-tile ${trendClass(stock.changePercent)} ${area > 55_000 ? 'large' : area > 24_000 ? 'medium' : 'small'} ${selectedStockId === stock.id ? 'selected' : ''}`}
              onClick={() => setSelectedStockId((current) => current === stock.id ? null : stock.id)}
              onPointerEnter={() => setHoveredStockId(stock.id)}
              onPointerLeave={() => setHoveredStockId(null)}
              onFocus={() => setHoveredStockId(stock.id)}
              onBlur={() => setHoveredStockId(null)}
              aria-pressed={selectedStockId === stock.id}
              style={{
                left: `${node.x0 / 10}%`,
                top: `${node.y0 / 6.2}%`,
                width: `${(node.x1 - node.x0) / 10}%`,
                height: `${(node.y1 - node.y0) / 6.2}%`,
                backgroundColor: heatmapCellColor(stock.changePercent),
              }}
              title={`${stock.name} ${stock.symbol} ${signed(stock.changePercent)}`}
            >
              <span className="macro-world-logo" aria-hidden="true">
                <i>{stock.name.slice(0, 1)}</i>
                {stock.logoUrl ? (
                  <img
                    src={stock.logoUrl}
                    alt=""
                    loading="eager"
                    decoding="async"
                    draggable={false}
                    onError={(event) => {
                      const image = event.currentTarget;
                      if (stock.fallbackLogoUrl && image.dataset.fallbackTried !== 'true') {
                        image.dataset.fallbackTried = 'true';
                        image.src = stock.fallbackLogoUrl;
                        return;
                      }
                      image.style.display = 'none';
                    }}
                  />
                ) : null}
              </span>
              <strong>{stock.name}</strong><span className="macro-world-symbol">{stock.symbol}</span><b>{signed(stock.changePercent)}</b><small>{formatNumber(stock.price)}</small>
            </button>
          );
        })}
      {focusedStock ? (
        <div className="macro-world-detail" role="status" aria-live="polite">
          <span className="macro-world-detail-logo" aria-hidden="true">
            <i>{focusedStock.name.slice(0, 1)}</i>
            {focusedStock.logoUrl ? <img src={focusedStock.logoUrl} alt="" draggable={false} /> : null}
          </span>
          <span className="macro-world-detail-name">
            <strong>{focusedStock.name}</strong>
            <small>{focusedStock.symbol} · {focusedStock.sector}</small>
          </span>
          <span><strong>{formatNumber(focusedStock.price)}</strong><small>价格</small></span>
          <span>
            <strong>{focusedStock.marketCapType === 'actual' ? formatCompactNumber(focusedStock.marketCap) : `${formatNumber(focusedStock.weight, 0)}%`}</strong>
            <small>{focusedStock.marketCapType === 'actual' ? '总市值' : '代表权重'}</small>
          </span>
          <span><strong>{formatNumber(focusedStock.previousClose)}</strong><small>昨收</small></span>
          <span><strong className={trendClass(focusedStock.changePercent)}>{signed(focusedStock.changePercent)}</strong><small>涨跌</small></span>
          <span><strong>{new Date(focusedStock.updatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}</strong><small>更新时间</small></span>
          <a href={focusedStock.sourceUrl} target="_blank" rel="noreferrer" aria-label={`查看${focusedStock.name}行情`} title="查看行情">
            <ExternalLink size={15} />
          </a>
        </div>
      ) : null}
      </div>
      <footer className="macro-world-footer">
        <div className="macro-world-footer-meta">
          <a href={data.sourceUrl} target="_blank" rel="noreferrer">{data.source}</a>
          <span>{data.coverage || data.weightMethod}</span>
          <strong className={freshnessWarning ? 'warning' : ''}>{freshnessNotice}</strong>
          <span>数据 {latestQuoteTime}</span>
        </div>
        <div className="macro-world-legend" aria-label="涨跌颜色图例">
          <span><i className="up" />上涨</span>
          <span><i className="down" />下跌</span>
          <span><i className="flat" />平盘</span>
          <RefreshCw size={12} />
        </div>
      </footer>
    </div>
  );
}

function MarketSessionSummary({
  quote,
  mode,
  onRefreshSession,
}: {
  quote: Quote | null;
  mode: GlobalMarketMode | null;
  onRefreshSession: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const refreshedOpeningRef = useRef('');

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const nextOpenAt = quote?.session.nextOpenAt;
  const nextOpenMs = nextOpenAt ? new Date(nextOpenAt).getTime() : Number.NaN;
  useEffect(() => {
    if (!nextOpenAt || !Number.isFinite(nextOpenMs) || now < nextOpenMs || refreshedOpeningRef.current === nextOpenAt) return;
    refreshedOpeningRef.current = nextOpenAt;
    onRefreshSession();
  }, [nextOpenAt, nextOpenMs, now, onRefreshSession]);

  if (!quote && mode !== 'crypto') return null;
  const crypto = !quote && mode === 'crypto';
  const session = quote?.session;
  const isLive = crypto || session?.tone === 'live';
  const isPreOpen = session?.tone === 'pre';
  const localClock = crypto
    ? formatSessionLocalClock(now, 'UTC')
    : formatSessionLocalClock(now, session?.timezone, session?.localTime);
  const countdown = !isLive && Number.isFinite(nextOpenMs)
    ? formatSessionCountdown(nextOpenMs - now)
    : '';
  const label = crypto ? '全天交易' : session?.label || '状态待确认';
  const detail = crypto ? '数字资产市场 24/7' : session?.detail || '交易所状态';

  return (
    <div
      className={`macro-modal-session ${isLive ? 'live' : isPreOpen ? 'pre' : 'closed'}`}
      aria-label={`${label}${countdown ? `，距离下次开盘 ${countdown}` : ''}`}
    >
      <span className="macro-modal-session-state"><i />{label}</span>
      <span className="macro-modal-session-detail">{detail}<b>{localClock ? `当地 ${localClock}` : ''}</b></span>
      {!isLive && countdown ? (
        <span className="macro-modal-session-next">
          <small>下次开盘 · {session?.nextOpenLabel}</small>
          <strong>{countdown}</strong>
        </span>
      ) : null}
    </div>
  );
}

function MarketModal({
  quote,
  mode,
  onClose,
  onOpenMarket,
  onRefreshSession,
}: {
  quote: Quote | null;
  mode: GlobalMarketMode | null;
  onClose: () => void;
  onOpenMarket: (mode: GlobalMarketMode) => void;
  onRefreshSession: () => void;
}) {
  if (!quote && !mode) return null;
  const title = quote?.name || '全球加密资产市场';
  return createPortal(
    <div className="macro-market-modal" role="dialog" aria-modal="true" aria-label={`${title}市场概览`}>
      <button type="button" className="macro-modal-backdrop" onClick={onClose} aria-label="关闭市场预览" />
      <section className="macro-modal-panel">
        <header className="macro-modal-header">
          <div>
            <span className="macro-modal-kicker">MARKET HEATMAP / 市场热力</span>
            <h2>{title}</h2>
          </div>
          <MarketSessionSummary quote={quote} mode={mode} onRefreshSession={onRefreshSession} />
          <div className="macro-modal-quote">
            {quote ? <><strong>{formatNumber(quote.price)}</strong><span className={trendClass(quote.changePercent)}>{signed(quote.changePercent)}</span></> : null}
            {mode ? <button type="button" onClick={() => onOpenMarket(mode)}>进入交易页面 <ArrowRight size={14} /></button> : null}
            {quote && !mode ? <a href={quote.sourceUrl} target="_blank" rel="noreferrer">查看交易所行情 <ExternalLink size={13} /></a> : null}
            <button type="button" className="macro-modal-close" onClick={onClose} aria-label="关闭"><X size={18} /></button>
          </div>
        </header>
        <div className="macro-modal-content">
          {mode ? <MarketHeatmap mode={mode} /> : quote ? <WorldMarketHeatmap market={quote.id} /> : null}
        </div>
      </section>
    </div>,
    document.body,
  );
}

function InteractiveFlatMap({
  markets,
  onSelect,
  onPrefetch,
}: {
  markets: Quote[];
  onSelect: (quote: Quote) => void;
  onPrefetch: (quote: Quote) => void;
}) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ pointerId: number; x: number; y: number; originX: number; originY: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [transform, setTransform] = useState({ scale: 1, x: 0, y: 0 });
  const [size, setSize] = useState({ width: 1200, height: 680 });
  const [worldCountries, setWorldCountries] = useState<FeatureCollection<Geometry> | null>(null);
  const markerClusters = useMemo(() => clusterMarketMarkers(markets), [markets]);

  useEffect(() => {
    let active = true;
    void loadWorldCountries().then((countries) => {
      if (active) setWorldCountries(countries);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return undefined;
    const update = () => {
      const rect = viewport.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) setSize({ width: rect.width, height: rect.height });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  const projection = useMemo(() => geoNaturalEarth1().fitExtent(
    [[20, 16], [Math.max(21, size.width - 20), Math.max(17, size.height - 16)]],
    WORLD_SPHERE,
  ), [size.height, size.width]);
  const mapPath = useMemo(() => geoPath(projection), [projection]);
  const projectedMarkets = useMemo(() => markerClusters.flatMap((cluster) => {
    const point = projection([cluster.primary.longitude, cluster.primary.latitude]);
    return point ? [{ cluster, left: point[0], top: point[1] }] : [];
  }), [markerClusters, projection]);

  const reset = useCallback(() => setTransform({ scale: 1, x: 0, y: 0 }), []);

  const zoom = useCallback((nextScale: number, clientX?: number, clientY?: number) => {
    setTransform((current) => {
      const scale = Math.max(1, Math.min(4, nextScale));
      if (scale === current.scale) return current;
      if (scale < current.scale) {
        const centerRatio = (scale - 1) / Math.max(current.scale - 1, Number.EPSILON);
        return {
          scale,
          x: current.x * centerRatio,
          y: current.y * centerRatio,
        };
      }
      const rect = viewportRef.current?.getBoundingClientRect();
      if (!rect || clientX === undefined || clientY === undefined) return { ...current, scale };
      const pointX = clientX - rect.left - rect.width / 2;
      const pointY = clientY - rect.top - rect.height / 2;
      const ratio = scale / current.scale;
      return {
        scale,
        x: pointX - (pointX - current.x) * ratio,
        y: pointY - (pointY - current.y) * ratio,
      };
    });
  }, []);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('button')) return;
    dragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      originX: transform.x,
      originY: transform.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  }, [transform.x, transform.y]);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const maxX = rect.width * Math.max(0.45, transform.scale * 0.55);
    const maxY = rect.height * Math.max(0.45, transform.scale * 0.55);
    const x = Math.max(-maxX, Math.min(maxX, drag.originX + event.clientX - drag.x));
    const y = Math.max(-maxY, Math.min(maxY, drag.originY + event.clientY - drag.y));
    setTransform((current) => ({ ...current, x, y }));
  }, [transform.scale]);

  const stopDragging = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }, []);

  return (
    <div
      ref={viewportRef}
      className={`macro-map${dragging ? ' dragging' : ''}`}
      onWheel={(event) => {
        event.preventDefault();
        zoom(transform.scale * Math.exp(-event.deltaY * 0.0015), event.clientX, event.clientY);
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={stopDragging}
      onPointerCancel={stopDragging}
      onDoubleClick={reset}
    >
      <div className="macro-map-layer">
        <svg className="macro-vector-map" viewBox={`0 0 ${size.width} ${size.height}`} aria-hidden="true">
          <defs>
            <radialGradient id="macro-ocean-glow" cx="50%" cy="44%" r="65%">
              <stop offset="0%" stopColor="#07141e" />
              <stop offset="72%" stopColor="#030a11" />
              <stop offset="100%" stopColor="#010509" />
            </radialGradient>
          </defs>
          <g transform={`translate(${size.width / 2 + transform.x} ${size.height / 2 + transform.y}) scale(${transform.scale}) translate(${-size.width / 2} ${-size.height / 2})`}>
            <path className="macro-vector-ocean" d={mapPath(WORLD_SPHERE) || undefined} />
            <path className="macro-vector-graticule" d={mapPath(WORLD_GRATICULE) || undefined} />
            <g className="macro-vector-countries">
              {(worldCountries?.features || []).map((country, index) => (
                <path key={country.id ?? index} d={mapPath(country) || undefined} />
              ))}
            </g>
          </g>
        </svg>
        {projectedMarkets.map(({ cluster, left, top }) => (
          <div
            key={cluster.id}
            className="macro-map-marker-cluster"
            style={{
              left: size.width / 2 + (left - size.width / 2) * transform.scale + transform.x,
              top: size.height / 2 + (top - size.height / 2) * transform.scale + transform.y,
            }}
          >
            <i className={`macro-map-shared-marker ${cluster.primary.changePercent >= 0 ? 'up' : 'down'} ${cluster.isLive ? 'live' : ''}`} />
            <div className="macro-map-cluster-labels">
              {cluster.quotes.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onPointerEnter={() => onPrefetch(item)}
                  onFocus={() => onPrefetch(item)}
                  onClick={() => onSelect(item)}
                >
                  <span>{item.name}</span>
                  <b className={trendClass(item.changePercent)}>{signed(item.changePercent)}</b>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="macro-map-controls">
        <button type="button" onClick={() => zoom(transform.scale * 1.25)} title="放大地图" aria-label="放大地图"><Plus size={15} /></button>
        <button type="button" onClick={() => zoom(transform.scale / 1.25)} title="缩小地图" aria-label="缩小地图"><Minus size={15} /></button>
        <button type="button" onClick={reset} title="复位地图" aria-label="复位地图"><Maximize2 size={14} /></button>
      </div>
    </div>
  );
}

export function GlobalMacroCommandCenter({ onOpenMarket }: { onOpenMarket: (market: GlobalMarketMode) => void }) {
  const [view, setView] = useState<'globe' | 'map'>('globe');
  const [data, setData] = useState<Dashboard | null>(null);
  const [selected, setSelected] = useState<Quote | null>(null);
  const [modalMode, setModalMode] = useState<GlobalMarketMode | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const lastFastQuoteFrameRef = useRef('');
  const worldHeatmapWarmupStartedRef = useRef(false);

  const applyFastQuotes = useCallback((payload: FastQuotePayload) => {
    if (payload.generatedAt && payload.generatedAt === lastFastQuoteFrameRef.current) return;
    lastFastQuoteFrameRef.current = payload.generatedAt;
    setData((current) => mergeDashboardPayload(current, payload, false));
    setSelected((current) => {
      if (!current || !payload.markets) return current;
      const incoming = payload.markets.find((item) => item.id === current.id);
      return incoming ? mergeDashboardItems([current], [incoming], false)[0] : current;
    });
    if (payload.markets?.length) setLoading(false);
  }, []);

  const refreshFastQuotes = useCallback(async () => {
    const payload = await request<FastQuotePayload>('/api/global-macro-quotes');
    applyFastQuotes(payload);
    return payload;
  }, [applyFastQuotes]);

  const refreshOfficialMacroRelease = useCallback(async () => {
    const payload = await request<DashboardSectionPayload>('/api/global-macro-release-sync');
    setData((current) => mergeDashboardPayload(current, payload, true));
    return payload;
  }, []);

  const load = useCallback(async (
    sections: readonly GlobalMacroSection[] = GLOBAL_MACRO_SECTIONS,
    reportError = true,
    forceOfficialMacro = false,
  ) => {
    if (reportError) setError('');
    const results = await Promise.allSettled(sections.map(async (section: GlobalMacroSection) => {
      const payload = await request<DashboardSectionPayload>(
        `/api/global-macro-dashboard?region=global&section=${encodeURIComponent(section)}${section === 'macro' && forceOfficialMacro ? '&fresh=1' : ''}`,
      );
      setData((current) => mergeDashboardPayload(current, payload, true));
      if (section === 'markets') setLoading(false);
      return section;
    }));
    const successful = results.filter((result) => result.status === 'fulfilled').length;
    if (successful === 0 && reportError) setError('全球市场各数据接口暂时均不可用');
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
    const historyRefresh = window.setInterval(
      () => void load(['markets', 'commodities'], false),
      5 * 60_000,
    );
    const slowDataRefresh = window.setInterval(
      () => void load(['pmi', 'calendar'], false),
      15 * 60_000,
    );
    const newsRefresh = window.setInterval(() => void load(['news'], false), 30_000);
    return () => {
      window.clearInterval(historyRefresh);
      window.clearInterval(slowDataRefresh);
      window.clearInterval(newsRefresh);
    };
  }, [load]);

  const criticalMacroUnavailable = Boolean(data?.macro?.some((item) => (
    ['ppi', 'cpi-pce'].includes(item.id) && (item.value === null || item.status === 'unavailable')
  )));

  useEffect(() => {
    const releaseSync = data?.releaseSync;
    if (!releaseSync) return undefined;
    let timer: number | undefined;
    let disposed = false;
    const refreshMacro = () => {
      if (disposed) return;
      if (document.hidden) {
        timer = window.setTimeout(refreshMacro, 60_000);
        return;
      }
      if (releaseSync.active && !releaseSync.synced) {
        void refreshOfficialMacroRelease().catch(() => {
          if (!disposed && !document.hidden) timer = window.setTimeout(refreshMacro, 15_000);
        });
      } else {
        void load(['macro'], false, criticalMacroUnavailable);
      }
    };
    timer = window.setTimeout(
      refreshMacro,
      criticalMacroUnavailable ? 15_000 : Math.max(10_000, releaseSync.pollAfterMs),
    );
    const handleVisibility = () => {
      if (!document.hidden && releaseSync.active && !releaseSync.synced) {
        if (timer !== undefined) window.clearTimeout(timer);
        refreshMacro();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', handleVisibility);
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [criticalMacroUnavailable, data?.releaseSync?.checkedAt, load, refreshOfficialMacroRelease]);

  useEffect(() => {
    let disposed = false;
    let eventSource: EventSource | null = null;
    let pollTimer: number | undefined;
    let streamWatchdog: number | undefined;

    const clearTransport = () => {
      if (pollTimer !== undefined) window.clearTimeout(pollTimer);
      if (streamWatchdog !== undefined) window.clearTimeout(streamWatchdog);
      pollTimer = undefined;
      streamWatchdog = undefined;
      if (eventSource) {
        eventSource.onerror = null;
        eventSource.onmessage = null;
        eventSource.close();
        eventSource = null;
      }
    };

    const poll = async () => {
      if (disposed || document.hidden) return;
      try {
        await refreshFastQuotes();
      } catch {
        // The next recursive poll retries without creating overlapping requests.
      }
      if (!disposed && !document.hidden) pollTimer = window.setTimeout(() => void poll(), 4_000);
    };

    const startPolling = (delay = 0) => {
      if (disposed || document.hidden || pollTimer !== undefined) return;
      pollTimer = window.setTimeout(() => {
        pollTimer = undefined;
        void poll();
      }, delay);
    };

    const connectStream = () => {
      if (disposed || document.hidden) return;
      clearTransport();
      if (!('EventSource' in window)) {
        startPolling();
        return;
      }
      eventSource = new EventSource('/api/global-macro-stream');
      streamWatchdog = window.setTimeout(() => {
        clearTransport();
        startPolling();
      }, 12_000);
      eventSource.onmessage = (event) => {
        if (streamWatchdog !== undefined) window.clearTimeout(streamWatchdog);
        streamWatchdog = undefined;
        try {
          applyFastQuotes(JSON.parse(event.data) as FastQuotePayload);
        } catch {
          // Ignore one malformed frame; the stream remains connected for the next quote frame.
        }
      };
      eventSource.onerror = () => {
        clearTransport();
        startPolling(1_000);
      };
    };

    const handleVisibility = () => {
      clearTransport();
      if (!document.hidden) connectStream();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    connectStream();

    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', handleVisibility);
      clearTransport();
    };
  }, [applyFastQuotes, refreshFastQuotes]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setSelected(null); setModalMode(null); }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  useEffect(() => {
    void prefetchInternationalMarketHeatmaps();
  }, []);

  const macro = data?.macro || [];
  const commodities = data?.commodities || [];
  const rightMarketSignals = useMemo(() => buildMarketSignals(data?.macro || [], data?.commodities || []), [data?.macro, data?.commodities]);
  const pmiSignals = useMemo(() => buildPmiSignals(data?.pmi || []), [data?.pmi]);
  const cpiMetrics = data?.cpi || [];
  const macroRiskMetrics = macro.filter((item) => !HIDDEN_MACRO_RISK_IDS.has(item.id));
  const treasurySpread = macro.find((item) => item.id === 'ust2y10y');
  const crypto = commodities.filter((item) => ['bitcoin', 'ethereum'].includes(item.id));
  const markets = data?.markets || [];

  const warmQuoteHeatmap = useCallback((quote: Quote) => {
    if (isInternationalMarketMode(quote.market)) {
      void prefetchInternationalMarketHeatmap(quote.market);
      return;
    }
    void prefetchWorldHeatmap(quote.id);
  }, []);

  const openQuote = useCallback((quote: Quote) => {
    warmQuoteHeatmap(quote);
    setSelected(quote);
    setModalMode(quote.market || null);
  }, [warmQuoteHeatmap]);

  useEffect(() => {
    if (!markets.length || worldHeatmapWarmupStartedRef.current) return;
    worldHeatmapWarmupStartedRef.current = true;
    let cancelled = false;
    const marketIds = markets
      .filter((item) => !isInternationalMarketMode(item.market))
      .map((item) => item.id)
      .filter((id) => WORLD_HEATMAP_MARKET_IDS.has(id));
    const timer = window.setTimeout(() => {
      const queue = [...marketIds];
      const worker = async () => {
        while (!cancelled && queue.length) {
          const market = queue.shift();
          if (market) await prefetchWorldHeatmap(market);
        }
      };
      void Promise.all([worker(), worker(), worker()]);
    }, 150);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [markets.length]);

  return (
    <section className="global-macro-shell">
      <div className="macro-app">
        <header className="macro-ticker macro-panel">
          <div className="macro-vt">
            <span className="macro-status-dot" />
            <div>
              <p className="macro-vt-label">GLOBAL EQUITY PROXY · 全球股票</p>
              <p className="macro-vt-name"><span>VT</span><strong>{formatNumber(data?.global?.price)}</strong><b className={trendClass(data?.global?.changePercent)}>{signed(data?.global?.changePercent)}</b></p>
            </div>
          </div>
          <IndexTickerTape items={data?.ticker || []} />
          <WorldClockBar onRefresh={() => { void load(); void refreshFastQuotes(); }} />
        </header>

        <MacroPulsePanel
          data={data}
          loading={loading}
          marketSignals={rightMarketSignals}
          crypto={crypto}
          onOpenCrypto={() => { setSelected(null); setModalMode('crypto'); }}
        />

        <main className="macro-main macro-panel">
          <div className="macro-stage">
            <div className="macro-stage-head">
              <div><span>GLOBAL EXCHANGE NETWORK</span><h1>全球资本市场主控台</h1></div>
              <div className="macro-mode-toggle">
                <button type="button" className={view === 'globe' ? 'active' : ''} onClick={() => setView('globe')} title="全息地球"><Globe2 size={15} /></button>
                <button type="button" className={view === 'map' ? 'active' : ''} onClick={() => setView('map')} title="平板地图"><MapIcon size={15} /></button>
              </div>
            </div>
            {error ? <button type="button" className="macro-error" onClick={() => void load()}>{error} · 点击重试</button> : null}
            <div className={`macro-globe-wrap ${view === 'map' ? 'flat' : ''}`}>
              {view === 'globe' ? (
                markets.length ? <HologramGlobe markets={markets} selectedId={selected?.id} onSelect={openQuote} onPrefetch={warmQuoteHeatmap} /> : null
              ) : (
                <InteractiveFlatMap markets={markets} onSelect={openQuote} onPrefetch={warmQuoteHeatmap} />
              )}
            </div>
            {loading ? <div className="macro-loading"><span />正在连接全球市场数据</div> : null}
          </div>
        </main>

        <aside className="macro-right macro-panel">
          <section className="macro-terminal-section macro-macro-section">
            <p className="macro-section-title">宏观风险指标</p>
            <div className="macro-metric-list">
              {macroRiskMetrics.map((item) => (
                <a key={item.id} className={`macro-metric-row${item.stats?.length ? ' macro-metric-row-stats' : ''}`} href={item.sourceUrl} target="_blank" rel="noreferrer">
                  {item.stats?.length ? (() => {
                    const expectation = ppiExpectationState(item.stats);
                    return (
                    <span className="macro-metric-stat-layout">
                      <small className="macro-metric-stat-title"><i aria-hidden="true" />美国 PPI</small>
                      <span className="macro-metric-stat-previous">
                        <em>前值</em>
                        <strong>{item.stats[0]?.display}</strong>
                      </span>
                      <span className="macro-metric-stat-primary">
                        <strong className={trendClass(Number(item.stats[1]?.display.replace(/[^\d+.-]/g, '')))}>{item.stats[1]?.display}</strong>
                        <em>同比</em>
                      </span>
                      <span className="macro-metric-stat-change">
                        <em>市场预期</em>
                        <strong>{item.stats[2]?.display}</strong>
                      </span>
                      <span className="macro-metric-stat-rule" aria-hidden="true" />
                      <span className={`macro-metric-stat-verdict ${expectation.tone}`}>
                        <i aria-hidden="true" />{expectation.label}
                      </span>
                      <span className="macro-metric-stat-pressure" aria-hidden="true">
                        <i /><i /><i /><i />
                      </span>
                    </span>
                    );
                  })() : <>
                  <span className="macro-metric-copy">
                    <small>{item.label}</small>
                    {item.parts?.length ? (
                      <strong className="macro-metric-parts">
                        {item.parts.map((part) => <span key={part.label}><em>{part.label}</em>{part.display}</span>)}
                      </strong>
                    ) : <strong>{item.display}</strong>}
                  </span>
                  <span className={`macro-metric-change ${trendClass(item.change)}`}>{item.changeDisplay || signed(item.change)}</span>
                  <span className="macro-metric-chart"><MiniLine history={item.history} color={item.value === null ? '#506273' : '#55d9b0'} /></span>
                  </>}
                </a>
              ))}
            </div>
          </section>

          <section className="macro-terminal-section macro-key-change-section macro-pmi-section">
            <p className="macro-section-title">制造业 PMI · 最新</p>
            <div className="macro-key-change-grid">
              {pmiSignals.map((item) => <KeyChangeCard key={item.id} item={item} />)}
            </div>
          </section>
          <section className="macro-terminal-section macro-cpi-section">
            <p className="macro-section-title">消费者价格 CPI · 最新</p>
            <div className="macro-cpi-grid">
              {(['china-cpi', 'us-cpi'] as const).map((id) => (
                <CpiCard key={id} id={id} item={cpiMetrics.find((metric) => metric.id === id)} />
              ))}
            </div>
          </section>
          <section className="macro-terminal-section macro-treasury-section">
            <p className="macro-section-title">美债期限结构</p>
            <TreasurySpreadCard item={treasurySpread} />
          </section>
          <FedRateExpectationCard expectation={data?.fedRateExpectation || null} />
        </aside>

        <footer className="macro-news macro-panel">
          <span className="macro-news-live"><i /> GLOBAL ALERT</span>
          <div className="macro-news-window">
            {data?.news?.length ? <GlobalNewsTicker news={data.news} /> : <span className="macro-news-empty">今日暂无达到头条级门槛的国际新闻</span>}
          </div>
        </footer>
      </div>

      <MarketModal
        quote={selected}
        mode={modalMode}
        onClose={() => { setSelected(null); setModalMode(null); }}
        onOpenMarket={onOpenMarket}
        onRefreshSession={() => { void refreshFastQuotes(); }}
      />
    </section>
  );
}

function KeyChangeCard({ item }: { item: KeySignal }) {
  const Icon = KEY_SIGNAL_ICONS[item.id];
  return (
    <a className={`macro-key-change-card ${Icon ? `has-asset-icon asset-${item.id}` : ''}`} href={item.url} target="_blank" rel="noreferrer" title={`${item.label} ${item.value} · ${item.change} · ${item.note}`}>
      {Icon ? <span className="macro-key-change-icon" aria-hidden="true"><Icon size={14} strokeWidth={1.8} /></span> : null}
      {Icon ? <span className="macro-key-change-label">{item.label}</span> : null}
      <span className="macro-key-change-copy">
        {!Icon ? <small>{item.label}</small> : null}
        <strong>{item.value}</strong>
      </span>
      <span className="macro-key-change-move">
        <b className={trendClass(item.rawChange)}>{item.change}</b>
        <small>{item.note}</small>
      </span>
    </a>
  );
}

function CpiCard({ id, item }: { id: CpiMetric['id']; item?: CpiMetric }) {
  const isChina = id === 'china-cpi';
  const label = item?.label || (isChina ? '中国 CPI' : '美国 CPI');
  const source = item?.source || (isChina ? '国家统计局' : '美国劳工统计局');
  const sourceUrl = item?.sourceUrl || (isChina
    ? 'https://www.stats.gov.cn/sj/zxfb/'
    : 'https://www.bls.gov/cpi/');
  const available = item?.value !== null && item?.value !== undefined && Number.isFinite(item.value);
  const monthChange = item?.change;
  const monthChangeDisplay = monthChange === null || monthChange === undefined || !Number.isFinite(monthChange)
    ? '待更新'
    : `${monthChange > 0 ? '+' : ''}${monthChange.toFixed(1)}%`;

  return (
    <a
      className={`macro-cpi-card ${isChina ? 'china' : 'us'} ${available ? '' : 'unavailable'}`}
      href={sourceUrl}
      target="_blank"
      rel="noreferrer"
      title={`${label} ${item?.display || '待更新'} · 环比 ${monthChangeDisplay} · ${item?.period || '等待最新一期'}`}
    >
      <span className="macro-cpi-head">
        <span><i />{label}</span>
        <small>{item?.period || '等待数据'}</small>
      </span>
      <span className="macro-cpi-value">
        <strong>{item?.display || '待更新'}</strong>
        <em>同比</em>
      </span>
      <span className="macro-cpi-foot">
        <span>环比 <b className={trendClass(monthChange)}>{monthChangeDisplay}</b></span>
        <small>{source}</small>
      </span>
    </a>
  );
}

function CoreIndexCard({ item }: { item: CoreIndex }) {
  const available = item.changePercent !== null && Number.isFinite(item.changePercent);
  const color = !available || Math.abs(item.changePercent || 0) <= 0.03
    ? '#71849a'
    : (item.changePercent || 0) > 0 ? '#ff4d6d' : '#34e6b1';
  return (
    <a
      className={`macro-core-index-card ${available ? '' : 'is-unavailable'}`}
      href={item.sourceUrl}
      target="_blank"
      rel="noreferrer"
      aria-label={`${item.name}，24小时变化 ${signed(item.changePercent)}`}
      title={`${item.name} ${item.symbol} · ${signed(item.changePercent)}`}
    >
      <span className="macro-core-index-head"><strong>{item.name}</strong><small>{item.symbol}</small></span>
      <b className={trendClass(item.changePercent)}>{signed(item.changePercent)}</b>
      <span className="macro-core-index-period">1M</span>
      <span className="macro-core-index-chart"><MiniLine history={item.history} color={color} /></span>
    </a>
  );
}

function CryptoRow({ item, onOpen }: { item: Metric; onOpen: () => void }) {
  const symbols: Record<string, string> = { bitcoin: 'BTC', ethereum: 'ETH' };
  const symbol = symbols[item.id] || item.id.slice(0, 4).toUpperCase();
  const icon = item.id === 'bitcoin'
    ? <Bitcoin size={18} strokeWidth={2.4} />
    : item.id === 'ethereum'
      ? (
        <svg className="macro-ethereum-mark" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 2 5.7 12.2 12 15.8l6.3-3.6L12 2Z" fill="#627eea" />
          <path d="m12 2 6.3 10.2-6.3 3.6V2Z" fill="#454a75" />
          <path d="m5.7 13.5 6.3 8.5v-4.9l-6.3-3.6Z" fill="#8a92b2" />
          <path d="m12 17.1 6.3-3.6L12 22v-4.9Z" fill="#62688f" />
        </svg>
      )
      : symbol.slice(0, 1);
  return (
    <button type="button" className="macro-crypto-row" onClick={onOpen} aria-label={`打开${item.label}热力图`}>
      <span className={`macro-crypto-icon is-${item.id}`}>{icon}</span>
      <span className="macro-crypto-copy"><strong>{item.label}</strong><small>{symbol}</small></span>
      <span className="macro-crypto-value"><strong>{item.display}</strong><b className={trendClass(item.change)}>{signed(item.change)}</b></span>
    </button>
  );
}

function TreasurySpreadCard({ item }: { item?: Metric }) {
  const value = item?.value;
  const available = value !== undefined && value !== null && Number.isFinite(value);
  const state = !available ? '等待数据' : value < 0 ? '收益率曲线倒挂' : value < 0.25 ? '曲线接近水平' : '收益率曲线正常';
  const tone = !available ? 'unavailable' : value < 0 ? 'inverted' : value < 0.25 ? 'flat' : 'normal';
  const sourceUrl = item?.sourceUrl || 'https://fred.stlouisfed.org/series/T10Y2Y';

  return (
    <a className={`macro-treasury-card ${tone}`} href={sourceUrl} target="_blank" rel="noreferrer">
      <span className="macro-treasury-copy">
        <small>10Y - 2Y · FRED 日频</small>
        <strong>{item?.display || '待更新'}</strong>
        <b>{state}</b>
      </span>
      <span className="macro-treasury-change">
        <small>较前值</small>
        <b className={trendClass(item?.change)}>{item?.change === undefined || item.change === null ? '待更新' : `${item.change > 0 ? '+' : ''}${item.change.toFixed(2)}pct`}</b>
      </span>
      <span className="macro-treasury-chart">
        <MiniLine history={item?.history || []} color={tone === 'inverted' ? '#ff6b81' : tone === 'normal' ? '#52e0b5' : '#d8bd72'} />
      </span>
      <span className="macro-treasury-foot"><i />负值表示倒挂，正值表示长端收益率高于短端</span>
    </a>
  );
}

function FedRateExpectationCard({ expectation }: { expectation: FedRateExpectation | null }) {
  const distribution = expectation?.distribution || [
    { id: 'hold', label: '维持', probability: 0, direction: 'hold' as const },
    { id: 'cut25', label: '降息 25bp', probability: 0, direction: 'cut' as const },
  ];
  const meetingDate = expectation?.meetingDate
    ? new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit' }).format(new Date(`${expectation.meetingDate}T00:00:00Z`))
    : '日期待更新';
  const expectedMove = expectation
    ? `${expectation.expectedChangeBps > 0 ? '+' : ''}${expectation.expectedChangeBps.toFixed(1)}bp`
    : '待更新';
  const sourceUrl = expectation?.sourceUrl || 'https://www.cmegroup.com/markets/interest-rates/cme-fedwatch-tool.html';

  return (
    <section className="macro-terminal-section macro-fed-section">
      <p className="macro-section-title">美联储利率预期</p>
      <a className={`macro-fed-card ${expectation ? '' : 'unavailable'}`} href={sourceUrl} target="_blank" rel="noreferrer">
        <div className="macro-fed-head">
          <span><small>NEXT FOMC · {meetingDate}</small><strong>{expectation ? `${expectation.cutProbability.toFixed(1)}%` : '待更新'}</strong><b>降息概率</b></span>
          <span><small>当前 EFFR → 会后隐含</small><strong>{expectation ? `${expectation.currentRate.toFixed(2)}% → ${expectation.impliedRate.toFixed(2)}%` : '等待期货数据'}</strong><b className={expectation && expectation.expectedChangeBps < 0 ? 'macro-down' : 'macro-flat'}>{expectedMove}</b></span>
        </div>
        <div className="macro-fed-distribution">
          {distribution.map((item) => (
            <div key={item.id} className={`macro-fed-row ${item.direction}`}>
              <span><small>{item.label}</small><b>{expectation ? `${item.probability.toFixed(1)}%` : '—'}</b></span>
              <i role="meter" aria-label={`${item.label}概率`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={expectation ? item.probability : undefined}><em style={{ width: `${expectation ? item.probability : 0}%` }} /></i>
            </div>
          ))}
        </div>
        <footer><span>{expectation ? `${expectation.method} · ${expectation.contractSymbol}` : '等待会议月 ZQ 期货与 FRED 数据'}</span><span>CME 方法说明 <ExternalLink size={9} /></span></footer>
      </a>
    </section>
  );
}
