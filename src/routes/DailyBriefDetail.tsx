import {
  Activity,
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Bitcoin,
  BrainCircuit,
  CheckCircle2,
  CircleAlert,
  ExternalLink,
  LineChart,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react';
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import type {
  DailyBriefAssessment,
  DailyBriefChartPoint,
  DailyBriefFlowDetails,
  DailyBriefPerformanceDetails,
  DailyBriefPerformanceSeries,
  DailyBriefResponse,
} from '../lib/dailyBriefTypes';
import './DailyBrief.css';
import './DailyBriefDetail.css';

type DetailKind = 'judgement' | 'flows' | 'performance';

const detailNavigation: Array<{ kind: DetailKind; eyebrow: string; title: string; description: string }> = [
  { kind: 'judgement', eyebrow: 'AI ASSESSMENT', title: '综合评级', description: '结论、依据与风险检查' },
  { kind: 'flows', eyebrow: 'BTC EVIDENCE', title: '资金与情绪', description: '价格、ETF 与链上活跃度' },
  { kind: 'performance', eyebrow: 'LONG HORIZON', title: '长期资产表现', description: '共同起点、倍数与回撤' },
];

async function requestJson<T>(url: string) {
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  const payload = await response.json() as T & { detail?: string };
  if (!response.ok) throw new Error(payload.detail || `请求失败（${response.status}）`);
  return payload;
}

function formatDate(value?: string) {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(parsed);
}

function formatCompact(value: number | null, unit = '') {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${new Intl.NumberFormat('zh-CN', { notation: Math.abs(value) >= 10_000 ? 'compact' : 'standard', maximumFractionDigits: 2 }).format(value)}${unit}`;
}

function fallbackAssessment(response: DailyBriefResponse): DailyBriefAssessment {
  const summary = response.snapshot.summary;
  const rating = summary.tone === 'risk' ? '谨慎' : summary.tone === 'cautious' ? '中性偏谨慎' : summary.tone === 'calm' ? '中性偏积极' : '中性';
  return {
    rating,
    score: summary.tone === 'risk' ? 28 : summary.tone === 'cautious' ? 42 : summary.tone === 'calm' ? 66 : 52,
    confidence: '低',
    rationale: summary.headline,
    advice: [
      { label: '仓位管理', detail: summary.portfolioNotes[0] || '持仓数据不足，不生成个性化仓位比例。' },
      { label: '关键风险', detail: summary.risks[0] || '当前风险证据不足。' },
      { label: '加密观察', detail: '结合价格、ETF 资金流和链上活跃度交叉确认。' },
      { label: '黄金与防守资产', detail: summary.watchlist[0] || '观察美元、黄金和美债收益率的同步关系。' },
      { label: '潜在机会', detail: summary.highlights[0] || '暂未发现足够明确的结构性线索。' },
    ],
    disclaimer: '以上内容仅用于信息整理与风险检查，不构成任何投资建议。',
  };
}

function linePath(points: DailyBriefChartPoint[], width: number, height: number, logarithmic = false) {
  if (points.length < 2) return '';
  const values = points.map((point) => logarithmic ? Math.log(Math.max(point.value, 0.0001)) : point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = max - min || 1;
  return points.map((point, index) => {
    const value = logarithmic ? Math.log(Math.max(point.value, 0.0001)) : point.value;
    const x = index / (points.length - 1) * width;
    const y = height - ((value - min) / spread) * height;
    return `${index ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(' ');
}

function EvidenceLineChart({ price, activity }: { price: DailyBriefChartPoint[]; activity: DailyBriefChartPoint[] }) {
  return (
    <div className="brief-detail-chart">
      <div className="brief-detail-chart__legend"><span><i style={{ background: '#70b7ff' }} />BTC 价格</span><span><i style={{ background: '#e7bb74' }} />活跃地址（归一化视觉）</span></div>
      <svg viewBox="0 0 1000 360" role="img" aria-label="BTC 价格与活跃地址趋势图">
        {Array.from({ length: 6 }, (_, index) => <line key={index} x1="0" x2="1000" y1={index * 72} y2={index * 72} className="chart-grid-line" />)}
        <path d={linePath(price, 1000, 320)} className="chart-line is-price" transform="translate(0 20)" />
        <path d={linePath(activity, 1000, 320)} className="chart-line is-activity" transform="translate(0 20)" />
      </svg>
      <div className="brief-detail-chart__axis"><span>{price[0]?.time || '—'}</span><span>{price[price.length - 1]?.time || '—'}</span></div>
    </div>
  );
}

function EtfFlowChart({ points }: { points: DailyBriefChartPoint[] }) {
  const recent = points.slice(-90);
  const maxAbs = Math.max(1, ...recent.map((point) => Math.abs(point.value)));
  const cumulative = recent.map((point, index) => ({ time: point.time, value: recent.slice(Math.max(0, index - 6), index + 1).reduce((sum, item) => sum + item.value, 0) }));
  return (
    <div className="brief-detail-chart">
      <div className="brief-detail-chart__legend"><span><i style={{ background: '#54c9a3' }} />日净流入</span><span><i style={{ background: '#f1788d' }} />日净流出</span><span><i style={{ background: '#70b7ff' }} />7 日累计</span></div>
      <svg viewBox="0 0 1000 360" role="img" aria-label="美国现货 BTC ETF 资金流图">
        <line x1="0" x2="1000" y1="180" y2="180" className="chart-zero-line" />
        {recent.map((point, index) => {
          const width = Math.max(2, 1000 / Math.max(1, recent.length) - 3);
          const x = index / Math.max(1, recent.length) * 1000;
          const barHeight = Math.abs(point.value) / maxAbs * 145;
          return <rect key={point.time} x={x} y={point.value >= 0 ? 180 - barHeight : 180} width={width} height={barHeight} rx="2" className={point.value >= 0 ? 'chart-bar is-inflow' : 'chart-bar is-outflow'} />;
        })}
        <path d={linePath(cumulative, 1000, 300)} className="chart-line is-price" transform="translate(0 30)" />
      </svg>
      <div className="brief-detail-chart__axis"><span>{recent[0]?.time || '—'}</span><span>单位：百万美元</span><span>{recent[recent.length - 1]?.time || '—'}</span></div>
    </div>
  );
}

function PerformanceChart({ series }: { series: DailyBriefPerformanceSeries[] }) {
  const available = series.filter((item) => item.points.length > 1);
  const allValues = available.flatMap((item) => item.points.map((point) => Math.log(Math.max(point.value, 0.001))));
  const min = Math.min(...allValues, 0);
  const max = Math.max(...allValues, 1);
  const spread = max - min || 1;
  const start = Date.parse('2012-05-18');
  const end = Math.max(Date.now(), ...available.flatMap((item) => item.points.map((point) => Date.parse(point.time))));
  const pathFor = (item: DailyBriefPerformanceSeries) => item.points.map((point, index) => {
    const x = (Date.parse(point.time) - start) / Math.max(1, end - start) * 1000;
    const y = 350 - ((Math.log(Math.max(point.value, 0.001)) - min) / spread) * 330;
    return `${index ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(' ');
  return (
    <div className="brief-detail-chart is-performance">
      <svg viewBox="0 0 1000 390" role="img" aria-label="Mag7 与 BTC 共同起点长期表现图">
        {Array.from({ length: 6 }, (_, index) => <line key={index} x1="0" x2="1000" y1={20 + index * 66} y2={20 + index * 66} className="chart-grid-line" />)}
        {available.map((item) => <path key={item.symbol} d={pathFor(item)} className="chart-line" style={{ stroke: item.color }} />)}
      </svg>
      <div className="brief-performance-legend">
        {available.map((item) => <span key={item.symbol} style={{ borderColor: `${item.color}88` }}><i style={{ background: item.color }} />{item.symbol}<strong>{item.multiple?.toFixed(item.multiple >= 100 ? 0 : 1)}×</strong></span>)}
      </div>
      <div className="brief-detail-chart__axis"><span>2012</span><span>对数刻度 · 共同起点 = 1×</span><span>{new Date(end).getFullYear()}</span></div>
    </div>
  );
}

function DetailNav({ active }: { active: DetailKind }) {
  return <nav className="brief-detail-navigation" aria-label="简报详情页">{detailNavigation.map((item) => <Link key={item.kind} to={`/council/details/${item.kind}`} className={active === item.kind ? 'is-active' : ''}><small>{item.eyebrow}</small><strong>{item.title}</strong><span>{item.description}</span><ArrowRight size={16} /></Link>)}</nav>;
}

function JudgementView({ brief }: { brief: DailyBriefResponse }) {
  const { snapshot } = brief;
  const assessment = snapshot.summary.assessment || fallbackAssessment(brief);
  return <>
    <section className="brief-detail-rating-card">
      <div className="brief-detail-rating-card__heading"><div><p><BrainCircuit size={15} /> COMPREHENSIVE VIEW</p><h2>综合评级与今日判断</h2></div><span>置信度 {assessment.confidence}</span></div>
      <div className="brief-detail-rating"><div className="brief-detail-score" style={{ '--score': `${assessment.score}%` } as CSSProperties}><strong>{assessment.score}</strong><span>/ 100</span></div><div><small>{snapshot.summary.regime}</small><h3>{assessment.rating}</h3><p>{assessment.rationale}</p></div></div>
      <div className="brief-detail-advice"><p>AI 建议</p><ul>{assessment.advice.map((item) => <li key={item.label}><strong>{item.label}</strong><span>{item.detail}</span></li>)}</ul></div>
      <div className="brief-detail-disclaimer"><ShieldAlert size={16} />{assessment.disclaimer}</div>
    </section>
    <section className="brief-detail-prose-grid">
      <article><span>01 · 核心判断</span><h3>{snapshot.summary.headline}</h3>{snapshot.summary.highlights.map((item) => <p key={item}>{item}</p>)}</article>
      <article><span>02 · 关键风险</span><h3>什么可能改变今天的判断</h3>{snapshot.summary.risks.map((item) => <p key={item}>{item}</p>)}</article>
      <article><span>03 · 下一步确认</span><h3>观察，而不是预测</h3>{snapshot.summary.watchlist.map((item) => <p key={item}>{item}</p>)}</article>
    </section>
  </>;
}

function FlowsView({ data }: { data: DailyBriefFlowDetails }) {
  const cards = [
    ['BTC 参考价', formatCompact(data.metrics.btcPrice, ' USD')],
    ['BTC 30 日', formatCompact(data.metrics.btc30dChange, '%')],
    ['活跃地址 30 日', formatCompact(data.metrics.activity30dChange, '%')],
    ['ETF 最近一日', formatCompact(data.metrics.etfLatest, 'm')],
    ['ETF 近 7 日', formatCompact(data.metrics.etf7d, 'm')],
  ];
  return <>
    <section className="brief-detail-metric-grid">{cards.map(([label, value]) => <article key={label}><span>{label}</span><strong>{value}</strong></article>)}</section>
    {data.price.length ? <section className="brief-detail-visual-card"><div className="brief-detail-card-heading"><div><p><Bitcoin size={15} /> PRICE × NETWORK</p><h2>BTC 价格与链上活跃度</h2></div><span>近 180 日</span></div><EvidenceLineChart price={data.price} activity={data.activity} /><p className="brief-detail-note">活跃地址用于观察链上使用变化，是活跃度代理；它不是长期持有者净持仓，也不能单独解释价格方向。</p></section> : null}
    {data.etfFlows.length ? <section className="brief-detail-visual-card"><div className="brief-detail-card-heading"><div><p><BarChart3 size={15} /> SPOT ETF FLOW</p><h2>美国现货 BTC ETF 净流入</h2></div><span>近 90 个交易日</span></div><EtfFlowChart points={data.etfFlows} /></section> : null}
    <SourceNotes sources={data.sources} errors={data.errors} />
  </>;
}

function PerformanceView({ data }: { data: DailyBriefPerformanceDetails }) {
  return <>
    <section className="brief-detail-visual-card"><div className="brief-detail-card-heading"><div><p><LineChart size={15} /> COMMON START</p><h2>Mag7 + BTC：共同起点以来的价格表现</h2></div><span>{data.startDate} = 1×</span></div><PerformanceChart series={data.series} /><p className="brief-detail-note">曲线使用共同起点归一化与对数刻度，只比较历史价格路径，不代表未来收益或风险相同。</p></section>
    <section className="brief-detail-drawdowns"><div className="brief-detail-card-heading"><div><p><Activity size={15} /> DRAWDOWN CHECK</p><h2>最大回撤区间</h2></div></div><div className="brief-detail-table"><div className="is-head"><span>标的</span><span>最新倍数</span><span>最大回撤</span><span>峰值 → 谷底</span><span>状态</span></div>{data.series.map((item) => <div key={item.symbol}><span><i style={{ background: item.color }} />{item.symbol}</span><span>{item.multiple === null ? '—' : `${item.multiple.toFixed(item.multiple >= 100 ? 0 : 1)}×`}</span><span className="is-risk">{item.maxDrawdown === null ? '—' : `${item.maxDrawdown.toFixed(1)}%`}</span><span>{item.drawdownPeak || '—'} → {item.drawdownTrough || '—'}</span><span className={item.recovered ? 'is-ok' : 'is-pending'}>{item.recovered ? '已恢复' : '尚未恢复'}</span></div>)}</div></section>
    <SourceNotes sources={data.sources} errors={data.errors} />
  </>;
}

function SourceNotes({ sources, errors }: { sources: Array<{ label: string; url: string; detail: string }>; errors: string[] }) {
  return <section className="brief-detail-sources"><h2>数据口径与来源</h2><div>{sources.map((source) => <a href={source.url} target="_blank" rel="noreferrer" key={source.label}><strong>{source.label}<ExternalLink size={13} /></strong><span>{source.detail}</span></a>)}</div>{errors.length ? <p><CircleAlert size={15} />{errors.join('；')}</p> : <p className="is-ok"><CheckCircle2 size={15} />本页所需数据源已返回可用样本。</p>}</section>;
}

export function DailyBriefDetail() {
  const { section } = useParams();
  const kind = section as DetailKind;
  const [brief, setBrief] = useState<DailyBriefResponse | null>(null);
  const [detail, setDetail] = useState<DailyBriefFlowDetails | DailyBriefPerformanceDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const meta = useMemo(() => detailNavigation.find((item) => item.kind === kind), [kind]);

  useEffect(() => {
    if (!meta) return;
    let alive = true;
    setLoading(true); setError(''); setDetail(null);
    const task = kind === 'judgement' ? requestJson<DailyBriefResponse>('/api/daily-brief') : requestJson<DailyBriefFlowDetails | DailyBriefPerformanceDetails>(`/api/daily-brief/details?view=${kind}`);
    task.then((payload) => {
      if (!alive) return;
      if (kind === 'judgement') setBrief(payload as DailyBriefResponse); else setDetail(payload as DailyBriefFlowDetails | DailyBriefPerformanceDetails);
    }).catch((reason) => { if (alive) setError(reason instanceof Error ? reason.message : String(reason)); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [kind, meta]);

  if (!meta) return <Navigate to="/council" replace />;
  return <div className="daily-brief-page daily-brief-detail-page"><div className="daily-brief-orbit daily-brief-orbit--one" /><div className="daily-brief-shell"><header className="brief-detail-hero"><Link to="/council#overview"><ArrowLeft size={15} /> 返回每日简报</Link><p>{meta.eyebrow} · 每日简报详情</p><h1>{meta.title}</h1><span>{meta.description} · 更新 {formatDate(brief?.snapshot.updatedAt || detail?.generatedAt)}</span></header><DetailNav active={kind} />
    {loading ? <div className="brief-detail-loading"><RefreshCw className="is-spinning" />正在读取缓存数据…</div> : null}
    {error ? <div className="daily-brief-error"><CircleAlert size={17} />{error}</div> : null}
    <main className="brief-detail-content">{kind === 'judgement' && brief ? <JudgementView brief={brief} /> : null}{kind === 'flows' && detail?.kind === 'flows' ? <FlowsView data={detail} /> : null}{kind === 'performance' && detail?.kind === 'performance' ? <PerformanceView data={detail} /> : null}</main>
  </div></div>;
}
