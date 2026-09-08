import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { CheckCircle2, ChevronRight, Clock3, ExternalLink, LayoutGrid, ShieldCheck, Sparkles } from 'lucide-react';
import type { Alert, AnalysisJob, AnalysisReport, BriefInsight, DailyBrief, Evidence, Holding, PortfolioPerformance, WorkbenchState } from '../../lib/ibkr/workbenchTypes';
import { chartSeries, finite, monthlyReturns, overviewAllocation, periodReturn } from '../../lib/ibkr/overview';
import { industryLabel } from '../../lib/ibkr/industryLabels';
import './OverviewPanels.css';
import { useAdaptiveRows } from './useAdaptiveRows';

const amount = (v: unknown) => finite(v) === null ? '—' : Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const percent = (v: number | null | undefined) => v == null || !Number.isFinite(v) ? '—' : `${(v * 100).toFixed(1)}%`;
const signed = (v: number | null | undefined) => v == null ? '—' : `${v > 0 ? '+' : ''}${(v * 100).toFixed(2)}%`;
const colors = ['#35dba3', '#5b9df0', '#efac48', '#a08cdd', '#60bfc5', '#859c8f'];
const stamp = (v?: string | null) => v ? new Date(v).toLocaleString('zh-CN', { hour12: false }) : '尚未同步';

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
  const [remote, setRemote] = useState<{ account: string; value: PortfolioPerformance }>();
  const [range, setRange] = useState(30), [mode, setMode] = useState<'nav' | 'return'>('nav'), [hover, setHover] = useState<number | null>(null);
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
      if (!controller.signal.aborted) setRemote({ account, value });
    }).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [account, state.preferences.benchmark, state.performance?.fetchedAt]);
  const fetched = remote?.account === account ? remote.value : undefined;
  const performance = fetched && (!state.performance?.fetchedAt || Date.parse(fetched.fetchedAt ?? '') >= Date.parse(state.performance.fetchedAt)) ? fetched : state.performance ?? fetched;
  const all = chartSeries(performance), last = all.slice(-1)[0];
  const points = all.filter(p => !last || Date.parse(p.date) >= Date.parse(last.date) - range * 86400000);
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
  return <section className="awb-panel awb-performance awb-performance-redesign" aria-label="资产表现">
    <div className="awb-chart-toolbar"><div className="awb-chart-tabs">{[['nav', '资产净值'], ['return', '投资收益']].map(([value, label]) => <button key={value} aria-pressed={mode === value} disabled={value === 'return' && !performance?.returnMethod} onClick={() => { setMode(value as typeof mode); setHover(null); }}>{label}</button>)}</div><div className="awb-period-tabs">{[[7, '1周'], [30, '1月'], [90, '3月'], [365, '1年']].map(([value, label]) => <button key={value} aria-pressed={range === value} onClick={() => { setRange(Number(value)); setHover(null); }}>{label}</button>)}</div></div>
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
        <dt>收益盈亏金额</dt><dd className="awb-tooltip-missing">— 未提供</dd>
      </dl>
      <p>{twr && returnAnchor ? `区间起点 ${returnAnchor.date}。` : ''}{previous ? `上一观测 ${previous.date}。` : '无上一观测。'}净值变动包含资金进出，不等于投资盈亏。</p>
      <small>{performance?.source ?? '来源待核实'} · 历史盈亏金额未提供</small>
    </div>}</div> : <div className="awb-chart-empty"><strong>开始积累真实账户轨迹</strong><p>{points.length ? '有效观测不足，至少两个点后显示曲线' : '官方历史尚未取得，同步后保存本地净值'}</p></div>}
    <div className="awb-chart-legend">{state.metrics?.sectors.slice(0, 3).map((s, i) => <span key={s.name}><i style={{ background: colors[i] }}/>{industryLabel(s.name)} {percent(s.weight)}</span>)}<span><i style={{ background: colors[5] }}/>现金 {percent(overviewAllocation(state.snapshot).cashWeight)}</span>{hasBenchmark && <span><i style={{ background: '#a49ddb' }}/>{performance?.benchmark} 基准</span>}</div>
    <p className="awb-overview-note">{performance?.note ?? '净值变化含出入金，不能直接视为投资收益。'}{failed && ' 历史刷新失败，保留已有记录。'}</p>
    {hasBenchmark && <div className="awb-performance-stats"><span>区间超额 <b>{signed(points.map((_, i) => values[i] !== null && benchmark[i] !== null ? values[i]! - benchmark[i]! : null).filter(v => v !== null).slice(-1)[0])}</b></span><span>波动率比较 <b>{performance?.volatilityRatio == null ? '至少需要 60 个共同交易日' : `${performance.volatilityRatio.toFixed(2)}×（完整共同历史）`}</b></span><small>{performance?.benchmarkSource ?? '基准未取得'}</small></div>}
    <div className="awb-performance-bottom"><div className="awb-return-summary" aria-label="收益摘要">{[7, 30, range].map((days, i) => { const result = periodReturn(performance, days); return <div key={i} title={result.value !== null ? `${result.start} 至 ${result.end}` : '缺少区间起点或未核实 TWR'}><small>{i === 0 ? '近一周收益' : i === 1 ? '近一月收益' : `所选 ${days} 日收益`}</small><b className={(result.value ?? 0) < 0 ? 'negative' : 'positive'}>{signed(result.value)}</b></div>; })}</div>
    <div className="awb-monthly"><div className="awb-section-heading"><h3>月度收益率</h3><small>最近 6 个月 · TWR</small></div>
      {monthly.some(m => m.value !== null) ? <svg className="awb-month-chart" ref={monthRef} viewBox={`0 0 ${monthWidth} ${monthHeight}`} role="img" aria-label="月度收益率柱状图"><path d={`M0 ${monthHeight / 2 - 3}H${monthWidth}`} stroke="#304337"/>{monthly.map((m, i) => { const xx = (i + .5) * monthWidth / 6, zero = monthHeight / 2 - 3, height = Math.abs(m.value ?? 0) / extent * Math.max(8, (monthHeight - 42) / 2); return <g key={m.month}><title>{m.month}：{signed(m.value)} · {m.start ?? '起点缺失'} 至 {m.end ?? '终点缺失'}</title>{m.value === null ? <text x={xx} y={zero - 5} textAnchor="middle">—</text> : <><rect x={xx - 13} y={m.value >= 0 ? zero - height : zero} width="26" height={Math.max(1, height)} rx="3" fill={m.value >= 0 ? '#2bb88b' : '#c66559'}/><text x={xx} y={m.value >= 0 ? zero - 5 - height : zero + 11 + height} textAnchor="middle">{signed(m.value)}</text></>}<text x={xx} y={monthHeight - 3} textAnchor="middle">{m.month.slice(5)}月{m.partial ? '*' : ''}</text></g>; })}</svg> : <div className="awb-monthly-empty">暂不足以计算月度收益：需要 TWR 和相邻月界观测。</div>}
      <small>按实际月界观测计算；缺失月份留空。{last ? `最新月份截至 ${last.date}，标 * 为截至该日。` : ''}</small>
    </div></div>
  </section>;
}

