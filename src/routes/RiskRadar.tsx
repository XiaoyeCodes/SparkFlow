import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Activity,
  AlertTriangle,
  BookOpen,
  BrainCircuit,
  ExternalLink,
  Gauge,
  LockKeyhole,
  RefreshCw,
  ScanSearch,
  Settings2,
  Swords,
  TrendingUp,
  X,
} from 'lucide-react';
import { PageTransition } from '../components/PageTransition';
import type { ValuationDashboard, ValuationMetric, ValuationSnapshot } from '../lib/ibkr/valuationTypes';
import './RiskRadar.css';

type Ticker = 'VOO' | 'QQQ';
type WeightKey = 'buffett' | 'shiller' | 'yield' | 'technical' | 'valuation' | 'volatility' | 'drawdown' | 'sentiment';
type VulnerabilityKey = 'buffett' | 'shiller' | 'valuation' | 'debtService' | 'yield' | 'overheat' | 'greed';
type StressKey = 'creditSpread' | 'nfci' | 'vix' | 'volatility' | 'drawdown' | 'downside' | 'panic' | 'resteepening';
type PricePayload = {
  symbol: string;
  generatedAt: string;
  source: { label: string; url: string };
  points: Array<{ time: string; close: number }>;
};
type InstrumentValuation = Pick<ValuationMetric, 'current' | 'asOf' | 'status' | 'source' | 'sourceUrl' | 'note' | 'eligible' | 'percentile'>;
type RiskRadarValuation = Pick<ValuationDashboard, 'fetchedAt' | 'treasury' | 'sentiment' | 'riskRadar' | 'cache'> & {
  valuations?: Partial<Record<Ticker, InstrumentValuation>>;
};
type RiskRadarHistoryEvent = {
  id: string;
  label: string;
  date: string;
  marketCapRatio: number;
  cape: number;
  tenYear: number;
  twoYear: number;
  fear: number;
  price: number;
  sma: number;
  pe: number;
  volatility: number;
  drawdown: number;
};
type RiskRadarHistory = {
  ticker: Ticker;
  proxySymbol: string;
  proxyLabel: string;
  generatedAt: string;
  source: { label: string; url: string };
  valuationSource: { label: string; url: string };
  events: RiskRadarHistoryEvent[];
};
type RiskTimelinePoint = {
  date: string;
  values: RiskValues;
  sentimentMode: 'cnn' | 'price-proxy';
  valuationMode: 'trailing' | 'scaled-forward' | 'unavailable';
};
type RiskTimelinePayload = {
  generatedAt: string;
  period: { requestedYears: number; start: string; end: string };
  series: Array<{
    ticker: Ticker;
    proxyLabel: string;
    firstDate: string;
    lastDate: string;
    points: RiskTimelinePoint[];
  }>;
  sources: Array<{ label: string; url: string }>;
  methodology: string[];
  cache?: {
    storedAt: string;
    checkedAt: string;
    nextCheckAt: string;
    refreshing: boolean;
    stale: boolean;
    error: string | null;
  };
};
type RiskTimelineCacheEnvelope = { version: 1; storedAt: string; payload: RiskTimelinePayload };
type RiskRadarCacheEnvelope = {
  version: 5;
  ticker: Ticker;
  storedAt: string;
  prices: PricePayload;
  valuation: RiskRadarValuation;
  history: RiskRadarHistory;
};
type Weights = Record<WeightKey, number>;
type DualWeights = {
  vulnerability: Record<VulnerabilityKey, number>;
  stress: Record<StressKey, number>;
};
type Factor = {
  id: string;
  label: string;
  eyebrow: string;
  value: string;
  score: number | null;
  weight: number;
  contribution: number | null;
  detail: string;
  source: string;
  sourceUrl: string;
};

const DEFAULT_WEIGHTS: Weights = { buffett: 10, shiller: 10, yield: 15, technical: 15, valuation: 15, volatility: 10, drawdown: 10, sentiment: 15 };
const DEFAULT_DUAL_WEIGHTS: DualWeights = {
  vulnerability: { buffett: 10, shiller: 15, valuation: 10, debtService: 15, yield: 15, overheat: 20, greed: 15 },
  stress: { creditSpread: 20, nfci: 20, vix: 15, volatility: 10, drawdown: 15, downside: 10, panic: 5, resteepening: 5 },
};
const RISK_CACHE_PREFIX = 'sparkflow.risk-radar.v5.';
const TIMELINE_CACHE_KEY = 'sparkflow.risk-radar.timeline.v1';
const RISK_CACHE_FRESH_MS = 60 * 60_000;
const RISK_CACHE_MAX_MS = 7 * 24 * 60 * 60_000;
const TIMELINE_CACHE_MAX_MS = 14 * 24 * 60 * 60_000;
const SMA_DAYS = 200;
const CHART_DAYS = 252;
const REQUIRED_PRICE_POINTS = SMA_DAYS + CHART_DAYS - 1;
const RISK_WARNING_SCORE = 40;
const RISK_DANGER_SCORE = 70;

function finite(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function formatDate(value: string | null | undefined, withTime = false) {
  if (!value || !Number.isFinite(Date.parse(value))) return '时间待确认';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    ...(withTime ? { hour: '2-digit', minute: '2-digit', hour12: false } : {}),
  }).format(new Date(value));
}

function normalizedWeights(weights: Weights) {
  const total = Object.values(weights).reduce((sum, value) => sum + value, 0);
  if (!total) return Object.fromEntries(Object.keys(weights).map(key => [key, 0])) as Weights;
  return Object.fromEntries(Object.entries(weights).map(([key, value]) => [key, value / total])) as Weights;
}

type RiskValues = {
  marketCapRatio: number | null; cape: number | null; tenYear: number | null; twoYear: number | null;
  fear: number | null; price: number | null; sma: number | null; pe: number | null;
  volatility: number | null; drawdown: number | null;
  creditSpread?: number | null; nfci?: number | null; vix?: number | null; debtService?: number | null; priorCurveMin?: number | null;
};

function continuousScore(value: number | null, anchors: Array<readonly [number, number]>) {
  if (value === null || !finite(value) || !anchors.length) return null;
  if (value <= anchors[0][0]) return anchors[0][1];
  for (let index = 1; index < anchors.length; index++) {
    const [rightValue, rightScore] = anchors[index];
    const [leftValue, leftScore] = anchors[index - 1];
    if (value <= rightValue) {
      const ratio = (value - leftValue) / Math.max(rightValue - leftValue, Number.EPSILON);
      return leftScore + (rightScore - leftScore) * ratio;
    }
  }
  return anchors[anchors.length - 1][1];
}

function factorScores(values: RiskValues) {
  const buffett = values.marketCapRatio === null ? null : values.marketCapRatio > 200 ? 100 : values.marketCapRatio > 180 ? 90 : values.marketCapRatio > 150 ? 75 : values.marketCapRatio > 120 ? 50 : 25;
  const shiller = values.cape === null ? null : values.cape > 40 ? 100 : values.cape > 35 ? 90 : values.cape > 30 ? 70 : values.cape > 25 ? 50 : 20;
  const spread = values.tenYear === null || values.twoYear === null ? null : values.tenYear - values.twoYear;
  const yieldScore = spread === null ? null : spread < -.5 ? 80 : spread < 0 ? 60 : spread < .5 ? 70 : 30;
  const deviation = values.price === null || values.sma === null || values.sma <= 0 ? null : (values.price - values.sma) / values.sma * 100;
  const technical = continuousScore(deviation, [[-20, 5], [-10, 10], [0, 20], [5, 40], [15, 65], [20, 85], [25, 100], [40, 100]]);
  const valuation = continuousScore(values.pe, [[10, 5], [15, 15], [20, 35], [25, 60], [30, 80], [40, 100]]);
  const volatility = continuousScore(values.volatility, [[5, 5], [10, 15], [15, 30], [20, 50], [30, 75], [45, 100]]);
  const drawdown = continuousScore(values.drawdown === null ? null : Math.abs(Math.min(0, values.drawdown)), [[0, 5], [5, 20], [10, 40], [20, 70], [30, 90], [45, 100]]);
  const sentiment = values.fear === null ? null : values.fear > 80 ? 100 : values.fear > 60 ? 70 : values.fear < 20 ? 0 : 40;
  return { buffett, shiller, yield: yieldScore, technical, valuation, volatility, drawdown, sentiment, spread, deviation };
}

function calculateRisk(values: RiskValues, weights: Weights) {
  const scores = factorScores(values);
  const normalized = normalizedWeights(weights);
  const complete = (Object.keys(normalized) as WeightKey[]).every(key => scores[key] !== null);
  const score = complete ? (Object.keys(normalized) as WeightKey[]).reduce((sum, key) => sum + scores[key]! * normalized[key], 0) : null;
  return { score, scores, normalized };
}

