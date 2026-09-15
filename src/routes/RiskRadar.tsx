import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BrainCircuit,
  ExternalLink,
  Gauge,
  LockKeyhole,
  RefreshCw,
  ScanSearch,
  Settings2,
  Swords,
  TrendingUp,
} from 'lucide-react';
import { PageTransition } from '../components/PageTransition';
import type { ValuationDashboard, ValuationSnapshot } from '../lib/ibkr/valuationTypes';
import './RiskRadar.css';

type Ticker = 'VOO' | 'QQQ';
type WeightKey = 'buffett' | 'shiller' | 'yield' | 'technical' | 'sentiment';
type PricePayload = {
  symbol: string;
  generatedAt: string;
  source: { label: string; url: string };
  points: Array<{ time: string; close: number }>;
};
type RiskRadarValuation = Pick<ValuationDashboard, 'fetchedAt' | 'treasury' | 'sentiment' | 'riskRadar' | 'cache'>;
type RiskRadarCacheEnvelope = {
  version: 3;
  ticker: Ticker;
  storedAt: string;
  prices: PricePayload;
  valuation: RiskRadarValuation;
};
type Weights = Record<WeightKey, number>;
type Factor = {
  id: WeightKey;
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

const DEFAULT_WEIGHTS: Weights = { buffett: 15, shiller: 20, yield: 25, technical: 20, sentiment: 20 };
const RISK_CACHE_PREFIX = 'sparkflow.risk-radar.v3.';
const RISK_CACHE_FRESH_MS = 6 * 60 * 60_000;
const RISK_CACHE_MAX_MS = 7 * 24 * 60 * 60_000;
const SMA_DAYS = 200;
const CHART_DAYS = 252;
const REQUIRED_PRICE_POINTS = SMA_DAYS + CHART_DAYS - 1;
const HISTORICAL = [
  { label: '2000 互联网泡沫', date: '2000-03', marketCapRatio: 145, cape: 44.2, tenYear: 6.2, twoYear: 6.6, fear: 90, price: 115, sma: 100 },
  { label: '2008 次贷危机前', date: '2007-10', marketCapRatio: 110, cape: 27.5, tenYear: 4.6, twoYear: 4.2, fear: 75, price: 108, sma: 100 },
  { label: '2022 加息熊市', date: '2022-01', marketCapRatio: 195, cape: 38.3, tenYear: 1.6, twoYear: .8, fear: 75, price: 112, sma: 100 },
] as const;

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

type RiskValues = { marketCapRatio: number | null; cape: number | null; tenYear: number | null; twoYear: number | null; fear: number | null; price: number | null; sma: number | null };

function factorScores(values: RiskValues) {
  const buffett = values.marketCapRatio === null ? null : values.marketCapRatio > 200 ? 100 : values.marketCapRatio > 180 ? 90 : values.marketCapRatio > 150 ? 75 : values.marketCapRatio > 120 ? 50 : 25;
  const shiller = values.cape === null ? null : values.cape > 40 ? 100 : values.cape > 35 ? 90 : values.cape > 30 ? 70 : values.cape > 25 ? 50 : 20;
  const spread = values.tenYear === null || values.twoYear === null ? null : values.tenYear - values.twoYear;
  const yieldScore = spread === null ? null : spread < -.5 ? 80 : spread < 0 ? 60 : spread < .5 ? 70 : 30;
  const deviation = values.price === null || values.sma === null || values.sma <= 0 ? null : (values.price - values.sma) / values.sma * 100;
  const technical = deviation === null ? null : deviation > 25 ? 100 : deviation > 20 ? 85 : deviation > 15 ? 65 : deviation > 5 ? 40 : deviation < -10 ? 10 : 20;
  const sentiment = values.fear === null ? null : values.fear > 80 ? 100 : values.fear > 60 ? 70 : values.fear < 20 ? 0 : 40;
  return { buffett, shiller, yield: yieldScore, technical, sentiment, spread, deviation };
}

function calculateRisk(values: RiskValues, weights: Weights) {
  const scores = factorScores(values);
  const normalized = normalizedWeights(weights);
  const complete = (Object.keys(normalized) as WeightKey[]).every(key => scores[key] !== null);
  const score = complete ? (Object.keys(normalized) as WeightKey[]).reduce((sum, key) => sum + scores[key]! * normalized[key], 0) : null;
  return { score, scores, normalized };
}

function compactValuation(value: RiskRadarValuation): RiskRadarValuation {
  return {
    fetchedAt: value.fetchedAt,
    treasury: value.treasury,
    sentiment: value.sentiment,
    riskRadar: value.riskRadar,
    cache: value.cache,
  };
}

function completeRiskInputs(value: RiskRadarValuation | null | undefined) {
  if (!value) return false;
  const snapshots = [value.riskRadar?.marketCap, value.riskRadar?.gdp, value.riskRadar?.cape,
    value.riskRadar?.treasury2y, value.treasury, value.sentiment];
  return snapshots.every(item => item?.eligible && finite(item.current));
}

function completePriceHistory(value: PricePayload | null | undefined): value is PricePayload {
  return (value?.points?.filter(point => finite(point.close) && point.close > 0).length ?? 0) >= REQUIRED_PRICE_POINTS;
}

function readRiskCache(ticker: Ticker): RiskRadarCacheEnvelope | null {
  try {
    window.localStorage.removeItem(`sparkflow.risk-radar.v1.${ticker}`);
    window.localStorage.removeItem(`sparkflow.risk-radar.v2.${ticker}`);
    const parsed = JSON.parse(window.localStorage.getItem(`${RISK_CACHE_PREFIX}${ticker}`) || 'null') as Partial<RiskRadarCacheEnvelope> | null;
    const storedAt = Date.parse(parsed?.storedAt || '');
    if (parsed?.version !== 3 || parsed.ticker !== ticker || !Number.isFinite(storedAt)
      || storedAt > Date.now() + 60_000 || Date.now() - storedAt > RISK_CACHE_MAX_MS
      || !completePriceHistory(parsed.prices) || !completeRiskInputs(parsed.valuation as RiskRadarValuation | undefined)) {
      window.localStorage.removeItem(`${RISK_CACHE_PREFIX}${ticker}`);
      return null;
    }
    return parsed as RiskRadarCacheEnvelope;
  } catch { return null; }
}

function writeRiskCache(ticker: Ticker, prices: PricePayload, valuation: RiskRadarValuation) {
  try {
    if (!completePriceHistory(prices) || !completeRiskInputs(valuation)) {
      window.localStorage.removeItem(`${RISK_CACHE_PREFIX}${ticker}`);
      return null;
    }
    const value: RiskRadarCacheEnvelope = { version: 3, ticker, storedAt: new Date().toISOString(), prices, valuation };
    window.localStorage.setItem(`${RISK_CACHE_PREFIX}${ticker}`, JSON.stringify(value));
    return value.storedAt;
  } catch { return null; }
}

function riskBand(score: number | null) {
  if (score === null) return { label: '等待数据', zone: '暂不评分', tone: 'unavailable', summary: '部分自动数据源尚未返回可用快照。系统不会用手工默认值代替，数据齐全后会自动生成风险评分。' };
  if (score > 80) return { label: '高压风险', zone: '高风险区', tone: 'high', summary: '五因子模型同时出现明显压力，优先检查仓位、现金缓冲和对冲成本。' };
  if (score > 60) return { label: '风险累积', zone: '警戒区', tone: 'elevated', summary: '估值或市场结构的压力正在积聚，新增仓位需要更高安全边际。' };
  return { label: '相对安全', zone: '安全区', tone: 'low', summary: '模型处于常态波动范围，维持既定计划，同时继续观察因子变化和自身回撤承受力。' };
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

export function RiskRadar() {
  const [initialCache] = useState(() => readRiskCache('VOO'));
  const [ticker, setTicker] = useState<Ticker>('VOO');
  const [weights, setWeights] = useState<Weights>(DEFAULT_WEIGHTS);
  const [prices, setPrices] = useState<PricePayload | null>(initialCache?.prices ?? null);
  const [valuation, setValuation] = useState<RiskRadarValuation | null>(initialCache?.valuation ?? null);
  const [cacheStoredAt, setCacheStoredAt] = useState<string | null>(initialCache?.storedAt ?? null);
  const [loading, setLoading] = useState(!initialCache);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (force = false) => {
    const saved = readRiskCache(ticker);
    if (!force && saved) {
      setPrices(saved.prices);
      setValuation(saved.valuation);
      setCacheStoredAt(saved.storedAt);
      setLoading(false);
      if (Date.now() - Date.parse(saved.storedAt) < RISK_CACHE_FRESH_MS) return;
    }
    if (force || saved) setRefreshing(true);
    else { setPrices(null); setValuation(null); setLoading(true); }
    try {
      const [priceResult, valuationPayload] = await Promise.all([
        fetchJson(`/api/equity-report-chart?symbol=${ticker}&range=2y`, 9_000, force ? 'no-cache' : 'default').catch(() => null),
        fetchJson('/api/ibkr-valuation/risk-radar', 15_000, force ? 'no-cache' : 'default'),
      ]);
      const nextValuation = valuationPayload as RiskRadarValuation;
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
      if (!completeRiskInputs(compact)) {
        if (saved) {
          setPrices(saved.prices);
          setValuation(saved.valuation);
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
      setCacheStoredAt(writeRiskCache(ticker, nextPrices, compact));
      setError(note);
    } catch (reason) {
      setError(saved ? '自动更新暂不可用，继续显示本地缓存。' : reason instanceof Error ? reason.message : '风险数据暂不可用');
    } finally {
      setLoading(false); setRefreshing(false);
    }
  }, [ticker]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => { void load(); }, 60 * 60_000);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    if (!valuation || completeRiskInputs(valuation)) return;
    const timer = window.setInterval(() => { void load(true); }, 60_000);
    return () => window.clearInterval(timer);
  }, [load, valuation]);

  const priceSeries = useMemo(() => {
    const points = (prices?.points || []).filter(point => finite(point.close) && point.close > 0);
    return points.map((point, index) => ({ ...point, sma: index >= SMA_DAYS - 1
      ? points.slice(index + 1 - SMA_DAYS, index + 1).reduce((sum, row) => sum + row.close, 0) / SMA_DAYS : NaN }))
      .filter(point => finite(point.sma)).slice(-CHART_DAYS);
  }, [prices]);
  const current = priceSeries[priceSeries.length - 1];
  const usingIndexProxy = prices?.symbol !== ticker;
  const targetLabel = usingIndexProxy ? `${ticker} · ${prices?.symbol} 趋势代理` : ticker;
  const radar = valuation?.riskRadar;
  const marketCapRaw = finite(radar?.marketCap?.current) ? radar.marketCap.current : null;
  const gdpRaw = finite(radar?.gdp?.current) ? radar.gdp.current : null;
  const capeRaw = finite(radar?.cape?.current) ? radar.cape.current : null;
  const twoYearRaw = finite(radar?.treasury2y?.current) ? radar.treasury2y.current : null;
  const fearRaw = finite(valuation?.sentiment.current) ? valuation.sentiment.current : null;
  const tenYearRaw = finite(valuation?.treasury.current) ? valuation.treasury.current : null;
  const marketCapRatioRaw = marketCapRaw !== null && gdpRaw !== null && gdpRaw > 0 ? marketCapRaw / gdpRaw * 100 : null;
  const marketCapRatio = radar?.marketCap?.eligible && radar?.gdp?.eligible ? marketCapRatioRaw : null;
  const cape = radar?.cape?.eligible ? capeRaw : null;
  const twoYear = radar?.treasury2y?.eligible ? twoYearRaw : null;
  const tenYear = valuation?.treasury.eligible ? tenYearRaw : null;
  const fear = valuation?.sentiment.eligible ? fearRaw : null;
  const values: RiskValues = { marketCapRatio, cape, tenYear, twoYear, fear, price: current?.close ?? null, sma: current?.sma ?? null };
  const result = calculateRisk(values, weights);
  const band = riskBand(result.score);
  const spreadStatus = result.scores.spread === null ? '数据待更新' : result.scores.spread < -.5 ? '深度倒挂' : result.scores.spread < 0 ? '轻度倒挂' : result.scores.spread < .5 ? '低正利差' : '正常斜率';
  const contribution = (key: WeightKey) => result.scores[key] === null ? null : result.scores[key]! * result.normalized[key];
  const formatValue = (value: number | null, digits: number, suffix = '') => value === null ? '—' : `${value >= 0 && suffix === '%' ? '+' : ''}${value.toFixed(digits)}${suffix}`;
  const factors: Factor[] = [
    { id: 'buffett', label: '巴菲特指标', eyebrow: 'MARKET CAP / GDP', value: marketCapRatioRaw === null ? '—' : `${marketCapRatioRaw.toFixed(1)}%`, score: result.scores.buffett, weight: weights.buffett, contribution: contribution('buffett'), detail: `美联储非金融企业股票市场价值 ${marketCapRaw?.toFixed(1) ?? '—'} 万亿美元 ÷ GDP ${gdpRaw?.toFixed(1) ?? '—'} 万亿美元`, source: `${radar?.marketCap.source || 'Federal Reserve Z.1'} + ${radar?.gdp.source || 'BEA GDP'}`, sourceUrl: radar?.marketCap.sourceUrl || 'https://fred.stlouisfed.org/series/NCBEILQ027S' },
    { id: 'shiller', label: '席勒市盈率', eyebrow: 'SHILLER CAPE', value: capeRaw === null ? '—' : `${capeRaw.toFixed(1)}x`, score: result.scores.shiller, weight: weights.shiller, contribution: contribution('shiller'), detail: '过去十年经通胀调整盈利的周期调整市盈率；当前源与日期显示在只读参数中', source: radar?.cape.source || 'Robert Shiller / Multpl · CAPE', sourceUrl: radar?.cape.sourceUrl || 'https://www.multpl.com/shiller-pe' },
    { id: 'yield', label: '美债期限利差', eyebrow: 'US 10Y − 2Y', value: formatValue(result.scores.spread, 2, '%'), score: result.scores.yield, weight: weights.yield, contribution: contribution('yield'), detail: `${spreadStatus} · 10Y ${tenYearRaw?.toFixed(2) ?? '—'}% · 2Y ${twoYearRaw?.toFixed(2) ?? '—'}%`, source: `${valuation?.treasury.source || 'FRED DGS10'} + ${radar?.treasury2y.source || '新浪财经 / FRED DGS2'}`, sourceUrl: radar?.treasury2y.sourceUrl || valuation?.treasury.sourceUrl || 'https://fred.stlouisfed.org/series/DGS2' },
    { id: 'technical', label: '200 日均线乖离', eyebrow: `${prices?.symbol || ticker} PRICE / SMA200`, value: formatValue(result.scores.deviation, 1, '%'), score: result.scores.technical, weight: weights.technical, contribution: contribution('technical'), detail: `${targetLabel} ${current?.close.toFixed(2) ?? '—'} · SMA200 ${current?.sma.toFixed(2) ?? '—'}`, source: prices?.source.label || 'Yahoo Finance · 日线收盘', sourceUrl: prices?.source.url || `https://finance.yahoo.com/quote/${ticker}` },
    { id: 'sentiment', label: '恐惧与贪婪', eyebrow: 'CNN FEAR & GREED', value: fearRaw === null ? '—' : `${Math.round(fearRaw)} / 100`, score: result.scores.sentiment, weight: weights.sentiment, contribution: contribution('sentiment'), detail: '采用 CNN 最新公开快照；自动同步且不可手工覆盖', source: valuation?.sentiment.source || 'CNN · Fear & Greed', sourceUrl: valuation?.sentiment.sourceUrl || 'https://www.cnn.com/markets/fear-and-greed' },
  ];
  const historical = HISTORICAL.map(item => ({ ...item, score: calculateRisk(item, weights).score! }));
  const comparison = [{ label: '当前市场', date: formatDate(prices?.generatedAt), score: result.score }, ...historical];
  const pricePath = chartPath(priceSeries, 'close');
  const smaPath = chartPath(priceSeries, 'sma');

  return <PageTransition><div className="risk-radar-page"><div className="risk-radar-shell">
    <header className="risk-hero">
      <div><span className="risk-kicker"><Gauge size={15} /> US STOCK CRASH MONITOR</span><h1>美股风险雷达</h1><p>基于 US_Stock_Crash_Monitor 的五因子风险模型</p></div>
      <div className="risk-hero-actions"><div className="risk-window-switch" aria-label="选择监测标的">
        {(['VOO', 'QQQ'] as Ticker[]).map(value => <button type="button" key={value} aria-pressed={ticker === value} onClick={() => setTicker(value)}>{value}</button>)}
      </div><button type="button" className="risk-refresh" onClick={() => void load(true)} disabled={refreshing}><RefreshCw size={15} className={refreshing ? 'is-spinning' : ''} />{refreshing ? '更新中' : '刷新数据'}</button></div>
    </header>
    {error ? <div className="risk-alert" role="alert"><AlertTriangle size={16} />{error}{prices && valuation ? '，继续显示上次成功数据。' : ''}</div> : null}
    {loading && (!prices || !valuation) ? <div className="risk-loading"><RefreshCw className="is-spinning" size={20} />正在读取行情与风险快照…</div> : null}
    {prices && valuation ? <>
      <section className={`risk-command ${band.tone}`} aria-label="风险指数与量化建议">
        <div className="risk-command-meter">
          <span className="risk-command-eyebrow">{targetLabel} 崩盘风险指数</span>
          <GaugeDial score={result.score} />
          <div className="risk-meter-foot"><span className="risk-status"><i />{cacheStoredAt ? '本地缓存已加载' : '自动数据源已连接'}</span><strong>数据 {formatDate(prices.generatedAt, true)}</strong></div>
        </div>
        <div className="risk-command-intelligence">
          <header><BrainCircuit size={21}/><h2>量化建议</h2></header>
          <article className="risk-advice-card"><span>MODEL GUIDANCE / 模型建议</span><h3>{band.label}<small>（{band.zone}）</small></h3><p>{band.summary}</p></article>
          <section className="risk-history-reference"><header><span>VS</span><h3>历史对比参考</h3></header><p>使用当前因子权重，历史高压时点的模型分数为：</p><div>{historical.map(item => <article key={item.label}><small>{item.label.replace(/\s.*$/, '')} 峰值</small><strong>{Math.round(item.score)}</strong><span>{item.date}</span></article>)}</div></section>
        </div>
      </section>

      <section className="risk-factor-section" aria-label="风险因子分解"><header className="risk-section-title"><ScanSearch size={22}/><div><h2>风险因子分解</h2><span>FACTOR ATTRIBUTION · 含自定义权重</span></div></header><div className="risk-factor-strip">{factors.map(factor => <article className={`risk-factor ${factor.score === null ? 'is-missing' : ''}`} key={factor.id} title={factor.detail}>
        <header><span>{factor.label}</span><small>权重 {factor.weight}%</small></header>
        <strong>{factor.value}</strong>
        <div className="risk-factor-score"><span className={factor.score !== null && factor.score > 60 ? 'is-risk' : ''}>{factor.score === null ? '数据待更新' : `${factor.score > 60 ? '↑ 风险' : '↑ 正常'} · ${factor.score}`}</span><em>贡献 {factor.contribution === null ? '—' : factor.contribution.toFixed(1)}</em></div>
        <a href={factor.sourceUrl} target="_blank" rel="noopener noreferrer">{factor.source} <ExternalLink size={10}/></a>
      </article>)}</div></section>

      <section className="risk-panel risk-stress"><header className="risk-section-title"><Swords size={22}/><div><h2>跨时代风险大比拼 <small>Stress Test</small></h2><span>当前市场与三次历史高压时点的同权重模型对比</span></div></header><div className="risk-stress-chart"><div className="risk-stress-thresholds" aria-hidden="true"><span>警戒线</span><span>高风险线</span></div><div className="risk-stress-list">{comparison.map((item, index) => { const score = item.score; return <div key={item.label}><span><strong>{index === 0 ? '当前（Now）' : item.label}</strong><small>{item.date}</small></span><i><b className={score !== null && score > 80 ? 'high' : score !== null && score > 60 ? 'elevated' : ''} style={{ width: `${score === null ? 0 : Math.min(100, score)}%` }} /><em style={{ left: `${score === null ? 7 : Math.min(97, Math.max(7, score))}%` }}>{score === null ? '—' : score.toFixed(1)}</em></i></div>; })}</div></div><p>历史快照沿用原项目内置参考值，其中 200 日均线与 CNN 情绪为构造值，只用于复现原项目压力比较，不代表完整历史回测。</p></section>

      <details className="risk-controls" open>
        <summary><span><Settings2 size={15} />模型参数</span><small>本地缓存每 6 小时检查共享快照；原始指标只读，权重不等于 100% 时自动归一化</small></summary>
        <div className="risk-control-body"><section><h2>自动数据输入 · 不可修改</h2><div className="risk-input-grid">
          <ReadOnlyMetric label="美股总市值" value={marketCapRaw} unit=" 万亿美元" snapshot={radar?.marketCap} />
          <ReadOnlyMetric label="美国名义 GDP" value={gdpRaw} unit=" 万亿美元" snapshot={radar?.gdp} />
          <ReadOnlyMetric label="Shiller CAPE" value={capeRaw} unit="x" snapshot={radar?.cape} />
          <ReadOnlyMetric label="2 年期美债" value={twoYearRaw} unit="%" snapshot={radar?.treasury2y} />
          <ReadOnlyMetric label="CNN 恐惧与贪婪" value={fearRaw} unit=" / 100" snapshot={valuation.sentiment} />
        </div></section><section><h2>因子权重</h2><div className="risk-weight-grid">{(Object.keys(DEFAULT_WEIGHTS) as WeightKey[]).map(key => <label key={key}><span>{{ buffett: '巴菲特指标', shiller: '席勒市盈率', yield: '美债利差', technical: '均线乖离', sentiment: '恐惧贪婪' }[key]}<b>{weights[key]}%</b></span><input type="range" min="0" max="50" step="5" value={weights[key]} onChange={event => setWeights(value => ({ ...value, [key]: Number(event.target.value) }))} /></label>)}</div></section></div>
      </details>

      <div className="risk-lower-grid"><section className="risk-panel risk-trend-panel"><header className="risk-panel-heading"><div><span>PRICE STRUCTURE</span><h2>{targetLabel} 与 200 日均线</h2></div><TrendingUp size={18} /></header>
        {pricePath && smaPath ? <><div className="risk-chart-wrap"><svg viewBox="0 0 1000 250" preserveAspectRatio="none" aria-label={`${targetLabel}价格与200日均线`}><defs><linearGradient id="riskArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#66dfbd" stopOpacity=".25" /><stop offset="1" stopColor="#66dfbd" stopOpacity="0" /></linearGradient></defs><path className="risk-chart-area" d={`${pricePath} L1000,250 L0,250 Z`} /><path className="risk-chart-trend" d={smaPath} /><path className="risk-chart-value" d={pricePath} /></svg></div><footer className="risk-chart-footer"><span>{formatDate(priceSeries[0]?.time)}</span><div><i className="actual" />{prices.symbol} 收盘 <i className="trend" />SMA200</div><span>{formatDate(priceSeries[priceSeries.length - 1]?.time)}</span></footer></> : <div className="risk-empty">尚无足够数据计算 200 日均线</div>}
      </section><section className="risk-panel risk-breakdown"><header className="risk-panel-heading"><div><span>FACTOR CONTRIBUTION</span><h2>当前压力贡献</h2></div><Activity size={18} /></header><div className="risk-breakdown-list">{[...factors].sort((a, b) => (b.contribution ?? -1) - (a.contribution ?? -1)).map(factor => <div key={factor.id}><span>{factor.label}<small>因子风险 {factor.score ?? '待更新'}</small></span><i><b style={{ width: `${factor.score ?? 0}%` }} /></i><strong>{factor.contribution === null ? '—' : factor.contribution.toFixed(1)}</strong></div>)}</div><p className="risk-score-formula">综合分采用原项目分档规则。任一自动输入缺失或过期时总分留空，不使用样例值补算；权重偏离 100% 时按比例归一化。</p></section></div>

      <footer className="risk-project-note"><span>模型来源：US_Stock_Crash_Monitor · SparkFlow 原生移植</span><span>市场风险指数是规则评分，不是崩盘概率或投资建议。</span></footer>
    </> : null}
  </div></div></PageTransition>;
}
