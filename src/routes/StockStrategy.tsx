import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowUpRight, BookOpen, Check, ChevronDown, Clock3, Download, FlaskConical, History, Layers3, LoaderCircle, MessageSquare, Plus, RefreshCw, Search, Settings2, ShieldCheck, Sparkles, Square, Target, TrendingUp, X } from 'lucide-react';
import { MarketSubnav } from '../components/MarketSubnav';
import { IntegrationSettingsPanel } from '../components/IntegrationSettings';
import { ResearchRichText } from '../components/ibkr/ResearchRichText';
import { loadStrategyState, peekStrategyState, strategyRequest } from '../lib/stockStrategyClient';
import { INTEGRATION_SETTINGS_CHANGED } from '../lib/integrations';
import { isStrategyActive, type StrategyJob, type StrategyState } from '../lib/stockStrategyTypes';
import { strategyReportDetails } from '../lib/stockStrategyReport';
import './StockStrategy.css';

const statusLabels: Record<StrategyJob['status'], string> = { queued: '排队中', running: '研究中', completed: '已完成', failed: '失败', cancelled: '已停止', interrupted: '已中断' };
const formatTime = (value: string) => new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
const money = (value?: number | null) => typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('zh-CN', { maximumFractionDigits: 2 }) : '—';
function markdown(job: StrategyJob) {
  if (job.result?.content) return `# ${job.symbol} · 策略问答\n\n${job.question}\n\n${job.result.content}`;
  const report = job.result?.report;
  const details = strategyReportDetails(report);
  return [
    `# ${job.result?.stock_name || job.symbol} · 策略研究`, `${job.symbol} · ${formatTime(job.updatedAt)} · ${job.model}`,
    '## 核心结论', report?.summary?.analysis_summary, `研究倾向：${report?.summary?.operation_advice || '—'}`,
    '## 条件与点位', `参考买点：${report?.strategy?.ideal_buy || '—'}\n\n备选买点：${report?.strategy?.secondary_buy || '—'}\n\n止损参考：${report?.strategy?.stop_loss || '—'}\n\n目标参考：${report?.strategy?.take_profit || '—'}`,
    '## 技术分析', details.technical_analysis, '## 基本面', details.fundamental_analysis,
    '## 新闻与催化', details.news_summary, details.empty_news_disclosure,
    '## 风险', details.risk_warning,
    '研究由 Daily Stock Analysis 生成，基于报告生成时可用的数据，不构成交易指令。',
  ].filter(Boolean).join('\n\n');
}

