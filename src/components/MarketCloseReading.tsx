import { useEffect, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { CloseMarket, CloseReportState } from '../lib/marketCloseTypes';
import './MarketCloseReading.css';

export function MarketCloseReading({ children }: { children: ReactNode }) {
  const [kind, setKind] = useState<'day1' | CloseMarket>('day1');
  const [data, setData] = useState<CloseReportState | null>(null), [error, setError] = useState(''), [submitting, setSubmitting] = useState(false);
  useEffect(() => {
    setData(null); setError('');
    if (kind === 'day1') return;
    const controller = new AbortController();
    let busy = false;
    const load = async () => {
      if (busy) return; busy = true;
      try { const r = await fetch(`/api/market-close?market=${kind}`, { signal: controller.signal }); if (!r.ok) throw new Error('收盘总结暂时无法读取'); const value = await r.json(); if (!controller.signal.aborted) { setData(value); setError(''); } }
      catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : '读取失败'); } finally { busy = false; }
    };
    void load(); const timer = setInterval(() => void load(), 10000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [kind]);
  async function generate() {
    if (kind === 'day1') return;
    const market = kind; setSubmitting(true); setError('');
    try { const r = await fetch(`/api/market-close?market=${market}&refresh=1`, { method: 'POST' }); const value = await r.json(); if (!r.ok) throw new Error(value.detail || '生成请求失败'); setData(value); }
    catch (e) { setError(e instanceof Error ? e.message : '生成请求失败'); } finally { setSubmitting(false); }
  }
  const current = data?.market === kind ? data : null;
  const at = (date?: string | null) => date ? new Date(date).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '待确认';
  return <div className="editorial-intelligence">
    <div className="editorial-intelligence-head"><div><span>AI MARKET READING</span><select className="market-reading-select" aria-label="简报类型" value={kind} onChange={e => setKind(e.target.value as typeof kind)}><option value="day1">Day1 Global 深度解读</option><option value="cn">A股收盘总结</option><option value="us">美股收盘总结</option></select></div><em>AI 生成</em></div>
    {kind === 'day1' ? children : <div className="market-close-reading">
      <div className="market-close-toolbar"><span>{kind === 'cn' ? '交易日 15:10（北京时间）' : '交易日收盘后 10 分钟 · 纽约交易时间'}<small>下次生成：{at(current?.nextRunAt)}（北京时间）</small></span><button type="button" onClick={() => void generate()} disabled={submitting || !current?.dueDate || current.status === 'running' || current.attempts >= 3}>{submitting || current?.status === 'running' ? '正在生成…' : current?.report?.date === current?.dueDate && current?.report ? '重新生成' : current?.status === 'failed' ? '重新生成' : '生成最近收盘总结'}</button></div>
      {error || current?.error ? <p className="market-close-error" role="alert">{error || current?.error}</p> : null}
      {current?.status === 'running' && <p role="status">{current.dueDate} · {current.stage || '任务已开始'}，完成后自动显示。</p>}
      {current && !current.calendarSupported && <p role="status">交易日历尚未覆盖当前年份，自动生成已暂停。</p>}
      {current?.report ? <>
        <div className="market-close-meta"><span>交易日 {current.report.date}</span><span>{current.report.model} · {at(current.report.generatedAt)}</span></div>
        {current.report.date !== current.dueDate && <p className="market-close-previous">当前展示上期报告，本期尚未生成。</p>}
        <article className="market-close-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ children, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer">{children}</a> }}>{current.report.markdown}</ReactMarkdown></article>
        <details className="market-close-sources"><summary>研究来源与获取时间 · {current.report.sources.length} 条</summary>{current.report.sources.map(source => <div key={source.id}><a href={source.url} target="_blank" rel="noopener noreferrer">{source.id} · {source.title}</a><small>发布 {source.publishedAt} · 获取 {at(source.fetchedAt)}</small></div>)}</details>
      </> : !error && current?.status !== 'running' ? <p className="market-close-empty">{current ? '暂无已生成的收盘总结。交易日收盘后自动生成，也可生成最近一个交易日的总结。' : '正在读取收盘总结…'}</p> : null}
      <p className="market-close-service-note">后台随本机服务运行，关闭网页不影响定时生成；电脑或服务关闭期间暂停。资料缺失会明确标注。</p>
    </div>}
  </div>;
}
