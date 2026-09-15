import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Clock3,
  ExternalLink,
  Gauge,
  RefreshCw,
  Settings2,
  ShieldCheck,
  TrendingUp,
} from 'lucide-react';
import { PageTransition } from '../components/PageTransition';
import type { ValuationDashboard } from '../lib/ibkr/valuationTypes';
import './RiskRadar.css';

type Ticker = 'VOO' | 'QQQ';
type WeightKey = 'buffett' | 'shiller' | 'yield' | 'technical' | 'sentiment';
type PricePayload = {
  symbol: string;
  generatedAt: string;
  source: { label: string; url: string };
  points: Array<{ time: string; close: number }>;
};
type Weights = Record<WeightKey, number>;
type Inputs = { marketCap: number; gdp: number; cape: number; twoYear: number };
type Factor = {
  id: WeightKey;
  label: string;
  eyebrow: string;
  value: string;
  score: number;
  weight: number;
  contribution: number;
  detail: string;
  source: string;
  sourceUrl: string;
};

const DEFAULT_WEIGHTS: Weights = { buffett: 15, shiller: 25, yield: 25, technical: 20, sentiment: 15 };
const DEFAULT_INPUTS: Inputs = { marketCap: 59, gdp: 29, cape: 40, twoYear: 4.2 };
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

function factorScores(values: { marketCapRatio: number; cape: number; tenYear: number; twoYear: number; fear: number; price: number; sma: number }) {
  const buffett = values.marketCapRatio > 200 ? 100 : values.marketCapRatio > 180 ? 90 : values.marketCapRatio > 150 ? 75 : values.marketCapRatio > 120 ? 50 : 25;
  const shiller = values.cape > 40 ? 100 : values.cape > 35 ? 90 : values.cape > 30 ? 70 : values.cape > 25 ? 50 : 20;
  const spread = values.tenYear - values.twoYear;
  const yieldScore = spread < -.5 ? 80 : spread < 0 ? 60 : spread < .5 ? 70 : 30;
  const deviation = values.sma > 0 ? (values.price - values.sma) / values.sma * 100 : 0;
  const technical = deviation > 25 ? 100 : deviation > 20 ? 85 : deviation > 15 ? 65 : deviation > 5 ? 40 : deviation < -10 ? 10 : 20;
  const sentiment = values.fear > 80 ? 100 : values.fear > 60 ? 70 : values.fear < 20 ? 0 : 40;
  return { buffett, shiller, yield: yieldScore, technical, sentiment, spread, deviation };
}

function calculateRisk(values: Parameters<typeof factorScores>[0], weights: Weights) {
  const scores = factorScores(values);
  const normalized = normalizedWeights(weights);
  const score = (Object.keys(normalized) as WeightKey[]).reduce((sum, key) => sum + scores[key] * normalized[key], 0);
  return { score, scores, normalized };
}

function riskBand(score: number) {
  if (score > 80) return { label: '极高风险', tone: 'high', summary: '五因子模型同时出现明显压力，优先检查仓位、现金缓冲和对冲成本。' };
  if (score > 60) return { label: '风险累积', tone: 'elevated', summary: '估值或市场结构的压力正在积聚，新增仓位需要更高安全边际。' };
  return { label: '常态区间', tone: 'low', summary: '模型未进入高风险区，继续观察因子变化和自身回撤承受力。' };
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

function GaugeDial({ score }: { score: number }) {
  const safe = Math.max(0, Math.min(100, score));
  const radians = (-90 + safe * 1.8) * Math.PI / 180;
  return <div className="risk-gauge" role="meter" aria-label="持仓风险指数" aria-valuemin={0} aria-valuemax={100} aria-valuenow={score}>
    <svg viewBox="0 0 300 170" aria-hidden="true">
      <path className="risk-gauge-track" pathLength="100" d="M 30 146 A 120 120 0 0 1 270 146" />
      <path className="risk-gauge-fill" pathLength="100" strokeDasharray={`${safe} 100`} d="M 30 146 A 120 120 0 0 1 270 146" />
      <circle className="risk-gauge-dot" cx={150 + Math.cos(radians) * 112} cy={146 + Math.sin(radians) * 112} r="7" />
      <text x="150" y="116" className="risk-gauge-score">{Math.round(score)}</text>
      <text x="150" y="140" className="risk-gauge-unit">/ 100 · 风险指数</text>
      <text x="24" y="164" className="risk-gauge-edge">低</text><text x="276" y="164" textAnchor="end" className="risk-gauge-edge">高</text>
    </svg>
  </div>;
}

function NumberField({ label, value, step, onChange }: { label: string; value: number; step: number; onChange: (value: number) => void }) {
  return <label className="risk-number-field"><span>{label}</span><input type="number" value={value} step={step} onChange={event => {
    const next = Number(event.target.value);
    if (Number.isFinite(next)) onChange(next);
  }} /></label>;
}

async function fetchJson(url: string, timeoutMs: number) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: controller.signal });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    return payload;
  } finally {
    window.clearTimeout(timer);
  }
}

