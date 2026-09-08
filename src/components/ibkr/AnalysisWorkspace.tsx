import { useState } from 'react';
import {
  ArrowUpRight,
  ArrowLeft,
  BookOpenText,
  Check,
  Database,
  Download,
  FileCheck2,
  MessageSquareText,
  RotateCcw,
  Search,
  ShieldCheck,
  Sparkles,
  XCircle,
} from 'lucide-react';
import type {
  AnalysisJob,
  AnalysisReport,
  ResearchProgress,
  WorkbenchState,
} from '../../lib/ibkr/workbenchTypes';
import { exportSparkFlowResearchPdf } from '../../lib/exportResearchPdf';
import { holdingChanges, reportMarkdown } from '../../lib/ibkr/workbenchReport';
import { industryLabel } from '../../lib/ibkr/industryLabels';
import { api, EvidenceLinks, money, pct, ResearchDetails, time } from './WorkbenchPanels';
import './AnalysisWorkspace.css';

type AnalysisWorkspaceProps = {
  state: WorkbenchState;
  report?: AnalysisReport;
  task?: AnalysisJob;
  running?: AnalysisJob;
  busy: boolean;
  canAnalyze: boolean;
  question: string;
  onQuestion: (value: string) => void;
  onAsk: () => void;
  onStart: () => void;
  onTaskAction: (task: AnalysisJob) => void;
  onSelectTask: (id: string) => void;
  onSelect: (report: AnalysisReport) => void;
  onCloseReport: () => void;
  onPlan: () => void;
};

const actionLabel = {
  hold: '维持',
  watch: '观察',
  increase: '增持',
  reduce: '减持',
} as const;

const jobLabel = {
  running: '分析中',
  partial: '待继续',
  cancelled: '已取消',
  failed: '未完成',
  interrupted: '已中断',
  completed: '已完成',
} as const;

function disabledReason(state: WorkbenchState, running?: AnalysisJob, busy = false) {
  if (busy) return '当前操作完成后即可继续';
  if (!state.snapshot.snapshotId || !['ready', 'empty'].includes(state.snapshot.state)) {
    return '账户快照就绪后才能开始分析';
  }
  if (!state.ai.enabled) return '请先在设置中授权 AI 使用账户数据';
  if (running) return '当前账户分析完成后可以继续提问';
  if (state.ai.usedToday >= state.preferences.maxAiCalls) return '今日 AI 调用额度已用完';
  return '';
}

function ResearchSteps({ progress, running = false, snapshotReady = true }: { progress?: ResearchProgress; running?: boolean; snapshotReady?: boolean }) {
  const steps = [
    { label: '账户快照', note: snapshotReady ? '冻结本次账户数据' : '等待账户同步', done: snapshotReady },
    {
      label: '市场资料',
      note: progress?.sources ? `${progress.sources} 个来源已保存` : '等待检索与阅读',
      done: (progress?.sources ?? 0) > 0,
    },
    {
      label: 'AI 判断',
      note: (progress?.modelCalls ?? 0) > 0 ? '模型已完成一次调用' : '等待形成账户结论',
      done: (progress?.modelCalls ?? 0) > 0,
    },
    {
      label: '发布报告',
      note: progress?.complete ? '报告已经归档' : running ? '完成后自动归档' : '等待完成分析',
      done: Boolean(progress?.complete),
    },
  ];
  const firstOpen = steps.findIndex((step) => !step.done);
  const active = firstOpen < 0 ? steps.length - 1 : firstOpen;

  return (
    <ol className="awb-analysis-steps" aria-label="研究步骤">
      {steps.map((step, index) => (
        <li
          className={step.done ? 'is-done' : index === active ? 'is-active' : ''}
          aria-current={index === active ? 'step' : undefined}
          key={step.label}
        >
          <span>{step.done ? <Check size={14} /> : String(index + 1).padStart(2, '0')}</span>
          <div>
            <b>{step.label}</b>
            <small>{step.note}</small>
          </div>
        </li>
      ))}
    </ol>
  );
}

