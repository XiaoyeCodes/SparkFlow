import { lazy, Suspense, useEffect, useState } from 'react';
import { ArrowUpRight, RefreshCw } from 'lucide-react';
import type { GravityHistory, GravitySymbol } from '../lib/etfGravity';
import { peekPublicData, publicDataFetch } from '../lib/publicDataClient';
import './EtfGravityCard.css';

const GravityPlot = lazy(() => import('./EtfGravityPlot'));
const references = {
  SPY: 'https://cryptoweeklies.com/SPY_Equities_TWAP',
  QQQ: 'https://cryptoweeklies.com/QQQ_Gravity_Analysis',
};
const money = (value: number) => `$${value.toFixed(2)}`;
const percent = (value: number) => `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;

export function EtfGravityCard({ symbol, refresh }: { symbol: GravitySymbol; refresh: number }) {
  const url = `/api/risk-radar/gravity?ticker=${symbol}`;
  const [history, setHistory] = useState(() => peekPublicData<GravityHistory>(url));
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let busy = false;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      if (document.hidden || busy) return;
      clearTimeout(timer);
      busy = true;
      let next = 30_000;
      try {
        const response = await publicDataFetch(url, { signal: controller.signal, cache: 'reload' });
        if (!response.ok) throw new Error('行情暂不可用');
        const data: GravityHistory = await response.json();
        if (data.symbol !== symbol || !data.points?.length || !(Date.parse(data.validUntil) > Date.now())) throw new Error('行情已过期');
        if (!controller.signal.aborted) {
          setHistory(data);
          setFailed(false);
          if (data._publicCache?.state !== 'stale') next = Math.min(3600_000, Date.parse(data.validUntil) - Date.now());
        }
      } catch {
        if (!controller.signal.aborted) {
          setFailed(true);
          setHistory(previous => previous && Date.parse(previous.validUntil) > Date.now() ? previous : undefined);
        }
      } finally {
        busy = false;
        if (!controller.signal.aborted) timer = setTimeout(load, next);
      }
    };
    void load();
    document.addEventListener('visibilitychange', load);
    return () => { controller.abort(); clearTimeout(timer); document.removeEventListener('visibilitychange', load); };
  }, [url, symbol, attempt, refresh]);

  const last = history?.points[history.points.length - 1];
  const spy = symbol === 'SPY';
  const metrics = last ? [
    { label: '收盘价', value: money(last.close) },
    { label: '200 周 TWAP', value: money(last.twap) },
    { label: '溢价 / 折价', value: percent(last.premium), tone: last.premium >= 0 ? 'positive' : 'negative' },
    { label: '重力风险', value: `${last.score.toFixed(1)}/100`, tone: 'score' },
    ...(spy && last.vwap !== null ? [
      { label: 'VWAP · 2020 年起', value: money(last.vwap), accent: true },
      { label: '相对 VWAP', value: percent((last.close / last.vwap - 1) * 100), accent: true,
        tone: last.close >= last.vwap ? 'positive' : 'negative' },
    ] : [{ label: '风险等级', value: `${last.level}/10` }]),
  ] : [];
  return <section className="etf-gravity" aria-busy={!history && !failed} aria-labelledby={`gravity-${symbol}`} id={`etf-gravity-${symbol.toLowerCase()}`}>
    <header className="etf-gravity-head">
      <h2 id={`gravity-${symbol}`}>{spy ? 'SPY TWAP 重力风险模型' : 'QQQ 对数价格与时间重力'}</h2>
      <div>{spy && <span className="etf-gravity-proxy">VOO 的标普 500 历史代理</span>}
        {(failed || history?._publicCache?.state === 'stale') && <span className="etf-gravity-stale">{failed ? '更新失败' : '正在核实缓存'}</span>}
        {last && <time dateTime={last.date}>{last.date} 收盘</time>}</div>
    </header>
    {history && last ? <>
      <dl className="etf-gravity-metrics">{metrics.map(metric => <div key={metric.label} className={'accent' in metric ? 'is-vwap' : undefined}>
        <dt>{metric.label}</dt><dd className={metric.tone}>{metric.value}</dd>
      </div>)}</dl>
      <Suspense fallback={<div className="etf-gravity-empty">正在绘制价格走势…</div>}><GravityPlot history={history} /></Suspense>
    </> : <div className="etf-gravity-empty" role="status">{failed ? '暂时无法读取历史行情' : '正在读取上市以来的日线…'}
      {failed && <button type="button" onClick={() => setAttempt(value => value + 1)}><RefreshCw size={13}/> 重试</button>}</div>}
    <footer className="etf-gravity-foot">
      <details><summary>计算口径</summary><p>按美股已收盘的复权日线计算。TWAP 取过去 200 个自然周内交易日收盘价的算术平均。将收盘价相对 TWAP 的溢价，按全历史第 1、99 百分位截断并线性映射为 0–100 分，每 10 分一档。历史颜色会随全样本更新。2020 年前显示每周最后一个交易日，此后显示每日。</p>
        {spy && <p>VWAP 从 2020 年首个交易日累计，以成交量加权每日复权最高价、最低价与收盘价的均值。</p>}</details>
      <div><a href={`https://finance.yahoo.com/quote/${symbol}/history/`} target="_blank" rel="noreferrer">Yahoo Finance <ArrowUpRight size={12}/></a>
        <a href={references[symbol]} target="_blank" rel="noreferrer">参考图表 <ArrowUpRight size={12}/></a></div>
    </footer>
  </section>;
}