export function OverviewBrief({ state, report, pending, alerts, openReport, openAlert, openAlerts, generateBrief, busy }: { state: WorkbenchState; report?: AnalysisReport; pending?: AnalysisJob; alerts: Alert[]; openReport: () => void; openAlert: (a: Alert) => void; openAlerts: () => void; generateBrief?: () => void; busy?: boolean }) {
  if (state.dailyBrief) return <DailyAccountBrief state={state} generate={generateBrief} busy={busy} openReport={openReport}/>;
  const allocation = overviewAllocation(state.snapshot), level = state.metrics?.riskLevel ?? '数据不足';
  const gaugeColor = level === '未触发' ? '#35dba3' : level === '数据不足' ? '#667e70' : '#efac48';
  const structure = allocation.topFive !== null ? `前五大持仓占净资产 ${percent(allocation.topFive)}，现金占比 ${percent(allocation.cashWeight)}。` : '持仓估值或币种换算不完整，暂不能核实整体集中度。';
  const blocks = [
    { title: '组合结构', icon: LayoutGrid, text: report?.content.accountSummary || structure },
    { title: '事件影响', icon: Clock3, text: report?.content.marketContext || '尚无已发布的市场研究。财报与公告影响待取得来源后展示。' },
    { title: '行动条件', icon: CheckCircle2, text: report?.content.actions?.find(a => a.trigger)?.trigger || (state.preferences.cashFloor !== null || state.preferences.targetWeight !== null ? `已设观察条件：现金下限 ${percent(state.preferences.cashFloor)}，单标的上限 ${percent(state.preferences.targetWeight)}。` : '尚未设置个人仓位和现金约束，可在设置中补充。规则提示供核验。') },
  ];
  return <section className="awb-panel awb-brief-redesign" aria-label="AI 账户简报"><span className="awb-ai-badge"><Sparkles size={13}/>AI 账户简报</span><h2 className="awb-ai-headline">{report?.content.headline ?? '让持仓与市场背景连起来'}</h2>
    {pending && <p className="awb-brief-notice">{pending.state === 'running' ? '新报告正在生成。' : '新账户报告尚未完成。'}{report ? '目前显示上一份已发布简报。' : '当前展示账户事实与研究待办。'}</p>}
    <div className="awb-risk-gauge"><svg viewBox="0 0 110 65" role="img" aria-label={`规则风险等级：${level}，非百分制评分`}><path d="M12 55 A43 43 0 0 1 98 55" fill="none" stroke="#25372c" strokeWidth="12"/><path d="M12 55 A43 43 0 0 1 98 55" fill="none" stroke={gaugeColor} strokeWidth="12" opacity=".75"/><ShieldCheck x="43" y="33" width="24" height="24" color={gaugeColor}/></svg><div><small>规则风险等级</small><strong style={{ color: gaugeColor }}>{level}</strong><small>{state.metrics?.reasons.length ?? 0} 条观察规则触发 · 非百分制评分</small></div></div>
    {!!state.metrics?.reasons.length && <details className="awb-overview-evidence"><summary>查看规则依据</summary>{state.metrics.reasons.map(reason => <p key={reason}>{reason}</p>)}<small>规则来自当前配置；默认观察线不代表你的个人风险额度。</small></details>}
    <div className="awb-insight-list">{blocks.map(({ title, icon: Icon, text }) => <div className="awb-insight-item" key={title}><span className="awb-insight-icon"><Icon size={15}/></span><div><h3>{title}</h3><p>{text}</p></div></div>)}</div>
    <small className="awb-overview-note">{report ? `研究归档于 ${stamp(report.generatedAt)} · ${report.model}` : `账户事实 · IBKR 快照 ${stamp(state.snapshot.asOf)}；研究待生成。`}</small>
    <button className="awb-full awb-ai-cta" onClick={openReport}>{report ? '查看完整分析' : '查看研究状态'}<ChevronRight size={16}/></button>
    <div className="awb-overview-flags"><div className="awb-section-heading"><h3>机会与风险</h3><button onClick={openAlerts}>查看全部 <ChevronRight size={13}/></button></div>{alerts.slice(0, 3).map(a => <button className="awb-overview-flag" key={a.id} onClick={() => openAlert(a)} title={a.detail}><span><i style={{ background: a.kind === 'opportunity' ? '#35dba3' : '#efac48' }}/>{a.title}</span><ChevronRight size={15}/></button>)}{!alerts.length && <p className="awb-overview-note">{state.snapshot.state === 'ready' || state.snapshot.state === 'empty' ? '当前未触发观察规则' : '账户同步后检查观察规则'}</p>}</div>
  </section>;
}