function QuickQuestion({
  state,
  running,
  busy,
  canAnalyze,
  question,
  onQuestion,
  onAsk,
}: Pick<
  AnalysisWorkspaceProps,
  'state' | 'running' | 'busy' | 'canAnalyze' | 'question' | 'onQuestion' | 'onAsk'
>) {
  const reason = disabledReason(state, running, busy);
  return (
    <section className="awb-analysis-card awb-analysis-question">
      <span className="awb-analysis-kicker"><MessageSquareText size={14} />AI 分析对话</span>
      <h3>你想了解持仓的哪一面？</h3>
      <p>基于当前账户快照追问持仓、回调情景或风险优先级。</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (canAnalyze && question.trim()) onAsk();
        }}
      >
        <textarea
          aria-label="账户分析问题"
          maxLength={2000}
          placeholder="例如：如果市场回调，我应该优先关注哪些持仓？"
          value={question}
          onChange={(event) => onQuestion(event.target.value)}
        />
        <button className="primary" disabled={!canAnalyze || !question.trim()} type="submit">
          提交问题 <ArrowUpRight size={15} />
        </button>
      </form>
      {reason && <small className="awb-analysis-helper">{reason}</small>}
    </section>
  );
}

function CoverageCard({ state }: { state: WorkbenchState }) {
  return (
    <section className="awb-analysis-card awb-analysis-coverage">
      <span className="awb-analysis-kicker"><Database size={14} />本次研究范围</span>
      <h3>{state.snapshot.positions.length} 个持仓 · 1 个账户结论</h3>
      <div className="awb-analysis-coverage-list">
        <span><Check size={14} /><b>账户</b><small>持仓、现金与风险约束</small></span>
        <span><Search size={14} /><b>资料</b><small>市场背景与原始证据</small></span>
        <span><FileCheck2 size={14} /><b>输出</b><small>结论、行动与失效条件</small></span>
      </div>
      <small>AI 调用 {state.ai.usedToday}/{state.preferences.maxAiCalls} · {state.ai.model || '模型未配置'}</small>
    </section>
  );
}

function ResearchTaskCard({
  task,
  running,
  busy,
  onAction,
}: {
  task: AnalysisJob;
  running?: AnalysisJob;
  busy: boolean;
  onAction: (task: AnalysisJob) => void;
}) {
  const progress = task.progress;
  const isRunning = task.state === 'running';
  const retry = (progress?.modelCalls ?? 0) > 0;
  const title = isRunning
    ? '正在建立账户判断'
    : retry
      ? '这次分析未能完成'
      : '已有阶段结果，可以继续';
  const action = isRunning
    ? '取消分析'
    : retry
      ? '基于已保存资料重新分析'
      : '继续完成分析';

  return (
    <section
      className={`awb-analysis-card awb-analysis-task ${isRunning ? 'is-running' : retry ? 'is-retry' : 'is-recoverable'}`}
      aria-live="polite"
    >
      <div className="awb-analysis-task-head">
        <span className="awb-analysis-state"><i />{jobLabel[task.state]}</span>
        <small>{time(task.startedAt)}</small>
      </div>
      <span className="awb-analysis-kicker">ACTIVE RESEARCH</span>
      <h2>{title}</h2>
      <p className={isRunning ? '' : 'awb-analysis-task-message'} role={!isRunning && task.error ? 'alert' : undefined}>
        {isRunning ? progress?.stage ?? '正在汇总账户和市场资料' : task.error ?? '已保存本次账户快照与阶段资料。'}
      </p>
      <div className="awb-analysis-task-metrics">
        <span><b>{progress?.strategy==='portfolio'?progress.total:`${progress?.covered.length??0}/${progress?.total??0}`}</b><small>{progress?.strategy==='portfolio'?`账户持仓 · ${progress.complete?'已完成校验':'结论待校验'}`:'历史逐仓覆盖'}</small></span>
        <span><b>{progress?.sources ?? 0}</b><small>资料来源</small></span>
        <span><b>{progress?.reads ?? 0}</b><small>原文阅读</small></span>
        <span><b>{progress?.modelCalls ?? 0}/1</b><small>AI 调用</small></span>
      </div>
      <ResearchSteps progress={progress} running={isRunning} />
      <div className="awb-analysis-task-actions">
        <button
          className={isRunning ? '' : 'primary'}
          disabled={busy || (!isRunning && Boolean(running))}
          onClick={() => onAction(task)}
        >
          {isRunning ? <XCircle size={16} /> : retry ? <RotateCcw size={16} /> : <Sparkles size={16} />}
          {action}
        </button>
        <ResearchDetails id={task.id} />
      </div>
      {retry && (
        <small className="awb-analysis-helper">使用最新账户快照和一天内已保存资料，新建一次分析；原始资料时间保持可查。</small>
      )}
    </section>
  );
}