function dualFactorScores(values: RiskValues) {
  const legacy = factorScores(values);
  const spread = legacy.spread;
  const deviation = legacy.deviation;
  const inversion = spread === null ? null : continuousScore(-spread, [[-1.5, 5], [-.5, 15], [0, 35], [.5, 70], [1, 90], [2, 100]]);
  const overheat = deviation === null ? null : continuousScore(Math.max(0, deviation), [[0, 5], [3, 20], [7, 40], [10, 60], [15, 75], [20, 90], [25, 100]]);
  const greed = values.fear === null ? null : continuousScore(values.fear, [[0, 5], [45, 10], [55, 25], [65, 50], [75, 70], [85, 90], [100, 100]]);
  const debtService = values.debtService === null || values.debtService === undefined ? null
    : continuousScore(values.debtService, [[8, 5], [9.5, 20], [11, 40], [12, 60], [13, 80], [15, 100]]);
  const creditSpread = values.creditSpread === null || values.creditSpread === undefined ? null
    : continuousScore(values.creditSpread, [[1, 5], [2, 15], [3, 35], [4, 55], [6, 80], [9, 100]]);
  const nfci = values.nfci === null || values.nfci === undefined ? null
    : continuousScore(values.nfci, [[-1, 5], [-.5, 12], [0, 30], [.5, 55], [1, 75], [2, 95], [4, 100]]);
  const vix = values.vix === null || values.vix === undefined ? null
    : continuousScore(values.vix, [[10, 5], [15, 15], [20, 35], [25, 55], [35, 80], [50, 100], [80, 100]]);
  const downside = deviation === null ? null : continuousScore(Math.abs(Math.min(0, deviation)), [[0, 0], [5, 30], [10, 55], [20, 85], [30, 100]]);
  const panic = values.fear === null ? null : continuousScore(100 - values.fear, [[50, 5], [60, 25], [70, 45], [80, 70], [90, 100], [100, 100]]);
  const priorMin = values.priorCurveMin;
  const resteepening = spread === null || priorMin === null || priorMin === undefined || priorMin >= 0 || spread <= priorMin ? 0
    : continuousScore(spread - priorMin, [[0, 0], [.5, 30], [1, 60], [1.5, 80], [2.5, 100]]);
  const buffett = continuousScore(values.marketCapRatio, [[60, 5], [90, 20], [110, 40], [130, 70], [150, 90], [180, 100], [220, 100]]);
  return {
    vulnerability: { buffett, shiller: legacy.shiller, valuation: legacy.valuation, debtService, yield: inversion, overheat, greed },
    stress: { creditSpread, nfci, vix, volatility: legacy.volatility, drawdown: legacy.drawdown, downside, panic, resteepening },
    spread,
    deviation,
  };
}

function weightedLayer<K extends string>(scores: Record<K, number | null>, weights: Record<K, number>) {
  const keys = Object.keys(weights) as K[];
  const available = keys.filter(key => scores[key] !== null);
  const availableWeight = available.reduce((sum, key) => sum + weights[key], 0);
  const score = availableWeight >= 65
    ? available.reduce((sum, key) => sum + scores[key]! * weights[key] / availableWeight, 0)
    : null;
  return { score, coverage: availableWeight, contribution: Object.fromEntries(keys.map(key => [key, scores[key] === null || !availableWeight ? null : scores[key]! * weights[key] / availableWeight])) as Record<K, number | null> };
}

function calculateDualRisk(values: RiskValues, weights: DualWeights) {
  const scores = dualFactorScores(values);
  const vulnerability = weightedLayer(scores.vulnerability, weights.vulnerability);
  const stress = weightedLayer(scores.stress, weights.stress);
  const overall = vulnerability.score === null ? stress.score : stress.score === null ? vulnerability.score : Math.max(vulnerability.score, stress.score);
  return { overall, vulnerability, stress, scores };
}

function compactValuation(value: RiskRadarValuation): RiskRadarValuation {
  return {
    fetchedAt: value.fetchedAt,
    treasury: value.treasury,
    sentiment: value.sentiment,
    riskRadar: value.riskRadar,
    valuations: value.valuations,
    cache: value.cache,
  };
}

function completeRiskInputs(value: RiskRadarValuation | null | undefined, ticker?: Ticker) {
  if (!value) return false;
  const snapshots = [value.riskRadar?.marketCap, value.riskRadar?.gdp, value.riskRadar?.cape,
    value.riskRadar?.treasury2y, value.treasury, value.sentiment];
  return snapshots.every(item => item?.eligible && finite(item.current))
    && (!ticker || recentValuation(value.valuations?.[ticker]) !== null);
}

function completePriceHistory(value: PricePayload | null | undefined): value is PricePayload {
  return (value?.points?.filter(point => finite(point.close) && point.close > 0).length ?? 0) >= REQUIRED_PRICE_POINTS;
}

function completeHistoricalRisk(value: RiskRadarHistory | null | undefined, ticker: Ticker): value is RiskRadarHistory {
  return value?.ticker === ticker && value.events?.length === 3 && value.events.every((event) => (
    event.date && [event.marketCapRatio, event.cape, event.tenYear, event.twoYear, event.fear,
      event.price, event.sma, event.pe, event.volatility, event.drawdown].every(finite)
  ));
}

function recentValuation(metric: InstrumentValuation | undefined) {
  if (!metric || !finite(metric.current)) return null;
  const asOf = Date.parse(metric.asOf || '');
  if (!Number.isFinite(asOf) || asOf > Date.now() + 86_400_000 || Date.now() - asOf > 10 * 86_400_000) return null;
  return metric.current;
}

function instrumentRiskStats(value: PricePayload | null) {
  const closes = (value?.points || []).map(point => point.close).filter(close => finite(close) && close > 0);
  if (closes.length < 61) return { volatility: null, drawdown: null };
  const recent = closes.slice(-61);
  const returns = recent.slice(1).map((close, index) => Math.log(close / recent[index]));
  const mean = returns.reduce((sum, item) => sum + item, 0) / returns.length;
  const variance = returns.reduce((sum, item) => sum + (item - mean) ** 2, 0) / Math.max(1, returns.length - 1);
  const volatility = Math.sqrt(variance) * Math.sqrt(252) * 100;
  const year = closes.slice(-252);
  const peak = Math.max(...year);
  const drawdown = peak > 0 ? (closes[closes.length - 1] / peak - 1) * 100 : null;
  return { volatility, drawdown };
}

function readRiskCache(ticker: Ticker): RiskRadarCacheEnvelope | null {
  try {
    window.localStorage.removeItem(`sparkflow.risk-radar.v1.${ticker}`);
    window.localStorage.removeItem(`sparkflow.risk-radar.v2.${ticker}`);
    window.localStorage.removeItem(`sparkflow.risk-radar.v3.${ticker}`);
    window.localStorage.removeItem(`sparkflow.risk-radar.v4.${ticker}`);
    const parsed = JSON.parse(window.localStorage.getItem(`${RISK_CACHE_PREFIX}${ticker}`) || 'null') as Partial<RiskRadarCacheEnvelope> | null;
    const storedAt = Date.parse(parsed?.storedAt || '');
    if (parsed?.version !== 5 || parsed.ticker !== ticker || !Number.isFinite(storedAt)
      || storedAt > Date.now() + 60_000 || Date.now() - storedAt > RISK_CACHE_MAX_MS
      || !completePriceHistory(parsed.prices) || !completeRiskInputs(parsed.valuation as RiskRadarValuation | undefined, ticker)
      || !completeHistoricalRisk(parsed.history as RiskRadarHistory | undefined, ticker)) {
      window.localStorage.removeItem(`${RISK_CACHE_PREFIX}${ticker}`);
      return null;
    }
    return parsed as RiskRadarCacheEnvelope;
  } catch { return null; }
}

function writeRiskCache(ticker: Ticker, prices: PricePayload, valuation: RiskRadarValuation, history: RiskRadarHistory) {
  try {
    if (!completePriceHistory(prices) || !completeRiskInputs(valuation, ticker) || !completeHistoricalRisk(history, ticker)) {
      window.localStorage.removeItem(`${RISK_CACHE_PREFIX}${ticker}`);
      return null;
    }
    const value: RiskRadarCacheEnvelope = { version: 5, ticker, storedAt: new Date().toISOString(), prices, valuation, history };
    window.localStorage.setItem(`${RISK_CACHE_PREFIX}${ticker}`, JSON.stringify(value));
    return value.storedAt;
  } catch { return null; }
}

function validTimelinePayload(value: RiskTimelinePayload | null | undefined): value is RiskTimelinePayload {
  if (!value || !Number.isFinite(Date.parse(value.generatedAt || '')) || !Array.isArray(value.series) || value.series.length !== 2) return false;
  return value.series.every(series => (series.ticker === 'VOO' || series.ticker === 'QQQ')
    && Number.isFinite(Date.parse(series.firstDate)) && Number.isFinite(Date.parse(series.lastDate))
    && Array.isArray(series.points) && series.points.length > 1);
}

