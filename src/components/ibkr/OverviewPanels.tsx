import { useCallback, useEffect, useId, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CheckCircle2, ChevronRight, Clock3, ExternalLink, LayoutGrid, ShieldCheck, Sparkles, TrendingUp } from 'lucide-react';
import type { Alert, AnalysisJob, AnalysisReport, BriefInsight, DailyBrief, Evidence, Holding, PortfolioPerformance, WorkbenchState } from '../../lib/ibkr/workbenchTypes';
import { chartSeries, finite, monthlyReturns, overviewAllocation, periodReturn } from '../../lib/ibkr/overview';
import { industryLabel } from '../../lib/ibkr/industryLabels';
import './OverviewPanels.css';

const amount = (v: unknown) => finite(v) === null ? '—' : Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const percent = (v: number | null | undefined) => v == null || !Number.isFinite(v) ? '—' : `${(v * 100).toFixed(1)}%`;
const signed = (v: number | null | undefined) => v == null ? '—' : `${v > 0 ? '+' : ''}${(v * 100).toFixed(2)}%`;
const colors = ['#35dba3', '#5b9df0', '#efac48', '#a08cdd', '#60bfc5', '#859c8f'];
const stamp = (v?: string | null) => v ? new Date(v).toLocaleString('zh-CN', { hour12: false }) : '尚未同步';
const conclusionHighlight = /^([+-]?\d+(?:\.\d+)?%|[A-Z]{2,6}(?:\/[A-Z]{2,6})*|现金|集中度?|风险|减仓|加仓|持有|观望|不追高|优先|缺口|高弹性)$/;
const conclusionParts = (text: string) => text.split(/([+-]?\d+(?:\.\d+)?%|[A-Z]{2,6}(?:\/[A-Z]{2,6})*|现金|集中度?|风险|减仓|加仓|持有|观望|不追高|优先|缺口|高弹性)/g).filter(Boolean).map((part, index) => {
  if (!conclusionHighlight.test(part)) return part;
  const kind = /^[-+\d]/.test(part) ? 'number' : /^[A-Z]/.test(part) ? 'ticker' : /减仓|加仓|持有|观望|不追高|优先/.test(part) ? 'action' : 'risk';
  return <strong className={`awb-conclusion-${kind}`} key={`${part}-${index}`}>{part}</strong>;
});
const conclusionSignals = ['EXPOSURE', 'EVIDENCE', 'ACTION'];

export function OverviewPnlSummary({ state }: { state: WorkbenchState }) {
  const { metrics, baseCurrency } = state.snapshot;
  const value = finite(metrics.unrealizedPnl);
  return <article className="awb-pnl-summary" aria-label="未实现盈亏">
    <span className="awb-metric-icon"><TrendingUp size={23} /></span>
    <div className="awb-pnl-summary-values"><div className="awb-pnl-summary-field" title="当前持仓相对成本的累计浮动盈亏。">
      <span>未实现盈亏</span>
      <strong className={value === null || value === 0 ? '' : value < 0 ? 'negative' : 'positive'}>{value !== null && value > 0 ? '+' : ''}{amount(value)}</strong>
      <small>{baseCurrency ?? '—'} · {value === null ? '未提供' : 'IBKR 账面'}</small>
    </div></div>
  </article>;
}

function useSvgSize(width: number, height: number) {
  const [size, setSize] = useState({ width, height });
  const observer = useRef<ResizeObserver>();
  const ref = useCallback((node: SVGSVGElement | null) => {
    observer.current?.disconnect();
    if (!node) return;
    observer.current = new ResizeObserver(([entry]) => {
      const next = { width: Math.round(entry.contentRect.width), height: Math.round(entry.contentRect.height) };
      if (next.width > 0 && next.height > 0) setSize(previous => previous.width === next.width && previous.height === next.height ? previous : next);
    });
    observer.current.observe(node);
  }, []);
  return [ref, size] as const;
}

// Monotone interpolation preserves the observed extrema. Missing observations split the path.
function curve(points: { x: number; y: number }[]) {
  if (!points.length) return '';
  const slopes = points.slice(1).map((p, i) => (p.y - points[i].y) / (p.x - points[i].x));
  const tangent = points.map((_, i) => i === 0 ? slopes[0] ?? 0 : i === points.length - 1 ? slopes[i - 1] : slopes[i - 1] * slopes[i] <= 0 ? 0 : 2 / (1 / slopes[i - 1] + 1 / slopes[i]));
  return `M${points[0].x},${points[0].y}` + points.slice(1).map((p, i) => { const a = points[i], dx = (p.x - a.x) / 3; return ` C${a.x + dx},${a.y + dx * tangent[i]} ${p.x - dx},${p.y - dx * tangent[i + 1]} ${p.x},${p.y}`; }).join('');
}