export default function StockStrategy() {
  const [state, setState] = useState<StrategyState | null>(peekStrategyState);
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('job') || '';
  const [selected, setSelected] = useState<StrategyJob | null>(null);
  const [symbol, setSymbol] = useState('');
  const [mode, setMode] = useState<'report' | 'chat'>('report');
  const [question, setQuestion] = useState('');
  const [strategies, setStrategies] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyQuery, setHistoryQuery] = useState('');
  const [detailLoading, setDetailLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const hydratedSelection = useRef('');
  const selectionRef = useRef(selectedId); selectionRef.current = selectedId;
  const refresh = useCallback(async () => {
    try { const next = await loadStrategyState(true); setState(next); return next; }
    catch (reason) { setError(reason instanceof Error ? reason.message : '研究记录加载失败'); return null; }
  }, []);

  const hasActiveJobs = Boolean(state?.jobs.some(isStrategyActive));
  useEffect(() => {
    let disposed = false; let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (disposed) return;
      const next = await refresh();
      if (!disposed) timer = setTimeout(poll, next?.jobs.some(isStrategyActive) ? 2000 : 30_000);
    };
    void poll();
    const settingsChanged = () => void refresh();
    window.addEventListener(INTEGRATION_SETTINGS_CHANGED, settingsChanged);
    return () => { disposed = true; clearTimeout(timer); window.removeEventListener(INTEGRATION_SETTINGS_CHANGED, settingsChanged); };
  }, [refresh, hasActiveJobs]);

  const selectedVersion = state?.jobs.find(job => job.id === selectedId)?.updatedAt;
  useEffect(() => {
    let disposed = false;
    if (!selectedId) { setSelected(null); hydratedSelection.current = ''; return; }
    setDetailLoading(true);
    void strategyRequest<StrategyJob>(`/jobs/${selectedId}`).then(job => {
      if (!disposed) {
        setSelected(job);
        if (hydratedSelection.current !== job.id) {
          hydratedSelection.current = job.id;
          setSymbol(job.symbol); setStrategies(job.strategies);
        }
      }
    }).catch(reason => { if (!disposed) setError(reason.message); }).finally(() => { if (!disposed) setDetailLoading(false); });
    return () => { disposed = true; };
  }, [selectedId, selectedVersion]);

  const choose = (job: StrategyJob) => {
    setError(''); setSelected(null); setParams({ job: job.id });
    setSymbol(job.symbol); setStrategies(job.strategies); setMode('report'); setQuestion('');
  };
  const newResearch = () => { setParams({}); setSelected(null); setSymbol(''); setQuestion(''); setMode('report'); setError(''); inputRef.current?.focus(); };
  const submit = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const sameStock = selected?.symbol === symbol.trim().toUpperCase();
      const job = await strategyRequest<StrategyJob>('/jobs', { symbol, mode, question, strategies, ...(mode === 'chat' && sameStock ? { sessionId: selected.sessionId } : {}) });
      setSelected(job); setParams({ job: job.id }); setQuestion('');
      await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : '研究启动失败'); }
    finally { setBusy(false); }
  };
  const cancel = async (job: StrategyJob) => {
    setError('');
    try { const next = await strategyRequest<StrategyJob>(`/jobs/${job.id}/cancel`, {}); if (selectionRef.current === job.id) setSelected(next); await refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '停止失败'); }
  };
  const exportReport = () => {
    if (!selected?.result) return;
    const blob = new Blob([markdown(selected)], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob); const anchor = document.createElement('a');
    anchor.href = url; anchor.download = `${selected.symbol}-策略研究-${selected.id.slice(0, 8)}.md`; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const jobs = state?.jobs || [];
  const filtered = jobs.filter(job => `${job.symbol} ${job.result?.stock_name || ''} ${job.question}`.toLowerCase().includes(historyQuery.toLowerCase()));
  const current = selected?.id === selectedId ? selected : null;
  const running = jobs.filter(isStrategyActive).length;
  const catalog = state?.strategies || [];

  return <section className="strategy-page">
    <div className="strategy-frame">
      <header className="strategy-hero">
        <div className="strategy-hero-title"><MarketSubnav /><p className="strategy-subtitle">从市场信号到研究判断。让每一个结论，都有依据。</p></div>
        <button className="strategy-model" onClick={() => setSettingsOpen(value => !value)} aria-expanded={settingsOpen}>
          <span className={`strategy-dot ${state?.configured ? 'is-ready' : ''}`} />
          <span><small>沿用设置中的模型</small><strong>{state?.model || '配置研究模型'}</strong></span><Settings2 size={17} />
        </button>
      </header>
      {settingsOpen && <section className="strategy-settings" aria-label="研究模型设置"><div className="strategy-section-head"><h2>模型设置</h2><button onClick={() => setSettingsOpen(false)} aria-label="关闭模型设置"><X size={18} /></button></div><IntegrationSettingsPanel compact onChange={() => void refresh()} /></section>}
      {error && <div role="alert" className="strategy-alert"><span>{error}</span><button onClick={() => { setError(''); void refresh(); }}>重试</button><button aria-label="关闭错误提示" onClick={() => setError('')}><X size={16} /></button></div>}
      {state && !state.ready && <div className="strategy-notice">研究引擎尚未就绪。请在项目目录运行 <code>npm run strategy:setup</code>，完成后刷新。</div>}
      <div className="strategy-workspace">
        <aside className="strategy-sidebar">
          <form className="strategy-compose" onSubmit={event => { event.preventDefault(); void submit(); }}>
            <div className="strategy-section-head"><h2><Plus size={17} />发起研究</h2><span>01 / RESEARCH</span></div>
            <div className="strategy-mode" aria-label="研究方式">
              <button type="button" aria-pressed={mode === 'report'} onClick={() => setMode('report')}><BookOpen size={15} />个股报告</button>
              <button type="button" aria-pressed={mode === 'chat'} onClick={() => setMode('chat')}><MessageSquare size={15} />策略问答</button>
            </div>
            <label className="strategy-field">研究标的<div className="strategy-symbol"><Search size={17} /><input ref={inputRef} value={symbol} onChange={event => setSymbol(event.target.value)} placeholder="输入股票代码" aria-label="股票代码" maxLength={20} autoComplete="off" required /></div></label>
            <div className="strategy-examples">试试 <button type="button" onClick={() => setSymbol('600519')}>600519</button><button type="button" onClick={() => setSymbol('HK00700')}>HK00700</button><button type="button" onClick={() => setSymbol('AAPL')}>AAPL</button></div>
            <details className="strategy-picker">
              <summary><span><Layers3 size={16} />{strategies.length ? `已选 ${strategies.length} 项策略` : '综合分析 · 选择策略'}</span><ChevronDown size={15} /></summary>
              <p>选择最多 3 项。不选择时进行综合分析。</p>
              <div className="strategy-options">{catalog.map(strategy => <label key={strategy.id} title={strategy.description}>
                <input type="checkbox" checked={strategies.includes(strategy.id)} disabled={strategies.length >= 3 && !strategies.includes(strategy.id)} onChange={event => setStrategies(values => event.target.checked ? [...values, strategy.id] : values.filter(id => id !== strategy.id))} />
                <span><strong>{strategy.name}</strong><small>{strategy.description}</small></span>
              </label>)}</div>
            </details>
            {strategies.length > 0 && <div className="strategy-selected-tags">{strategies.map(id => <button key={id} type="button" onClick={() => setStrategies(values => values.filter(value => value !== id))}>{catalog.find(item => item.id === id)?.name || id}<X size={11} /></button>)}</div>}
            {mode === 'chat' && <label className="strategy-field">研究问题<textarea value={question} onChange={event => setQuestion(event.target.value)} rows={4} maxLength={4000} placeholder="例如：当前趋势是否支持继续持有？有哪些需要关注的风险？" required /></label>}
            <button className="strategy-submit" type="submit" disabled={busy || !symbol.trim() || !state?.configured || !state?.ready || (mode === 'chat' && !question.trim())}>{busy ? <LoaderCircle size={16} className="strategy-spin" /> : <Sparkles size={16} />}{busy ? '正在发起…' : mode === 'chat' ? '开始问答' : '开始研究'}<ArrowUpRight size={16} /></button>
            {!state?.configured && state ? <button className="strategy-configure" type="button" onClick={() => setSettingsOpen(true)}>先配置模型与 API Key <ArrowUpRight size={13} /></button> : <p className="strategy-compose-note">支持 A 股、港股、美股及日、韩、台股代码</p>}
          </form>
          <section className="strategy-history">
            <div className="strategy-section-head"><h2><History size={17} />研究记录</h2><button onClick={newResearch} aria-label="新建研究"><Plus size={16} /></button></div>
            {jobs.length > 5 && <input className="strategy-history-search" aria-label="搜索研究记录" placeholder="搜索代码 / 问题" value={historyQuery} onChange={event => setHistoryQuery(event.target.value)} />}
            <div className="strategy-history-list">{filtered.map(job => <button key={job.id} onClick={() => choose(job)} className={selectedId === job.id ? 'is-selected' : ''} aria-pressed={selectedId === job.id}>
              <div><strong>{job.symbol}</strong><span className={`strategy-job-status is-${job.status}`}>{isStrategyActive(job) && <span className="strategy-dot is-ready" />}{statusLabels[job.status]}</span></div>
              <p>{job.mode === 'chat' ? job.question : job.result?.stock_name || '个股综合研究'}</p><small>{formatTime(job.createdAt)} · {job.mode === 'chat' ? '问答' : '报告'}</small>
            </button>)}</div>
            {!filtered.length && <p className="strategy-no-history">{jobs.length ? '没有匹配的研究记录' : '完成一次研究后，记录会保存在这里。'}</p>}
            <div className="strategy-history-footer"><ShieldCheck size={13} />本地保存 · 刷新后继续查看{running > 0 && <span>{running} 项进行中</span>}</div>
          </section>
        </aside>
        <main className="strategy-main" aria-label="研究结果" aria-busy={detailLoading}>
          <div className="strategy-document-bar"><span><span className="strategy-dot" />{current ? `${current.symbol} / ${current.mode === 'chat' ? '策略问答' : '研究报告'}` : '研究工作台'}</span><div>{current?.status === 'completed' && <button onClick={exportReport}><Download size={14} />导出 Markdown</button>}<button onClick={() => void refresh()} aria-label="刷新研究记录"><RefreshCw size={15} /></button></div></div>
          {selectedId && !current ? <div className="strategy-loading"><LoaderCircle className="strategy-spin" size={22} />{detailLoading ? '正在读取研究记录' : '未能读取记录，请重试或新建研究'}</div> : current ? <>
            {isStrategyActive(current) ? <div className="strategy-progress" role="status"><div className="strategy-progress-icon"><FlaskConical size={30} /></div><p className="strategy-kicker">RESEARCH IN PROGRESS</p><h2>正在研究 {current.symbol}</h2><p>{current.message}</p><progress value={current.progress} max={100} /><small>可以切换页面，研究完成后会自动保存。</small><button onClick={() => void cancel(current)}><Square size={13} />停止研究</button></div>
            : current.status === 'completed' ? <ResearchDocument job={current} onFollowup={() => { setMode('chat'); setSymbol(current.symbol); requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('.strategy-field textarea')?.focus()); }} />
            : <div className="strategy-progress"><ShieldCheck size={32} /><h2>{statusLabels[current.status]}</h2><p>{current.message}</p><button onClick={() => { setSymbol(current.symbol); setMode(current.mode); setStrategies(current.strategies); setQuestion(current.question); inputRef.current?.focus(); }}>重新填写并发起 <ArrowUpRight size={15} /></button></div>}
          </> : <div className="strategy-empty">
            <div className="strategy-orbit" aria-hidden="true"><div /><div /><FlaskConical size={35} /><span>01</span><span>02</span><span>03</span></div>
            <p className="strategy-kicker">A CLEARER VIEW OF YOUR NEXT MOVE</p><h2>把直觉，变成有依据的判断。</h2><p>选择一只股票，连接行情、技术面与市场信息，<br className="strategy-desktop-break" />生成一份可以回看、追问的研究报告。</p>
            <div className="strategy-pillars"><div><TrendingUp size={21} /><strong>识别趋势</strong><p>均线、量价与技术结构</p></div><div><Target size={21} /><strong>制定条件</strong><p>参考点位与策略触发条件</p></div><div><ShieldCheck size={21} /><strong>审视风险</strong><p>基本面、新闻与反向信号</p></div></div>
            <button className="strategy-empty-action" onClick={() => inputRef.current?.focus()}>从一只股票开始 <ArrowUpRight size={15} /></button>
          </div>}
          <footer className="strategy-source"><span>研究引擎 <a href="https://github.com/ZhuLinsen/daily_stock_analysis" target="_blank" rel="noreferrer">Daily Stock Analysis <ArrowUpRight size={11} /></a></span><span>独立判断，理性决策</span></footer>
        </main>
      </div>
    </div>
  </section>;
}

