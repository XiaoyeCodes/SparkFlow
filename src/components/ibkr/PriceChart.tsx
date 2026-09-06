import { useEffect, useRef, useState } from 'react';
import {
  CandlestickSeries,
  ColorType,
  HistogramSeries,
  LineSeries,
  createChart,
  type IChartApi,
  type UTCTimestamp,
} from 'lightweight-charts';
import { ChartNoAxesCombined } from 'lucide-react';
import { formatDecimal } from '../../lib/ibkr/store';
import type { Quote, Snapshot } from '../../lib/ibkr/types';
import { getHistoricalData, type ChartPeriod, type HistoricalBar, type HistoricalDataset } from '../../lib/ibkr/marketData';

import { MarketQuote, type MarketInstrument } from './MarketWatch';

type HoverBar = {
  time: UTCTimestamp;
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  previousClose: number | null;
  volume: number | null;
  x: number;
  y: number;
};

const MA_WINDOWS = [5, 10, 20] as const;

function numeric(value: string | null | undefined) {
  if (value == null || !/^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatChartNumber(value: number | null, maximumFractionDigits = 3) {
  if (value == null || !Number.isFinite(value)) return '—';
  return value.toLocaleString('en-US', { maximumFractionDigits });
}

function formatSigned(value: number | null, suffix = '') {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${value > 0 ? '+' : ''}${formatChartNumber(value, 3)}${suffix}`;
}

function averageAt(bars: Array<{ close: number; time: UTCTimestamp }>, index: number, window: number) {
  if (index + 1 < window) return null;
  const values = bars.slice(index + 1 - window, index + 1).map((bar) => bar.close);
  const value = values.reduce((total, item) => total + item, 0) / values.length;
  return Number.isFinite(value) ? value : null;
}

function lineData(bars: Array<{ close: number; time: UTCTimestamp }>, window: number) {
  return bars.flatMap((bar, index) => {
    const value = averageAt(bars, index, window);
    return value == null ? [] : [{ time: bar.time, value }];
  });
}

function chartBars(data: HistoricalDataset) {
  return data.bars.flatMap((bar: HistoricalBar, index) => {
    const open = numeric(bar.open);
    const high = numeric(bar.high);
    const low = numeric(bar.low);
    const close = numeric(bar.close);
    const volume = numeric(bar.volume);
    const time = Math.floor(Date.parse(bar.time) / 1000) as UTCTimestamp;
    if ([open, high, low, close].some((value) => value == null) || !Number.isFinite(time)) return [];
    return [{
      time,
      date: bar.time,
      open: open!,
      high: high!,
      low: low!,
      close: close!,
      previousClose: index > 0 ? numeric(data.bars[index - 1].close) : null,
      volume,
    }];
  });
}

function barLabel(bar: HoverBar, field: 'open' | 'close' | 'high' | 'low') {
  return formatChartNumber(bar[field]);
}

export function PriceChart({ snapshot, position, quote, watch = false }: { snapshot: Snapshot; position: MarketInstrument | null; quote?: Quote; watch?: boolean }) {
  const [period, setPeriod] = useState<ChartPeriod>('1D');
  const [data, setData] = useState<HistoricalDataset | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [hoverBar, setHoverBar] = useState<HoverBar | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const status = { realtime: '实时', delayed: '延迟', frozen: '冻结', disconnected: '断线', missing: '缺失' };

  useEffect(() => {
    setData(null); setError(''); setLoading(false); setHoverBar(null);
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
    const api = createChart(container.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: '#050d0f' }, textColor: '#78978d', fontSize: 10 },
      grid: { vertLines: { color: '#10211d' }, horzLines: { color: '#10211d' } },
      rightPriceScale: { borderColor: '#234039' },
      timeScale: { borderColor: '#234039', timeVisible: period === '1D' || period === '5D' },
      crosshair: { vertLine: { color: '#7da99b', width: 1, style: 3 }, horzLine: { color: '#7da99b', width: 1, style: 3 } },
    });
    chart.current = api;
    const bars = chartBars(data);
    const candles = api.addSeries(CandlestickSeries, { upColor: '#67dbc1', downColor: '#e06c75', borderVisible: false, wickUpColor: '#67dbc1', wickDownColor: '#e06c75' });
    candles.setData(bars.map((bar) => ({ time: bar.time, open: bar.open, high: bar.high, low: bar.low, close: bar.close })));

    const maColors = { 5: '#f5a623', 10: '#f05b2a', 20: '#4f7cff' } as const;
    MA_WINDOWS.forEach((window) => {
      const series = api.addSeries(LineSeries, { color: maColors[window], lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
      series.setData(lineData(bars, window));
    });

    const volume = bars.filter((bar) => bar.volume != null).map((bar) => ({
      time: bar.time,
      value: bar.volume!,
      color: bar.close >= bar.open ? '#67dbc188' : '#e06c7588',
    }));
    if (volume.length) {
      const volumeSeries = api.addSeries(HistogramSeries, { priceFormat: { type: 'volume' }, priceScaleId: 'volume', lastValueVisible: false, priceLineVisible: false });
      volumeSeries.setData(volume);
      api.priceScale('volume').applyOptions({ scaleMargins: { top: 0.78, bottom: 0 } });
    }

    const byTime = new Map(bars.map((bar) => [bar.time, bar]));
    const handleCrosshairMove = (param: Parameters<NonNullable<Parameters<IChartApi['subscribeCrosshairMove']>[0]>>[0]) => {
      const numericTime = typeof param.time === 'number' ? param.time : null;
      const bar = numericTime == null ? undefined : byTime.get(numericTime as UTCTimestamp);
      if (!bar || !param.point) { setHoverBar(null); return; }
      setHoverBar({ ...bar, x: param.point.x, y: param.point.y });
    };
    api.subscribeCrosshairMove(handleCrosshairMove);
    api.timeScale().fitContent();
    return () => {
      api.unsubscribeCrosshairMove(handleCrosshairMove);
      chart.current = null;
      setHoverBar(null);
      api.remove();
    };
  }, [data, period]);

  const chartBarData = data ? chartBars(data) : [];
  const latest = chartBarData.length ? chartBarData[chartBarData.length - 1] : undefined;
  const latestAverage = (window: number) => latest ? averageAt(chartBarData, chartBarData.length - 1, window) : null;
  const tooltipPosition = hoverBar && container.current ? {
    left: Math.min(Math.max(8, hoverBar.x + 12), Math.max(8, container.current.clientWidth - 214)),
    top: Math.min(Math.max(8, hoverBar.y + 12), Math.max(8, container.current.clientHeight - 164)),
  } : undefined;

  return <section className="ibkr-chart" aria-label="行情图表"><div className="ibkr-chart-toolbar"><div><b data-testid="chart-symbol">{position?.symbol || '选择合约'}</b><strong>{formatDecimal(quote?.price)}</strong><span className="ibkr-pill">{quote ? status[quote.state] : '行情未接入'}</span></div><div className="ibkr-tabs">{(['1D', '5D', '1M', '6M', '1Y'] as ChartPeriod[]).map(item => <button key={item} aria-pressed={period === item} onClick={() => setPeriod(item)}>{item}</button>)}</div></div>
    {position && <button onClick={() => setRefresh(value => value + 1)} disabled={loading}>刷新历史行情</button>}
    {watch && position && <MarketQuote snapshot={snapshot} instrument={position} />}
    <div className="ibkr-chart-canvas">{data?.bars.length ? <>
      <div className="ibkr-chart-overlays" aria-label="均线与复权口径"><div className="ibkr-chart-ma-legend" data-testid="moving-average-legend"><span className="is-ma5">均线</span><span className="is-ma5">MA5: {formatChartNumber(latestAverage(5))}</span><span className="is-ma10">MA10: {formatChartNumber(latestAverage(10))}</span><span className="is-ma20">MA20: {formatChartNumber(latestAverage(20))}</span></div><span className="ibkr-chart-adjustment">复权口径：IBKR TRADES</span></div>
      <div ref={container} data-testid="historical-chart" className="ibkr-chart-render" />
      {hoverBar && tooltipPosition && <div className="ibkr-chart-tooltip" data-testid="candle-tooltip" role="status" style={{ left: tooltipPosition.left, top: tooltipPosition.top }}>
        <div className="ibkr-chart-tooltip-title"><span>时间</span><strong>{new Date(hoverBar.date).toLocaleDateString('zh-CN')}</strong></div>
        <dl><dt>开盘</dt><dd className="is-negative">{barLabel(hoverBar, 'open')}</dd><dt>收盘</dt><dd className={hoverBar.close >= hoverBar.open ? 'is-positive' : 'is-negative'}>{barLabel(hoverBar, 'close')}</dd><dt>最高</dt><dd className="is-negative">{barLabel(hoverBar, 'high')}</dd><dt>最低</dt><dd className="is-positive">{barLabel(hoverBar, 'low')}</dd><dt>涨跌额</dt><dd className={hoverBar.previousClose != null && hoverBar.close >= hoverBar.previousClose ? 'is-positive' : 'is-negative'}>{formatSigned(hoverBar.previousClose == null ? null : hoverBar.close - hoverBar.previousClose)}</dd><dt>涨跌幅</dt><dd className={hoverBar.previousClose != null && hoverBar.close >= hoverBar.previousClose ? 'is-positive' : 'is-negative'}>{formatSigned(hoverBar.previousClose == null ? null : (hoverBar.close - hoverBar.previousClose) / hoverBar.previousClose * 100, '%')}</dd><dt>成交量</dt><dd>{formatChartNumber(hoverBar.volume, 0)}</dd><dt>成交额</dt><dd>—</dd><dt>换手率</dt><dd>—</dd></dl><small>成交额与换手率：当前 IBKR 历史字段未提供</small>
      </div>}
      <small className="ibkr-chart-source">{data.source} · {data.bars.length.toLocaleString('en-US')} 根 · {data.barSize} · {data.state === 'stale' ? '缓存已过期' : data.testData ? '工程行情' : '只读行情'}</small>
    </> : <div className="ibkr-chart-message"><ChartNoAxesCombined size={32} strokeWidth={1} /><h2>{position ? `${position.symbol} · ${period}` : '从持仓或搜索选择合约'}</h2><p>{error || (loading ? '正在读取历史行情' : data?.state === 'permission-required' ? '历史行情权限未配置' : data?.state === 'empty' ? '所选区间无行情' : data?.state === 'stale' ? '历史行情缓存已过期' : '历史行情尚未接入')}</p><small>{data ? `${data.source} · ${data.missing.join('、') || '无可用 K 线'}` : '接入后显示来源、时效与交易时段'}</small></div>}</div>
  </section>;
}