export function RiskRadar() {
  const [ticker, setTicker] = useState<Ticker>('VOO');
  const [weights, setWeights] = useState<Weights>(DEFAULT_WEIGHTS);
  const [inputs, setInputs] = useState<Inputs>(DEFAULT_INPUTS);
  const [fearOverride, setFearOverride] = useState<number | null>(null);
  const [prices, setPrices] = useState<PricePayload | null>(null);
  const [valuation, setValuation] = useState<ValuationDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (force = false) => {
    if (force) setRefreshing(true); else setLoading(true);
    try {
      const [priceResult, valuationPayload] = await Promise.all([
        fetchJson(`/api/equity-report-chart?symbol=${ticker}&range=1y`, 9_000).catch(() => null),
        fetchJson(`/api/ibkr-valuation?years=5${force ? '&fresh=1' : ''}`, force ? 45_000 : 15_000),
      ]);
      const nextValuation = valuationPayload as ValuationDashboard;
      let nextPrices = priceResult as PricePayload | null;
      let note = '';
      if (!nextPrices?.points?.length) {
        const indexKey = ticker === 'VOO' ? 'spx' : 'ndx';
        const proxy = nextValuation.audit.inputs.series[indexKey];
        if (!proxy?.points?.length) throw new Error(`${ticker} 与对应指数历史均暂不可用`);
        nextPrices = {
          symbol: ticker === 'VOO' ? 'SPX' : 'NDX', generatedAt: proxy.asOf || nextValuation.fetchedAt,
          source: { label: `${proxy.source} · ${ticker} 趋势代理`, url: proxy.sourceUrl || 'https://fred.stlouisfed.org/' },
          points: proxy.points.map(point => ({ time: point.date, close: point.value })),
        };
        note = `${ticker} ETF 日线暂不可用，当前使用 ${nextPrices.symbol} 缓存作为趋势代理。`;
      }
      setPrices(nextPrices);
      setValuation(nextValuation);
      setError(note);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '风险数据暂不可用');
    } finally {
      setLoading(false); setRefreshing(false);
    }
  }, [ticker]);

  useEffect(() => { void load(); }, [load]);

  const priceSeries = useMemo(() => {
    const points = (prices?.points || []).filter(point => finite(point.close) && point.close > 0);
    return points.map((point, index) => ({ ...point, sma: index >= 199 ? points.slice(index - 199, index + 1).reduce((sum, row) => sum + row.close, 0) / 200 : NaN })).filter(point => finite(point.sma));
  }, [prices]);
  const current = priceSeries[priceSeries.length - 1];
  const usingIndexProxy = prices?.symbol !== ticker;
  const targetLabel = usingIndexProxy ? `${ticker} · ${prices?.symbol} 趋势代理` : ticker;
  const tenYear = finite(valuation?.treasury.current) ? valuation.treasury.current : 4;
  const liveFear = valuation?.sentiment.eligible && finite(valuation.sentiment.current) ? valuation.sentiment.current : 45;
  const fear = fearOverride ?? liveFear;
  const marketCapRatio = inputs.gdp > 0 ? inputs.marketCap / inputs.gdp * 100 : 0;
  const values = { marketCapRatio, cape: inputs.cape, tenYear, twoYear: inputs.twoYear, fear, price: current?.close ?? 0, sma: current?.sma ?? 0 };
  const result = calculateRisk(values, weights);
  const band = riskBand(result.score);
  const totalWeight = Object.values(weights).reduce((sum, value) => sum + value, 0);
  const spreadStatus = result.scores.spread < -.5 ? '深度倒挂' : result.scores.spread < 0 ? '轻度倒挂' : result.scores.spread < .5 ? '低正利差' : '正常斜率';
  const factors: Factor[] = [
    { id: 'buffett', label: '巴菲特指标', eyebrow: 'MARKET CAP / GDP', value: `${marketCapRatio.toFixed(1)}%`, score: result.scores.buffett, weight: weights.buffett, contribution: result.scores.buffett * result.normalized.buffett, detail: `美股总市值 ${inputs.marketCap.toFixed(1)} 万亿美元 ÷ GDP ${inputs.gdp.toFixed(1)} 万亿美元`, source: '手工输入 · 原项目口径', sourceUrl: 'https://sc.macromicro.me/series/616/wilshire5000' },
    { id: 'shiller', label: '席勒市盈率', eyebrow: 'SHILLER CAPE', value: `${inputs.cape.toFixed(1)}x`, score: result.scores.shiller, weight: weights.shiller, contribution: result.scores.shiller * result.normalized.shiller, detail: '使用过去十年经通胀调整盈利的周期调整市盈率', source: '手工输入 · Multpl', sourceUrl: 'https://www.multpl.com/shiller-pe' },
    { id: 'yield', label: '美债期限利差', eyebrow: 'US 10Y − 2Y', value: `${result.scores.spread >= 0 ? '+' : ''}${result.scores.spread.toFixed(2)}%`, score: result.scores.yield, weight: weights.yield, contribution: result.scores.yield * result.normalized.yield, detail: `${spreadStatus} · 10Y ${tenYear.toFixed(2)}% · 2Y ${inputs.twoYear.toFixed(2)}%`, source: `${valuation?.treasury.source || 'FRED DGS10'} + 手工 2Y`, sourceUrl: valuation?.treasury.sourceUrl || 'https://fred.stlouisfed.org/series/DGS10' },
    { id: 'technical', label: '200 日均线乖离', eyebrow: `${prices?.symbol || ticker} PRICE / SMA200`, value: `${result.scores.deviation >= 0 ? '+' : ''}${result.scores.deviation.toFixed(1)}%`, score: result.scores.technical, weight: weights.technical, contribution: result.scores.technical * result.normalized.technical, detail: `${targetLabel} ${current?.close.toFixed(2) ?? '—'} · SMA200 ${current?.sma.toFixed(2) ?? '—'}`, source: prices?.source.label || 'Yahoo Finance · 日线收盘', sourceUrl: prices?.source.url || `https://finance.yahoo.com/quote/${ticker}` },
    { id: 'sentiment', label: '恐惧与贪婪', eyebrow: 'CNN FEAR & GREED', value: `${Math.round(fear)} / 100`, score: result.scores.sentiment, weight: weights.sentiment, contribution: result.scores.sentiment * result.normalized.sentiment, detail: fearOverride === null ? '采用 CNN 最新公开快照' : '使用手工覆盖值', source: valuation?.sentiment.source || 'CNN · Fear & Greed', sourceUrl: valuation?.sentiment.sourceUrl || 'https://www.cnn.com/markets/fear-and-greed' },
  ];
  const historical = HISTORICAL.map(item => ({ ...item, score: calculateRisk(item, weights).score }));
  const comparison = [{ label: '当前市场', date: formatDate(prices?.generatedAt), score: result.score }, ...historical];
  const maxComparison = Math.max(100, ...comparison.map(item => item.score));
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
      <section className={`risk-overview ${band.tone}`}>
        <div className="risk-overview-copy"><span className="risk-status"><i />延迟行情已连接 · 宏观数据按小时缓存</span><h2>{band.label}</h2><p>{band.summary}</p><div className="risk-overview-meta"><span><Clock3 size={13} />行情 {formatDate(prices.generatedAt, true)}</span><span><ShieldCheck size={13} />五项因子已计算</span><span><BarChart3 size={13} />权重合计 {totalWeight}%</span></div></div>
        <GaugeDial score={result.score} />
        <aside className="risk-overview-reading"><span>CURRENT TARGET</span><strong>{targetLabel} · {usingIndexProxy ? '' : '$'}{current?.close.toFixed(2) ?? '—'}</strong><p>200 日均线 {current?.sma.toFixed(2) ?? '—'}<br />10 年期美债 {tenYear ? `${tenYear.toFixed(2)}%` : '待更新'}<br />CNN 情绪 {Math.round(fear)} / 100</p></aside>
      </section>

      <section className="risk-factor-grid" aria-label="五项风险因子">{factors.map((factor, index) => <article className="risk-factor" key={factor.id}>
        <header><span>{String(index + 1).padStart(2, '0')}</span><small>{factor.eyebrow}</small><em>风险 {factor.score}</em></header>
        <div className="risk-factor-main"><div><h3>{factor.label}</h3><strong>{factor.value}</strong></div><b>{factor.contribution.toFixed(1)} 分</b></div>
        <div className="risk-factor-bar"><i style={{ width: `${factor.score}%` }} /></div><p>{factor.detail}</p><footer><span>原始权重 {factor.weight}%</span><a href={factor.sourceUrl} target="_blank" rel="noopener noreferrer">{factor.source} <ExternalLink size={10} /></a></footer>
      </article>)}</section>

      <details className="risk-controls" open>
        <summary><span><Settings2 size={15} />模型参数</span><small>保留原项目的手工校准能力；权重不等于 100% 时自动按比例归一化</small></summary>
        <div className="risk-control-body"><section><h2>宏观输入</h2><div className="risk-input-grid">
          <NumberField label="美股总市值 · 万亿美元" value={inputs.marketCap} step={.5} onChange={marketCap => setInputs(value => ({ ...value, marketCap }))} />
          <NumberField label="美国 GDP · 万亿美元" value={inputs.gdp} step={.1} onChange={gdp => setInputs(value => ({ ...value, gdp }))} />
          <NumberField label="Shiller CAPE" value={inputs.cape} step={.1} onChange={cape => setInputs(value => ({ ...value, cape }))} />
          <NumberField label="2 年期美债 · %" value={inputs.twoYear} step={.01} onChange={twoYear => setInputs(value => ({ ...value, twoYear }))} />
          <label className="risk-number-field"><span>CNN 情绪 · {fearOverride === null ? '自动' : '手工'}</span><input type="range" min="0" max="100" value={fear} onChange={event => setFearOverride(Number(event.target.value))} /><b>{Math.round(fear)}</b><button type="button" onClick={() => setFearOverride(null)}>恢复自动</button></label>
        </div></section><section><h2>因子权重</h2><div className="risk-weight-grid">{(Object.keys(DEFAULT_WEIGHTS) as WeightKey[]).map(key => <label key={key}><span>{{ buffett: '巴菲特指标', shiller: '席勒市盈率', yield: '美债利差', technical: '均线乖离', sentiment: '恐惧贪婪' }[key]}<b>{weights[key]}%</b></span><input type="range" min="0" max="50" step="5" value={weights[key]} onChange={event => setWeights(value => ({ ...value, [key]: Number(event.target.value) }))} /></label>)}</div></section></div>
      </details>

      <div className="risk-lower-grid"><section className="risk-panel risk-trend-panel"><header className="risk-panel-heading"><div><span>PRICE STRUCTURE</span><h2>{targetLabel} 与 200 日均线</h2></div><TrendingUp size={18} /></header>
        {pricePath && smaPath ? <><div className="risk-chart-wrap"><svg viewBox="0 0 1000 250" preserveAspectRatio="none" aria-label={`${targetLabel}价格与200日均线`}><defs><linearGradient id="riskArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#66dfbd" stopOpacity=".25" /><stop offset="1" stopColor="#66dfbd" stopOpacity="0" /></linearGradient></defs><path className="risk-chart-area" d={`${pricePath} L1000,250 L0,250 Z`} /><path className="risk-chart-trend" d={smaPath} /><path className="risk-chart-value" d={pricePath} /></svg></div><footer className="risk-chart-footer"><span>{formatDate(priceSeries[0]?.time)}</span><div><i className="actual" />{prices.symbol} 收盘 <i className="trend" />SMA200</div><span>{formatDate(priceSeries[priceSeries.length - 1]?.time)}</span></footer></> : <div className="risk-empty">尚无足够数据计算 200 日均线</div>}
      </section><section className="risk-panel risk-breakdown"><header className="risk-panel-heading"><div><span>FACTOR CONTRIBUTION</span><h2>当前压力贡献</h2></div><Activity size={18} /></header><div className="risk-breakdown-list">{[...factors].sort((a, b) => b.contribution - a.contribution).map(factor => <div key={factor.id}><span>{factor.label}<small>因子风险 {factor.score}</small></span><i><b style={{ width: `${factor.score}%` }} /></i><strong>{factor.contribution.toFixed(1)}</strong></div>)}</div><p className="risk-score-formula">综合分采用原项目分档规则。权重合计偏离 100% 时按比例归一化，避免仪表超出 0–100。</p></section></div>

      <section className="risk-panel risk-stress"><header className="risk-panel-heading"><div><span>HISTORICAL STRESS TEST</span><h2>跨时代风险对比</h2></div><BarChart3 size={18} /></header><div className="risk-stress-list">{comparison.map(item => <div key={item.label}><span><strong>{item.label}</strong><small>{item.date}</small></span><i><b className={item.score > 80 ? 'high' : item.score > 60 ? 'elevated' : ''} style={{ width: `${item.score / maxComparison * 100}%` }} /></i><em>{item.score.toFixed(1)}</em></div>)}</div><p>历史快照沿用原项目内置参考值，其中 200 日均线与 CNN 情绪为构造值，只用于复现原项目压力比较，不代表完整历史回测。</p></section>

      <footer className="risk-project-note"><span>模型来源：US_Stock_Crash_Monitor · SparkFlow 原生移植</span><span>市场风险指数是规则评分，不是崩盘概率或投资建议。</span></footer>
    </> : null}
  </div></div></PageTransition>;
}
