import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { ndxMonthlySource, peSources, peWindow, type PeHistory, type PeRange, type PeTicker } from '../lib/forwardPe';
import { peekPublicData, publicDataFetch } from '../lib/publicDataClient';
import './ForwardPeCard.css';

const PePlot = lazy(() => import('./ForwardPePlot'));
const multiple = (n?: number) => n === undefined ? '—' : n.toFixed(2) + '×';

export function ForwardPeCard({ ticker, refresh, years, onRangeChange }: {
  ticker: PeTicker; refresh: number; years: PeRange; onRangeChange: (years: PeRange) => void;
}) {
  const url = '/api/risk-radar/forward-pe?ticker=' + ticker;
  const source = peSources[ticker];
  const [data, setData] = useState(() => peekPublicData<PeHistory>(url));
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let pending = false;
    async function load() {
      if (document.hidden || pending) return;
      clearTimeout(timer);
      pending = true;
      let delay = 60_000;
      try {
        const res = await publicDataFetch(url, { cache: 'reload', signal: controller.signal });
        if (!res.ok) throw new Error('暂时无法读取估值');
        const next: PeHistory = await res.json();
        if (next.ticker !== ticker || !next.consensus?.length || !next.reports?.length) throw new Error('估值记录不完整');
        if (!controller.signal.aborted) { setData(next); setFailed(false); }
        if (next._publicCache?.state !== 'stale') delay = 3600_000;
      } catch {
        if (!controller.signal.aborted) {
          setFailed(true);
          setData(previous => previous?._publicCache?.expiresAt && Date.parse(previous._publicCache.expiresAt) <= Date.now() ? undefined : previous);
        }
      } finally {
        pending = false;
        if (!controller.signal.aborted) timer = setTimeout(load, delay);
      }
    }
    void load();
    document.addEventListener('visibilitychange', load);
    return () => { controller.abort(); clearTimeout(timer); document.removeEventListener('visibilitychange', load); };
  }, [url, ticker, refresh, attempt]);
  const view = useMemo(() => data?.ticker === ticker && data.reports?.length ? peWindow(data, years) : undefined, [data, ticker, years]);
  const stats = view?.stats;
  const stale = view && Date.now() - Date.parse(view.latest.date) > 35 * 86400_000;
  return <section id="forward-pe" className="etf-gravity forward-pe" aria-labelledby="forward-pe-title" aria-busy={!data && !failed}>
    <header className="etf-gravity-head"><h2 id="forward-pe-title">{ticker} 前瞻市盈率</h2>
      <div className="pe-ranges" role="group" aria-label="估值历史范围">{([5, 10, 'all'] as const).map(n =>
        <button type="button" key={n} aria-pressed={n === years} onClick={() => onRangeChange(n)}>{n === 'all' ? '全部' : '近 ' + n + ' 年'}</button>)}</div>
    </header>
    {view ? <>
      <div className="pe-dateline">{source.index}指数 · 未来 12 个月盈利预期 · 观测日 <time dateTime={view.latest.date}>{view.latest.date}</time>
        {(failed || stale || data?.checkFailed || data?._publicCache?.state === 'stale') && <span className="etf-gravity-stale"> · {failed || data?.checkFailed ? '更新检查未完成，显示已核实报告' : stale ? '距最新观测已超过五周' : '缓存待更新'}</span>}</div>
      <dl className="etf-gravity-metrics"><div><dt>最新估值 · Nasdaq 报告</dt><dd>{multiple(view.latest.value)}</dd></div>
        <div><dt>历史参考分位（约）</dt><dd>{stats ? stats.percentile.toFixed(1) + '%' : '—'}</dd></div>
        <div><dt>历史中位数</dt><dd>{multiple(stats?.median)}</dd></div>
        <div><dt>中间 50% 区间</dt><dd>{stats ? stats.q1.toFixed(1) + '–' + stats.q3.toFixed(1) + '×' : '—'}</dd></div></dl>
      <Suspense fallback={<div className="etf-gravity-empty">正在绘制估值曲线…</div>}><PePlot view={view} /></Suspense>
      <div className="pe-legend"><span><i/>前瞻市盈率</span><span><i className="pe-median"/>历史中位数</span><span><i className="pe-band"/>中间 50% 区间</span>
        {view.monthlyReference.length > 0 && <span className="pe-monthly-reference"><i/>月度补录</span>}</div>
      {view.monthlyReference.length > 0 && <p className="pe-coverage">
        {view.monthlyReference[0].month} 至 {view.monthlyReference[view.monthlyReference.length - 1].month} 期间，主源缺失的 {view.monthlyReference.length} 个月以
        {' '}<a href={ndxMonthlySource} target="_blank" rel="noreferrer">Trendonify 月度数据 ↗</a> 补充。{stats && '历史统计仅采用主源的 ' + stats.count + ' 个有效月份。'}
      </p>}
    </> : <div className="etf-gravity-empty" role="status">{failed ? '暂时无法读取前瞻市盈率' : '正在读取估值历史…'}
      {failed && <button type="button" onClick={() => setAttempt(n => n + 1)}>重试</button>}</div>}
    <footer className="etf-gravity-foot"><details><summary>三张图怎么看 · 数据口径</summary>
      <p>上方 TWAP 比较价格与 200 周均价。本图比较价格与未来一年的预期盈利。下方双层风险走势把潜在脆弱性和即时市场压力放在一起，可切换查看哪一层正在升高。</p>
      <p>估值跌破阴影下沿，说明相对自身历史偏低。价格下跌或盈利预期上调都能压低倍数；若盈利预期随后下修，倍数也可能回升。本图独立于风险总分。</p>
      {data && view && <><p>绿线在 {data.reports[0].date} 之前采用 History of Market 的历史一致预期，之后连接 Nasdaq 双周报告中 {source.index}指数的 NTM P/E 观测值。横轴采用报告表内的数据日期。两期之间的线段只连接已公布的点。悬停可查看日期、倍数和来源。</p>
      {view.gaps.size > 0 && <p>{[...view.gaps].map(([end, start]) => start + ' 至 ' + end).join('、')} 期间缺少连续观测，曲线在两端之间留空。</p>}
      <p>历史参考取所选区间内每月最后一笔指数估值，各月等权，剔除最新观测所在月。{stats && '本区间有 ' + stats.count + ' 个有效月份，统计至 ' + stats.lastMonth + '。'}分位是其中估值小于或等于最新倍数的月份占比。</p></>}
    </details><div>{view && <a href={view.latest.url} target="_blank" rel="noreferrer">Nasdaq 最新报告 ↗</a>}
      <a href={source.page} target="_blank" rel="noreferrer">历史数据 · History of Market ↗</a>
      <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a></div></footer>
  </section>;
}