export function PerformancePanel({ state }: { state: WorkbenchState }) {
  const account = state.snapshot.accountKey;
  const channel = `${state.source}:${state.source === 'gateway' ? state.gatewayMode : 'official'}:${account}`;
  const [remote, setRemote] = useState<{ channel: string; value: PortfolioPerformance }>();
  const [range, setRange] = useState<number | 'all'>(30), [mode, setMode] = useState<'nav' | 'return'>('nav'), [hover, setHover] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const [chartRef, { width: chartWidth, height: chartHeight }] = useSvgSize(690, 240);
  const [monthRef, { width: monthWidth, height: monthHeight }] = useSvgSize(690, 136);
  const plotBottom = chartHeight - 28;
  const gradient = useId().replace(/:/g, '');
  useEffect(() => {
    const controller = new AbortController(); setHover(null); setFailed(false);
    void fetch('/api/ibkr-workbench/performance', { signal: controller.signal }).then(async r => {
      if (!r.ok) throw new Error('历史暂不可用');
      const value = await r.json();
      if (!Array.isArray(value.points)) throw new Error('历史格式无效');
      if (!controller.signal.aborted) setRemote({ channel, value });
    }).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [channel, state.preferences.benchmark, state.performance?.fetchedAt]);
  const fetched = remote?.channel === channel ? remote.value : undefined;
  const performance = fetched && (!state.performance?.fetchedAt || Date.parse(fetched.fetchedAt ?? '') >= Date.parse(state.performance.fetchedAt)) ? fetched : state.performance ?? fetched;
  const all = chartSeries(performance), last = all.slice(-1)[0];
  const points = range === 'all' ? all : all.filter(p => !last || Date.parse(p.date) >= Date.parse(last.date) - range * 86400000);
  const twr = performance?.returnMethod === 'TWR';
  const base = points.find(p => p.cumulativeReturn !== null)?.cumulativeReturn;
  const baseB = points.find(p => p.benchmarkReturn != null && p.cumulativeReturn !== null);
  const hasBenchmark = mode === 'return' && twr && !!baseB;
  // Benchmark comparison uses the same starting observation for both series.
  const anchor = hasBenchmark ? baseB?.cumulativeReturn : base;
  const values = points.map(p => mode === 'nav' ? p.nav : !performance?.returnMethod ? null : !twr ? p.cumulativeReturn : p.cumulativeReturn !== null && anchor != null && (!hasBenchmark || p.date >= baseB!.date) ? (1 + p.cumulativeReturn) / (1 + anchor) - 1 : null);
  const benchmark = points.map(p => hasBenchmark && p.benchmarkReturn != null && p.date >= baseB!.date ? (1 + p.benchmarkReturn) / (1 + baseB!.benchmarkReturn!) - 1 : null);
  const valid = [...values, ...benchmark].filter((v): v is number => v !== null);
  const low = valid.length ? Math.min(...valid) : 0, high = valid.length ? Math.max(...valid) : 1;
  const spread = Math.max(high - low, Math.abs(high) * .002, .0001), bottom = low - spread * .12, top = high + spread * .12;
  const x = (i: number) => 18 + (Date.parse(points[i].date) - Date.parse(points[0].date)) / Math.max(1, Date.parse(points.slice(-1)[0]!.date) - Date.parse(points[0].date)) * (chartWidth - 96);
  const y = (v: number) => plotBottom - (v - bottom) / (top - bottom) * (plotBottom - 16);
  const segments = (series: (number | null | undefined)[]) => {
    const groups: { x: number; y: number }[][] = []; let group: { x: number; y: number }[] = [];
    series.forEach((v, i) => { if (v == null) { if (group.length) groups.push(group); group = []; } else group.push({ x: x(i), y: y(v) }); });
    if (group.length) groups.push(group); return groups;
  };
  const selected = hover !== null ? points[hover] : undefined;
  const previous = selected ? all[all.findIndex(p => p.date === selected.date) - 1] : undefined;
  const navChange = selected?.nav != null && previous?.nav != null ? selected.nav - previous.nav : null;
  const returnAnchor = hasBenchmark ? baseB : points.find(p => p.cumulativeReturn !== null);
  const hoverReturn = selected?.cumulativeReturn == null ? null : twr
    ? returnAnchor?.cumulativeReturn != null && selected.date >= returnAnchor.date ? (1 + selected.cumulativeReturn) / (1 + returnAnchor.cumulativeReturn) - 1 : null
    : performance?.returnMethod === 'MWR' ? selected.cumulativeReturn : null;
  const observationReturn = twr && selected?.cumulativeReturn != null && previous?.cumulativeReturn != null
    ? (1 + selected.cumulativeReturn) / (1 + previous.cumulativeReturn) - 1 : null;
  const tooltipWidth = Math.min(250, Math.max(0, chartWidth - 16));
  const tooltipX = hover !== null && selected ? Math.max(8, Math.min(chartWidth - tooltipWidth - 8, x(hover) + 16 + tooltipWidth <= chartWidth - 8 ? x(hover) + 16 : x(hover) - tooltipWidth - 16)) : 8;
  const tooltipId = `performance-detail-${gradient}`;
  const monthly = monthlyReturns(performance), extent = Math.max(.01, ...monthly.map(m => Math.abs(m.value ?? 0)));
  const localHistory = !performance?.returnMethod;
  const firstNav = all.find(point => point.nav !== null), navPoints = all.filter(point => point.nav !== null), latestNav = navPoints[navPoints.length - 1];
  const localNavChange = firstNav?.nav != null && latestNav?.nav != null && firstNav.date < latestNav.date ? latestNav.nav - firstNav.nav : null;
  const emptyCopy = state.source === 'mcp'
    ? { title: state.connection.authorized ? '正在等待 PortfolioAnalyst 历史' : '请先连接官方 MCP', detail: state.connection.authorized ? '当前账户同步后会读取官方历史；本地快照也会按日保留' : '完成 IBKR 官方授权后读取当前账户及 PortfolioAnalyst 历史' }
    : { title: `开始积累 ${state.gatewayMode === 'paper' ? '模拟盘' : '实盘'}净值轨迹`, detail: points.length ? '有效观测不足，至少两个不同日期后显示曲线' : '智能连接并成功同步后，SparkFlow 会按日保存该 Gateway 账户净值' };
  return <section className="awb-panel awb-performance awb-performance-redesign" aria-label="资产表现">
    <div className="awb-chart-toolbar"><div className="awb-chart-tabs">{[['nav', '资产净值'], ['return', '投资收益']].map(([value, label]) => <button key={value} aria-pressed={mode === value} disabled={value === 'return' && !performance?.returnMethod} onClick={() => { setMode(value as typeof mode); setHover(null); }}>{label}</button>)}</div><div className="awb-period-tabs">{([[7, '1周'], [30, '1月'], [90, '3月'], [365, '1年'], ['all', '全部']] as const).map(([value, label]) => <button key={value} aria-pressed={range === value} title={value === 'all' ? '全部可用历史' : undefined} onClick={() => { setRange(value); setHover(null); }}>{label}</button>)}</div></div>
    <div className="awb-chart-reading"><span>{selected && hover !== null ? `${selected.date} · ${mode === 'nav' ? amount(values[hover]) : signed(values[hover])}` : mode === 'nav' ? `资产净值 · ${performance?.currency ?? state.snapshot.baseCurrency ?? '币种待核实'}` : twr ? '时间加权收益 · 所选区间' : '资金加权累计收益 · 原始口径'}</span><small>{performance?.source ?? '历史尚未取得'}</small></div>
    {values.filter(v => v !== null).length > 1 ? <div className="awb-nav-chart-wrap"><svg className="awb-nav-chart" ref={chartRef} viewBox={`0 0 ${chartWidth} ${chartHeight}`} role="img" aria-label="账户资产表现曲线" aria-describedby={selected ? tooltipId : undefined} tabIndex={0} onBlur={() => setHover(null)} onMouseLeave={() => setHover(null)} onMouseMove={e => {
      const rect = e.currentTarget.getBoundingClientRect(), target = (e.clientX - rect.left) / rect.width * chartWidth;
      setHover(points.reduce((best, _, i) => Math.abs(x(i) - target) < Math.abs(x(best) - target) ? i : best, 0));
    }} onKeyDown={e => { if (e.key === 'Escape') setHover(null); if (['ArrowLeft', 'ArrowRight'].includes(e.key)) { e.preventDefault(); setHover(Math.max(0, Math.min(points.length - 1, (hover ?? points.length - 1) + (e.key === 'ArrowRight' ? 1 : -1)))); } }}>
      <defs><linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1"><stop stopColor="#35dba3" stopOpacity=".3"/><stop offset="1" stopColor="#35dba3" stopOpacity=".01"/></linearGradient></defs>
      {[0, 1, 2, 3, 4].map(i => { const value = top - (top - bottom) * i / 4, yy = y(value); return <g key={i}><path d={`M18 ${yy}H${chartWidth - 78}`} stroke="#24362c" opacity=".35"/><text x={chartWidth - 4} y={yy + 3} textAnchor="end">{mode === 'nav' ? amount(value) : signed(value)}</text></g>; })}
      {segments(values).map((group, i) => <g key={i}><path d={`${curve(group)} L${group.slice(-1)[0]!.x},${plotBottom} L${group[0].x},${plotBottom} Z`} fill={`url(#${gradient})`}/><path d={curve(group)} fill="none" stroke="#35dba3" strokeWidth="2.2" vectorEffect="non-scaling-stroke"/></g>)}
      {hasBenchmark && segments(benchmark).map((group, i) => <path key={i} d={curve(group)} fill="none" stroke="#a49ddb" strokeWidth="1.5" strokeDasharray="5 4" vectorEffect="non-scaling-stroke"/>)}
      {[...new Set(Array.from({ length: Math.min(chartWidth < 450 ? 3 : 6, points.length) }, (_, i) => Math.round(i / Math.min(chartWidth < 450 ? 2 : 5, points.length - 1) * (points.length - 1))))].map(i => <text key={i} x={x(i)} y={chartHeight - 4} textAnchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'}>{points[i].date.slice(5)}</text>)}
      {hover !== null && points[hover] && <g><path d={`M${x(hover)} 16V${plotBottom}`} stroke="#8faa9a" strokeDasharray="3 3"/>{values[hover] != null && <><path d={`M18 ${y(values[hover]!)}H${chartWidth - 78}`} stroke="#8faa9a" strokeDasharray="3 3" opacity=".55"/><circle cx={x(hover)} cy={y(values[hover]!)} r="3" fill="#35dba3"/></>}</g>}
    </svg>{selected && <div className="awb-performance-tooltip" id={tooltipId} role="tooltip" aria-label="资产表现详情" style={{ left: tooltipX, width: tooltipWidth, top: 8 }}>
      <dl>
        <dt>时间（日度）</dt><dd>{selected.date}</dd>
        <dt>资产净值</dt><dd>{amount(selected.nav)} <small>{performance?.currency ?? state.snapshot.baseCurrency ?? '—'}</small></dd>
        <dt>{twr ? '区间收益率 · TWR' : performance?.returnMethod === 'MWR' ? '累计收益率 · MWR' : '收益率'}</dt><dd className={hoverReturn == null ? '' : hoverReturn < 0 ? 'negative' : 'positive'}>{signed(hoverReturn)}</dd>
        <dt>较上一观测收益率</dt><dd className={observationReturn == null ? '' : observationReturn < 0 ? 'negative' : 'positive'}>{signed(observationReturn)}</dd>
        <dt>净值变动</dt><dd className={navChange == null ? '' : navChange < 0 ? 'negative' : 'positive'}>{navChange !== null && navChange > 0 ? '+' : ''}{amount(navChange)}</dd>
      </dl>
      <p>{twr && returnAnchor ? `区间起点 ${returnAnchor.date}。` : ''}{previous ? `上一观测 ${previous.date}。` : '无上一观测。'}净值变动包含资金进出，不等于投资盈亏。</p>
      <small>{performance?.source ?? '来源待核实'}</small>
    </div>}</div> : <div className="awb-chart-empty"><strong>{emptyCopy.title}</strong><p>{emptyCopy.detail}</p></div>}
    <div className="awb-chart-legend">{state.metrics?.sectors.slice(0, 3).map((s, i) => <span key={s.name}><i style={{ background: colors[i] }}/>{industryLabel(s.name)} {percent(s.weight)}</span>)}<span><i style={{ background: colors[5] }}/>现金 {percent(overviewAllocation(state.snapshot).cashWeight)}</span>{hasBenchmark && <span><i style={{ background: '#a49ddb' }}/>{performance?.benchmark} 基准</span>}</div>
    <p className="awb-overview-note">{performance?.note ?? '净值变化含出入金，不能直接视为投资收益。'}{failed && ' 历史刷新失败，保留已有记录。'}</p>
    {hasBenchmark && <div className="awb-performance-stats"><span>区间超额 <b>{signed(points.map((_, i) => values[i] !== null && benchmark[i] !== null ? values[i]! - benchmark[i]! : null).filter(v => v !== null).slice(-1)[0])}</b></span><span>波动率比较 <b>{performance?.volatilityRatio == null ? '至少需要 60 个共同交易日' : `${performance.volatilityRatio.toFixed(2)}×（完整共同历史）`}</b></span><small>{performance?.benchmarkSource ?? '基准未取得'}</small></div>}
    {localHistory ? <div className="awb-performance-bottom awb-performance-local-bottom"><div className="awb-return-summary" aria-label="本地净值摘要">
      <div className="awb-inception-return"><small>历史记录</small><b>{all.filter(point => point.nav !== null).length} 个日期</b><span>{state.source === 'gateway' ? `IB Gateway ${state.gatewayMode === 'paper' ? '模拟盘' : '实盘'}` : 'MCP 当前账户快照'}</span></div>
      <div><small>起始净值</small><b>{amount(firstNav?.nav)}</b><span>{firstNav?.date ?? '等待首次同步'}</span></div>
      <div><small>最新净值</small><b>{amount(latestNav?.nav)}</b><span>{latestNav?.date ?? '等待首次同步'}</span></div>
      <div><small>净值变动 · 含出入金</small><b className={localNavChange == null ? '' : localNavChange < 0 ? 'negative' : 'positive'}>{localNavChange !== null && localNavChange > 0 ? '+' : ''}{amount(localNavChange)}</b><span>不作为投资收益率</span></div>
    </div><div className="awb-monthly awb-local-history-note"><div className="awb-section-heading"><h3>当前历史口径</h3><small>{performance?.source ?? '来源待同步'}</small></div><p>{state.source === 'gateway' ? 'Gateway 提供当前账户账面数据；这里展示 SparkFlow 按日保存的独立净值轨迹。实盘与模拟盘分别保存，不从 MCP 借用历史。' : '当前账户由 MCP 同步；PortfolioAnalyst 收益历史可用后会自动切换为经过券商核实的 TWR 或 MWR。'}</p></div></div> : <div className="awb-performance-bottom"><div className="awb-return-summary" aria-label="收益摘要">
      <div className="awb-inception-return" title={performance?.inception?.note ?? '等待 IBKR 核实自始以来的完整业绩'}>
        <small>自始以来总回报</small>
        <b className={performance?.inception?.value == null ? '' : performance.inception.value < 0 ? 'negative' : 'positive'}>{signed(performance?.inception?.value)}</b>
        <span>{performance?.inception?.value != null ? `${performance.inception.start} 至 ${performance.inception.end} · ${performance.returnMethod}` : '完整历史待核实'}</span>
      </div>
      {([7, 30, range] as const).map((days, i) => { const result = periodReturn(performance, days); return <div key={i} title={result.value !== null ? `${result.start} 至 ${result.end}` : '缺少区间起点或未核实 TWR'}><small>{i === 0 ? '近一周收益' : i === 1 ? '近一月收益' : days === 'all' ? '全部区间收益' : `所选 ${days} 日收益`}</small><b className={(result.value ?? 0) < 0 ? 'negative' : 'positive'}>{signed(result.value)}</b></div>; })}</div>
    <div className="awb-monthly"><div className="awb-section-heading"><h3>月度收益率</h3><small>最近 6 个月 · TWR</small></div>
      {monthly.some(m => m.value !== null) ? <svg className="awb-month-chart" ref={monthRef} viewBox={`0 0 ${monthWidth} ${monthHeight}`} role="img" aria-label="月度收益率柱状图"><path d={`M0 ${monthHeight / 2 - 3}H${monthWidth}`} stroke="#304337"/>{monthly.map((m, i) => { const xx = (i + .5) * monthWidth / 6, zero = monthHeight / 2 - 3, height = Math.abs(m.value ?? 0) / extent * Math.max(8, (monthHeight - 42) / 2); return <g key={m.month}><title>{m.month}：{signed(m.value)} · {m.start ?? '起点缺失'} 至 {m.end ?? '终点缺失'}</title>{m.value === null ? <text x={xx} y={zero - 5} textAnchor="middle">—</text> : <><rect x={xx - 13} y={m.value >= 0 ? zero - height : zero} width="26" height={Math.max(1, height)} rx="3" fill={m.value >= 0 ? '#2bb88b' : '#c66559'}/><text x={xx} y={m.value >= 0 ? zero - 5 - height : zero + 11 + height} textAnchor="middle">{signed(m.value)}</text></>}<text x={xx} y={monthHeight - 3} textAnchor="middle">{m.month.slice(5)}月{m.partial ? '*' : ''}</text></g>; })}</svg> : <div className="awb-monthly-empty">暂不足以计算月度收益：需要 TWR 和相邻月界观测。</div>}
      <small>按实际月界观测计算；缺失月份留空。{last ? `最新月份截至 ${last.date}，标 * 为截至该日。` : ''}</small>
    </div></div>}
  </section>;
}

export function OverviewBrief({ state, report, pending, openReport }: { state: WorkbenchState; report?: AnalysisReport; pending?: AnalysisJob; openReport: () => void }) {
  const localDay = (value: Date | string) => { const date = new Date(value); return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date) : undefined; };
  const today = localDay(new Date());
  const reportDay = report ? localDay(report.generatedAt) : undefined;
  const todayReport = report && reportDay === today ? report : undefined;
  const todayPending = pending && localDay(pending.startedAt) === today ? pending : undefined;
  const showIncomplete = !todayReport && Boolean(todayPending || report && reportDay !== today);
  const points = todayReport ? (todayReport.content.briefPoints?.length ? todayReport.content.briefPoints : [todayReport.content.brief]).slice(0, 3) : [];
  const schedule = state.preferences.schedules?.analysis;
  return <section className="awb-panel awb-brief-redesign awb-overview-analysis-card" aria-label="今日分析结论">
    <div className="awb-overview-analysis-head"><span className="awb-ai-badge"><Sparkles size={13}/>今日分析结论</span><small>{todayReport ? stamp(todayReport.generatedAt) : '今日尚未生成'}</small></div>
    <h2 className="awb-ai-headline">{todayReport?.content.headline ?? '今天还没有账户分析结论'}</h2>
    {showIncomplete && <p className="awb-brief-notice">{todayPending?.state === 'running' ? '今日账户分析正在生成，完成后会自动显示在这里。' : '今日账户分析尚未完成，可前往 AI 分析继续。'}</p>}
    {points.length ? <ol className="awb-overview-analysis-points">{points.map((point, index) => <li className={`awb-conclusion-card awb-conclusion-card-${index + 1}`} data-signal={conclusionSignals[index] ?? 'SIGNAL'} key={`${index}-${point}`} tabIndex={0}><span className="awb-conclusion-index">{String(index + 1).padStart(2, '0')}</span><p>{conclusionParts(point)}</p><i className="awb-conclusion-scan" aria-hidden="true"/><div className="awb-conclusion-ornament" aria-hidden="true"><i/><i/><i/><i/></div></li>)}</ol> : <p className="awb-overview-analysis-empty">只有你手动发起或已开启的每日定时任务会生成分析；启动服务不会自动补跑。</p>}
    <div className="awb-overview-analysis-footer"><small>{todayReport ? `${todayReport.kind === 'daily' ? '定时分析' : '手动分析'} · ${todayReport.model}` : schedule?.enabled ? `每日定时已开启 · ${schedule.mode === 'market-close' ? '美股收盘后 30 分钟' : schedule.times.join('、')}` : '每日定时未开启'}</small><button className="awb-ai-cta" onClick={openReport}>{todayReport ? '查看完整分析' : todayPending ? '查看分析进度' : '前往 AI 分析'}<ChevronRight size={16}/></button></div>
  </section>;
}

const briefKind = { opportunity: '机会', risk: '风险', mixed: '双向影响', watch: '观察' };
const briefPriority = { high: '重点', medium: '中等', low: '一般' };
const briefChange = { new: '新增', ongoing: '持续', upgraded: '升级', eased: '缓解' };
const briefConfidence = { high: '高', medium: '中', low: '低' };
const briefCoverage = { complete: '已覆盖', partial: '部分覆盖', failed: '检索失败', unsupported: '暂不支持' };
const briefArea: Record<string, string> = { news: '近期新闻', filings: '公告财报', filing: '公告财报', financials: '财报', earnings: '财报', valuation: '估值', macro: '宏观', calendar: '已核实事件', calendarChecked: '已查官方事件页', market: '行情', profile: '公司资料' };
const briefLimitation = (gap: string) => /历史分位|仅提供损益表|报告期不能作为发布日期|ETF成分|未完整核验价格时点|使用(?:FRED转发的BLS|BLS)原始序列/.test(gap);
const briefTime = (value?: string | null) => {
  if (!value) return '未确认';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value}（时间未确认）`;
  return Number.isNaN(Date.parse(value)) ? '未确认' : new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
};
const briefSourceUrl = (value: string) => {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : undefined; } catch { return undefined; }
};

function BriefSources({ evidence, ids, support = [] }: { evidence: Evidence[]; ids: string[]; support?: BriefInsight['support'] }) {
  const sources = [...new Set(ids)].map(id => evidence.find(item => item.id === id)).filter((item): item is Evidence => !!item);
  return <div className="awb-brief-sources">{sources.length ? sources.map(source => {
    const url = briefSourceUrl(source.url), quotes = support.filter(item => item.evidenceId === source.id && item.quote);
    return <div key={source.id} className="awb-brief-source">
      {url ? <a href={url} target="_blank" rel="noopener noreferrer">{source.title}<ExternalLink size={11}/></a> : <span>{source.title}</span>}
      <small>{source.source} · {source.primary ? '一手来源' : '外部来源'} · {source.read ? '已读取' : '读取状态未确认'}</small>
      <small>发布 {briefTime(source.publishedAt)} · 读取 {briefTime(source.fetchedAt)}（北京时间）</small>
      {quotes.map((item, i) => <blockquote key={i}>{item.quote}</blockquote>)}
    </div>;
  }) : <small>这条提醒未附可核验的外部来源。</small>}</div>;
}

function DailyInsight({ insight, evidence }: { insight: BriefInsight; evidence: Evidence[] }) {
  return <article className={`awb-daily-insight awb-daily-insight-${insight.kind}`}>
    <div className="awb-brief-tags"><span className={`awb-brief-kind awb-brief-kind-${insight.kind}`}>{briefKind[insight.kind]}</span><span>{briefPriority[insight.priority]}</span><span className={`awb-brief-change-${insight.status}`}>{briefChange[insight.status]}</span>{insight.symbols.map(symbol => <b key={symbol}>{symbol}</b>)}</div>
    <h4>{insight.title}</h4>
    <p className="awb-brief-impact">{insight.impact}</p>
    <details className="awb-brief-expand"><summary>查看事实、观察条件与证据<ChevronRight size={13}/></summary><div className="awb-brief-expanded">
      <div><h5>发生了什么</h5><p>{insight.fact}</p></div>
      <div><h5>接下来看什么</h5><p>{insight.watch}</p></div>
      <div><h5>什么会改变判断</h5><p>{insight.invalidation}</p></div>
      <p className="awb-brief-confidence">影响周期 · {insight.horizon || '待确认'}<br/>置信度 · {briefConfidence[insight.confidence]}{insight.confidenceReason ? `，${insight.confidenceReason}` : ''}</p>
      <BriefSources evidence={evidence} ids={insight.evidenceIds} support={insight.support}/>
    </div></details>
  </article>;
}

function DailyResearch({ brief }: { brief: DailyBrief }) {
  const insights = [...(brief.content.insights ?? [])].sort((a, b) => ({ high: 0, medium: 1, low: 2 }[a.priority] - { high: 0, medium: 1, low: 2 }[b.priority]));
  const evidence = brief.evidence ?? [], calendar = brief.content.calendar ?? [], changes = brief.content.changes ?? [];
  const gaps = [...new Set([...brief.content.gaps, ...(brief.researchGaps ?? [])])];
  const limitations = gaps.filter(briefLimitation), issues = gaps.filter(gap => !briefLimitation(gap));
  return <>
    <div className="awb-daily-judgement"><h3><Sparkles size={15}/>账户风险速览</h3><p>{brief.content.summary}</p></div>
    <div className="awb-daily-opportunities"><div className="awb-brief-section-title"><h3><ShieldCheck size={15}/>机会与风险</h3><small>{insights.length} 条提醒</small></div>
      {insights.slice(0, 2).map(insight => <DailyInsight key={insight.id} insight={insight} evidence={evidence}/>)}
      {!insights.length && <p className="awb-overview-note">本期未列出重点提醒，判断范围请结合下方研究覆盖查看。</p>}
      {insights.length > 2 && <details className="awb-brief-more"><summary>其余 {insights.length - 2} 条提醒<ChevronRight size={13}/></summary>{insights.slice(2).map(insight => <DailyInsight key={insight.id} insight={insight} evidence={evidence}/>)}</details>}
    </div>
    <details className="awb-brief-fold"><summary><span><Clock3 size={14}/>未来 7 日关注</span><span>{calendar.length} 个事件<ChevronRight size={14}/></span></summary><div className="awb-brief-expanded">
      {calendar.length ? calendar.map((event, i) => <article className="awb-brief-calendar" key={`${event.title}-${i}`}><small>{briefTime(event.at)}{event.at && !/^\d{4}-\d{2}-\d{2}$/.test(event.at) ? '（北京时间）' : ''} · {{ confirmed: '已确认', estimated: '预计', unknown: '日期待核实' }[event.dateStatus]}</small><h4>{event.title}</h4>{!!event.symbols.length && <div className="awb-brief-tags">{event.symbols.map(symbol => <b key={symbol}>{symbol}</b>)}</div>}<h5>观察条件</h5><p>{event.watch}</p><h5>账户含义</h5><p>{event.implication}</p><BriefSources evidence={evidence} ids={event.evidenceIds}/></article>) : <p>本期没有列出未来事件；这不代表未来 7 日没有影响持仓的事件。</p>}
    </div></details>
    {!!changes.length && <details className="awb-brief-fold"><summary><span>相较上期的变化</span><span>{changes.length} 项<ChevronRight size={14}/></span></summary><ul>{changes.map((change, i) => <li key={i}>{change}</li>)}</ul></details>}
    <details className="awb-brief-fold awb-brief-coverage"><summary><span>研究覆盖与来源</span><span>{evidence.filter(item => item.read).length} 篇已读取<ChevronRight size={14}/></span></summary><div className="awb-brief-expanded">
      {!!issues.length && <div className="awb-daily-gaps"><h3>本期数据缺口</h3><ul>{issues.map((gap, i) => <li key={i}>{gap}</li>)}</ul></div>}
      {!!limitations.length && <details className="awb-brief-expand"><summary>数据口径与功能范围（{limitations.length} 项）<ChevronRight size={13}/></summary><ul>{limitations.map((gap, i) => <li key={i}>{gap}</li>)}</ul></details>}
      {brief.coverage?.length ? <ul className="awb-brief-coverage-list">{brief.coverage.map(item => <li key={item.symbol}><div><b>{item.symbol}</b><span className={`awb-coverage-${item.status}`}>{briefCoverage[item.status]}</span></div><small>{item.areas.length ? `已取得：${item.areas.map(area => briefArea[area] ?? area).join(' · ')}` : '本期尚未取得有效研究来源'}</small>{!!item.gaps.length && <details className="awb-brief-expand"><summary>查看未覆盖内容与原因<ChevronRight size={13}/></summary><ul>{item.gaps.map((gap, i) => <li key={i}>{gap.replace(/\b(profile|news|calendar|prices|financials)\b/g, area => briefArea[area === 'prices' ? 'market' : area] ?? area)}</li>)}</ul></details>}</li>)}</ul> : <p>本期未提供逐标的研究覆盖记录。</p>}
      <BriefSources evidence={evidence} ids={evidence.map(item => item.id)}/>
    </div></details>
    <p className="awb-overview-note">⚠️ 以上内容仅供参考，不构成任何投资建议，投资有风险，决策需谨慎。</p>
  </>;
}

function BriefSynthesis({ detail, preservingPrevious }: { detail: string; preservingPrevious: boolean }) {
  return <section className="awb-brief-synthesis" role="status" aria-label="账户简报生成中">
    <div className="awb-synthesis-glow" aria-hidden="true"><i/><i/><i/></div>
    <div className="awb-synthesis-copy"><span>LIVE / SIGNAL SYNTHESIS</span><h3>正在合成今日账户简报</h3><p>{detail}</p>{preservingPrevious && <small>当前保留上一份成功简报，可继续查看。</small>}</div>
    <div className="awb-synthesis-stages" aria-hidden="true"><b>账户快照</b><b>市场证据</b><b>观点编排</b></div>
  </section>;
}

function DailyAccountBrief({ state, generate, busy }: { state: WorkbenchState; generate?: () => void; busy?: boolean }) {
  const status = state.dailyBrief!, brief = status.latest, running = status.state === 'running';
  const ready = ['ready', 'empty'].includes(state.snapshot.state);
  return <section className="awb-panel awb-brief-redesign awb-daily-brief" aria-label="AI 账户简报">
    {running ? <BriefSynthesis detail={status.detail} preservingPrevious={Boolean(brief)}/> : status.state !== 'ready' && status.detail && <p className="awb-brief-notice" role="status">{status.detail}</p>}
    {brief ? <div className="awb-daily-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{brief.content.markdown ?? brief.content.summary}</ReactMarkdown></div> : !running && <p className="awb-daily-empty">生成今日最高持仓的具体操作建议。</p>}
    <div className="awb-daily-footer">
      <button className="awb-full primary" onClick={generate} disabled={!generate || busy || running || !ready || !state.ai.enabled || state.ai.usedToday >= state.preferences.maxAiCalls}>{running ? '正在生成简报' : brief ? '重新生成简报' : '生成账户简报'}<Sparkles size={14}/></button>
    </div>
  </section>;
}

export function OverviewAllocation({ state }: { state: WorkbenchState }) {
  const sectors = (state.metrics?.sectors ?? []).filter(s => Number.isFinite(s.weight) && s.weight > 0);
  const total = sectors.reduce((sum, sector) => sum + sector.weight, 0);
  const [active, setActive] = useState<string | null>(null);
  const palette = ['#35dba3', '#5b9df0', '#efac48', '#a08cdd', '#60bfc5', '#859c8f', '#de839b', '#adbd65', '#d08b5b', '#7d92bb'];
  let offset = -Math.PI / 2;
  return <section className="awb-panel awb-allocation-panel">
    <div className="awb-section-heading"><h2>行业配置</h2><small>占净资产 · {state.snapshot.baseCurrency ?? '—'}</small></div>
    {total > 0 ? <>
      <svg className="awb-sector-pie" viewBox="0 0 240 240" role="img" aria-label="行业配置扇形图">
        <title>行业配置：{sectors.map(s => `${industryLabel(s.name)} ${percent(s.weight)}`).join('，')}</title>
        {sectors.map((sector, i) => {
          const start = offset, angle = sector.weight / total * Math.PI * 2;
          offset += angle;
          const x = (r: number) => 120 + 108 * Math.cos(r), y = (r: number) => 120 + 108 * Math.sin(r);
          const props = { fill: palette[i % palette.length], opacity: active && active !== sector.name ? .35 : 1, onMouseEnter: () => setActive(sector.name), onMouseLeave: () => setActive(null) };
          const title = `${industryLabel(sector.name)}：占净资产 ${percent(sector.weight)}，占已统计持仓 ${percent(sector.weight / total)}`;
          return sectors.length === 1
            ? <circle key={sector.name} cx="120" cy="120" r="108" {...props}><title>{title}</title></circle>
            : <path key={sector.name} d={`M120,120 L${x(start)},${y(start)} A108,108 0 ${angle > Math.PI ? 1 : 0},1 ${x(offset)},${y(offset)} Z`} {...props}><title>{title}</title></path>;
        })}
      </svg>
      <div className="awb-sector-legend">{sectors.map((sector, i) => <button key={sector.name} onMouseEnter={() => setActive(sector.name)} onMouseLeave={() => setActive(null)} onFocus={() => setActive(sector.name)} onBlur={() => setActive(null)} onClick={() => setActive(active === sector.name ? null : sector.name)} aria-pressed={active === sector.name}><i style={{ background: palette[i % palette.length] }}/><span>{industryLabel(sector.name)}</span><b>{percent(sector.weight)}</b></button>)}</div>
      <p className="awb-overview-note">扇区按已统计持仓归一化，列表为占净资产比例。行业未知单独列示；ETF 不穿透。</p>
    </> : <p className="awb-overview-note">行业资料尚未取得。</p>}
  </section>;
}

export function OverviewPnl({ state, select }: { state: WorkbenchState; select: (p: Holding) => void }) {
  const currencies = [...new Set(state.snapshot.positions.map(p => p.currency))];
  const [chosen, setChosen] = useState('');
  const base = state.snapshot.baseCurrency ?? '';
  const currency = currencies.includes(chosen) ? chosen : currencies.includes(base) ? base : currencies[0] ?? base;
  const positions = state.snapshot.positions.filter(p => p.currency === currency);
  const rows = positions.map(holding => ({ holding, pnl: finite(holding.unrealizedPnl) })).sort((a, b) => {
    if (a.pnl === null) return b.pnl === null ? 0 : 1;
    if (b.pnl === null) return -1;
    return b.pnl - a.pnl;
  });
  const groups = [
    { key: 'gain', label: '盈利', count: rows.filter(r => r.pnl !== null && r.pnl > 0).length },
    { key: 'loss', label: '亏损', count: rows.filter(r => r.pnl !== null && r.pnl < 0).length },
    { key: 'flat', label: '持平', count: rows.filter(r => r.pnl === 0).length },
    { key: 'missing', label: '缺失', count: rows.filter(r => r.pnl === null).length },
  ];
  const share = (count: number) => positions.length ? percent(count / positions.length) : '—';
  const maximum = rows.reduce((max, r) => Math.max(max, Math.abs(r.pnl ?? 0)), 0);
  const pnlLabel = (value: number | null) => value === null ? '缺失' : `${value > 0 ? '+' : ''}${value !== 0 && Math.abs(value) < 0.01 ? value.toLocaleString('en-US', { maximumSignificantDigits: 3 }) : amount(value)}`;
  const distribution = groups.map(g => `${g.label} ${g.count} 个，占 ${share(g.count)}`).join('；');
  return <section className="awb-panel awb-pnl-panel awb-pnl-chart-panel">
    <div className="awb-section-heading"><h2>持仓盈亏分布</h2><select aria-label="盈亏排行币种" value={currency} onChange={e => setChosen(e.target.value)}>{[...new Set([currency, ...currencies])].map(c => <option key={c} value={c}>{c || '币种待核实'}</option>)}</select></div>
    <p className="awb-pnl-subtitle">按持仓数量 · {positions.length} 个持仓 · {currency || '—'}</p>
    {positions.length > 0 ? <>
      <div className="awb-pnl-ratios">{groups.slice(0, 2).map(g => <div key={g.key} className={`awb-pnl-${g.key}`}><span>{g.label}<small>{g.count} 个</small></span><strong>{share(g.count)}</strong></div>)}</div>
      <div className="awb-pnl-sharebar" role="img" aria-label={distribution}>{groups.filter(g => g.count > 0).map(g => <span key={g.key} className={`awb-pnl-${g.key}`} style={{ width: `${g.count / positions.length * 100}%` }} title={`${g.label} ${g.count} 个 · ${share(g.count)}`} />)}</div>
      {groups.slice(2).some(g => g.count > 0) && <div className="awb-pnl-other">{groups.slice(2).filter(g => g.count > 0).map(g => <span key={g.key}><i className={`awb-pnl-${g.key}`} />{g.label} {g.count} 个 · {share(g.count)}</span>)}</div>}
      <div className="awb-pnl-chart-title"><span>未实现盈亏金额</span><small>高 → 低</small></div>
      <div className="awb-pnl-axis" aria-hidden="true"><span /><div><span>亏损</span><b>0</b><span>盈利</span></div><span>{currency || '—'}</span></div>
      <div className="awb-pnl-bars" role="group" aria-label="各持仓未实现盈亏，左右同尺度，点击查看持仓">
        {rows.map(({ holding, pnl }) => <button type="button" className="awb-pnl-row awb-pnl-bar-row" key={holding.conId} onClick={() => select(holding)} aria-label={`${holding.symbol}，未实现盈亏 ${pnlLabel(pnl)} ${currency}，查看持仓`} title={`${holding.symbol} · 未实现盈亏 ${pnlLabel(pnl)} ${currency}`}>
          <span className="awb-pnl-symbol">{holding.symbol}</span>
          <span className="awb-pnl-track" aria-hidden="true">{pnl !== null && pnl !== 0 && <i className={pnl > 0 ? 'awb-pnl-gain' : 'awb-pnl-loss'} style={{ width: `${Math.abs(pnl) / maximum * 50}%`, left: pnl > 0 ? '50%' : `${50 - Math.abs(pnl) / maximum * 50}%` }} />}{pnl === 0 && <i className="awb-pnl-zero" />}</span>
          <b className={pnl === null || pnl === 0 ? 'awb-pnl-neutral' : pnl > 0 ? 'positive' : 'negative'}>{pnlLabel(pnl)}</b>
        </button>)}
      </div>
      <p className="awb-overview-note awb-pnl-caption">比例 = 对应持仓数 ÷ 本币种全部持仓数。条长表示金额，左右同尺度；列表可滚动，点击查看持仓。</p>
    </> : <p className="awb-overview-note">暂无持仓，盈亏比例待生成。</p>}
    <p className="awb-overview-note awb-pnl-source" title={state.snapshot.asOf ?? undefined}>IBKR 未实现盈亏 · 非今日收益或收益率</p>
  </section>;
}

export function OverviewFunds({ state }: { state: WorkbenchState }) {
  const snapshot = state.snapshot, allocation = overviewAllocation(snapshot);
  const currency = snapshot.baseCurrency ?? '—';
  const nav = finite(snapshot.metrics.netLiquidation);
  const invested = allocation.excluded === 0 ? allocation.rows.reduce((sum, row) => sum + row.value, 0) : null;
  const pnl = finite(snapshot.metrics.unrealizedPnl);
  const metrics = [
    { name: '持仓市值', value: invested, color: '#70dcba', detail: '本位币已估值持仓的净市值' },
    { name: '现金余额', value: allocation.cash, color: '#72cbd6', detail: '本位币现金余额' },
    { name: '未实现盈亏', value: pnl, color: pnl !== null && pnl < 0 ? '#e79084' : '#70dcba', detail: '券商账面浮动盈亏，已包含在净资产中' },
    { name: '购买力', value: finite(snapshot.metrics.buyingPower), color: '#b5a3e8', detail: '券商可用购买力，可能包含融资额度' },
    { name: '维持保证金', value: finite(snapshot.metrics.maintenanceMargin), color: '#e5b96e', detail: '维持当前持仓所需的保证金' },
  ].map(item => ({ ...item, ratio: item.value !== null && nav !== null && nav > 0 ? item.value / nav : null }));
  // One absolute-amount scale for all rows; signs and NAV ratios remain explicit.
  const scale = Math.max(nav !== null && nav > 0 ? nav : 0, ...metrics.map(item => Math.abs(item.value ?? 0)));
  const signedAmount = (item: typeof metrics[number]) => `${item.name === '未实现盈亏' && item.value !== null && item.value > 0 ? '+' : ''}${amount(item.value)}`;
  return <section className="awb-panel awb-funds-panel awb-funds-hud">
    <div className="awb-section-heading"><h2>资金概况</h2><small>IBKR · {currency}</small></div>
    <div className="awb-funds-nav"><span><i />净清算值 <small>NET LIQUIDATION</small></span><strong>{amount(nav)}<small>{currency}</small></strong></div>
    <div className="awb-funds-scale" aria-hidden="true"><span>金额刻度 · {currency}</span><div><span>0</span><span>{scale > 0 ? amount(scale / 2) : '—'}</span><span>{scale > 0 ? amount(scale) : '—'}</span></div></div>
    <div className="awb-funds-bars" role="group" aria-label="资金指标横向柱状图，统一绝对金额刻度">
      {metrics.map((item, index) => <div className="awb-funds-bar-item" key={item.name} data-funds-bar={item.name} title={item.detail}>
        <div className="awb-funds-bar-heading"><span><small>{String(index + 1).padStart(2, '0')}</small>{item.name}</span><b style={{ color: item.color }}>{signedAmount(item)}</b></div>
        <div className="awb-funds-bar-track" role="img" aria-label={`${item.name} ${signedAmount(item)} ${currency}，占净资产 ${percent(item.ratio)}`}>
          {item.value !== null && scale > 0 && <i style={{ width: `${Math.abs(item.value) / scale * 100}%`, background: item.color, color: item.color }} />}
          {item.value === null && <span className="awb-funds-bar-missing">数据未取得</span>}
        </div>
        <div className="awb-funds-bar-reading"><span>{item.value !== null && item.value < 0 ? '负值 · 条长按绝对金额' : item.name === '购买力' ? '可用交易额度' : item.name === '维持保证金' ? '当前持仓要求' : '券商账面'}</span><span>占净资产 <b>{percent(item.ratio)}</b></span></div>
      </div>)}
    </div>
    <div className="awb-funds-hud-footer"><p>统一金额刻度；指标有重叠，不相加。</p>{nav === null || nav <= 0 ? <p>净资产无效，占比暂不显示。</p> : null}
      {snapshot.cash.filter(c => c.currency !== snapshot.baseCurrency && c.currency !== 'BASE').map(c => <p key={c.currency}>{c.currency} 现金 <b>{amount(c.amount)}</b></p>)}
      <small><i />快照 {stamp(snapshot.asOf)}{snapshot.state === 'stale' ? ' · 已过期，待刷新' : ''}</small>
    </div>
  </section>;
}
