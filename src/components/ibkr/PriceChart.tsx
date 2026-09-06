import { useEffect, useRef, useState } from 'react';
import { ChartNoAxesCombined } from 'lucide-react';
import { CandlestickSeries, ColorType, createChart, type IChartApi, type UTCTimestamp } from 'lightweight-charts';
import { formatDecimal } from '../../lib/ibkr/store';
import type { Quote, Snapshot } from '../../lib/ibkr/types';
import { getHistoricalData, type ChartPeriod, type HistoricalDataset } from '../../lib/ibkr/marketData';

import { MarketQuote, type MarketInstrument } from './MarketWatch';

export function PriceChart({ snapshot, position, quote, watch = false }: { snapshot: Snapshot; position: MarketInstrument | null; quote?: Quote; watch?: boolean }) {
  const [period, setPeriod] = useState<ChartPeriod>('1D');
  const [data, setData] = useState<HistoricalDataset | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const container = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const status = { realtime: '实时', delayed: '延迟', frozen: '冻结', disconnected: '断线', missing: '缺失' };
  useEffect(() => {
    setData(null); setError(''); setLoading(false);
    if (!position || !snapshot.snapshotId) return;
    const controller = new AbortController();
    setLoading(true);
    getHistoricalData(snapshot, position, period, controller.signal).then(setData).catch(reason => {
      if (reason?.name !== 'AbortError') setError(reason instanceof Error ? reason.message : '历史行情不可用。');
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [snapshot.mode, snapshot.accountKey, snapshot.sessionRevision, position?.conId, period, refresh]);
  useEffect(() => {
    if (!container.current || !data || !data.bars.length) return;
    const api = createChart(container.current, { autoSize: true, layout: { background: { type: ColorType.Solid, color: '#050d0f' }, textColor: '#78978d', fontSize: 10 },
      grid: { vertLines: { color: '#10211d' }, horzLines: { color: '#10211d' } }, rightPriceScale: { borderColor: '#234039' }, timeScale: { borderColor: '#234039', timeVisible: period === '1D' || period === '5D' } });
    chart.current = api;
    const series = api.addSeries(CandlestickSeries, { upColor: '#67dbc1', downColor: '#e06c75', borderVisible: false, wickUpColor: '#67dbc1', wickDownColor: '#e06c75' });
    series.setData(data.bars.map(bar => ({ time: Math.floor(Date.parse(bar.time) / 1000) as UTCTimestamp, open: Number(bar.open), high: Number(bar.high), low: Number(bar.low), close: Number(bar.close) })));
    api.timeScale().fitContent();
    return () => { chart.current = null; api.remove(); };
  }, [data, period]);
  return <section className="ibkr-chart" aria-label="行情图表"><div className="ibkr-chart-toolbar"><div><b data-testid="chart-symbol">{position?.symbol || '选择合约'}</b><strong>{formatDecimal(quote?.price)}</strong><span className="ibkr-pill">{quote ? status[quote.state] : '行情未接入'}</span></div><div className="ibkr-tabs">{(['1D', '5D', '1M', '6M', '1Y'] as ChartPeriod[]).map(item => <button key={item} aria-pressed={period === item} onClick={() => setPeriod(item)}>{item}</button>)}</div></div>
    {position && <button onClick={() => setRefresh(value => value + 1)} disabled={loading}>刷新历史行情</button>}
    {watch && position && <MarketQuote snapshot={snapshot} instrument={position} />}
    <div className="ibkr-chart-canvas">{data?.bars.length ? <><div ref={container} data-testid="historical-chart" className="ibkr-chart-render" /><small className="ibkr-chart-source">{data.source} · {data.bars.length.toLocaleString('en-US')} 根 · {data.barSize} · {data.state === 'stale' ? '缓存已过期' : data.testData ? '工程行情' : '只读行情'}</small></> : <div className="ibkr-chart-message"><ChartNoAxesCombined size={32} strokeWidth={1} /><h2>{position ? `${position.symbol} · ${period}` : '从持仓或搜索选择合约'}</h2><p>{error || (loading ? '正在读取历史行情' : data?.state === 'permission-required' ? '历史行情权限未配置' : data?.state === 'empty' ? '所选区间无行情' : data?.state === 'stale' ? '历史行情缓存已过期' : '历史行情尚未接入')}</p><small>{data ? `${data.source} · ${data.missing.join('、') || '无可用 K 线'}` : '接入后显示来源、时效与交易时段'}</small></div>}</div>
  </section>;
}
