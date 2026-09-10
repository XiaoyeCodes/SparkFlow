import { OverviewBrief, OverviewAllocation, OverviewPnl, OverviewFunds, OverviewPnlSummary } from './OverviewPanels';
import { HoldingLogo } from './HoldingLogo';
import { AccountScheduleSettings } from './AccountScheduleSettings';
import { HoldingsAnalytics } from './HoldingsAnalytics';
import { PaperTradingWorkspace } from './PaperTradingWorkspace';
import { BacktestWorkspace } from './BacktestWorkspace';
import type { HoldingsRange } from '../../lib/ibkr/holdingsAnalytics';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Home, Gauge, ChartNoAxesCombined, BriefcaseBusiness, Menu, Wallet, TrendingUp, ArrowDownLeft, ArrowUpRight, Bell, Check, ChevronDown, ChevronRight, CircleCheck, Download, FileJson2, FlaskConical, Link2, ListOrdered, LoaderCircle, PlugZap, Radio, RefreshCw, Settings2, ShieldCheck, Sparkles, Unplug, WifiOff, X } from 'lucide-react';
import type { AnalysisReport, AdjustmentPlan, Alert, Holding, MarketQuote, Preferences, WorkbenchState } from '../../lib/ibkr/workbenchTypes';
import { reportMarkdown } from '../../lib/ibkr/workbenchReport';
import { exportAccountCommandDeckPdf } from '../../lib/ibkr/exportAccountPdf';
import { downloadHoldingsAiJson } from '../../lib/ibkr/exportHoldingsJson';
import { exportSparkFlowResearchPdf } from '../../lib/exportResearchPdf';
import { PerformancePanel, PlanPanel, ResearchDetails } from './WorkbenchPanels';
import { AnalysisWorkspace } from './AnalysisWorkspace';
import { ValuationWorkspace } from './ValuationWorkspace';
import { quantity as formatQuantity } from '../../lib/ibkr/workbenchFormat';
import { holdingIndustryDetails, holdingIndustryLabel } from '../../lib/ibkr/industryLabels';
import './AccountWorkbench.css';

