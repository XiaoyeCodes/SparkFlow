import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { CheckCircle2, ChevronRight, Clock3, LayoutGrid, ShieldCheck, Sparkles } from 'lucide-react';
import type { Alert, AnalysisJob, AnalysisReport, Holding, PortfolioPerformance, WorkbenchState } from '../../lib/ibkr/workbenchTypes';
import { chartSeries, finite, monthlyReturns, overviewAllocation, periodReturn } from '../../lib/ibkr/overview';
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
    <div className="awb-chart-legend">{state.metrics?.sectors.slice(0, 3).map((s, i) => <span key={s.name}><i style={{ background: colors[i] }}/>{s.name} {percent(s.weight)}</span>)}<span><i style={{ background: colors[5] }}/>现金 {percent(overviewAllocation(state.snapshot).cashWeight)}</span>{hasBenchmark && <span><i style={{ background: '#a49ddb' }}/>{performance?.benchmark} 基准</span>}</div>
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

function DailyAccountBrief({ state, generate, busy, openReport }: { state: WorkbenchState; generate?: () => void; busy?: boolean; openReport: () => void }) {
  const status = state.dailyBrief!, brief = status.latest, running = status.state === 'running';
  const ready = ['ready', 'empty'].includes(state.snapshot.state);
  return <section className="awb-panel awb-brief-redesign awb-daily-brief" aria-label="AI 账户简报">
    <span className="awb-ai-badge"><Sparkles size={13}/>AI 账户简报</span>
    <h2 className="awb-ai-headline">{brief?.content.headline ?? '每日账户简报'}</h2>
    <small className="awb-daily-session">{brief ? `复盘交易日 ${brief.sessionDate ?? '未核实'} · 生成于 ${stamp(brief.generatedAt)}` : '每个美股交易日收盘后 30 分钟生成'}</small>
    {status.state !== 'ready' && <p className="awb-brief-notice" role="status">{status.detail}{brief && running ? ' 当前保留上一份成功简报。' : ''}</p>}
    {brief ? <div className="awb-daily-content">
      <div><h3><LayoutGrid size={15}/>账户现状</h3><p>{brief.content.summary}</p></div>
      <div><h3><ShieldCheck size={15}/>风险解读</h3><p>{brief.content.risk}</p></div>
      <div><h3><CheckCircle2 size={15}/>下一交易日关注</h3><ul>{brief.content.watch.map((item, i) => <li key={i}>{item}</li>)}</ul></div>
      {!!brief.content.gaps.length && <div className="awb-daily-gaps"><h3>数据缺口</h3><p>{brief.content.gaps.join('；')}</p></div>}
      <details className="awb-overview-evidence"><summary>查看账户事实与来源</summary><small>IBKR 快照 {stamp(brief.snapshotAsOf)} · {brief.model}。复盘日期与快照时间分别标注。</small><dl>{Object.entries(brief.facts).slice(0, 7).map(([id, fact]) => <div key={id}><dt>{fact.label}</dt><dd>{fact.display}<small>{fact.source}</small></dd></div>)}</dl></details>
    </div> : <p className="awb-daily-empty">简报会结合你的持仓、现金、未实现盈亏和集中度，简要说明账户现状、风险及下一交易日需要关注的事项。</p>}
    <div className="awb-daily-footer"><p className="awb-overview-note">{status.enabled ? status.nextRunAt ? `下次自动生成：${stamp(status.nextRunAt)}（本地时间）` : '自动生成暂停，等待模型配置或交易日历恢复' : '自动简报已关闭'}</p><small>休市跳过，提前收盘相应提前。本机服务运行时执行，恢复后只补最近一期。</small>
      <button className="awb-full primary" onClick={generate} disabled={!generate || busy || running || !ready || !state.ai.enabled || state.ai.usedToday >= state.preferences.maxAiCalls}>{running ? '正在生成简报' : brief ? '重新生成简报' : '生成账户简报'}<Sparkles size={14}/></button>
      <button className="awb-full awb-ai-cta" onClick={openReport}>查看深度研究<ChevronRight size={15}/></button>
    </div>
  </section>;
}