function AnalysisEmpty({
  state,
  busy,
  canAnalyze,
  onStart,
}: Pick<AnalysisWorkspaceProps, 'state' | 'busy' | 'canAnalyze' | 'onStart'>) {
  const reason = disabledReason(state, undefined, busy);
  return (
    <section className="awb-analysis-card awb-analysis-intro">
      <span className="awb-analysis-kicker"><Sparkles size={14} />ACCOUNT RESEARCH</span>
      <h2>把账户快照，变成可执行的研究结论</h2>
      <p>一次汇总持仓、现金、市场资料与风险约束，形成账户级判断，而不是彼此割裂的个股摘要。</p>
      <ResearchSteps snapshotReady={Boolean(state.snapshot.snapshotId && ['ready', 'empty'].includes(state.snapshot.state))} />
      <div className="awb-analysis-intro-action">
        <button className="primary" disabled={!canAnalyze} onClick={onStart}>
          <Sparkles size={17} />开始账户分析
        </button>
        <small>{reason || '通常需要几分钟；离开页面不会丢失已保存进度。'}</small>
      </div>
    </section>
  );
}

function ReportToolbar({
  state,
  report,
  exporting,
  canAnalyze,
  onSelect,
  onStart,
  onExport,
}: {
  state: WorkbenchState;
  report: AnalysisReport;
  exporting: boolean;
  canAnalyze: boolean;
  onSelect: (report: AnalysisReport) => void;
  onStart: () => void;
  onExport: () => void;
}) {
  return (
    <div className="awb-analysis-toolbar">
      <label>
        <span>历史报告</span>
        <select
          aria-label="历史报告"
          value={report.id}
          onChange={(event) => {
            const value = state.reports.find((item) => item.id === event.target.value);
            if (value) onSelect(value);
          }}
        >
          {state.reports.map((item) => (
            <option key={item.id} value={item.id}>
              {time(item.generatedAt)} · {item.version === 2 ? '主动研究' : '旧版分析'}
            </option>
          ))}
        </select>
      </label>
      <div className="awb-analysis-toolbar-meta">
        <span>{report.model}</span>
        <span>{report.research?.sources ?? report.evidence.length} 个来源</span>
      </div>
      <div className="awb-analysis-toolbar-actions">
        <button disabled={!canAnalyze} onClick={onStart}><RotateCcw size={14} />新建分析</button>
        <a href={`${api}reports/${report.id}/html`}><Download size={14} />HTML</a>
        <button disabled={exporting} onClick={onExport}><Download size={14} />{exporting ? '导出中' : 'PDF'}</button>
      </div>
    </div>
  );
}

