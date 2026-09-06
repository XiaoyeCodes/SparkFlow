import { useEffect, useRef, useState } from 'react';
import { ArrowUp, LockKeyhole } from 'lucide-react';
import type { Snapshot } from '../../lib/ibkr/types';
import { cancelReportJob, createReportJob, getReportJob, loadAccountInsights, loadReports, reportUrl, type AiStatus, type ReportJob, type ReportMetadata, type RiskAnalysis } from '../../lib/ibkr/insights';
import { fetchNewsEvidence } from '../../lib/ibkr/newsEvidence';
import { fetchMacroEvidence } from '../../lib/ibkr/macroEvidence';
import { buildReportEvidence } from '../../lib/ibkr/reportEvidence';

const percent = (value: string | null) => value === null ? '数据缺失' : `${(Number(value) * 100).toFixed(2)}%`;
const pollDelay = (signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  const aborted = () => { window.clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); };
  const timer = window.setTimeout(() => { signal.removeEventListener('abort', aborted); resolve(); }, 150);
  signal.addEventListener('abort', aborted, { once: true });
});

export function AccountAiPanel({ snapshot }: { snapshot: Snapshot }) {
  const [risk, setRisk] = useState<RiskAnalysis | null>(null);
  const [ai, setAi] = useState<AiStatus | null>(null);
  const [reports, setReports] = useState<ReportMetadata[]>([]);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [job, setJob] = useState<ReportJob | null>(null);
  const jobRequest = useRef<AbortController | null>(null);
  const available = snapshot.connection === 'connected' && (snapshot.state === 'ready' || snapshot.state === 'empty') && Boolean(snapshot.snapshotId);
  useEffect(() => {
    jobRequest.current?.abort();
    setRisk(null); setAi(null); setReports([]); setJob(null); setError('');
    if (!available) return;
    const controller = new AbortController();
    loadAccountInsights(snapshot, controller.signal).then(value => {
      setRisk(value.risk); setAi(value.ai); setReports(value.reports);
    }).catch(reason => { if (reason?.name !== 'AbortError') setError(reason instanceof Error ? reason.message : '本地分析服务不可用。'); });
    return () => { controller.abort(); jobRequest.current?.abort(); };
  }, [snapshot.mode, snapshot.accountKey, snapshot.snapshotId, available]);
  const create = async () => {
    const controller = new AbortController(); jobRequest.current?.abort(); jobRequest.current = controller;
    setCreating(true); setError('');
    try {
      const [news, macro] = await Promise.allSettled([fetchNewsEvidence(controller.signal), fetchMacroEvidence(controller.signal)]);
      const evidence = buildReportEvidence(snapshot, news.status === 'fulfilled' ? news.value : null,
        macro.status === 'fulfilled' ? macro.value : null);
      let current = await createReportJob(snapshot, controller.signal, evidence); setJob(current);
      while (!['COMPLETED', 'FAILED', 'CANCELLED', 'INTERRUPTED'].includes(current.state)) {
        await pollDelay(controller.signal);
        current = await getReportJob(snapshot, current.jobId, controller.signal); setJob(current);
      }
      if (current.state !== 'COMPLETED' || !current.reportHash) throw new Error(`报告任务${current.state}：${current.errorCode || '未生成产物'}`);
      setReports(await loadReports(snapshot, controller.signal));
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : '报告生成失败。'); }
    finally { if (jobRequest.current === controller) jobRequest.current = null; setCreating(false); }
  };
  const cancel = async () => {
    if (!job || !['PENDING', 'RUNNING', 'CANCEL_REQUESTED'].includes(job.state)) return;
    const controller = new AbortController();
    try { setJob(await cancelReportJob(snapshot, job.jobId, controller.signal)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '取消报告任务失败。'); }
  };
  const latest = reports[0];
  const unavailable = snapshot.state === 'stale' ? '账户快照已过期，已暂停分析。'
    : snapshot.state === 'permission-required' ? '缺少账户读取权限，无法计算风险。'
    : snapshot.state === 'error' ? '账户同步失败，无法计算风险。'
    : snapshot.state === 'loading' || (available && !risk && !error) ? '正在读取可追溯风险指标。'
    : '未计算 · 不以固定分数替代分析';
  return <aside className="ibkr-ai" data-testid="account-ai" aria-label="账户 AI 分析">
    <section className="ibkr-card"><h2>账户健康度</h2><div className="ibkr-health"><span className="ibkr-empty-ring">—</span><div><b>不足以评分</b><small>{risk ? '风险指标可追溯；波动与相关性数据缺失' : '等待完整快照与可追溯风险指标'}</small></div></div></section>
    <section className="ibkr-card"><h2>确定性风险</h2>{risk ? <dl className="ibkr-ai-metrics">
      <div><dt>总敞口</dt><dd>{risk.metrics.grossExposure.value ?? '数据缺失'} {risk.metrics.grossExposure.unit}</dd></div>
      <div><dt>净敞口</dt><dd>{risk.metrics.netExposure.value ?? '数据缺失'} {risk.metrics.netExposure.unit}</dd></div>
      <div><dt>最大仓位</dt><dd>{percent(risk.metrics.largestPositionWeight.value)}</dd></div>
      <div><dt>保证金使用</dt><dd>{percent(risk.metrics.marginUsage.value)}</dd></div>
    </dl> : <div className="ibkr-risk-empty"><div className="ibkr-radar-grid">{error || ['error', 'permission-required', 'stale'].includes(snapshot.state) ? '不可用' : '暂无数据'}</div><small>{error || unavailable}</small></div>}</section>
    <section className="ibkr-card"><h2>快捷分析</h2><div className="ibkr-ai-actions"><button onClick={create} disabled={!available || creating}>{creating ? '正在生成…' : '生成本地报告'}</button>{job && ['PENDING', 'RUNNING', 'CANCEL_REQUESTED'].includes(job.state) ? <button onClick={cancel}>取消报告</button> : <button disabled>情景模拟</button>}<button disabled>风险解释</button></div>
      {job && <small className="ibkr-report-job">报告任务 {job.state}{job.errorCode ? ` · ${job.errorCode}` : ''}</small>}
      {latest && <div className="ibkr-report-links"><small>{latest.testData ? '工程测试报告' : '只读账户报告'} · {latest.status}</small><div>{latest.formats.map(kind => <a key={kind} href={reportUrl(latest, kind)}>{kind === 'markdown' ? 'Markdown' : kind.toUpperCase()}</a>)}</div></div>}
    </section>
    <section className="ibkr-ai-chat"><h2>AI 分析助手 <LockKeyhole size={12} /></h2><div className="ibkr-chat-message">{ai?.sharingEnabled ? `已授权 ${ai.activeGrant?.provider} / ${ai.activeGrant?.model}；尚未调用模型。` : '账户数据分享已关闭。'}<p>{ai?.sharingEnabled ? `允许字段：${ai.activeGrant?.fields.join('、')}` : '选择账户、模型与字段范围后，才能发送账户上下文。'}</p><small>分析与报告只读，交易需要独立授权。</small></div></section>
    <form className="ibkr-chat-input" onSubmit={event => event.preventDefault()}><input aria-label="账户 AI 消息" placeholder="请先授权账户分析…" disabled /><button aria-label="发送账户 AI 消息" disabled><ArrowUp size={16} /></button></form>
  </aside>;
}