function ResearchDocument({ job, onFollowup }: { job: StrategyJob; onFollowup: () => void }) {
  const report = job.result?.report;
  const summary = report?.summary;
  const details = strategyReportDetails(report);
  const change = report?.meta?.change_pct;
  const score = summary?.sentiment_score;
  return <article className="strategy-document">
    <header><div><p className="strategy-kicker">{job.mode === 'chat' ? 'STRATEGY CONVERSATION' : 'EQUITY RESEARCH NOTE'}</p><h2>{job.result?.stock_name || report?.meta?.stock_name || job.symbol}</h2><p className="strategy-document-meta"><span>{job.symbol}</span><span><Clock3 size={12} />{formatTime(job.updatedAt)}</span></p></div>
      {report && <div className="strategy-quote"><strong>{money(report.meta?.current_price)}</strong><span className={typeof change === 'number' ? change > 0 ? 'is-up' : change < 0 ? 'is-down' : '' : ''}>{typeof change === 'number' ? `${change > 0 ? '+' : ''}${change.toFixed(2)}%` : '涨跌幅暂无'}<small>分析时行情</small></span></div>}
    </header>
    {job.result?.content ? <><div className="strategy-question"><MessageSquare size={16} /><p>{job.question}</p></div><ResearchRichText text={job.result.content} restrained /></> : <>
      <section className="strategy-verdict"><div><p className="strategy-kicker">核心结论</p><h3>{summary?.action_label || summary?.operation_advice || '研究观察'}</h3><ResearchRichText text={summary?.analysis_summary || '暂无明确结论，请结合下方数据判断。'} restrained /></div><div className="strategy-score"><strong>{typeof score === 'number' ? score : '—'}<small>/ 100</small></strong><span>研究评分</span><small>{summary?.trend_prediction || summary?.sentiment_label || '综合判断'}</small></div></section>
      <section className="strategy-levels" aria-label="策略参考点位">{([
        ['参考买点', report?.strategy?.ideal_buy], ['备选买点', report?.strategy?.secondary_buy], ['止损参考', report?.strategy?.stop_loss], ['目标参考', report?.strategy?.take_profit],
      ] as const).map(([label, value]) => <div key={label}><span>{label}</span><strong>{value || '暂无明确点位'}</strong></div>)}</section>
      <div className="strategy-evidence-grid">{([
        ['技术结构', details?.technical_analysis, TrendingUp], ['基本面观察', details?.fundamental_analysis, Layers3], ['新闻与催化', [details?.news_summary, details?.empty_news_disclosure].filter(Boolean).join('\n\n'), BookOpen], ['风险与反向信号', details?.risk_warning, ShieldCheck],
      ] as const).map(([title, content, Icon]) => <section key={title} className={title === '风险与反向信号' ? 'is-risk' : ''}><h3><Icon size={17} />{title}</h3><ResearchRichText text={content || '本次未取得足够资料，暂不形成判断。'} restrained /></section>)}</div>
    </>}
    <div className="strategy-followup"><span><Check size={15} />已保存到本地研究记录</span><button onClick={onFollowup}><MessageSquare size={15} />继续追问<ArrowUpRight size={14} /></button></div>
    <p className="strategy-report-note">由 {job.model} 生成 · 数据以本次采集结果为准。评分和参考点位用于研究，不构成交易指令。</p>
  </article>;
}