function readTimelineCache(): RiskTimelineCacheEnvelope | null {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(TIMELINE_CACHE_KEY) || 'null') as Partial<RiskTimelineCacheEnvelope> | null;
    const storedAt = Date.parse(parsed?.storedAt || '');
    if (parsed?.version !== 1 || !Number.isFinite(storedAt) || storedAt > Date.now() + 60_000
      || Date.now() - storedAt > TIMELINE_CACHE_MAX_MS || !validTimelinePayload(parsed.payload)) {
      window.localStorage.removeItem(TIMELINE_CACHE_KEY);
      return null;
    }
    return parsed as RiskTimelineCacheEnvelope;
  } catch { return null; }
}

function writeTimelineCache(payload: RiskTimelinePayload) {
  try {
    if (!validTimelinePayload(payload)) return null;
    const value: RiskTimelineCacheEnvelope = { version: 1, storedAt: new Date().toISOString(), payload };
    window.localStorage.setItem(TIMELINE_CACHE_KEY, JSON.stringify(value));
    return value.storedAt;
  } catch { return null; }
}

function riskBand(score: number | null) {
  if (score === null) return { label: '等待数据', zone: '暂不评分', tone: 'unavailable', summary: '部分自动数据源尚未返回可用快照。系统不会用手工默认值代替，数据齐全后会自动生成风险评分。' };
  if (score >= RISK_DANGER_SCORE) return { label: '高压风险', zone: '高风险区', tone: 'high', summary: '宏观与标的风险因子同时出现明显压力，优先检查仓位、现金缓冲和对冲成本。' };
  if (score >= RISK_WARNING_SCORE) return { label: '风险累积', zone: '警戒区', tone: 'elevated', summary: '至少一层风险正在积聚，新增仓位需要更高安全边际。' };
  return { label: '相对安全', zone: '安全区', tone: 'low', summary: '脆弱性与即时压力均处于常态波动范围，维持既定计划并继续观察。' };
}