const api = '/api/ibkr-workbench/';
async function request<T>(endpoint: string, value?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(api + endpoint, { ...(value === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) }), signal });
  const data = await response.json(); if (!response.ok) throw new Error(data.error || '账户服务暂不可用'); return data;
}
const number = (value: unknown) => value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
const money = (value: unknown) => { const n = number(value); return n === null ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
const pct = (value: number | null | undefined) => value == null ? '—' : `${(value * 100).toFixed(1)}%`;
const time = (value: string | null | undefined) => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '尚未同步';
const actionLabels = { hold: '维持', watch: '观察', increase: '增持', reduce: '减持' };
const quoteLabels = { delayed: '延迟 / 休市参考', stale: '缓存已过期', missing: '行情缺失', unmapped: '待匹配', unsupported: '未覆盖品种' };
type HoldingSortKey = 'quantity' | 'marketValue' | 'weight' | 'unrealizedPnl';
type HoldingSort = { key: HoldingSortKey; direction: 'ascending' | 'descending' };
type SourceChoice = { source: 'mcp' | 'gateway'; gatewayMode: 'live' | 'paper' };
const holdingSortLabels: Record<HoldingSortKey, string> = { quantity: '数量', marketValue: '市值', weight: '占比', unrealizedPnl: '券商盈亏' };

export function AccountWorkbench() {
  const [state, setState] = useState<WorkbenchState | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  type Tab = 'overview' | 'reports' | 'backtests' | 'valuation' | 'alerts' | 'holdings' | 'orders' | 'settings';
  const [tab, setTab] = useState<Tab>(() => { const value = searchParams.get('tab'); return ['overview','reports','backtests','valuation','alerts','holdings','orders','settings'].includes(value ?? '') ? value as Tab : 'overview'; });
  useEffect(() => { const value = searchParams.get('tab'); if (['overview','reports','backtests','valuation','alerts','holdings','orders','settings'].includes(value ?? '')) setTab(value as Tab); }, [searchParams]);
  const [selected, setSelected] = useState<number | null>(null);
  const [report, setReport] = useState<AnalysisReport | null>(null);
  const [error, setError] = useState(''); const [busy, setBusy] = useState(''); const [exporting, setExporting] = useState(false); const [question, setQuestion] = useState(''); const [search, setSearch] = useState('');
  const [holdingSort, setHoldingSort] = useState<HoldingSort | null>(null);
  const [holdingsRange, setHoldingsRange] = useState<HoldingsRange>(90);
  const [sourceChoice, setSourceChoice] = useState<SourceChoice | null>(null);
  const [pendingConnection, setPendingConnection] = useState<SourceChoice | null>(null);
  const [menu,setMenu]=useState(false); const [filter,setFilter]=useState('all'); const [chosenAlert,setChosenAlert]=useState<Alert>(); const [chosenPlan,setChosenPlan]=useState<AdjustmentPlan>(); const [reportId,setReportId]=useState<string>();const [planReportId,setPlanReportId]=useState<string>();const [selectedJobId,setSelectedJobId]=useState<string>();
  const revision = useRef(0);
  const refresh = useCallback(async () => { const current = ++revision.current; const value = await request<WorkbenchState>('state'); if (current === revision.current) setState(value); }, []);
  useEffect(() => {
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>; let disposed = false;
    const poll = async () => { try { const current = ++revision.current; const value = await request<WorkbenchState>('state', undefined, controller.signal); if (!disposed && current === revision.current) setState(value); if (!document.hidden && value.snapshot.snapshotId) { const quotes = await request<MarketQuote[]>('quotes', undefined, controller.signal); if (!disposed && current === revision.current) setState(previous => previous?.snapshot.accountKey === value.snapshot.accountKey ? { ...previous, quotes } : previous); } } catch (e) { if (!disposed) setError(e instanceof Error ? e.message : '无法连接账户服务'); } finally { if (!disposed) timer = setTimeout(poll, document.hidden ? 15000 : 5000); } };
    void poll(); return () => { disposed = true; ++revision.current; controller.abort(); clearTimeout(timer); };
  }, []);
  const act = async (name: string, endpoint: string, payload: unknown = {}) => {
    if (busy) return; setBusy(name); setError('');
    try { await request(endpoint, payload); await refresh(); } catch (e) { const message = e instanceof Error ? e.message : '操作失败'; try { await refresh(); } catch { /* Preserve the action error when refreshing state also fails. */ } setError(message); } finally { setBusy(''); }
  };
  const selectSource = (source: SourceChoice['source'], gatewayMode: SourceChoice['gatewayMode'] = state?.gatewayMode ?? 'live') => {
    if (!state) return;
    const choice = { source, gatewayMode };
    const current = state.source === source && (source === 'mcp' || state.gatewayMode === gatewayMode);
    setSourceChoice(current ? null : choice);
    setError('');
  };
  const sameSource = (choice: SourceChoice) => Boolean(state && state.source === choice.source && (choice.source === 'mcp' || state.gatewayMode === choice.gatewayMode));
  const hasCurrentConnection = Boolean(state && (state.connection.state === 'connected' || state.snapshot.connection === 'connected' || state.connection.authorized));
  const activateConnection = async (choice: SourceChoice, replaceCurrent: boolean) => {
    if (!state || busy) return;
    // Open synchronously from the user gesture; never navigate an unvalidated authorization URL.
    const popup = choice.source === 'mcp' ? window.open('about:blank', '_blank') : null;
    if (popup) { popup.opener = null; popup.document.title = '正在连接 IBKR'; popup.document.body.textContent = '正在获取 IBKR 官方授权地址…'; }
    setPendingConnection(null); setBusy(choice.source === 'mcp' ? 'connect' : 'gateway-connect'); setError('');
    try {
      if (replaceCurrent) await request('disconnect', {});
      if (!sameSource(choice)) await request('source', choice.source === 'gateway' ? choice : { source: choice.source });
      if (choice.source === 'gateway') {
        await request('gateway-connect', {});
        await refresh(); setSourceChoice(null); return;
      }
      const result = await request<{ authorizationUrl?: string; detail: string; state: string }>('connect', {});
      if (!result.authorizationUrl) {
        popup?.close();
        if (result.state === 'connected') { await request('sync', {}); await refresh(); setSourceChoice(null); return; }
        throw new Error(result.detail || '无法获取授权地址');
      }
      const url = new URL(result.authorizationUrl); if (url.protocol !== 'https:' || url.hostname !== 'api.ibkr.com') { popup?.close(); throw new Error('官方授权地址校验失败'); }
      if (popup) popup.location.href = url.href; else window.location.assign(url.href);
      await refresh(); setSourceChoice(null);
    } catch (e) {
      popup?.close();
      try { await refresh(); } catch { /* Preserve the connection error. */ }
      setError(e instanceof Error ? e.message : '连接失败');
    } finally { setBusy(''); }
  };
  const connect = (choice: SourceChoice) => {
    if (!sameSource(choice) && hasCurrentConnection) { setPendingConnection(choice); return; }
    void activateConnection(choice, false);
  };
  useEffect(() => {
    if (!pendingConnection) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setPendingConnection(null); };
    document.addEventListener('keydown', close); return () => document.removeEventListener('keydown', close);
  }, [pendingConnection]);
  const snapshot=state?.snapshot; const latest=state?.reports.find(r=>r.kind!=='chat'); const holding=snapshot?.positions.find(p=>p.conId===selected);
  const exportAccountPdf = async () => {
    if (!state || exporting) return;
    setExporting(true); setError('');
    try { await exportAccountCommandDeckPdf({ snapshot: state.snapshot, metrics: state.metrics, quotes: state.quotes, performance: state.performance, range: holdingsRange }); }
    catch (e) { setError(e instanceof Error ? e.message : 'PDF 导出失败，请重试。'); }
    finally { setExporting(false); }
  };
  useEffect(()=>{setSelected(null);setReport(null);setReportId(undefined);setSelectedJobId(undefined);setChosenPlan(undefined);setChosenAlert(undefined);},[snapshot?.accountKey]);
  useEffect(()=>{if(selected===null&&!report)return;const old=document.activeElement as HTMLElement;const overflow=document.body.style.overflow;document.body.style.overflow='hidden';const dialog=document.querySelector<HTMLElement>('.awb-overlay [role="dialog"]');const focusable=()=>Array.from(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input,select,summary')??[]);focusable()[0]?.focus();const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){setSelected(null);setReport(null);}if(e.key==='Tab'){const els=focusable();if(e.shiftKey&&document.activeElement===els[0]){e.preventDefault();els[els.length-1]?.focus();}else if(!e.shiftKey&&document.activeElement===els[els.length-1]){e.preventDefault();els[0]?.focus();}}};document.addEventListener('keydown',key);return()=>{document.body.style.overflow=overflow;document.removeEventListener('keydown',key);old?.focus();};},[selected,report]);
  const ready=Boolean(snapshot?.snapshotId&&['ready','empty'].includes(snapshot.state));const running=state?.jobs.find(j=>j.state==='running');const task=running??state?.jobs.find(j=>j.id===selectedJobId)??state?.jobs.find(j=>j.state!=='completed'&&(j.progress?.covered.length??0)>0)??state?.jobs[0];const canAnalyze=Boolean(ready&&state?.ai.enabled&&!busy&&!running&&state.ai.usedToday<state.preferences.maxAiCalls);const alerts=state?.alerts.filter(a=>!a.resolved)??[];const nav=number(snapshot?.metrics.netLiquidation),currency=snapshot?.baseCurrency??'';const cash=snapshot?.cash.find(c=>c.currency===currency)?.amount;
  const hideBusyAnalysisMessage = (tab === 'alerts' || tab === 'holdings') && error === '已有分析正在运行';
  const filtered=snapshot?.positions.filter(p=>`${p.symbol} ${p.name??''}`.toLowerCase().includes(search.toLowerCase()))??[];const activeReport=state?.reports.find(r=>r.id===reportId); const pendingReport=state?.jobs.find(j=>j.kind!=='chat'&&j.state!=='completed'&&Date.parse(j.startedAt)>Date.parse(latest?.generatedAt??'1970-01-01'));
  const sortHoldings = (holdings: Holding[]) => !holdingSort ? holdings : holdings.map((holding, index) => ({ holding, index })).sort((a, b) => {
    const value = (holding: Holding) => holdingSort.key === 'weight' ? (nav && nav > 0 && holding.currency === currency ? number(holding.marketValue) === null ? null : Number(holding.marketValue) / nav : null) : number(holding[holdingSort.key]);
    const left = value(a.holding), right = value(b.holding);
    if (left === null) return right === null ? a.index - b.index : 1;
    if (right === null) return -1;
    return (left - right) * (holdingSort.direction === 'ascending' ? 1 : -1) || a.index - b.index;
  }).map(({ holding }) => holding);
  const toggleHoldingSort = (key: HoldingSortKey) => setHoldingSort(current => current?.key === key ? { key, direction: current.direction === 'ascending' ? 'descending' : 'ascending' } : { key, direction: 'ascending' });
  // The overview intentionally stays stable: it always shows the nine largest positions.
  const overviewRows = { count: 9, ref: undefined };

  const navigate=(key:typeof tab)=>{setTab(key);setMenu(false);setSearchParams(previous=>{const next=new URLSearchParams(previous);next.set('tab',key);return next;},{replace:true});};
  const navItems=[['overview','账户总览',Home],['reports','AI 分析',ChartNoAxesCombined],['backtests','策略回测',FlaskConical],['valuation','大盘估值',Gauge],['alerts','机会与风险',ShieldCheck],['holdings','持仓',BriefcaseBusiness],['orders','模拟交易',ListOrdered],['settings','设置',Settings2]] as const;
  const titles={valuation:'大盘估值分位监控',overview:'账户总览',reports:'投资组合分析报告',backtests:'策略与历史回测',alerts:'机会与风险中心',holdings:'我的持仓',orders:'IBKR 模拟盘交易',settings:'连接账户与分析偏好'};
  const subtitles={valuation:'指数趋势、估值与情绪的透明规则评分',overview:'你的资产、市场与下一步',reports:'完整账户数据一次提交、一次分析、一个结论',backtests:'保存结构化策略版本，用可追溯数据重复验证',alerts:'把市场变化转化为可执行的计划',holdings:'持仓结构与组合风险敞口',orders:'先授权范围，再预览与确认每一笔限价单',settings:'管理账户连接、研究授权与投资约束'};
  const holdingsTable=(compact:boolean)=>{const sortableHeader=(key:HoldingSortKey,label:React.ReactNode)=><th aria-sort={!holdingSort||holdingSort.key!==key?'none':holdingSort.direction}><button className="awb-sort-button" type="button" onClick={()=>toggleHoldingSort(key)} aria-label={`按${holdingSortLabels[key]}${holdingSort?.key===key&&holdingSort.direction==='ascending'?'降序':'升序'}排序`} title={`按${holdingSortLabels[key]}排序`}>{label}<span className={`awb-sort-indicator ${holdingSort?.key===key?holdingSort.direction:''}`} aria-hidden="true">↕</span></button></th>;const rows=compact?[...(snapshot?.positions??[])].sort((a,b)=>Math.abs(Number(b.marketValue))-Math.abs(Number(a.marketValue))).slice(0,overviewRows.count):sortHoldings(filtered);return <section ref={compact?overviewRows.ref:undefined} className={`awb-panel awb-holdings ${compact?'awb-holdings-summary':''}`}><div className="awb-section-heading"><h2>我的持仓 <small>{snapshot?.positions.length??0}</small></h2>{compact?<button onClick={()=>navigate('holdings')}>查看全部 <ChevronRight size={14}/></button>:<input aria-label="搜索持仓" type="search" placeholder="搜索代码 / 名称" value={search} onChange={e=>setSearch(e.target.value)}/>}</div><div className="awb-table-scroll"><table><thead><tr><th>资产</th>{compact?<th>数量/成本</th>:sortableHeader('quantity','数量 / 成本')}{compact?<th>市值</th>:sortableHeader('marketValue',<>市值 · {currency}</>)}{compact?<th>占比</th>:sortableHeader('weight','占比')}{compact?<th>券商盈亏</th>:sortableHeader('unrealizedPnl','券商盈亏')}{!compact&&<th>参考行情</th>}</tr></thead><tbody>{rows.map(p=>{const q=state?.quotes.find(q=>q.conId===p.conId),weight=nav&&nav>0&&p.currency===currency&&number(p.marketValue)!==null?Number(p.marketValue)/nav:null;return <tr key={p.conId}><td><button className="awb-symbol" onClick={()=>setSelected(p.conId)}><HoldingLogo holding={p}/><span><b>{p.symbol}</b>{!compact&&<small>{p.name??p.symbol} · {holdingIndustryLabel(p)}</small>}</span></button></td><td>{formatQuantity(p.quantity)}<small>{money(p.averageCost)}</small></td><td title={`${p.currency} · 市值 ${money(p.marketValue)}`}>{money(p.marketValue)}{(!compact||p.currency!==currency)&&<small>{p.currency}</small>}</td><td>{pct(weight)}<div className="awb-weight"><i style={{width:`${Math.min(100,Math.abs(weight??0)*100)}%`}}/></div></td><td className={(number(p.unrealizedPnl)??0)<0?'negative':'positive'}>{money(p.unrealizedPnl)}</td>{!compact&&<td>{money(q?.price)}<small>{q?quoteLabels[q.status]:'未取得'} · {q?.source??'东方财富'}<br/>{q?.asOf?time(q.asOf):'时间未取得'}</small></td>}</tr>;})}</tbody></table></div>{!(compact?snapshot?.positions.length:filtered.length)&&<div className="awb-empty"><p>{ready?'当前没有匹配持仓':'真实持仓将在授权并同步成功后显示'}</p><small>数量与账面金额来自 IBKR；参考行情单独展示。</small></div>}</section>;};
  return <main className={`account-workbench ${tab==='valuation'?'awb-valuation-mode':''} ${tab==='overview'?'awb-overview-compact':''} ${menu?'awb-menu-open':''}`} data-testid="ibkr-workbench"><aside className="awb-sidebar"><Link className="awb-brand" to="/"><span>SF</span><b>SparkFlow<small>ACCOUNT INTELLIGENCE</small></b></Link><nav aria-label="账户工作台导航">{navItems.map(([key,label,Icon])=><button key={key} aria-current={tab===key?'page':undefined} title={label} onClick={()=>navigate(key)}><Icon size={21}/><span>{label}</span>{key==='alerts'&&alerts.some(a=>!a.read)&&<i className="awb-dot"/>}</button>)}</nav><Link to="/" className="awb-terminal-link"><ArrowUpRight size={18}/><span>返回终端大屏</span></Link><div className="awb-sidebar-foot"><ShieldCheck size={16}/><span>{state?.source==='gateway'&&state.gatewayMode==='paper'?'IBKR · 模拟账户':'IBKR · 只读账户'}</span></div></aside><div className="awb-body"><header className="awb-topbar"><button className="awb-menu" aria-label="展开导航" onClick={()=>setMenu(!menu)}><Menu size={20}/></button><small>SPARKFLOW / IBKR</small><span className={`awb-status ${ready?'connected':''}`}><i/>{ready?'账户已同步':snapshot?.state==='stale'?'快照已过期':state?.connection.authorized?'已授权 · 持仓待同步':'等待账户连接'}</span></header>{tab!=='valuation'&&<div className="awb-page-heading"><div><h1>{titles[tab]}</h1><p>{subtitles[tab]}</p></div>{tab!=='reports'&&tab!=='alerts'&&tab!=='backtests'&&<div className="awb-heading-actions"><button disabled={!!busy} onClick={()=>void act('sync','sync')} aria-label="刷新账户"><RefreshCw size={16} className={busy==='sync'?'awb-spin':''}/><span>刷新账户</span></button>{tab!=='settings'&&tab!=='orders'&&<button disabled={!snapshot?.positions.length} onClick={()=>snapshot&&downloadHoldingsAiJson(snapshot)} title="仅导出持仓明细和 AI 分析提示词"><FileJson2 size={17}/>导出 JSON</button>}{tab!=='settings'&&tab!=='orders'&&<button className="primary" disabled={!snapshot?.snapshotId||exporting} onClick={()=>void exportAccountPdf()}><Download size={17}/>{exporting?'正在导出 PDF':'导出 PDF'}</button>}</div>}</div>}
  {tab==='valuation'&&<ValuationWorkspace/>}
  {tab!=='valuation'&&error&&!hideBusyAnalysisMessage&&<div className="awb-message error" role="alert">{error}<button aria-label="关闭错误" onClick={()=>setError('')}><X size={15}/></button></div>}{tab!=='valuation'&&state&&!ready&&<div className="awb-message"><ShieldCheck size={18}/><div><b>{snapshot?.snapshotId?'显示最后成功快照':state.connection.authorized?'IBKR 已授权，持仓尚未同步':'连接你的 IBKR 账户'}</b><p>{state.connection.detail}</p></div><button onClick={()=>navigate('settings')}>查看连接</button></div>}
  {tab!=='valuation'&&!state&&<div className="awb-empty">正在载入账户工作台…</div>}{state&&tab!=='valuation'&&<><div className="awb-provenance"><span>授权 {state.source==='gateway'?(ready?(state.gatewayMode==='paper'?'本机模拟会话':'本机只读会话'):'待连接'):state.connection.authorized?'有效':'待连接'} · 账户 {time(snapshot?.asOf)}</span><span>行情 {time(state.quotes.filter(q=>q.asOf).map(q=>q.asOf!).sort().slice(-1)[0])}</span><span>研究 {time(latest?.generatedAt)}</span></div>{(tab==='reports'||tab==='settings')&&<div className="awb-research-strip">{task&&task.state!=='completed'&&<div className="awb-job-select"><label>分析任务 <select aria-label="研究任务" value={task.id} disabled={!!running} onChange={e=>setSelectedJobId(e.target.value)}>{state.jobs.filter(j=>j.state!=='completed').map(j=><option key={j.id} value={j.id}>{time(j.startedAt)} · {{running:'分析中',partial:'未完成',cancelled:'已取消',failed:'未完成',interrupted:'已中断'}[j.state as 'partial']}</option>)}</select></label></div>}{task&&task.state!=='completed'&&<section className="awb-research-progress"><div><b>{running?running.progress?.stage??'单次账户分析进行中':task.error??'分析尚未完成'}</b><small>{task.progress?.strategy==='portfolio'?'完整账户已纳入':'旧任务数据'} {task.progress?.covered.length??0}/{task.progress?.total??snapshot?.positions.length??0} · 资料 {task.progress?.sources??0} · AI 调用 {task.progress?.modelCalls??0}/1 · 今日 {state.ai.usedToday}/{state.preferences.maxAiCalls}</small></div><button disabled={!!busy||(!running&&(!state.ai.enabled||state.ai.usedToday>=state.preferences.maxAiCalls))} onClick={()=>void act('job',running?'cancel':(task.progress?.modelCalls??0)===0?'resume':'retry',{id:task.id})}>{running?'取消分析':(task.progress?.modelCalls??0)===0?'继续准备并单次分析':'重新发起单次分析'}</button></section>}
  {task&&task.state!=='completed'&&<ResearchDetails key={task.id} id={task.id}/>}</div>}
  {tab==='overview'&&<><section className="awb-metrics" aria-label="账户摘要">{[['总资产',snapshot?.metrics.netLiquidation,Wallet],['未实现盈亏',snapshot?.metrics.unrealizedPnl,TrendingUp],['可用现金',cash,Wallet]].map(([label,value,Icon])=>{if(label==='未实现盈亏')return <OverviewPnlSummary key={String(label)} state={state}/>;const I=Icon as typeof Wallet;return <article key={String(label)}><span className="awb-metric-icon"><I size={23}/></span><div><span>{String(label)}</span><strong>{money(value)}</strong><small>{currency} · IBKR 账面</small></div></article>;})}<article><span className="awb-metric-icon risk"><ShieldCheck size={25}/></span><div><span>规则风险等级</span><strong className="attention">{state.metrics?.riskLevel??'待计算'}</strong><details className="awb-risk-explain"><summary>{state.metrics?.reasons.length??0} 条规则触发 · 查看依据</summary>{state.metrics?.reasons.map(r=><p key={r}>{r}</p>)}</details></div></article></section><div className="awb-overview-layout"><div className="awb-overview-main"><PerformancePanel state={state}/><OverviewBrief state={state} report={latest} pending={pendingReport} openReport={()=>navigate('reports')}/></div><div className="awb-overview-details"><div className="awb-overview-secondary">{holdingsTable(true)}<OverviewAllocation state={state}/></div><div className="awb-overview-bottom"><OverviewPnl state={state} select={p=>setSelected(p.conId)}/><OverviewFunds state={state}/></div></div></div></>}
  {tab==='holdings'&&<><HoldingsAnalytics snapshot={state.snapshot} performance={state.performance} range={holdingsRange} onRange={setHoldingsRange}/>{holdingsTable(false)}<div className="awb-secondary-metrics"><span>购买力 <b>{money(snapshot?.metrics.buyingPower)} {currency}</b></span><span>维持保证金 <b>{money(snapshot?.metrics.maintenanceMargin)} {currency}</b></span><span>最大单一仓位 <b>{pct(state.metrics?.topWeight)}</b></span></div></>}
  {tab==='orders'&&<PaperTradingWorkspace state={state} openSettings={()=>navigate('settings')}/>}
  {tab==='backtests'&&<BacktestWorkspace holdings={state.snapshot.positions}/>}
  {tab==='reports'&&<AnalysisWorkspace state={state} report={activeReport} task={task?.state==='completed'?undefined:task} running={running} busy={Boolean(busy)} canAnalyze={canAnalyze} question={question} onQuestion={setQuestion} onAsk={()=>{if(question.trim()){void act('chat','analyze',{question});setQuestion('');}}} onStart={()=>void act('analyze','analyze')} onTaskAction={job=>void act('job',job.state==='running'?'cancel':(job.progress?.modelCalls??0)===0?'resume':'retry',{id:job.id})} onSelectTask={setSelectedJobId} onSelect={r=>setReportId(r.id)} onCloseReport={()=>setReportId(undefined)} onPlan={()=>{setChosenAlert(undefined);setChosenPlan(undefined);setPlanReportId(activeReport?.id);navigate('alerts');}}/>}
  {tab==='alerts'&&<><div className="awb-filter">{[['all','全部'],['opportunity','机会'],['risk','风险'],['watch','已关注'],['resolved','已处理']].map(([key,label])=><button aria-pressed={filter===key} key={key} onClick={()=>setFilter(key)}>{label} <small>{state.alerts.filter(a=>key==='all'||key==='watch'&&a.watched||key==='resolved'&&a.resolved||a.kind===key).length}</small></button>)}</div><div className="awb-risk-grid"><div className="awb-stack">{state.alerts.filter(a=>filter==='all'||filter==='watch'&&a.watched||filter==='resolved'&&a.resolved||a.kind===filter).map(a=><article className={`awb-panel awb-risk-card ${a.resolved?'resolved':''} ${chosenAlert?.id===a.id?'selected':''}`} key={a.id}><span className={`awb-tag ${a.kind==='risk'?'attention':''}`}>{a.kind==='risk'?'优先关注':a.kind==='opportunity'?'机会观察':'事件提醒'}</span><h2>{a.title}</h2><p className="awb-affected">影响资产　{a.symbols.join(' · ')||'整体组合'}</p><p>{a.detail}</p>{a.trigger&&<p>触发条件　{a.trigger}</p>}<div className="awb-risk-card-actions"><small>{a.resolved?'已处理':a.read?'已读':'未读'} · {time(a.createdAt)}</small><button onClick={()=>void act('alert','alerts',{id:a.id,action:'watch'})}>{a.watched?'取消关注':'加入观察'}</button>{!a.resolved&&<button onClick={()=>void act('alert','alerts',{id:a.id,action:'resolve'})}>已处理</button>}<button className="awb-outline" onClick={()=>{setChosenAlert(a);setChosenPlan(undefined);void act('alert','alerts',{id:a.id,action:'read'});}}>查看调整计划</button></div>{a.reportId&&<button onClick={()=>{if(state.reports.some(r=>r.id===a.reportId)){setReportId(a.reportId);navigate('reports');}else void request<AnalysisReport>(`reports/${a.reportId}/json`).then(setReport).catch(()=>setError('报告暂不可用'));}}>查看证据与报告 <ArrowUpRight size={13}/></button>}</article>)}{!state.alerts.length&&<section className="awb-panel awb-empty">暂无提醒，可在右侧制定自己的计划。</section>}{!!state.plans?.length&&<section className="awb-panel"><h2>已保存计划</h2>{state.plans.map(p=><button className="awb-saved-plan" key={p.id} onClick={()=>{setChosenPlan(p);setChosenAlert(undefined);}}><span>{p.title}</span><small>{{watching:'观察中',triggered:'条件满足',handled:'已处理',invalidated:'已失效'}[p.status]}</small><ChevronRight size={14}/></button>)}</section>}</div><aside><PlanPanel key={chosenPlan?.id??chosenAlert?.id??planReportId??'new'} reportId={planReportId} state={state} alert={chosenAlert} existing={chosenPlan} onSaved={refresh}/></aside></div></>}
  {tab==='settings'&&<WorkbenchSettings state={state} busy={busy} act={act} connect={connect} sourceChoice={sourceChoice} selectSource={selectSource}/>}</>}
  {tab!=='overview'&&tab!=='holdings'&&tab!=='valuation'&&<footer className="awb-footer"><span><ShieldCheck size={13}/>{state?.source==='gateway'&&state.gatewayMode==='paper'?'模拟账户 · 每笔下单单独确认':'真实账户只读'} · 操作建议由你审核</span><span>本机服务运行期间持续更新</span></footer>}</div>
  {pendingConnection&&state&&<div className="awb-connection-confirm-backdrop" onClick={()=>setPendingConnection(null)}><section className="awb-connection-confirm" role="alertdialog" aria-modal="true" aria-labelledby="awb-connection-confirm-title" aria-describedby="awb-connection-confirm-description" onClick={event=>event.stopPropagation()}><span className="awb-eyebrow">CONNECTION SWITCH</span><h2 id="awb-connection-confirm-title">切换账户连接？</h2><p id="awb-connection-confirm-description">一次只能同时连接一个账户通道。开启<strong>{pendingConnection.source==='mcp'?'官方 MCP':pendingConnection.gatewayMode==='paper'?'IB Gateway 模拟盘':'IB Gateway 实盘'}</strong>将导致<strong>{state.source==='mcp'?'官方 MCP':state.gatewayMode==='paper'?'IB Gateway 模拟盘':'IB Gateway 实盘'}</strong>连接断开，确定吗？</p><div><button onClick={()=>setPendingConnection(null)}>取消</button><button className="primary" onClick={()=>void activateConnection(pendingConnection,true)}>确定并切换</button></div></section></div>}
  {holding&&<div className="awb-overlay" onClick={()=>setSelected(null)}><aside className="awb-drawer" role="dialog" aria-modal="true" aria-label={`${holding.symbol} 持仓详情`} onClick={e=>e.stopPropagation()}><button className="awb-close" onClick={()=>setSelected(null)} aria-label="关闭持仓详情"><X/></button><span className="awb-eyebrow">HOLDING DETAIL</span><h1>{holding.symbol}</h1><p>{holding.name??holding.symbol} · {holdingIndustryDetails(holding)}</p><div className="awb-detail-metrics"><div><small>持仓数量</small><b>{formatQuantity(holding.quantity)}</b></div><div><small>券商成本</small><b>{money(holding.averageCost)}</b></div><div><small>券商市值</small><b>{money(holding.marketValue)}</b></div></div><HoldingChart holding={holding} quote={state?.quotes.find(q=>q.conId===holding.conId)}/><Fundamentals holding={holding} report={latest}/><HoldingViews holding={holding} report={latest}/><h2>关联证据</h2>{latest?.evidence.filter(e=>e.symbols.includes(holding.symbol)).map(e=><a className="awb-detail-evidence" key={e.id} href={e.url} target="_blank" rel="noreferrer">{e.title}<small>{e.source} · 发布 {e.publishedAt?time(e.publishedAt):'未核实'}</small></a>)}</aside></div>}{report&&<ReportModal report={report} close={()=>setReport(null)}/>}</main>;
}
function AccountPicker({ accounts, value, connected, disabled, onChange }: { accounts: WorkbenchState['connection']['accounts']; value: string; connected: boolean; disabled: boolean; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(Math.max(0, accounts.findIndex(account => account.key === value)));
  const root = useRef<HTMLDivElement>(null);
  const selected = accounts.find(account => account.key === value);
  useEffect(() => {
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  const choose = (index: number) => { const account = accounts[index]; if (!account) return; setActive(index); setOpen(false); onChange(account.key); };
  const keyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); setOpen(false); return; }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) { setOpen(true); setActive(Math.max(0, accounts.findIndex(account => account.key === value))); return; }
      setActive(index => (index + (event.key === 'ArrowDown' ? 1 : -1) + accounts.length) % accounts.length);
      return;
    }
    if (event.key === 'Enter' && open) { event.preventDefault(); choose(active); }
  };
  return <div className="awb-account-picker" ref={root}>
    <span id="awb-account-picker-label">已授权账户</span>
    <div className={`awb-account-picker-control ${open ? 'is-open' : ''}`}>
      <button type="button" className="awb-account-picker-trigger" role="combobox" aria-labelledby="awb-account-picker-label" aria-haspopup="listbox" aria-controls="awb-account-picker-options" aria-expanded={open} data-value={value} disabled={disabled} onKeyDown={keyDown} onClick={() => setOpen(current => !current)}>
        <span className={`awb-account-picker-signal ${connected ? '' : 'is-saved'}`} aria-hidden="true"><i />{connected ? 'LIVE' : 'SAVED'}</span>
        <span className="awb-account-picker-value"><small>ACTIVE ACCOUNT</small><b>{selected?.label ?? '选择账户'}</b></span>
        <ChevronDown className="awb-account-picker-chevron" size={16} aria-hidden="true" />
      </button>
      {open && <div className="awb-account-picker-menu" id="awb-account-picker-options" role="listbox" aria-labelledby="awb-account-picker-label">
        <div className="awb-account-picker-menu-head"><span>SELECT ACCOUNT</span><b>{String(accounts.length).padStart(2, '0')}</b></div>
        {accounts.map((account, index) => <button type="button" role="option" aria-selected={account.key === value} className={index === active ? 'is-active' : ''} key={account.key} onMouseEnter={() => setActive(index)} onClick={() => choose(index)}><span className="awb-account-option-radio"><i /></span><span><b>{account.label}</b><small>{account.key === value ? '当前使用' : '切换至此账户'}</small></span>{account.key === value && <Check size={15} />}</button>)}
      </div>}
    </div>
  </div>;
}

function ConnectionSettings({ state, busy, act, connect, sourceChoice, selectSource }: { state: WorkbenchState; busy: string; act: (name: string, endpoint: string, data?: unknown) => Promise<void>; connect: (choice: SourceChoice) => void; sourceChoice: SourceChoice | null; selectSource: (source: SourceChoice['source'], gatewayMode?: SourceChoice['gatewayMode']) => void }) {
  const visibleSource = sourceChoice?.source ?? state.source;
  const visibleGatewayMode = sourceChoice?.gatewayMode ?? state.gatewayMode;
  const viewingActive = visibleSource === state.source && (visibleSource === 'mcp' || visibleGatewayMode === state.gatewayMode);
  const connecting = visibleSource === 'mcp' && (busy === 'connect' || viewingActive && state.connection.state === 'connecting');
  const connected = viewingActive && !connecting && state.connection.state === 'connected';
  const phase = connecting ? 'connecting' : connected ? 'connected' : 'disconnected';
  const authorized = viewingActive && Boolean(state.connection.authorized || state.connection.accounts.length);
  const copy = phase === 'connected'
    ? { kicker: 'SECURE CHANNEL ONLINE', title: 'IBKR 已连接', badge: '已连接', detail: state.connection.detail || '只读账户通道工作正常。' }
    : phase === 'connecting'
      ? { kicker: 'AUTHENTICATING', title: '正在建立安全连接', badge: '连接中', detail: '正在等待 IBKR 官方授权响应，请在新窗口完成登录。' }
      : { kicker: 'CHANNEL OFFLINE', title: authorized ? '授权需要恢复' : '尚未连接 IBKR', badge: authorized ? '需要重连' : '未连接', detail: !viewingActive ? '当前连接保持不变；点击连接后再确认是否切换至官方 MCP。' : state.connection.detail || '连接后才能读取真实持仓与账户快照。' };
  const StatusIcon = phase === 'connected' ? CircleCheck : phase === 'connecting' ? LoaderCircle : WifiOff;
  return <section className="awb-panel awb-connection-panel">
    <h2><Link2 size={18} />账户连接</h2>
    <p className="awb-muted">官方登录与授权在 IBKR 页面完成，密码不会进入本项目。</p>
    <div className="awb-source-options"><button aria-pressed={visibleSource === 'mcp'} disabled={!!busy} onClick={() => selectSource('mcp')}><b>官方 MCP</b><small>网页授权 · 默认方案</small></button><button aria-pressed={visibleSource === 'gateway' && visibleGatewayMode === 'live'} disabled={!!busy} onClick={() => selectSource('gateway', 'live')}><b>IB Gateway 实盘</b><small>本机客户端 · 只读实盘账户</small></button><button className="is-paper-source" aria-pressed={visibleSource === 'gateway' && visibleGatewayMode === 'paper'} disabled={!!busy} onClick={() => selectSource('gateway', 'paper')}><b>IB Gateway 模拟盘</b><small>本机客户端 · 持仓只读，可单独启用模拟下单</small></button></div>
    {visibleSource === 'mcp' && <div className={`awb-connection-console is-${phase}`} data-connection-state={phase} aria-live="polite">
      <header className="awb-connection-console-head">
        <span className="awb-connection-state-icon"><StatusIcon size={20} className={phase === 'connecting' ? 'awb-spin' : ''} /></span>
        <div><small>{copy.kicker}</small><strong>{copy.title}</strong><p>{copy.detail}</p></div>
        <span className="awb-connection-badge"><i />{copy.badge}</span>
      </header>
      <div className="awb-connection-route" aria-hidden="true"><span className={phase !== 'disconnected' ? 'is-active' : ''}>IBKR</span><i className={phase !== 'disconnected' ? 'is-active' : ''} /><span className={phase === 'connected' ? 'is-active' : phase === 'connecting' ? 'is-pending' : ''}>READ ONLY</span><i className={phase === 'connected' ? 'is-active' : ''} /><span className={phase === 'connected' ? 'is-active' : ''}>SPARKFLOW</span></div>
      <div className="awb-connection-actions">
        <button className={`awb-connect-primary ${phase === 'disconnected' ? 'primary' : ''}`} disabled={!!busy || phase === 'connecting'} onClick={() => connect({source:'mcp',gatewayMode:state.gatewayMode})}>{phase === 'connected' ? <RefreshCw size={15} /> : phase === 'connecting' ? <LoaderCircle size={15} className="awb-spin" /> : <Link2 size={15} />}{phase === 'connected' ? '重新授权' : phase === 'connecting' ? '正在连接 IBKR…' : authorized ? '重新连接 IBKR' : '连接 IBKR'}</button>
        {(authorized || connected) && <button className="awb-disconnect" disabled={!!busy} onClick={() => void act('disconnect', 'disconnect')}><Unplug size={14} />断开连接</button>}
      </div>
      {state.connection.accounts.length > 0 ? <AccountPicker accounts={state.connection.accounts} value={state.snapshot.accountKey} connected={connected} disabled={!!busy} onChange={accountKey => void act('source', 'source', { source: 'mcp', accountKey })} /> : connected && <div className="awb-connection-account"><Radio size={14} /><span>只读账户通道已建立</span><b>{state.snapshot.baseCurrency || 'IBKR'}</b></div>}
    </div>}
    {visibleSource === 'gateway' && (() => {
      const paper = visibleGatewayMode === 'paper';
      const gatewayLabel = paper ? '模拟盘 Gateway' : '实盘 Gateway';
      const viewingActiveGateway = state.source === 'gateway' && state.gatewayMode === visibleGatewayMode;
      const gatewayConnected = viewingActiveGateway && state.connection.state === 'connected';
      const gatewayConnecting = !gatewayConnected && busy === 'gateway-connect';
      const gatewayPhase = gatewayConnected ? 'connected' : gatewayConnecting ? 'connecting' : 'disconnected';
      const GatewayIcon = gatewayConnected ? CircleCheck : gatewayConnecting ? LoaderCircle : WifiOff;
      const gatewayCopy = gatewayConnected
        ? { kicker: 'LOCAL CHANNEL ONLINE', title: `${gatewayLabel} 已连接`, badge: '已连接', detail: state.connection.detail || '本机只读账户通道工作正常。' }
        : gatewayConnecting
          ? { kicker: 'SCANNING LOCAL CHANNEL', title: '正在检测本机通道', badge: '检测中', detail: state.connection.detail || '正在识别本机 IBKR API 端口并核对账户，连接成功后会立即同步。' }
          : { kicker: 'LOCAL CHANNEL OFFLINE', title: `${gatewayLabel} 尚未连接`, badge: '未连接', detail: !viewingActiveGateway ? '当前连接保持不变；点击“智能连接”后再确认是否切换。' : state.connection.detail || '点击“智能连接”后检测本机桥接服务与 Gateway API Socket。' };
      return <div className={`awb-connection-console is-${gatewayPhase} ${paper ? 'is-paper' : 'is-live'}`} data-connection-state={gatewayPhase} aria-live="polite">
        <header className="awb-connection-console-head">
          <span className="awb-connection-state-icon"><GatewayIcon size={20} className={gatewayConnecting ? 'awb-spin' : ''} /></span>
          <div><small>{gatewayCopy.kicker}</small><strong>{gatewayCopy.title}</strong><p>{gatewayCopy.detail}</p></div>
          <span className="awb-connection-badge"><i />{gatewayCopy.badge}</span>
        </header>
        <div className="awb-connection-route" aria-hidden="true"><span className={gatewayPhase !== 'disconnected' ? 'is-active' : ''}>{paper ? 'PAPER GATEWAY' : 'LIVE GATEWAY'}</span><i className={gatewayPhase !== 'disconnected' ? 'is-active' : ''}/><span className={gatewayPhase === 'connected' ? 'is-active' : gatewayPhase === 'connecting' ? 'is-pending' : ''}>LOCAL BRIDGE</span><i className={gatewayPhase === 'connected' ? 'is-active' : ''}/><span className={gatewayPhase === 'connected' ? 'is-active' : ''}>SPARKFLOW</span></div>
        <div className="awb-gateway-monitor"><span><Radio size={13}/>{gatewayConnected ? '连接成功，账户将按正常周期同步' : '等待手动启动智能连接'}</span><small>{viewingActiveGateway && state.connection.port ? `BRIDGE · 127.0.0.1:${state.connection.port}` : '点击后自动匹配端口'}</small></div>
        <div className="awb-connection-actions awb-gateway-actions">
          <button className="awb-connect-primary primary" disabled={!!busy || gatewayConnected} onClick={() => connect({source:'gateway',gatewayMode:visibleGatewayMode})}><PlugZap size={15} className={busy === 'gateway-connect' ? 'awb-pulse' : ''}/>{busy === 'gateway-connect' ? '正在智能连接…' : gatewayConnected ? '已智能连接' : '智能连接'}</button>
          <button className="awb-disconnect" disabled={!!busy || !gatewayConnected} onClick={() => void act('disconnect', 'disconnect')}><Unplug size={14}/>{busy === 'disconnect' ? '正在断开…' : '断开连接'}</button>
        </div>
      </div>;
    })()}
    <details className="awb-diagnostics"><summary>MCP 接入诊断</summary><p>服务器地址 https://api.ibkr.com/v1/api/mcp-public</p><p>仅申请 mcp.read 与账户标识权限。登录成功后核验工具和字段；不支持的结构会明确显示错误。</p>{state.connection.tools.map(t => <p key={t.name}><code>{t.name}</code> {t.description}</p>)}</details>
  </section>;
}

function WorkbenchSettings({ state, busy, act, connect, sourceChoice, selectSource }: { state: WorkbenchState; busy: string; act: (name: string, endpoint: string, data?: unknown) => Promise<void>; connect: (choice: SourceChoice) => void; sourceChoice: SourceChoice | null; selectSource: (source: SourceChoice['source'], gatewayMode?: SourceChoice['gatewayMode']) => void }) {
  const [preferences, setPreferences] = useState<Preferences>(state.preferences);
  useEffect(() => setPreferences(state.preferences), [state.snapshot.accountKey]);
  const field = (key: 'targetWeight' | 'cashFloor' | 'maxDrawdown', label: string) => <label>{label}<div className="awb-input-unit"><input type="number" min="0" max="100" step="1" value={preferences[key] === null ? '' : Number((preferences[key]! * 100).toFixed(2))} placeholder="尚未设置" onChange={e => setPreferences({ ...preferences, [key]: e.target.value === '' ? null : Number(e.target.value) / 100 })} />%</div></label>;
  return <div className="awb-settings-grid"><ConnectionSettings state={state} busy={busy} act={act} connect={connect} sourceChoice={sourceChoice} selectSource={selectSource} />
    <section className="awb-panel"><h2><Sparkles size={18} />AI 模型与账户数据</h2><dl className="awb-setting-dl"><div><dt>当前模型</dt><dd>{state.ai.model || '尚未配置'}</dd></div><div><dt>提供方</dt><dd>{state.ai.provider || '—'}</dd></div><div><dt>今日调用</dt><dd>{state.ai.usedToday} / {state.preferences.maxAiCalls}</dd></div></dl><div className="awb-research-services"><b>研究服务</b>{state.researchServices?.map(s=><p key={s}>{s}</p>)}<small>系统可先收集公开行情与原文；每份账户报告只把完整账户提交给 AI 一次，不做逐仓模型分析或自动修复调用。</small></div><p>复用 Vibe-Trading 模型配置。一次发送 {state.ai.fields.join('、')}，不含登录凭据和完整券商账号。</p><p className="awb-muted">模型或服务地址改变后，需重新核对并开启分析。关闭后不再发送新请求，已发送的请求无法从提供方收回。</p><button className={state.ai.enabled ? '' : 'primary'} disabled={!!busy || !state.snapshot.snapshotId || (!state.ai.configured && !state.ai.enabled)} onClick={() => void act('consent', 'consent', { enabled: !state.ai.enabled, fingerprint: state.ai.fingerprint })}>{state.ai.enabled ? '关闭账户 AI 分析' : '同意发送上述字段并开启 AI'}</button>{!state.ai.configured && <p className="awb-muted">请在项目现有 AI / Vibe-Trading 设置中配置模型后刷新。</p>}</section>
    <AccountScheduleSettings state={state} busy={!!busy} save={value=>void act('preferences','preferences',value)}/><form className="awb-panel awb-preferences" onSubmit={e => { e.preventDefault(); void act('preferences', 'preferences', { ...preferences, schedules: state.preferences.schedules, daily: false, eventAnalysis: false, maxAutomatic: 0 }); }}><h2><Settings2 size={18} />投资偏好与分析限制</h2><div className="awb-form-grid"><label>投资周期<select value={preferences.horizon} onChange={e => setPreferences({ ...preferences, horizon: e.target.value as Preferences['horizon'] })}><option value="both">短期与长期分别分析</option><option value="long">中长期配置</option><option value="swing">波段交易</option></select></label>{field('targetWeight', '单标的目标仓位上限')}{field('cashFloor', '现金占比底线')}{field('maxDrawdown', '可接受回撤')}<label>比较基准<select value={preferences.benchmark??'SPY'} onChange={e=>setPreferences({...preferences,benchmark:e.target.value as Preferences['benchmark']})}><option value="SPY">SPY</option><option value="QQQ">QQQ</option><option value="none">关闭比较</option></select></label><label>每日 AI 总调用上限<input type="number" min="1" max="100" value={preferences.maxAiCalls} onChange={e => setPreferences({ ...preferences, maxAiCalls: Number(e.target.value) })} /></label></div><p className="awb-muted">AI 只会在你手动发起分析，或已开启的每日定时到点时调用。启动服务、同步持仓和新增事件都不会自动生成分析。</p><button className="primary" disabled={!!busy || !state.snapshot.snapshotId} type="submit">{busy === 'preferences' ? '保存中…' : '保存偏好'}</button></form></div>;
}
function HoldingViews({ report, holding }: { report?: AnalysisReport; holding: Holding }) { const view = report?.content.holdings.find(h => h.symbol === holding.symbol); return <><h2>持仓研究</h2>{view ? <><p>{view.background}</p><div className="awb-view"><b><ArrowDownLeft size={15} />短期应对</b><p>{view.shortTerm}</p></div><div className="awb-view"><b><ArrowUpRight size={15} />长期逻辑</b><p>{view.longTerm}</p></div>{report?.content.actions.filter(a => a.symbol === holding.symbol).map((a, i) => <div className="awb-action" key={i}><b>{a.horizon === 'short' ? '短期' : '长期'} · {actionLabels[a.action]}</b><p>{a.rationale}</p><small>触发条件：{a.trigger}</small><small>反对证据：{a.counterEvidence}</small><small>失效条件：{a.invalidation}</small>{a.shares !== undefined && <p>独立情景估算：{a.shares > 0 ? '+' : ''}{a.shares} 股 · 调整后现金约 {money(a.estimatedCashAfter)} USD · 仓位 {pct(a.estimatedWeightAfter)}<small>按券商快照估价，不含费用；各情景不能直接相加。</small></p>}</div>)}</> : <p className="awb-muted">生成账户深度分析后展示该持仓的短期和长期观点。</p>}</>; }
function HoldingChart({ holding, quote }: { holding: Holding; quote?: MarketQuote }) {
  const [period, setPeriod] = useState('1M'); const [bars, setBars] = useState<{ time: string; close: number }[]>([]); const [error, setError] = useState('');
  useEffect(() => { const controller = new AbortController(); setBars([]); setError(''); request<{ bars: { time: string; close: number }[] }>(`history?conId=${holding.conId}&period=${period}`, undefined, controller.signal).then(data => setBars(data.bars)).catch(e => { if (e.name !== 'AbortError') setError(e.message); }); return () => controller.abort(); }, [holding.conId, period]);
  const low = Math.min(...bars.map(b => b.close)), high = Math.max(...bars.map(b => b.close));
  const points = bars.map((b, i) => `${20 + i / Math.max(1, bars.length - 1) * 600},${170 - (b.close - low) / Math.max(0.01, high - low) * 140}`).join(' ');
  return <section className="awb-chart"><div className="awb-section-heading"><h2>参考行情 {money(quote?.price)}</h2><div>{['1D', '5D', '1M', '6M', '1Y'].map(p => <button aria-pressed={period === p} onClick={() => setPeriod(p)} key={p}>{p}</button>)}</div></div>{bars.length ? <><svg viewBox="0 0 640 200" role="img" aria-label={`${holding.symbol} 历史收盘价曲线`}><path d="M20 30H620M20 100H620M20 170H620" stroke="#233936" fill="none" /><polyline points={points} fill="none" stroke="#66d8b9" strokeWidth="2" /></svg><div className="awb-chart-labels"><span>{bars[0].time}</span><span>{bars[bars.length - 1].time}</span></div></> : <div className="awb-empty">{error || '历史行情载入中…'}</div>}<small>东方财富 · 不复权 · 上游时间原样展示 · {quote ? quoteLabels[quote.status] : '报价未取得'} · 报价时间 {time(quote?.asOf)}</small></section>;
}
function ReportModal({ report, close }: { report: AnalysisReport; close: () => void }) { const [error, setError] = useState(''); const [exporting, setExporting] = useState(false); return <div className="awb-overlay" onClick={close}><section className="awb-report-modal" role="dialog" aria-modal="true" aria-label="账户分析报告" onClick={e => e.stopPropagation()}><header><b>SparkFlow · 账户研究</b><div><a href={`${api}reports/${report.id}/html`}><Download size={14} /> HTML</a><button disabled={exporting} onClick={async () => { setExporting(true); try { await exportSparkFlowResearchPdf(reportMarkdown(report)); } catch { setError('PDF 导出失败，请尝试 HTML 下载'); } finally { setExporting(false); } }}><Download size={14} />{exporting ? '生成中…' : 'PDF'}</button><button aria-label="关闭报告" onClick={close}><X size={20} /></button></div></header>{error && <p role="alert">{error}</p>}<article className="awb-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{reportMarkdown(report)}</ReactMarkdown></article></section></div>; }

function Fundamentals({holding,report}:{holding:Holding;report?:AnalysisReport}){const e=report?.evidence.find(e=>e.symbols.includes(holding.symbol)&&e.kind==='profile');let data:any;try{data=JSON.parse(e?.content??'{}');}catch{}const val=(v:any)=>v?.raw??v;return <section className="awb-fundamentals"><h2>基本面快照</h2><div className="awb-detail-metrics">{[['远期市盈率',val(data?.statistics?.forwardPE)],['收入同比',val(data?.financials?.revenueGrowth)],['净利润率',val(data?.financials?.profitMargins)]].map(([label,v])=><div key={label}><small>{label}</small><b>{label==='远期市盈率'?money(v):pct(number(v))}</b></div>)}</div><small>{e?`${e.source} · 获取 ${time(e.fetchedAt)} · 财务报告期以原始来源为准`:'尚未取得基本面原始数据；深度研究后更新。'}</small></section>;}