function ActiveTaskStrip({
  task,
  busy,
  onAction,
}: {
  task: AnalysisJob;
  busy: boolean;
  onAction: (task: AnalysisJob) => void;
}) {
  const isRunning = task.state === 'running';
  const retry = (task.progress?.modelCalls ?? 0) > 0;
  const label = isRunning ? '取消分析' : retry ? '基于已保存资料重新分析' : '继续完成分析';
  return (
    <section className={`awb-analysis-live-strip ${isRunning ? 'is-running' : retry ? 'is-retry' : 'is-recoverable'}`} aria-live="polite">
      <span className="awb-analysis-state"><i />{jobLabel[task.state]}</span>
      <div>
        <b>{isRunning ? task.progress?.stage ?? '账户分析进行中' : task.error ?? '已有阶段资料等待处理'}</b>
        <small>{task.progress?.covered.length ?? 0}/{task.progress?.total ?? 0} 持仓 · {task.progress?.sources ?? 0} 个来源 · 更新 {time(task.progress?.updatedAt ?? task.startedAt)}</small>
      </div>
      <button disabled={busy} onClick={() => onAction(task)}>{isRunning ? <XCircle size={15} /> : <RotateCcw size={15} />}{label}</button>
    </section>
  );
}

function PriorityActions({ report, onPlan }: { report: AnalysisReport; onPlan: () => void }) {
  const actions = report.content.actions.slice(0, 3);
  return (
    <section className="awb-analysis-card awb-analysis-priorities">
      <div className="awb-analysis-section-head">
        <span className="awb-analysis-kicker"><ShieldCheck size={14} />优先行动</span>
        <small>{actions.length} 项</small>
      </div>
      {actions.length ? actions.map((action, index) => (
        <article key={`${action.symbol}-${index}`}>
          <span>{String(index + 1).padStart(2, '0')}</span>
          <div>
            <h3>{action.symbol} · {actionLabel[action.action]}</h3>
            <small>{action.priority ? `${{ high: '高', medium: '中', low: '低' }[action.priority]}优先级 · ` : ''}{action.horizon === 'short' ? '短期' : '长期'}</small>
            <p>{action.rationale}</p>
          </div>
        </article>
      )) : <p className="awb-muted">本次报告没有给出需要立即执行的动作。</p>}
      <button className="primary awb-full" onClick={onPlan}>
        制定整份调整计划 <ArrowUpRight size={15} />
      </button>
    </section>
  );
}