const briefKind = { opportunity: '机会', risk: '风险', mixed: '双向影响', watch: '观察' };
const briefPriority = { high: '重点', medium: '中等', low: '一般' };
const briefChange = { new: '新增', ongoing: '持续', upgraded: '升级', eased: '缓解' };
const briefConfidence = { high: '高', medium: '中', low: '低' };
const briefCoverage = { complete: '已覆盖', partial: '部分覆盖', failed: '检索失败', unsupported: '暂不支持' };
const briefArea: Record<string, string> = { news: '公司新闻', filings: '公告财报', filing: '公告财报', earnings: '财报', valuation: '估值', macro: '宏观', calendar: '事件日历', market: '市场', profile: '公司资料' };
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
  return <>
    <div className="awb-daily-judgement"><h3><Sparkles size={15}/>今天对账户意味着什么</h3><p>{brief.content.summary}</p></div>
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
      {!!gaps.length && <div className="awb-daily-gaps"><h3>影响判断的缺口</h3><ul>{gaps.map((gap, i) => <li key={i}>{gap}</li>)}</ul></div>}
      {brief.coverage?.length ? <ul className="awb-brief-coverage-list">{brief.coverage.map(item => <li key={item.symbol}><div><b>{item.symbol}</b><span className={`awb-coverage-${item.status}`}>{briefCoverage[item.status]}</span></div><small>{item.areas.map(area => briefArea[area] ?? area).join(' · ')}</small>{!!item.gaps.length && <p>{item.gaps.join('；')}</p>}</li>)}</ul> : <p>本期未提供逐标的研究覆盖记录。</p>}
      <BriefSources evidence={evidence} ids={evidence.map(item => item.id)}/>
    </div></details>
  </>;
}

