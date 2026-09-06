import { useEffect, useRef, useState } from 'react';
import { cancelBacktestJob, loadBacktestWorkspace, type BacktestJob, type BacktestResult, type StrategyRecord } from '../../lib/ibkr/backtestClient';
import { BacktestResults } from './BacktestResults';
import type { Snapshot } from '../../lib/ibkr/types';
import { loadStrategyRuntime, stopStrategyRuntime, type StrategyActivation } from '../../lib/ibkr/strategyRuntime';
import { StrategyDraftEditor } from './StrategyDraftEditor';

export function StrategyWorkspace({ snapshot }: { snapshot: Snapshot }) {
  const [strategies, setStrategies] = useState<StrategyRecord[]>([]);
  const [runs, setRuns] = useState<BacktestResult[]>([]);
  const [jobs, setJobs] = useState<BacktestJob[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [detail, setDetail] = useState('');
  const request = useRef<AbortController | null>(null);
  const [activations, setActivations] = useState<StrategyActivation[]>([]);
  const [runtimeDetail, setRuntimeDetail] = useState('');

  const load = async () => {
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    setState('loading'); setDetail('');
    try {
      const value = await loadBacktestWorkspace(controller.signal);
      setStrategies(value.strategies); setRuns(value.runs); setJobs(value.jobs); setState('ready');
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      setState('error'); setDetail(error instanceof Error && error.message === 'BACKTESTS_DISABLED'
        ? '本地回测目录尚未启用。' : '回测服务不可用或返回格式无效。');
    }
  };
  useEffect(() => { void load(); return () => request.current?.abort(); }, []);
  useEffect(() => {
    setActivations([]); setRuntimeDetail('');
    if (!snapshot.snapshotId || snapshot.connection !== 'connected') return;
    const controller = new AbortController();
    loadStrategyRuntime(snapshot, controller.signal).then(setActivations).catch(error => {
      if (error instanceof Error && error.name !== 'AbortError') setRuntimeDetail('策略运行未配置或状态不可用。');
    });
    return () => controller.abort();
  }, [snapshot.mode, snapshot.accountKey, snapshot.snapshotId, snapshot.connection]);

  const cancel = async (job: BacktestJob) => {
    try {
      const next = await cancelBacktestJob(job.jobId);
      setJobs(rows => rows.map(row => row.jobId === next.jobId ? next : row));
    } catch { setDetail('取消请求失败；任务状态未作假设，请刷新核对。'); }
  };
  const users = strategies.filter(row => row.definition.origin === 'user');
  const stopRuntime = async (activation: StrategyActivation) => {
    try { const next = await stopStrategyRuntime(snapshot, activation); setActivations(rows => rows.map(row => row.activationId === next.activationId ? next : row)); }
    catch { setRuntimeDetail('停止请求未确认；请刷新并核对运行状态。'); }
  };

  return <div className="ibkr-strategy-workspace" data-testid="strategy-workspace">
    <div className="ibkr-strategy-gates"><div><span>用户策略</span><b>{users.length ? `${users.length} 个不可变版本` : '尚未提供'}</b></div><div><span>版本化数据</span><b>尚未配置生产数据集</b></div><div><span>运行通道</span><b>声明式 · 独立 worker · 无交易权限</b></div></div>
    <div className="ibkr-strategy-actions"><p>工程示例与用户策略分开保存。回测结果不授予 paper 或 live 交易权限。</p><button disabled>运行回测 · 等待策略与数据源</button><button onClick={() => void load()} disabled={state === 'loading'}>刷新结果</button></div>
    <StrategyDraftEditor snapshot={snapshot} />
    <section><h2>模拟盘运行</h2><p>停止只禁止新增信号，不会自动撤单或平仓。启动和恢复需要独立策略授权及最新账户对账。</p>
      {runtimeDetail && <p className="ibkr-backtest-error" role="status">{runtimeDetail}</p>}
      {activations.length ? <div className="ibkr-job-list">{activations.map(activation => <div key={activation.activationId}><span>{activation.strategyId}<small>{activation.activationId}</small></span><b>{activation.state}</b><small>信号 {activation.lastSignalSequence} · 至 {new Date(activation.expiresAt).toLocaleString('zh-CN', { hour12: false })}</small>{activation.testData && <strong>工程示例</strong>}{['RUNNING', 'PAUSED', 'RECOVERY_REQUIRED'].includes(activation.state) && <button onClick={() => void stopRuntime(activation)}>停止新增信号</button>}{activation.reason && <code>{activation.reason}</code>}</div>)}</div> : <p>没有已授权的策略运行实例。</p>}
    </section>
    {state === 'loading' && <p role="status">正在读取本地回测目录…</p>}
    {state === 'error' && <p className="ibkr-backtest-error" role="status">{detail}</p>}
    {state === 'ready' && <>
      <section><h2>策略版本</h2>{strategies.length ? <div className="ibkr-strategy-list">{strategies.map(row => <article key={`${row.definition.strategyId}:${row.definition.version}`}><div><b>{row.definition.name}</b>{row.definition.origin === 'fixture' && <strong>工程示例</strong>}</div><span>{row.definition.strategyId} · v{row.definition.version} · {row.definition.barInterval}</span><p>{row.definition.entryRule}</p><p>{row.definition.exitRule}</p><small>SMA {row.definition.signal.fastWindow}/{row.definition.signal.slowWindow} · 目标 {row.definition.positionSizing.targetQuantity} 股 · 最大 {row.definition.risk.maxPositionQuantity} 股 · 做空关闭</small><code>{row.strategyHash}</code></article>)}</div> : <p>尚无策略版本。需要用户提供明确规则、周期与参数。</p>}</section>
      {jobs.length > 0 && <section><h2>任务状态</h2><div className="ibkr-job-list">{jobs.map(job => <div key={job.jobId}><span>{job.jobId}</span><b>{job.state}</b>{['PENDING', 'RUNNING'].includes(job.state) && <button onClick={() => void cancel(job)}>取消任务</button>}{job.errorCode && <code>{job.errorCode}</code>}</div>)}</div></section>}
      <section><h2>历史结果</h2><BacktestResults runs={runs} /></section>
    </>}
  </div>;
}