function ReportDetails({
  report,
  previous,
  onPlan,
}: {
  report: AnalysisReport;
  previous?: AnalysisReport;
  onPlan: () => void;
}) {
  return (
    <div className="awb-analysis-report-grid">
      <main className="awb-stack">
        <section className="awb-analysis-card awb-analysis-narrative">
          <span className="awb-analysis-kicker"><BookOpenText size={14} />研究脉络</span>
          <div className="awb-analysis-narrative-section">
            <small>01 · 宏观与周期定位</small><h3>市场背景</h3><p>{report.content.marketContext}</p>
          </div>
          <div className="awb-analysis-narrative-section">
            <small>02 · 账户现状</small><h3>组合诊断</h3><p>{report.content.accountSummary}</p>
          </div>
          <div className="awb-analysis-narrative-section">
            <small>03 · 风险判断</small><h3>持仓风险</h3><p>{report.content.portfolioRisk}</p>
          </div>
          {report.content.benchmarkComparison && (
            <div className="awb-analysis-narrative-section">
              <small>04 · 相对表现</small><h3>基准比较</h3><p>{report.content.benchmarkComparison}</p>
            </div>
          )}
          <div className="awb-sector-bars">
            {report.metrics?.sectors.map((sector) => (
              <div key={sector.name}>
                <span>{industryLabel(sector.name)}</span><b>{pct(sector.weight)}</b>
                <i style={{ width: `${Math.min(100, sector.weight * 100)}%` }} />
              </div>
            ))}
          </div>
        </section>
        {report.content.holdings.map((holding) => (
          <section className="awb-analysis-card awb-holding-research" key={holding.symbol}>
            <div className="awb-section-heading"><h2>{holding.symbol}</h2><small>短期 + 长期</small></div>
            <p>{holding.background}</p>
            {holding.fact && <p><b>已核实事实</b> {holding.fact}</p>}
            {holding.impact && <p><b>影响机制</b> {holding.impact}</p>}
            <div className="awb-view"><b>短期应对</b><p>{holding.shortTerm}</p></div>
            <div className="awb-view"><b>长期逻辑</b><p>{holding.longTerm}</p></div>
            {holding.counterEvidence && <p className="awb-muted">反对证据 · {holding.counterEvidence}</p>}
            {holding.invalidation && <p className="awb-muted">失效条件 · {holding.invalidation}</p>}
            {holding.support?.map((support, index) => <blockquote className="awb-original-quote" key={index}>{support.quote}</blockquote>)}
            <EvidenceLinks report={report} ids={holding.evidenceIds} />
          </section>
        ))}
      </main>
      <aside className="awb-stack">
        {previous && (
          <details className="awb-analysis-card awb-analysis-compare">
            <summary>与上一份报告对比</summary>
            <p>净资产 {money(previous.snapshot.metrics.netLiquidation)} → {money(report.snapshot.metrics.netLiquidation)}</p>
            <small>净资产变化包含出入金，不等于投资收益。</small>
            {holdingChanges(previous, report).map((change) => <p key={change.conId}>{change.symbol} 数量 {change.before} → {change.after}</p>)}
            <p>上一份结论 · {previous.content.headline ?? previous.content.brief.slice(0, 120)}</p>
          </details>
        )}
        <section className="awb-analysis-card awb-analysis-actions">
          <span className="awb-analysis-kicker">ACTION DETAILS</span>
          <h2>完整行动清单</h2>
          {report.content.actions.map((action, index) => (
            <article className="awb-action-card" key={index}>
              <span className="awb-action-number">{String(index + 1).padStart(2, '0')}</span>
              <div>
                <h3>{action.symbol} · {actionLabel[action.action]}</h3>
                <span className="awb-tag">{action.priority ? `${{ high: '高', medium: '中', low: '低' }[action.priority]}优先级 · ` : ''}{action.horizon === 'short' ? '短期' : '长期'} · 目标 {pct(action.targetWeight)}</span>
                <p>{action.rationale}</p>
                <dl>
                  {action.executionWindow && <><dt>执行窗口</dt><dd>{action.executionWindow}</dd></>}
                  <dt>触发条件</dt><dd>{action.trigger}</dd>
                  {action.riskControl && <><dt>风险控制</dt><dd>{action.riskControl}</dd></>}
                  {action.expectedImpact && <><dt>组合影响</dt><dd>{action.expectedImpact}</dd></>}
                  <dt>反对证据</dt><dd>{action.counterEvidence}</dd>
                  <dt>失效条件</dt><dd>{action.invalidation}</dd>
                </dl>
                <EvidenceLinks report={report} ids={action.evidenceIds} />
              </div>
            </article>
          ))}
          <button className="primary awb-full" onClick={onPlan}>制定整份调整计划 <ArrowUpRight size={15} /></button>
        </section>
        <section className="awb-analysis-card">
          <h2>机会与风险</h2>
          <h3>机会</h3>
          {report.content.opportunities.map((item, index) => <p className="awb-view" key={`opportunity-${index}`}>{item}</p>)}
          <h3>风险</h3>
          {report.content.risks.map((item, index) => <p className="awb-view" key={`risk-${index}`}>{item}</p>)}
        </section>
        <section className="awb-analysis-card">
          <h2>情景分析</h2>
          {report.content.scenarios?.map((scenario) => (
            <article className="awb-view" key={scenario.name}>
              <b>{{ base: '基准情景', upside: '乐观情景', downside: '悲观情景' }[scenario.name]}</b>
              <p>{scenario.assumptions}</p><p>账户影响 · {scenario.accountImpact}</p><p>应对 · {scenario.response}</p>
            </article>
          )) ?? <><p>在调整计划中统一模拟目标仓位、现金与价格涨跌情景。</p><p className="awb-muted">不赋予假设情景概率或预测收益；所有建议合并计算后检查资金约束。</p></>}
        </section>
        {report.content.targetAllocation && (
          <section className="awb-analysis-card">
            <h2>目标配置框架</h2><p>{report.content.targetAllocation}</p>
            {report.content.monitoring?.map((monitor, index) => (
              <div className="awb-view" key={index}><b>{monitor.indicator}</b><p>预警线 · {monitor.warningLine}</p><p>应对 · {monitor.action}</p></div>
            ))}
          </section>
        )}
        <section className="awb-analysis-card awb-analysis-evidence">
          <h2>证据与数据缺口</h2>
          {report.content.gaps.map((gap, index) => <p className="awb-gap" key={`gap-${index}`}>{gap}</p>)}
          {report.content.limitations?.map((gap, index) => <p className="awb-gap" key={`limit-${index}`}>局限 · {gap}</p>)}
          {report.content.disclaimer && <p className="awb-muted">{report.content.disclaimer}</p>}
          <details>
            <summary>查看研究记录</summary>
            {report.research?.trace.map((trace, index) => (
              <p className="awb-trace" key={index}>{trace.ok ? '✓' : '×'} {trace.tool} · {trace.target}<small>{time(trace.at)}</small></p>
            ))}
          </details>
          {report.evidence.map((evidence) => (
            <a className="awb-detail-evidence" key={evidence.id} href={evidence.url} target="_blank" rel="noreferrer">
              {evidence.title}<small>{evidence.source} · 发布 {evidence.publishedAt ? time(evidence.publishedAt) : '未核实'}<br />获取 {time(evidence.fetchedAt)} · {evidence.read ? '已阅读' : '摘要线索'}</small>
            </a>
          ))}
        </section>
      </aside>
    </div>
  );
}