function DailyAccountBrief({ state, generate, busy, openReport }: { state: WorkbenchState; generate?: () => void; busy?: boolean; openReport: () => void }) {
  const status = state.dailyBrief!, brief = status.latest, running = status.state === 'running';
  const ready = ['ready', 'empty'].includes(state.snapshot.state);
  const researched = brief?.content.insights !== undefined;
  return <section className="awb-panel awb-brief-redesign awb-daily-brief" aria-label="AI 账户简报">
    <span className="awb-ai-badge"><Sparkles size={13}/>AI 账户简报</span>
    <h2 className="awb-ai-headline">{brief?.content.headline ?? '每日账户简报'}</h2>
    <small className="awb-daily-session">{brief ? <><span>{brief.analysisAsOf ? `研究截至 ${briefTime(brief.analysisAsOf)}` : `生成于 ${briefTime(brief.generatedAt)}`}（北京时间）</span><span>最近收盘交易日 {brief.sessionDate ?? '未核实'}</span></> : '每个美股交易日收盘后 30 分钟生成'}</small>
    {status.state !== 'ready' && <p className="awb-brief-notice" role="status">{status.detail}{brief && running ? ' 当前保留上一份成功简报。' : ''}</p>}
    {brief ? <div className="awb-daily-content">
      {researched ? <DailyResearch brief={brief}/> : <><div><h3><LayoutGrid size={15}/>账户现状</h3><p>{brief.content.summary}</p></div>
      <div><h3><ShieldCheck size={15}/>风险解读</h3><p>{brief.content.risk}</p></div>
      <div><h3><CheckCircle2 size={15}/>下一交易日关注</h3><ul>{brief.content.watch.map((item, i) => <li key={i}>{item}</li>)}</ul></div>
      {!!brief.content.gaps.length && <div className="awb-daily-gaps"><h3>数据缺口</h3><p>{brief.content.gaps.join('；')}</p></div>}</>}
      <details className="awb-overview-evidence awb-brief-account-facts"><summary>查看账户事实与来源</summary><small>IBKR 快照 {briefTime(brief.snapshotAsOf)} · 生成于 {briefTime(brief.generatedAt)}（北京时间） · {brief.model}。账户快照与最近收盘交易日分别标注。</small><dl>{Object.entries(brief.facts).map(([id, fact]) => <div key={id}><dt>{fact.label}</dt><dd>{fact.display}<small>{fact.source} · {briefTime(fact.asOf)}（北京时间）</small></dd></div>)}</dl></details>
    </div> : <p className="awb-daily-empty">结合持仓相关的宏观数据、估值、公司新闻和财报，解释对账户的机会与风险，并列出下一步观察条件和可核验来源。</p>}
    <div className="awb-daily-footer"><p className="awb-overview-note">{status.enabled ? status.nextRunAt ? `下次自动生成：${stamp(status.nextRunAt)}（本地时间）` : '自动生成暂停，等待模型配置或交易日历恢复' : '自动简报已关闭'}</p><small>休市跳过，提前收盘相应提前。本机服务运行时执行，恢复后只补最近一期。</small>
      <button className="awb-full primary" onClick={generate} disabled={!generate || busy || running || !ready || !state.ai.enabled || state.ai.usedToday >= state.preferences.maxAiCalls}>{running ? '正在生成简报' : brief ? '重新生成简报' : '生成账户简报'}<Sparkles size={14}/></button>
      <button className="awb-full awb-ai-cta" onClick={openReport}>查看深度研究<ChevronRight size={15}/></button>
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
  const invested = allocation.excluded === 0 ? allocation.rows.reduce((sum, row) => sum + row.value, 0) : null;
  const pnl = finite(snapshot.metrics.unrealizedPnl);
  const [active, setActive] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const focused = active ?? pinned;
  const nav = finite(snapshot.metrics.netLiquidation);
  const references = [
    { name: '未实现盈亏', value: pnl, color: pnl !== null && pnl < 0 ? '#e79084' : '#70dcba', radius: 86 },
    { name: '购买力', value: finite(snapshot.metrics.buyingPower), color: '#a08cdd', radius: 99 },
    { name: '维持保证金', value: finite(snapshot.metrics.maintenanceMargin), color: '#efac48', radius: 112 },
  ].map(item => ({ ...item, ratio: item.value !== null && nav !== null && nav > 0 ? item.value / nav : null }));
  // Only nonnegative, fully valued positions and cash can form an asset-composition pie.
  const canChart = invested !== null && allocation.cash !== null && allocation.cash >= 0 && allocation.rows.every(row => row.value >= 0);
  const composition = canChart ? [{ name: '持仓市值', value: invested!, color: '#35dba3' }, { name: '现金余额', value: allocation.cash!, color: '#5b9df0' }] : [];
  const slices = composition.filter(slice => slice.value > 0);
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  const selected = [...composition, ...references].find(item => item.name === focused);
  const bindings = (name: string) => ({
    onMouseEnter: () => setActive(name), onMouseLeave: () => setActive(null),
    onFocus: () => setActive(name), onBlur: () => setActive(null),
    onClick: () => setPinned(current => current === name ? null : name),
  });
  const referenceTitle = (item: typeof references[number]) => `${item.name} ${amount(item.value)} ${currency} · 占净资产 ${percent(item.ratio)}${item.ratio !== null && Math.abs(item.ratio) > 1 ? '，参考环满环表示达到或超过 100%' : ''}${item.value !== null && item.value < 0 ? '，负值以逆时针显示' : ''}`;
  let offset = -Math.PI / 2;
  return <section className="awb-panel awb-funds-panel">
    <div className="awb-section-heading"><h2>资金概况</h2><small>IBKR · {currency}</small></div>
    <div className="awb-funds-total"><span>总资产 · 净清算值</span><strong>{amount(snapshot.metrics.netLiquidation)}<small>{currency}</small></strong></div>
    {total > 0 ? <>
      <svg className="awb-sector-pie awb-funds-pie" viewBox="0 0 240 240" role="img" aria-label="资金构成扇形图，含未实现盈亏、购买力和维持保证金参考环">
        <title>{slices.map(slice => `${slice.name} ${amount(slice.value)} ${currency}，${percent(slice.value / total)}`).join('；')}；{references.map(referenceTitle).join('；')}</title>
        {slices.map(slice => {
          const start = offset, angle = slice.value / total * Math.PI * 2;
          offset += angle;
          const x = (r: number) => 120 + 74 * Math.cos(r), y = (r: number) => 120 + 74 * Math.sin(r);
          const props = { fill: slice.color, opacity: focused && focused !== slice.name ? .35 : 1, ...bindings(slice.name) };
          const title = `${slice.name} ${amount(slice.value)} ${currency} · ${percent(slice.value / total)}`;
          return slices.length === 1 ? <circle key={slice.name} cx="120" cy="120" r="74" {...props}><title>{title}</title></circle> : <path key={slice.name} d={`M120,120 L${x(start)},${y(start)} A74,74 0 ${angle > Math.PI ? 1 : 0},1 ${x(offset)},${y(offset)} Z`} {...props}><title>{title}</title></path>;
        })}
        {references.map(item => {
          const circumference = 2 * Math.PI * item.radius;
          const arc = item.ratio === null ? 0 : Math.min(1, Math.abs(item.ratio)) * circumference;
          return <g key={item.name} data-funds-ring={item.name} opacity={focused && focused !== item.name ? .35 : 1} {...bindings(item.name)}>
            <title>{referenceTitle(item)}</title>
            <circle cx="120" cy="120" r={item.radius} fill="none" style={{ stroke: '#20362a', strokeWidth: 7 }} />
            {arc > 0 && <circle cx="120" cy="120" r={item.radius} fill="none" strokeDasharray={`${arc} ${circumference - arc}`} transform={`${item.value! < 0 ? 'translate(240 0) scale(-1 1) ' : ''}rotate(-90 120 120)`} style={{ stroke: item.color, strokeWidth: 7 }} />}
          </g>;
        })}
        <circle cx="120" cy="120" r="46" fill="#0b1411" style={{ stroke: '#0b1411', strokeWidth: 2 }} />
        <g className="awb-funds-pie-center" aria-live="polite" pointerEvents="none">
          <text x="120" y="108" className="awb-funds-pie-label">{selected?.name ?? '资金构成'}</text>
          <text x="120" y="130" className="awb-funds-pie-value" style={{ fill: selected?.color ?? '#e0eee5' }} textLength={amount(selected ? selected.value : total).length > 9 ? 80 : undefined} lengthAdjust="spacingAndGlyphs">{amount(selected ? selected.value : total)}</text>
          <text x="120" y="146" className="awb-funds-pie-label">{currency}</text>
        </g>
      </svg>
      <div className="awb-sector-legend">{composition.map(slice => <button key={slice.name} {...bindings(slice.name)} aria-pressed={pinned === slice.name}><i style={{ background: slice.color }}/><span>{slice.name}</span><b>{amount(slice.value)} <small>{percent(slice.value / total)}</small></b></button>)}</div>
    </> : <p className="awb-overview-note">{canChart ? '暂无可展示的资金构成。' : '存在负现金、空头或估值缺失，暂不绘制资金扇形图。'}</p>}
    <dl className="awb-funds-values">{total <= 0 && <div className="awb-funds-reference-row"><dt>持仓市值 · {currency}</dt><dd>{amount(invested)}</dd><dt>现金余额 · {currency}</dt><dd>{amount(allocation.cash)}</dd></div>}{references.map(item => <div key={item.name} className="awb-funds-reference-row"><dt><button {...bindings(item.name)} aria-pressed={pinned === item.name} title={referenceTitle(item)}><i style={{ background: item.color }} />{item.name} · {currency}</button></dt><dd style={{ color: item.color }}>{item.name === '未实现盈亏' && item.value !== null && item.value > 0 ? '+' : ''}{amount(item.value)}</dd></div>)}</dl>
    {snapshot.cash.filter(c => c.currency !== snapshot.baseCurrency && c.currency !== 'BASE').map(c => <p key={c.currency}>{c.currency} 现金 <b>{amount(c.amount)}</b></p>)}
    <details className="awb-funds-help"><summary>参考环 · 分别对比净资产</summary><p className="awb-overview-note">主图为持仓与现金。外环由内向外为盈亏、购买力、保证金，各占净资产比例；负值逆时针，超过 100% 满环。{nav === null || nav <= 0 ? '净资产无效，参考环比例暂不显示。' : ''}</p></details>
    <small>快照 {stamp(snapshot.asOf)}{snapshot.state === 'stale' ? ' · 已过期，待刷新' : ''}</small>
  </section>;
}