function chartPath(points: Array<{ close: number; sma: number }>, key: 'close' | 'sma') {
  if (points.length < 2) return '';
  const all = points.flatMap(point => [point.close, point.sma]).filter(value => finite(value) && value > 0);
  const min = Math.min(...all);
  const max = Math.max(...all);
  const span = Math.max(max - min, 1);
  return points.map((point, index) => {
    const x = index / (points.length - 1) * 1000;
    const y = 250 - (point[key] - min) / span * 250;
    return `${index ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
}

function GaugeDial({ score }: { score: number | null }) {
  const safe = score === null ? 0 : Math.max(0, Math.min(100, score));
  const radians = Math.PI - safe / 100 * Math.PI;
  const needle = { x: 150 + Math.cos(radians) * 99, y: 146 - Math.sin(radians) * 99 };
  const marks = [0, 20, 40, 60, 80, 100].map(value => {
    const angle = Math.PI - value / 100 * Math.PI;
    return { value, x: 150 + Math.cos(angle) * 137, y: 146 - Math.sin(angle) * 137 };
  });
  return <div className="risk-gauge" role="meter" aria-label="市场崩盘风险指数" aria-valuemin={0} aria-valuemax={100} {...(score === null ? { 'aria-valuetext': '数据待更新' } : { 'aria-valuenow': Math.round(score), 'aria-valuetext': `${Math.round(score)} / 100` })}>
    <svg viewBox="0 0 300 176" aria-hidden="true">
      <path className="risk-gauge-track" pathLength="100" d="M 30 146 A 120 120 0 0 1 270 146" />
      <path className="risk-gauge-zone safe" pathLength="100" strokeDasharray="40 60" d="M 30 146 A 120 120 0 0 1 270 146" />
      <path className="risk-gauge-zone warning" pathLength="100" strokeDasharray="30 70" strokeDashoffset="-40" d="M 30 146 A 120 120 0 0 1 270 146" />
      <path className="risk-gauge-zone danger" pathLength="100" strokeDasharray="30 70" strokeDashoffset="-70" d="M 30 146 A 120 120 0 0 1 270 146" />
      {marks.map(mark => <text key={mark.value} x={mark.x} y={mark.y + 4} textAnchor="middle" className="risk-gauge-mark">{mark.value}</text>)}
      {score === null ? null : <><line className="risk-gauge-needle" x1="150" y1="146" x2={needle.x} y2={needle.y} /><circle className="risk-gauge-pivot" cx="150" cy="146" r="5" /></>}
      <text x="150" y="126" className="risk-gauge-score">{score === null ? '—' : Math.round(score)}</text>
    </svg>
  </div>;
}

function ReadOnlyMetric({ label, value, unit, snapshot }: { label: string; value: number | null; unit: string; snapshot: ValuationSnapshot | undefined }) {
  const state = snapshot?.eligible ? '已同步' : value !== null ? '已过期' : '待更新';
  const digits = unit === '%' ? 2 : unit.includes('100') ? 0 : 1;
  return <article className={`risk-readonly-input ${snapshot?.eligible ? 'is-live' : 'is-stale'}`}>
    <header><span>{label}</span><b><LockKeyhole size={10} />只读</b></header>
    <strong>{value === null ? '—' : `${value.toFixed(digits)}${unit}`}</strong>
    <small>{state} · {formatDate(snapshot?.asOf)}</small>
    {snapshot?.sourceUrl ? <a href={snapshot.sourceUrl} target="_blank" rel="noopener noreferrer">{snapshot.source}<ExternalLink size={9}/></a> : <span className="risk-source-pending">{snapshot?.source || '来源待连接'}</span>}
  </article>;
}

function TimelineMetric({ label, value, unit, source, sourceUrl, asOf }: { label: string; value: number | null | undefined; unit?: string; source: string; sourceUrl: string; asOf?: string }) {
  return <article className={`risk-readonly-input ${value == null ? 'is-stale' : 'is-live'}`}>
    <header><span>{label}</span><b><LockKeyhole size={10}/>只读</b></header>
    <strong>{value == null ? '—' : `${value.toFixed(2)}${unit || ''}`}</strong>
    <small>{value == null ? '待更新' : '已同步'} · {formatDate(asOf)}</small>
    <a href={sourceUrl} target="_blank" rel="noopener noreferrer">{source}<ExternalLink size={9}/></a>
  </article>;
}

async function fetchJson(url: string, timeoutMs: number, cache: RequestCache = 'default') {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: controller.signal, cache });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    return payload;
  } finally {
    window.clearTimeout(timer);
  }
}

function RiskTimelineChart({ payload, weights, loading, refreshing, error, cacheStoredAt, current }: {
  payload: RiskTimelinePayload | null;
  weights: DualWeights;
  loading: boolean;
  refreshing: boolean;
  error: string;
  cacheStoredAt: string | null;
  current: { ticker: Ticker; date: string; overall: number | null; vulnerability: number | null; stress: number | null } | null;
}) {
  const [cursor, setCursor] = useState<number | null>(null);
  const [mode, setMode] = useState<'overall' | 'vulnerability' | 'stress'>('overall');
  const model = useMemo(() => {
    if (!payload?.series.length) return null;
    const scored = payload.series.map(series => {
      const points = series.points.flatMap(point => {
        const result = calculateDualRisk(point.values, weights);
        const score = mode === 'overall' ? result.overall : result[mode].score;
        return score === null ? [] : [{ ...point, score }];
      });
      const currentScore = current ? current[mode] : null;
      if (current?.ticker === series.ticker && currentScore !== null && current.date && points.length) {
        const last = points[points.length - 1];
        const livePoint = { ...last, date: current.date, score: currentScore };
        if (Date.parse(current.date) > Date.parse(last.date)) points.push(livePoint);
        else if (current.date === last.date) points[points.length - 1] = livePoint;
      }
      return { ...series, lastDate: points[points.length - 1]?.date ?? series.lastDate, points };
    }).filter(series => series.points.length > 1);
    const stamps = scored.flatMap(series => series.points.map(point => Date.parse(point.date))).filter(Number.isFinite);
    if (!stamps.length) return null;
    const minTime = Math.min(...stamps);
    const maxTime = Math.max(...stamps);
    const width = 1200;
    const height = 420;
    const left = 94;
    const right = 34;
    const top = 28;
    const bottom = 52;
    const plotWidth = width - left - right;
    const plotHeight = height - top - bottom;
    const x = (date: string) => left + (Date.parse(date) - minTime) / Math.max(maxTime - minTime, 1) * plotWidth;
    const y = (score: number) => top + (100 - score) / 100 * plotHeight;
    const paths = scored.map(series => ({
      ...series,
      path: series.points.map((point, index) => `${index ? 'L' : 'M'}${x(point.date).toFixed(2)},${y(point.score).toFixed(2)}`).join(' '),
    }));
    const firstYear = new Date(minTime).getUTCFullYear();
    const lastYear = new Date(maxTime).getUTCFullYear();
    const startTick = Math.ceil(firstYear / 5) * 5;
    const years = [firstYear, ...Array.from({ length: Math.max(0, Math.floor((lastYear - startTick) / 5) + 1) }, (_, index) => startTick + index * 5), lastYear]
      .filter((year, index, list) => list.indexOf(year) === index && year >= firstYear && year <= lastYear);
    return { paths, minTime, maxTime, width, height, left, right, top, bottom, plotWidth, plotHeight, x, y, years };
  }, [current, mode, payload, weights]);

  const hovered = useMemo(() => {
    if (!model || cursor === null) return null;
    const time = model.minTime + cursor * (model.maxTime - model.minTime);
    const entries = model.paths.map(series => {
      let best = series.points[0];
      let distance = Math.abs(Date.parse(best.date) - time);
      for (const point of series.points) {
        const nextDistance = Math.abs(Date.parse(point.date) - time);
        if (nextDistance < distance) { best = point; distance = nextDistance; }
      }
      return { ticker: series.ticker, point: best };
    });
    return { time, entries };
  }, [cursor, model]);

  return <section className="risk-panel risk-timeline" aria-label="近30年风险得分走势">
    <header className="risk-timeline-heading">
      <div><span>DUAL-LAYER RISK RECONSTRUCTION</span><h2>近 30 年双层风险走势</h2><p>潜在脆弱性 + 即时市场压力 · 月末/本月最新交易日 · 当前权重实时重算</p></div>
      <div className="risk-timeline-tools"><span className={`risk-timeline-cache-state${payload?.cache?.stale ? ' is-stale' : ''}`}><RefreshCw size={11} className={refreshing || payload?.cache?.refreshing ? 'is-spinning' : ''}/>{refreshing || payload?.cache?.refreshing ? '正在更新历史快照' : payload?.cache?.stale ? '旧缓存 · 等待更新' : '历史快照已缓存'}{payload?.cache?.checkedAt || cacheStoredAt ? ` · ${formatDate(payload?.cache?.checkedAt || cacheStoredAt, true)}` : ''}</span><div className="risk-timeline-mode" aria-label="选择历史风险层">{([
        ['overall', '综合状态'], ['vulnerability', '潜在脆弱性'], ['stress', '即时压力'],
      ] as const).map(([value, label]) => <button type="button" key={value} aria-pressed={mode === value} onClick={() => setMode(value)}>{label}</button>)}</div>
      {model ? <div className="risk-timeline-legend">{model.paths.map(series => { const latest = series.points[series.points.length - 1]; return <span key={series.ticker} className={series.ticker.toLowerCase()} title={`截至 ${formatDate(latest.date)}`}><i />{series.ticker}<b>{latest.score.toFixed(1)}</b><small>{latest.date.slice(0, 7).replace('-', '/')}</small></span>; })}</div> : null}</div>
    </header>
    {loading && !model ? <div className="risk-timeline-state"><RefreshCw className="is-spinning" size={18}/>正在重建历史月度得分…</div> : error && !model ? <div className="risk-timeline-state is-error"><AlertTriangle size={18}/>{error}</div> : model ? <>
      <div className="risk-timeline-frame" onMouseLeave={() => setCursor(null)} onMouseMove={event => {
        const rect = event.currentTarget.getBoundingClientRect();
        const plotLeft = rect.width * model.left / model.width;
        const plotRight = rect.width * (model.width - model.right) / model.width;
        setCursor(Math.max(0, Math.min(1, (event.clientX - rect.left - plotLeft) / Math.max(plotRight - plotLeft, 1))));
      }}>
        <svg viewBox={`0 0 ${model.width} ${model.height}`} role="img" aria-labelledby="risk-timeline-title risk-timeline-desc">
          <title id="risk-timeline-title">VOO 与 QQQ 近30年{mode === 'overall' ? '综合风险' : mode === 'vulnerability' ? '潜在脆弱性' : '即时压力'}走势</title>
          <desc id="risk-timeline-desc">纵轴从零到一百分，绿色为正常区，黄色为警戒区，红色为高风险区。</desc>
          <rect className="risk-timeline-band high" x={model.left} y={model.y(100)} width={model.plotWidth} height={model.y(70) - model.y(100)} />
          <rect className="risk-timeline-band elevated" x={model.left} y={model.y(70)} width={model.plotWidth} height={model.y(40) - model.y(70)} />
          <rect className="risk-timeline-band low" x={model.left} y={model.y(40)} width={model.plotWidth} height={model.y(0) - model.y(40)} />
          {[0, 20, 40, 60, 70, 80, 100].map(value => <g key={value} className={value === 40 || value === 70 ? 'risk-timeline-threshold' : 'risk-timeline-grid'}><line x1={model.left} x2={model.width - model.right} y1={model.y(value)} y2={model.y(value)} /><text x={model.left - 14} y={model.y(value) + 4} textAnchor="end">{value}</text></g>)}
          <text className="risk-timeline-zone-label high" x={18} y={(model.y(100) + model.y(70)) / 2}>高风险</text>
          <text className="risk-timeline-zone-label elevated" x={18} y={(model.y(70) + model.y(40)) / 2}>警戒</text>
          <text className="risk-timeline-zone-label low" x={18} y={(model.y(40) + model.y(0)) / 2}>正常</text>
          {model.years.map(year => { const date = `${year}-01-01`; return <g key={year} className="risk-timeline-year"><line x1={model.x(date)} x2={model.x(date)} y1={model.top} y2={model.height - model.bottom} /><text x={model.x(date)} y={model.height - 22} textAnchor="middle">{year}</text></g>; })}
          {model.paths.map(series => <path key={series.ticker} data-series={series.ticker} className={`risk-timeline-line ${series.ticker.toLowerCase()}`} d={series.path} />)}
          {cursor !== null ? <line className="risk-timeline-cursor" x1={model.left + cursor * model.plotWidth} x2={model.left + cursor * model.plotWidth} y1={model.top} y2={model.height - model.bottom} /> : null}
        </svg>
        {hovered ? <div className="risk-timeline-tooltip" style={{ left: `${Math.max(8, Math.min(84, (cursor ?? 0) * 100))}%` }}><time>{formatDate(new Date(hovered.time).toISOString())}</time>{hovered.entries.map(entry => <span key={entry.ticker} className={entry.ticker.toLowerCase()}><i />{entry.ticker}<b>{entry.point.score.toFixed(1)}</b></span>)}</div> : null}
      </div>
      <div className="risk-timeline-meta"><div><b>0–39</b> 正常区 <b>40–69</b> 警戒区 <b>70–100</b> 高风险区</div><span>{mode === 'overall' ? '综合状态取两层较高值' : mode === 'vulnerability' ? '观察危机前累积的估值与杠杆脆弱性' : '观察信用、融资、波动与市场损伤'} · {model.paths.map(series => `${series.proxyLabel} ${series.firstDate.slice(0, 4)}–${series.lastDate.slice(0, 4)}`).join(' · ')}</span></div>
      <div className="risk-timeline-notes"><p>{payload?.methodology.join(' ')}</p><div>{payload?.sources.map(source => <a key={source.label} href={source.url} target="_blank" rel="noopener noreferrer">{source.label}<ExternalLink size={10}/></a>)}</div></div>
    </> : <div className="risk-timeline-state">暂无可用历史序列</div>}
  </section>;
}

export function RiskRadar() {
  const [initialCache] = useState(() => readRiskCache('VOO'));
  const [initialTimelineCache] = useState(() => readTimelineCache());
  const [ticker, setTicker] = useState<Ticker>('VOO');
  const [weights] = useState<Weights>(DEFAULT_WEIGHTS);
  const [dualWeights, setDualWeights] = useState<DualWeights>(DEFAULT_DUAL_WEIGHTS);
  const [prices, setPrices] = useState<PricePayload | null>(initialCache?.prices ?? null);
  const [valuation, setValuation] = useState<RiskRadarValuation | null>(initialCache?.valuation ?? null);
  const [history, setHistory] = useState<RiskRadarHistory | null>(initialCache?.history ?? null);
  const [cacheStoredAt, setCacheStoredAt] = useState<string | null>(initialCache?.storedAt ?? null);
  const [loading, setLoading] = useState(!initialCache);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [guideOpen, setGuideOpen] = useState(false);
  const [timeline, setTimeline] = useState<RiskTimelinePayload | null>(initialTimelineCache?.payload ?? null);
  const [timelineCacheStoredAt, setTimelineCacheStoredAt] = useState<string | null>(initialTimelineCache?.storedAt ?? null);
  const [timelineLoading, setTimelineLoading] = useState(!initialTimelineCache);
  const [timelineRefreshing, setTimelineRefreshing] = useState(false);
  const [timelineError, setTimelineError] = useState('');

  const load = useCallback(async (force = false) => {
    const saved = readRiskCache(ticker);
    if (!force && saved) {
      setPrices(saved.prices);
      setValuation(saved.valuation);
      setHistory(saved.history);
      setCacheStoredAt(saved.storedAt);
      setLoading(false);
      if (Date.now() - Date.parse(saved.storedAt) < RISK_CACHE_FRESH_MS) return;
    }
    if (force || saved) setRefreshing(true);
    else { setPrices(null); setValuation(null); setHistory(null); setLoading(true); }
    try {
      const [priceResult, valuationPayload, historyPayload] = await Promise.all([
        fetchJson(`/api/equity-report-chart?symbol=${ticker}&range=2y`, 9_000, 'no-cache').catch(() => null),
        fetchJson(`/api/ibkr-valuation/risk-radar${force ? '?fresh=1' : ''}`, 15_000, force ? 'no-store' : 'no-cache'),
        fetchJson(`/api/risk-radar/history?ticker=${ticker}`, 15_000, 'no-cache'),
      ]);
      const nextValuation = valuationPayload as RiskRadarValuation;
      const nextHistory = historyPayload as RiskRadarHistory;
      let nextPrices = priceResult as PricePayload | null;
      let note = '';
      if (!completePriceHistory(nextPrices)) {
        const fullValuation = await fetchJson('/api/ibkr-valuation?years=5', 15_000, force ? 'no-cache' : 'default') as ValuationDashboard;
        const indexKey = ticker === 'VOO' ? 'spx' : 'ndx';
        const proxy = fullValuation.audit.inputs.series[indexKey];
        if (!proxy?.points?.length) throw new Error(`${ticker} 与对应指数历史均暂不可用`);
        nextPrices = {
          symbol: ticker === 'VOO' ? 'SPX' : 'NDX', generatedAt: proxy.asOf || fullValuation.fetchedAt,
          source: { label: `${proxy.source} · ${ticker} 趋势代理`, url: proxy.sourceUrl || 'https://fred.stlouisfed.org/' },
          points: proxy.points.map(point => ({ time: point.date, close: point.value })),
        };
        note = `${ticker} ETF 日线暂不可用，当前使用 ${nextPrices.symbol} 缓存作为趋势代理。`;
      }
      const compact = compactValuation(nextValuation);
      if (!completeRiskInputs(compact, ticker) || !completeHistoricalRisk(nextHistory, ticker)) {
        if (saved) {
          setPrices(saved.prices);
          setValuation(saved.valuation);
          setHistory(saved.history);
          setCacheStoredAt(saved.storedAt);
          setError('自动更新暂未取得完整官方数据，继续显示最近一次成功缓存。');
        } else {
          setPrices(nextPrices);
          setValuation(compact);
          setCacheStoredAt(null);
          setError('官方数据正在补齐，页面将在一分钟内自动重试。');
        }
        return;
      }
      setPrices(nextPrices);
      setValuation(compact);
      setHistory(nextHistory);
      setCacheStoredAt(writeRiskCache(ticker, nextPrices, compact, nextHistory));
      setError(note);
    } catch (reason) {
      setError(saved ? '自动更新暂不可用，继续显示本地缓存。' : reason instanceof Error ? reason.message : '风险数据暂不可用');
    } finally {
      setLoading(false); setRefreshing(false);
    }
  }, [ticker]);

  const loadTimeline = useCallback(async (force = false) => {
    const saved = readTimelineCache();
    if (!force && saved) {
      setTimeline(saved.payload);
      setTimelineCacheStoredAt(saved.storedAt);
      setTimelineLoading(false);
      if (Date.now() - Date.parse(saved.storedAt) < RISK_CACHE_FRESH_MS) return;
    }
    setTimelineRefreshing(true);
    if (!saved) setTimelineLoading(true);
    try {
      const payload = await fetchJson(`/api/risk-radar/timeline${force ? '?refresh=1' : ''}`, 60_000, force ? 'no-store' : 'no-cache') as RiskTimelinePayload;
      if (!validTimelinePayload(payload)) throw new Error('RISK_TIMELINE_INVALID');
      setTimeline(payload);
      setTimelineCacheStoredAt(writeTimelineCache(payload));
      setTimelineError(payload.cache?.error || '');
    } catch {
      setTimelineError(saved ? '历史走势更新失败，继续显示最近一次成功缓存。' : '历史走势暂时无法加载，请稍后刷新。');
    } finally {
      setTimelineLoading(false);
      setTimelineRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => { void load(); }, 60 * 60_000);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    void loadTimeline();
    const timer = window.setInterval(() => { void loadTimeline(); }, RISK_CACHE_FRESH_MS);
    return () => window.clearInterval(timer);
  }, [loadTimeline]);

  useEffect(() => {
    if (!timeline?.cache?.refreshing) return;
    const timer = window.setTimeout(() => { void loadTimeline(true); }, 20_000);
    return () => window.clearTimeout(timer);
  }, [loadTimeline, timeline?.cache?.refreshing]);

  useEffect(() => {
    if (!valuation || completeRiskInputs(valuation, ticker)) return;
    const timer = window.setInterval(() => { void load(true); }, 60_000);
    return () => window.clearInterval(timer);
  }, [load, ticker, valuation]);

  useEffect(() => {
    if (!guideOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setGuideOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [guideOpen]);

  const refreshAll = useCallback(async () => {
    await Promise.all([load(true), loadTimeline(true)]);
  }, [load, loadTimeline]);

  const priceSeries = useMemo(() => {
    const points = (prices?.points || []).filter(point => finite(point.close) && point.close > 0);
    return points.map((point, index) => ({ ...point, sma: index >= SMA_DAYS - 1
      ? points.slice(index + 1 - SMA_DAYS, index + 1).reduce((sum, row) => sum + row.close, 0) / SMA_DAYS : NaN }))
      .filter(point => finite(point.sma)).slice(-CHART_DAYS);
  }, [prices]);
  const timelineSeries = useMemo(() => timeline?.series.find(series => series.ticker === ticker) ?? null, [ticker, timeline]);
  const latestTimelinePoint = timelineSeries?.points[timelineSeries.points.length - 1] ?? null;
  const current = priceSeries[priceSeries.length - 1];
  const instrumentStats = useMemo(() => instrumentRiskStats(prices), [prices]);
  const cachedAt = cacheStoredAt ? Date.parse(cacheStoredAt) : NaN;
  const staleBrowserCache = Number.isFinite(cachedAt) && Date.now() - cachedAt >= RISK_CACHE_FRESH_MS;
  const syncLabel = refreshing
    ? staleBrowserCache ? '旧缓存 · 正在更新' : '正在检查最新数据'
    : staleBrowserCache ? '旧缓存 · 更新待恢复' : cacheStoredAt ? '已缓存 · 每小时检查' : '自动数据源已连接';
  const checkedAt = valuation?.cache?.checkedAt || cacheStoredAt;
  const usingIndexProxy = prices?.symbol !== ticker;
  const targetLabel = usingIndexProxy ? `${ticker} · ${prices?.symbol} 趋势代理` : ticker;
  const radar = valuation?.riskRadar;
  const marketCapRaw = finite(radar?.marketCap?.current) ? radar.marketCap.current : null;
  const gdpRaw = finite(radar?.gdp?.current) ? radar.gdp.current : null;
  const capeRaw = finite(radar?.cape?.current) ? radar.cape.current : null;
  const twoYearRaw = finite(radar?.treasury2y?.current) ? radar.treasury2y.current : null;
  const fearRaw = finite(valuation?.sentiment.current) ? valuation.sentiment.current : null;
  const tenYearRaw = finite(valuation?.treasury.current) ? valuation.treasury.current : null;
  const instrumentValuation = valuation?.valuations?.[ticker];
  const valuationTicker = ticker === 'VOO' ? 'SPY' : 'QQQ';
  const pe = recentValuation(instrumentValuation);
  const marketCapRatioRaw = marketCapRaw !== null && gdpRaw !== null && gdpRaw > 0 ? marketCapRaw / gdpRaw * 100 : null;
  const marketCapRatio = radar?.marketCap?.eligible && radar?.gdp?.eligible ? marketCapRatioRaw : null;
  const cape = radar?.cape?.eligible ? capeRaw : null;
  const twoYear = radar?.treasury2y?.eligible ? twoYearRaw : null;
  const tenYear = valuation?.treasury.eligible ? tenYearRaw : null;
  const fear = valuation?.sentiment.eligible ? fearRaw : null;
  const values: RiskValues = { marketCapRatio, cape, tenYear, twoYear, fear, price: current?.close ?? null, sma: current?.sma ?? null,
    pe, volatility: instrumentStats.volatility, drawdown: instrumentStats.drawdown,
    creditSpread: latestTimelinePoint?.values.creditSpread ?? null,
    nfci: latestTimelinePoint?.values.nfci ?? null,
    vix: latestTimelinePoint?.values.vix ?? null,
    debtService: latestTimelinePoint?.values.debtService ?? null,
    priorCurveMin: latestTimelinePoint?.values.priorCurveMin ?? null,
  };
  const result = calculateRisk(values, weights);
  const dualResult = calculateDualRisk(values, dualWeights);
  const band = riskBand(dualResult.overall);
  const spreadStatus = result.scores.spread === null ? '数据待更新' : result.scores.spread < -.5 ? '深度倒挂' : result.scores.spread < 0 ? '轻度倒挂' : result.scores.spread < .5 ? '低正利差' : '正常斜率';
  const formatValue = (value: number | null, digits: number, suffix = '') => value === null ? '—' : `${value >= 0 && suffix === '%' ? '+' : ''}${value.toFixed(digits)}${suffix}`;
  const vulnerabilityFactors: Factor[] = [
    { id: 'v-buffett', label: '巴菲特指标', eyebrow: 'MARKET CAP / GDP', value: marketCapRatioRaw === null ? '—' : `${marketCapRatioRaw.toFixed(1)}%`, score: dualResult.scores.vulnerability.buffett, weight: dualWeights.vulnerability.buffett, contribution: dualResult.vulnerability.contribution.buffett, detail: '衡量股权市场相对实体经济规模的长期估值压力', source: `${radar?.marketCap.source || 'Federal Reserve Z.1'} + ${radar?.gdp.source || 'BEA GDP'}`, sourceUrl: radar?.marketCap.sourceUrl || 'https://fred.stlouisfed.org/series/NCBEILQ027S' },
    { id: 'v-shiller', label: '席勒市盈率', eyebrow: 'SHILLER CAPE', value: capeRaw === null ? '—' : `${capeRaw.toFixed(1)}x`, score: dualResult.scores.vulnerability.shiller, weight: dualWeights.vulnerability.shiller, contribution: dualResult.vulnerability.contribution.shiller, detail: '过去十年经通胀调整盈利的周期估值', source: radar?.cape.source || 'Robert Shiller / Multpl · CAPE', sourceUrl: radar?.cape.sourceUrl || 'https://www.multpl.com/shiller-pe' },
    { id: 'v-valuation', label: `${valuationTicker} 市盈率`, eyebrow: `${valuationTicker} P/E`, value: pe === null ? '—' : `${pe.toFixed(1)}x`, score: dualResult.scores.vulnerability.valuation, weight: dualWeights.vulnerability.valuation, contribution: dualResult.vulnerability.contribution.valuation, detail: `${ticker === 'VOO' ? '使用 SPY 同指数估值代理' : '使用 QQQ / NDX 可得估值'}；缺失月份在本层按可用权重归一化`, source: instrumentValuation?.source || `${valuationTicker} 估值数据`, sourceUrl: instrumentValuation?.sourceUrl || `https://finance.yahoo.com/quote/${valuationTicker}` },
    { id: 'v-debt', label: '家庭债务偿付率', eyebrow: 'HOUSEHOLD DSR', value: values.debtService == null ? '—' : `${values.debtService.toFixed(1)}%`, score: dualResult.scores.vulnerability.debtService, weight: dualWeights.vulnerability.debtService, contribution: dualResult.vulnerability.contribution.debtService, detail: '家庭所需债务付款占可支配收入比例；FRED序列自2005年起可用', source: 'Federal Reserve / FRED · TDSP', sourceUrl: 'https://fred.stlouisfed.org/series/TDSP' },
    { id: 'v-yield', label: '曲线倒挂脆弱性', eyebrow: 'US 10Y − 2Y', value: formatValue(result.scores.spread, 2, '%'), score: dualResult.scores.vulnerability.yield, weight: dualWeights.vulnerability.yield, contribution: dualResult.vulnerability.contribution.yield, detail: `${spreadStatus} · 倒挂越深，脆弱性得分越高`, source: 'U.S. Treasury / FRED · DGS10 − DGS2', sourceUrl: 'https://fred.stlouisfed.org/series/T10Y2Y' },
    { id: 'v-overheat', label: '趋势过热', eyebrow: 'PRICE ABOVE SMA200', value: formatValue(Math.max(0, result.scores.deviation ?? 0), 1, '%'), score: dualResult.scores.vulnerability.overheat, weight: dualWeights.vulnerability.overheat, contribution: dualResult.vulnerability.contribution.overheat, detail: '只衡量向上偏离造成的拥挤和过热，不再把下跌阶段混入同一方向', source: prices?.source.label || 'Yahoo Finance · 日线收盘', sourceUrl: prices?.source.url || `https://finance.yahoo.com/quote/${ticker}` },
    { id: 'v-greed', label: '贪婪情绪', eyebrow: 'RISK APPETITE', value: fearRaw === null ? '—' : `${Math.round(fearRaw)} / 100`, score: dualResult.scores.vulnerability.greed, weight: dualWeights.vulnerability.greed, contribution: dualResult.vulnerability.contribution.greed, detail: '只把高贪婪计入脆弱性；极端恐惧在压力层单独计分', source: valuation?.sentiment.source || 'CNN · Fear & Greed', sourceUrl: valuation?.sentiment.sourceUrl || 'https://www.cnn.com/markets/fear-and-greed' },
  ];
  const stressFactors: Factor[] = [
    { id: 's-credit', label: 'Baa 企业债利差', eyebrow: 'CREDIT SPREAD', value: values.creditSpread == null ? '—' : `${values.creditSpread.toFixed(2)}%`, score: dualResult.scores.stress.creditSpread, weight: dualWeights.stress.creditSpread, contribution: dualResult.stress.contribution.creditSpread, detail: 'Baa企业债收益率相对10年期美债的利差，反映信用风险与融资压力', source: 'Federal Reserve / FRED · BAA10Y', sourceUrl: 'https://fred.stlouisfed.org/series/BAA10Y' },
    { id: 's-nfci', label: '全国金融条件', eyebrow: 'CHICAGO FED NFCI', value: values.nfci == null ? '—' : values.nfci.toFixed(2), score: dualResult.scores.stress.nfci, weight: dualWeights.stress.nfci, contribution: dualResult.stress.contribution.nfci, detail: 'Chicago Fed综合货币、债券、股票及银行体系的周度金融条件指数', source: 'Chicago Fed / FRED · NFCI', sourceUrl: 'https://fred.stlouisfed.org/series/NFCI' },
    { id: 's-vix', label: 'VIX 隐含波动率', eyebrow: '30D IMPLIED VOL', value: values.vix == null ? '—' : values.vix.toFixed(1), score: dualResult.scores.stress.vix, weight: dualWeights.stress.vix, contribution: dualResult.stress.contribution.vix, detail: '由SPX期权价格反映的近期期望波动率', source: 'Cboe / FRED · VIXCLS', sourceUrl: 'https://fred.stlouisfed.org/series/VIXCLS' },
    { id: 's-volatility', label: '60 日实际波动', eyebrow: `${ticker} REALIZED VOL`, value: instrumentStats.volatility === null ? '—' : `${instrumentStats.volatility.toFixed(1)}%`, score: dualResult.scores.stress.volatility, weight: dualWeights.stress.volatility, contribution: dualResult.stress.contribution.volatility, detail: '最近60个交易日对数收益率样本标准差，按252个交易日年化', source: prices?.source.label || 'Yahoo Finance · 日线收盘', sourceUrl: prices?.source.url || `https://finance.yahoo.com/quote/${ticker}` },
    { id: 's-drawdown', label: '近一年当前回撤', eyebrow: `${ticker} 52W DRAWDOWN`, value: formatValue(instrumentStats.drawdown, 1, '%'), score: dualResult.scores.stress.drawdown, weight: dualWeights.stress.drawdown, contribution: dualResult.stress.contribution.drawdown, detail: '当前收盘价相对最近252个交易日最高收盘价的回撤', source: prices?.source.label || 'Yahoo Finance · 日线收盘', sourceUrl: prices?.source.url || `https://finance.yahoo.com/quote/${ticker}` },
    { id: 's-downside', label: '跌破200日均线', eyebrow: 'DOWNSIDE TREND', value: formatValue(Math.min(0, result.scores.deviation ?? 0), 1, '%'), score: dualResult.scores.stress.downside, weight: dualWeights.stress.downside, contribution: dualResult.stress.contribution.downside, detail: '只衡量向下偏离造成的趋势破坏', source: prices?.source.label || 'Yahoo Finance · 日线收盘', sourceUrl: prices?.source.url || `https://finance.yahoo.com/quote/${ticker}` },
    { id: 's-panic', label: '恐慌情绪', eyebrow: 'EXTREME FEAR', value: fearRaw === null ? '—' : `${Math.round(fearRaw)} / 100`, score: dualResult.scores.stress.panic, weight: dualWeights.stress.panic, contribution: dualResult.stress.contribution.panic, detail: '极端恐惧提高即时压力，不再被当作安全信号', source: valuation?.sentiment.source || 'CNN · Fear & Greed', sourceUrl: valuation?.sentiment.sourceUrl || 'https://www.cnn.com/markets/fear-and-greed' },
    { id: 's-resteep', label: '倒挂后重新陡峭', eyebrow: 'CURVE RE-STEEPENING', value: values.priorCurveMin == null || result.scores.spread === null ? '—' : `${(result.scores.spread - values.priorCurveMin).toFixed(2)}%`, score: dualResult.scores.stress.resteepening, weight: dualWeights.stress.resteepening, contribution: dualResult.stress.contribution.resteepening, detail: '过去18个月出现倒挂后，曲线快速重新陡峭视为压力阶段信号', source: 'U.S. Treasury / FRED · DGS10 − DGS2', sourceUrl: 'https://fred.stlouisfed.org/series/T10Y2Y' },
  ];
  const factors = [...vulnerabilityFactors, ...stressFactors];
  const historical = (history?.events || []).map(item => {
    const year = item.label.match(/^\d{4}/)?.[0] || item.date.slice(0, 4);
    const candidates = (timelineSeries?.points || []).filter(point => point.date.startsWith(year)).map(point => ({ point, risk: calculateDualRisk(point.values, dualWeights) }));
    candidates.sort((left, right) => (right.risk.overall ?? -1) - (left.risk.overall ?? -1));
    const selected = candidates[0];
    const point = selected?.point;
    const score = selected?.risk ?? null;
    return { ...item, date: point?.date ?? item.date, score: score?.overall ?? null, vulnerability: score?.vulnerability.score ?? null, stress: score?.stress.score ?? null };
  });
  const comparison = [{ label: '当前市场', date: formatDate(prices?.generatedAt), score: dualResult.overall }, ...historical];
  const pricePath = chartPath(priceSeries, 'close');
  const smaPath = chartPath(priceSeries, 'sma');

  return <PageTransition><div className="risk-radar-page"><div className="risk-radar-shell">
    <header className="risk-hero">
      <div><span className="risk-kicker"><Gauge size={15} /> US STOCK CRASH MONITOR</span><h1>美股风险雷达</h1><p>双层模型分别识别危机前脆弱性与危机中的即时市场压力</p></div>
      <div className="risk-hero-actions"><div className="risk-window-switch" aria-label="选择监测标的">
        {(['VOO', 'QQQ'] as Ticker[]).map(value => <button type="button" key={value} aria-pressed={ticker === value} onClick={() => setTicker(value)}>{value}</button>)}
      </div><button type="button" className="risk-refresh" onClick={() => void refreshAll()} disabled={refreshing || timelineRefreshing}><RefreshCw size={15} className={refreshing || timelineRefreshing ? 'is-spinning' : ''} />{refreshing || timelineRefreshing ? '更新中' : '刷新数据'}</button></div>
    </header>
    {error ? <div className="risk-alert" role="alert"><AlertTriangle size={16} />{error}{prices && valuation && history ? '，继续显示上次成功数据。' : ''}</div> : null}
    {loading && (!prices || !valuation || !history) ? <div className="risk-loading"><RefreshCw className="is-spinning" size={20} />正在读取行情与历史风险快照…</div> : null}
    {prices && valuation && history ? <>
      <section className={`risk-command ${band.tone}`} aria-label="风险指数与量化建议">
        <div className="risk-command-meter">
          <span className="risk-command-eyebrow">{targetLabel} 综合风险状态</span>
          <GaugeDial score={dualResult.overall} />
          <div className="risk-meter-foot"><span className={`risk-status ${staleBrowserCache ? 'is-stale' : ''}`}><i />{syncLabel}</span><strong title="风险模型使用美股日线收盘数据；每小时检查一次，新的交易日数据通常在美股收盘后形成。">最新交易日 {formatDate(prices.generatedAt)} · 系统检查 {formatDate(checkedAt, true)}</strong></div>
        </div>
        <div className="risk-command-intelligence">
          <header><BrainCircuit size={21}/><h2>量化建议</h2></header>
          <div className="risk-layer-summary">
            <article className={`is-${riskBand(dualResult.vulnerability.score).tone}`}>
              <span>潜在脆弱性</span>
              <strong>{dualResult.vulnerability.score === null ? '—' : dualResult.vulnerability.score.toFixed(1)}</strong>
              <small>覆盖 {dualResult.vulnerability.coverage}% · 估值、杠杆、倒挂与过热</small>
            </article>
            <article className={`is-${riskBand(dualResult.stress.score).tone}`}>
              <span>即时市场压力</span>
              <strong>{dualResult.stress.score === null ? '—' : dualResult.stress.score.toFixed(1)}</strong>
              <small>覆盖 {dualResult.stress.coverage}% · 信用、融资、波动与市场损伤</small>
            </article>
          </div>
          <article className="risk-advice-card"><span>MODEL GUIDANCE / 模型建议</span><h3>{band.label}<small>（{band.zone}）</small></h3><p>{band.summary}</p></article>
          <section className="risk-history-reference"><header><span>VS</span><h3>{ticker} 历史双层风险</h3></header><p>{ticker === 'VOO' ? 'VOO 成立前采用 SPY 标普500历史代理。' : 'QQQ 从2000年起按可用因子归一化；早期P/E缺失不会伪造。'} 综合状态取脆弱性与即时压力中的较高值：</p><div>{historical.map(item => <article key={item.label}><small>{item.label.replace(/\s.*$/, '')}</small><strong>{item.score === null ? '—' : Math.round(item.score)}</strong><span>脆弱 {item.vulnerability?.toFixed(0) ?? '—'} · 压力 {item.stress?.toFixed(0) ?? '—'}</span></article>)}</div></section>
        </div>
      </section>

      <section className="risk-factor-section" aria-label="风险因子分解"><header className="risk-section-title"><ScanSearch size={22}/><div><h2>双层风险因子分解</h2><span>VULNERABILITY + MARKET STRESS · 两层独立归一化</span></div></header>{([
        { id: 'vulnerability', label: '潜在脆弱性', note: '危机发生前逐步累积', score: dualResult.vulnerability.score, coverage: dualResult.vulnerability.coverage, items: vulnerabilityFactors },
        { id: 'stress', label: '即时市场压力', note: '冲击发生后快速上升', score: dualResult.stress.score, coverage: dualResult.stress.coverage, items: stressFactors },
      ] as const).map(layer => <div className={`risk-layer-block ${layer.id}`} key={layer.id}><header><div><b>{layer.label}</b><span>{layer.note}</span></div><strong>{layer.score === null ? '—' : layer.score.toFixed(1)}<small>/ 100 · 数据覆盖 {layer.coverage}%</small></strong></header><div className="risk-factor-strip">{layer.items.map(factor => <article className={`risk-factor ${factor.score === null ? 'is-missing' : ''}`} key={factor.id} title={factor.detail}>
          <header><span>{factor.label}</span><small>权重 {factor.weight}%</small></header><strong>{factor.value}</strong><div className="risk-factor-score"><span className={factor.score !== null && factor.score >= RISK_WARNING_SCORE ? 'is-risk' : ''}>{factor.score === null ? '数据待更新' : `${factor.score >= RISK_DANGER_SCORE ? '↑ 高风险' : factor.score >= RISK_WARNING_SCORE ? '↑ 压力' : '正常'} · ${factor.score.toFixed(1)}`}</span><em>贡献 {factor.contribution === null ? '—' : factor.contribution.toFixed(1)}</em></div><a href={factor.sourceUrl} target="_blank" rel="noopener noreferrer">{factor.source}<ExternalLink size={10}/></a>
        </article>)}</div></div>)}</section>

      <section className="risk-panel risk-stress">
        <header className="risk-section-title risk-stress-heading">
          <div className="risk-section-title-main"><Swords size={22}/><div><h2>跨时代风险大比拼 <small>Dual-Layer Test</small></h2><span>{ticker} 当前与历史关键时点的双层模型对比</span></div></div>
          <button type="button" className="risk-guide-trigger" aria-haspopup="dialog" aria-expanded={guideOpen} onClick={() => setGuideOpen(true)}><BookOpen size={17}/><span>使用说明<small>评分与权重</small></span></button>
        </header>
        <div className="risk-stress-chart"><div className="risk-stress-thresholds" aria-hidden="true"><span>警戒线 40</span><span>高风险线 70</span></div><div className="risk-stress-list">{comparison.map((item, index) => { const score = item.score; return <div key={item.label}><span><strong>{index === 0 ? `${ticker} 当前（Now）` : item.label}</strong><small>{item.date}</small></span><i><b className={score !== null && score >= RISK_DANGER_SCORE ? 'high' : score !== null && score >= RISK_WARNING_SCORE ? 'elevated' : ''} style={{ width: `${score === null ? 0 : Math.min(100, score)}%` }} /><em style={{ left: `${score === null ? 7 : Math.min(97, Math.max(7, score))}%` }}>{score === null ? '—' : score.toFixed(1)}</em></i></div>; })}</div></div>
        <p>历史行情来自 {history.source.label}，历史估值来自 {history.valuationSource.label}。{ticker === 'VOO' ? 'VOO早期使用SPY代理；' : 'QQQ早期缺失P/E时按可用权重归一化；'}信用利差、NFCI、VIX、回撤和均线均采用对应月份数据。综合状态取两层较高值。</p>
      </section>

      {guideOpen ? createPortal(<div className="risk-guide-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setGuideOpen(false); }}>
        <section className="risk-guide-dialog" role="dialog" aria-modal="true" aria-labelledby="risk-guide-title">
          <header><div><span><BookOpen size={16}/> QUICK GUIDE</span><h2 id="risk-guide-title">双层风险雷达使用说明</h2><p>先看危机前的脆弱性，再看冲击发生后的即时市场压力。</p></div><button type="button" aria-label="关闭使用说明" autoFocus onClick={() => setGuideOpen(false)}><X size={19}/></button></header>
          <div className="risk-guide-body">
            <section className="risk-guide-intro"><h3>先看总分</h3><div className="risk-guide-bands"><article><strong>0–39</strong><span>正常区</span><small>整体压力较低</small></article><article><strong>40–69</strong><span>警戒区</span><small>压力正在累积</small></article><article><strong>70–100</strong><span>高风险区</span><small>多项风险共振</small></article></div><p>这个分数是规则模型的压力刻度，不代表未来发生崩盘的概率，也不直接等于买入或卖出信号。</p></section>
            <section><h3>两层因子与当前权重</h3><div className="risk-guide-weight-grid">{factors.map(factor => <article key={factor.id}><span>{factor.label}</span><strong>{factor.weight}%</strong><small>{factor.id.startsWith('v-') ? '脆弱性层' : '压力层'} · {factor.score === null || factor.contribution === null ? '数据待更新' : `风险分 ${factor.score.toFixed(1)} · 贡献 ${factor.contribution.toFixed(1)}`}</small></article>)}</div></section>
            <section className="risk-guide-formula"><h3>综合状态怎么算</h3><div><code>每层得分 = 有效因子按该层权重归一化</code><code>综合状态 = max（脆弱性，压力）</code></div><p>估值和杠杆可以在市场平静时提示脆弱性；信用、融资、VIX和回撤可以在危机发生时提示压力。缺失因子不会被补零，单层有效权重低于65%时该层留空。</p></section>
            <section className="risk-guide-steps"><h3>日常怎么用</h3><ol><li><b>先看总分所处区间。</b>分数跨过 40 或 70 时，再检查原因。</li><li><b>再看风险因子分解。</b>“贡献”越高，说明该因子对总分影响越大。</li><li><b>最后看历史压力对比。</b>横条越长代表同一套规则下的压力越高；历史数据用于对照量级，不是完整回测。</li></ol><p>{ticker === 'VOO' ? 'VOO 成立较晚，2000 年和 2008 年行情使用 SPY 作为标普500代理。' : 'QQQ 的历史对比使用 QQQ 自身行情与纳斯达克100历史估值。'}</p></section>
          </div>
        </section>
      </div>, document.body) : null}

      <details className="risk-controls" open>
        <summary><span><Settings2 size={15} />模型参数</span><small>每小时检查行情并更新本地缓存；原始指标只读，权重不等于 100% 时自动归一化</small></summary>
        <div className="risk-control-body"><section><h2>自动数据输入 · 不可修改</h2><div className="risk-input-grid">
          <ReadOnlyMetric label="美股总市值" value={marketCapRaw} unit=" 万亿美元" snapshot={radar?.marketCap} />
          <ReadOnlyMetric label="美国名义 GDP" value={gdpRaw} unit=" 万亿美元" snapshot={radar?.gdp} />
          <ReadOnlyMetric label="Shiller CAPE" value={capeRaw} unit="x" snapshot={radar?.cape} />
          <ReadOnlyMetric label="2 年期美债" value={twoYearRaw} unit="%" snapshot={radar?.treasury2y} />
          <ReadOnlyMetric label="CNN 恐惧与贪婪" value={fearRaw} unit=" / 100" snapshot={valuation.sentiment} />
          <ReadOnlyMetric label={`${valuationTicker} 市盈率`} value={pe} unit="x" snapshot={instrumentValuation} />
          <TimelineMetric label="Baa企业债利差" value={values.creditSpread} unit="%" source="FRED · BAA10Y" sourceUrl="https://fred.stlouisfed.org/series/BAA10Y" asOf={latestTimelinePoint?.date}/>
          <TimelineMetric label="Chicago Fed NFCI" value={values.nfci} source="FRED · NFCI" sourceUrl="https://fred.stlouisfed.org/series/NFCI" asOf={latestTimelinePoint?.date}/>
          <TimelineMetric label="Cboe VIX" value={values.vix} source="FRED · VIXCLS" sourceUrl="https://fred.stlouisfed.org/series/VIXCLS" asOf={latestTimelinePoint?.date}/>
          <TimelineMetric label="家庭债务偿付率" value={values.debtService} unit="%" source="FRED · TDSP" sourceUrl="https://fred.stlouisfed.org/series/TDSP" asOf={latestTimelinePoint?.date}/>
        </div></section><section><h2>双层因子权重</h2><div className="risk-dual-weight-groups">{([
          ['vulnerability', '潜在脆弱性', { buffett: '巴菲特指标', shiller: '席勒CAPE', valuation: `${valuationTicker}估值`, debtService: '债务偿付率', yield: '曲线倒挂', overheat: '趋势过热', greed: '贪婪情绪' }],
          ['stress', '即时市场压力', { creditSpread: 'Baa信用利差', nfci: '金融条件NFCI', vix: 'VIX', volatility: '实际波动', drawdown: '一年回撤', downside: '下行趋势', panic: '恐慌情绪', resteepening: '倒挂后陡峭' }],
        ] as const).map(([layer, label, labels]) => <div key={layer}><header><span>{label}</span><b>合计 {Object.values(dualWeights[layer]).reduce((sum, value) => sum + value, 0)}%</b></header><div className="risk-weight-grid">{(Object.keys(dualWeights[layer]) as Array<keyof typeof labels>).map(key => <label key={key}><span>{labels[key]}<b>{dualWeights[layer][key]}%</b></span><input type="range" min="0" max="40" step="5" value={dualWeights[layer][key]} onChange={event => setDualWeights(value => ({ ...value, [layer]: { ...value[layer], [key]: Number(event.target.value) } }))}/></label>)}</div></div>)}</div></section></div>
      </details>

      <div className="risk-lower-grid"><section className="risk-panel risk-trend-panel"><header className="risk-panel-heading"><div><span>PRICE STRUCTURE</span><h2>{targetLabel} 与 200 日均线</h2></div><TrendingUp size={18} /></header>
        {pricePath && smaPath ? <><div className="risk-chart-wrap"><svg viewBox="0 0 1000 250" preserveAspectRatio="none" aria-label={`${targetLabel}价格与200日均线`}><defs><linearGradient id="riskArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#66dfbd" stopOpacity=".25" /><stop offset="1" stopColor="#66dfbd" stopOpacity="0" /></linearGradient></defs><path className="risk-chart-area" d={`${pricePath} L1000,250 L0,250 Z`} /><path className="risk-chart-trend" d={smaPath} /><path className="risk-chart-value" d={pricePath} /></svg></div><footer className="risk-chart-footer"><span>{formatDate(priceSeries[0]?.time)}</span><div><i className="actual" />{prices.symbol} 收盘 <i className="trend" />SMA200</div><span>{formatDate(priceSeries[priceSeries.length - 1]?.time)}</span></footer></> : <div className="risk-empty">尚无足够数据计算 200 日均线</div>}
      </section><section className="risk-panel risk-breakdown"><header className="risk-panel-heading"><div><span>TOP FACTOR CONTRIBUTIONS</span><h2>当前主要风险贡献</h2></div><Activity size={18} /></header><div className="risk-breakdown-list">{[...factors].sort((a, b) => (b.contribution ?? -1) - (a.contribution ?? -1)).slice(0, 8).map(factor => <div key={factor.id}><span>{factor.label}<small>{factor.id.startsWith('v-') ? '脆弱性层' : '压力层'} · 因子风险 {factor.score === null ? '待更新' : factor.score.toFixed(1)}</small></span><i><b style={{ width: `${factor.score ?? 0}%` }} /></i><strong>{factor.contribution === null ? '—' : factor.contribution.toFixed(1)}</strong></div>)}</div><p className="risk-score-formula">两层分别按各自有效权重归一化；综合状态取潜在脆弱性与即时市场压力中的较高值，因此危机前和危机中都不会被另一类低分抵消。</p></section></div>

      <RiskTimelineChart
        payload={timeline}
        weights={dualWeights}
        loading={timelineLoading}
        refreshing={timelineRefreshing}
        error={timelineError}
        cacheStoredAt={timelineCacheStoredAt}
        current={current?.time ? {
          ticker,
          date: current.time,
          overall: dualResult.overall,
          vulnerability: dualResult.vulnerability.score,
          stress: dualResult.stress.score,
        } : null}
      />

      <footer className="risk-project-note"><span>模型来源：US_Stock_Crash_Monitor · SparkFlow 原生移植</span><span>市场风险指数是规则评分，不是崩盘概率或投资建议。</span></footer>
    </> : null}
  </div></div></PageTransition>;
}