export function AnalysisWorkspace({
  state,
  report,
  task,
  running,
  busy,
  canAnalyze,
  question,
  onQuestion,
  onAsk,
  onStart,
  onTaskAction,
  onSelectTask,
  onSelect,
  onCloseReport,
  onPlan,
}: AnalysisWorkspaceProps) {
  const [view, setView] = useState<'start' | 'history'>('start');
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const previous = report ? state.reports[state.reports.findIndex((item) => item.id === report.id) + 1] : undefined;
  const unfinished = state.jobs.filter((job) => job.state !== 'completed');

  const exportPdf = async () => {
    setExporting(true);
    setError('');
    try {
      if (report) await exportSparkFlowResearchPdf(reportMarkdown(report));
    } catch {
      setError('PDF 导出失败，请使用 HTML');
    } finally {
      setExporting(false);
    }
  };

  const latest = state.reports[0];
  const showingHistory = Boolean(report) || view === 'history';
  const switchView = (next: 'start' | 'history') => { onCloseReport(); setView(next); setError(''); };
  const startAnalysis = () => { switchView('start'); onStart(); };

  return (
    <div className="awb-analysis-workspace">
      <nav className="awb-analysis-tabs" aria-label="研究视图">
        <button aria-pressed={!showingHistory} onClick={() => switchView('start')}><Sparkles size={16} />开始分析</button>
        <button aria-pressed={showingHistory} onClick={() => switchView('history')}><BookOpenText size={16} />历史研究 <small>{state.reports.length}</small></button>
      </nav>
      {error && <p className="awb-message error" role="alert">{error}</p>}
      {report ? (
        <>
          <button className="awb-analysis-back" onClick={() => switchView('history')}><ArrowLeft size={16} />返回历史研究</button>
          <ReportToolbar state={state} report={report} exporting={exporting} canAnalyze={canAnalyze} onSelect={onSelect} onStart={startAnalysis} onExport={() => void exportPdf()} />
          {task && <ActiveTaskStrip task={task} busy={busy} onAction={onTaskAction} />}
          <div className="awb-analysis-command-grid">
            <section className="awb-analysis-card awb-analysis-hero">
              <div className="awb-analysis-hero-meta">
                <span className="awb-analysis-kicker"><Sparkles size={14} />账户研究结论</span>
                <small>{time(report.generatedAt)}</small>
              </div>
              <h2>{report.content.headline ?? '组合判断与研究结论'}</h2>
              <div className="awb-analysis-brief-points">
                {(report.content.briefPoints ?? [report.content.brief]).map((point, index) => (
                  <p key={index}><span>{String(index + 1).padStart(2, '0')}</span>{point}</p>
                ))}
              </div>
              <EvidenceLinks report={report} ids={report.content.evidenceIds} />
            </section>
            <PriorityActions report={report} onPlan={onPlan} />
          </div>
          <ReportDetails report={report} previous={previous} onPlan={onPlan} />
        </>
      ) : showingHistory ? (
        <section className="awb-analysis-history" aria-label="历史研究列表">
          <div className="awb-analysis-history-heading"><div><h2>每一次判断，都有迹可循</h2><p>浏览研究摘要，点击报告查看完整结论与依据。</p></div><span>{state.reports.length} 份研究</span></div>
          {state.reports.length ? <div className="awb-analysis-history-list">
            {state.reports.map(item => (
              <button className="awb-analysis-history-item" key={item.id} onClick={() => onSelect(item)}>
                <span className="awb-analysis-history-meta">{item.kind === 'chat' ? '账户问答' : '组合研究'} · {time(item.generatedAt)}</span>
                <h3>{item.content.headline || item.question || '组合判断与研究结论'}</h3>
                <p>{(item.content.briefPoints?.[0] || item.content.brief || '查看本次账户研究结论').slice(0, 180)}</p>
                <span className="awb-analysis-history-foot"><small>{item.snapshot.positions.length} 个持仓 · {item.research?.sources ?? item.evidence.length} 个来源</small><span>查看完整报告 <ArrowUpRight size={15} /></span></span>
              </button>
            ))}
          </div> : <div className="awb-analysis-history-empty"><BookOpenText size={28} /><h3>还没有历史研究</h3><p>完成首次分析后，报告会自动保存在这里。</p><button onClick={() => switchView('start')}>开始第一份研究 <ArrowUpRight size={15} /></button></div>}
        </section>
      ) : (
        <div className="awb-analysis-home">
          {task && unfinished.length > 1 && (
            <label className="awb-analysis-task-select">分析任务
              <select aria-label="研究任务" value={task.id} disabled={Boolean(running)} onChange={event => onSelectTask(event.target.value)}>
                {unfinished.map(job => <option key={job.id} value={job.id}>{time(job.startedAt)} · {jobLabel[job.state]}</option>)}
              </select>
            </label>
          )}
          <div className="awb-analysis-command-grid">
            {task ? <ResearchTaskCard task={task} running={running} busy={busy} onAction={onTaskAction} />
              : <AnalysisEmpty state={state} busy={busy} canAnalyze={canAnalyze} onStart={startAnalysis} />}
            <CoverageCard state={state} />
          </div>
          {latest && <button className="awb-analysis-latest" onClick={() => onSelect(latest)}>
            <span><small>最近研究 · {time(latest.generatedAt)}</small><b>{latest.content.headline || latest.question || '组合判断与研究结论'}</b><span>{(latest.content.briefPoints?.[0] || latest.content.brief || '').slice(0, 140)}</span></span>
            <span>查看报告 <ArrowUpRight size={16} /></span>
          </button>}
        </div>
      )}
      <div className="awb-analysis-composer">
        <QuickQuestion state={state} running={running} busy={busy} canAnalyze={canAnalyze} question={question} onQuestion={onQuestion} onAsk={onAsk} />
      </div>
    </div>
  );
}