export function OverviewAllocation({ state, select }: { state: WorkbenchState; select: (p: Holding) => void }) {
  const allocation = overviewAllocation(state.snapshot);
  const visible = useAdaptiveRows(allocation.rows.length, 6, '.awb-distribution-bars button');
  const max = Math.max(1, ...allocation.rows.map(r => Math.abs(r.weight ?? 0)));
  return <section ref={visible.ref} className="awb-panel awb-allocation-panel"><div className="awb-section-heading"><h2>持仓分布</h2><small>占净资产 · {state.snapshot.baseCurrency ?? '—'}</small></div><div className="awb-distribution-summary"><span>前五大持仓 <b>{percent(allocation.topFive)}</b></span><span>现金占比 <b>{percent(allocation.cashWeight)}</b></span></div><div className="awb-distribution-bars">{allocation.rows.slice(0, visible.count).map((r, i) => <button key={r.holding.conId} onClick={() => select(r.holding)} title={`${r.holding.symbol} · ${amount(r.value)} ${r.holding.currency}`}><span>{r.holding.symbol}</span><span className="awb-distribution-track"><i style={{ width: `${Math.abs(r.weight ?? 0) / max * 100}%`, background: colors[i % colors.length] }}/></span><b>{percent(r.weight)}</b></button>)}</div>{!allocation.rows.length && <p className="awb-overview-note">暂无可计算的持仓估值。</p>}<p className="awb-overview-note">展示前 {visible.count} 大持仓；集中度按绝对市值计算，含空头或杠杆时可超过 100%。{allocation.excluded > 0 && ` ${allocation.excluded} 个持仓缺少估值或币种换算，整体集中度暂不计算。`}</p><div className="awb-sector-summary"><h3>行业配置</h3>{state.metrics?.sectors.length ? state.metrics.sectors.map((s, i) => <span key={s.name}><i style={{ background: colors[i % colors.length] }}/>{s.name}<b>{percent(s.weight)}</b></span>) : <p className="awb-overview-note">行业资料尚未取得。</p>}<small>行业未知单独列示；ETF 不穿透。</small></div></section>;
}

export function OverviewPnl({ state, select }: { state: WorkbenchState; select: (p: Holding) => void }) {
  const currencies = [...new Set(state.snapshot.positions.map(p => p.currency))];
  const [chosen, setChosen] = useState('');
  const currency = currencies.includes(chosen) ? chosen : state.snapshot.baseCurrency ?? currencies[0] ?? '';
  const rows = state.snapshot.positions.filter(p => p.currency === currency && finite(p.unrealizedPnl) !== null);
  const winners = [...rows].filter(p => Number(p.unrealizedPnl) > 0).sort((a, b) => Number(b.unrealizedPnl) - Number(a.unrealizedPnl));
  const losers = [...rows].filter(p => Number(p.unrealizedPnl) < 0).sort((a, b) => Number(a.unrealizedPnl) - Number(b.unrealizedPnl));
  const visible = useAdaptiveRows(winners.length + losers.length, 6, '.awb-pnl-row');
  const winnerCount = Math.min(winners.length, Math.max(Math.ceil(visible.count / 2), visible.count - losers.length));
  const loserCount = Math.min(losers.length, visible.count - winnerCount);
  return <section ref={visible.ref} className="awb-panel awb-pnl-panel"><div className="awb-section-heading"><h2>持仓盈亏排行</h2><select aria-label="盈亏排行币种" value={currency} onChange={e => setChosen(e.target.value)}>{[...new Set([currency, ...currencies])].map(c => <option key={c} value={c}>{c || '币种待核实'}</option>)}</select></div><div className="awb-pnl-columns">{[[winners.slice(0, winnerCount), '浮盈最多'], [losers.slice(0, loserCount), '浮亏最多']].map(([holdings, label]) => <div key={String(label)}><h3>{String(label)}</h3>{(holdings as Holding[]).map(p => <button className="awb-pnl-row" key={p.conId} onClick={() => select(p)}><span>{p.symbol}</span><b className={Number(p.unrealizedPnl) < 0 ? 'negative' : 'positive'}>{Number(p.unrealizedPnl) > 0 ? '+' : ''}{amount(p.unrealizedPnl)}</b></button>)}{!(holdings as Holding[]).length && <p className="awb-overview-note">暂无对应持仓</p>}</div>)}</div><p className="awb-overview-note">IBKR 券商未实现盈亏 · {currency || '—'}；按币种分别排序，不是今日收益贡献。{state.snapshot.positions.filter(p => p.currency === currency && finite(p.unrealizedPnl) === null).length || 0} 个持仓盈亏缺失。</p></section>;
}

export function OverviewFunds({ state }: { state: WorkbenchState }) {
  const snapshot = state.snapshot, allocation = overviewAllocation(snapshot);
  return <section className="awb-panel awb-funds-panel"><div className="awb-section-heading"><h2>资金概况</h2><small>IBKR 账户摘要</small></div><dl><dt>现金余额 · {snapshot.baseCurrency ?? '—'}</dt><dd>{amount(allocation.cash)}</dd><dt>购买力 · {snapshot.baseCurrency ?? '—'}</dt><dd>{amount(snapshot.metrics.buyingPower)}</dd><dt>维持保证金 · {snapshot.baseCurrency ?? '—'}</dt><dd>{amount(snapshot.metrics.maintenanceMargin)}</dd><dt>现金占比</dt><dd>{percent(allocation.cashWeight)}</dd></dl>{snapshot.cash.filter(c => c.currency !== snapshot.baseCurrency).map(c => <p key={c.currency}>{c.currency} 现金 <b>{amount(c.amount)}</b></p>)}<p className="awb-overview-note">购买力为券商返回的交易额度，不等于可提取现金。不同币种余额独立列示。</p><small>快照 {stamp(snapshot.asOf)}{snapshot.state === 'stale' ? ' · 已过期，待刷新' : ''}</small></section>;
}
