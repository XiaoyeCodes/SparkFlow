import { useEffect, useMemo, useRef, useState } from 'react';
import { react as drawPlot, purge } from 'plotly.js-basic-dist-min';
import type { Data, Layout } from 'plotly.js';
import type { GravityHistory } from '../lib/etfGravity';

const colors = ['#2563eb', '#3b82f6', '#06b6d4', '#14b8a6', '#22c55e',
  '#a3e635', '#facc15', '#fb923c', '#f97316', '#ef4444'];

function traces({ symbol, points }: GravityHistory, compact: boolean): Data[] {
  const spy = symbol === 'SPY';
  const dates = points.map(point => point.date);
  const result: Data[] = [
    { type: 'scatter', mode: 'lines', name: '收盘价', x: dates, y: points.map(point => point.close),
      line: { color: spy ? '#646971' : '#404550', width: 1 }, hovertemplate: '%{x|%Y-%m-%d}<br>收盘 $%{y:,.2f}<extra></extra>' },
    { type: 'scatter', mode: 'lines', name: '200 周 TWAP', x: dates, y: points.map(point => point.twap),
      line: { color: spy ? '#3b82f6' : '#a855f7', width: 2.5 }, hovertemplate: '%{x|%Y-%m-%d}<br>TWAP $%{y:,.2f}<extra></extra>' },
  ];
  if (spy) {
    const volumeWeighted = points.filter(point => point.vwap !== null);
    result.push({ type: 'scatter', mode: 'lines', name: 'VWAP · 2020 起', x: volumeWeighted.map(point => point.date),
      y: volumeWeighted.map(point => point.vwap), line: { color: '#e879f9', width: 2.2 },
      hovertemplate: '%{x|%Y-%m-%d}<br>VWAP $%{y:,.2f}<extra></extra>' });
  }
  for (const [index, color] of colors.entries()) {
    const level = index + 1;
    const samples = points.filter(point => point.level === level);
    result.push({ type: 'scatter', mode: 'markers', name: compact ? `等级 ${level}` : `风险等级 ${level}`,
      x: samples.map(point => point.date), y: samples.map(point => point.close),
      customdata: samples.map(point => [point.twap, point.premium, point.score]),
      marker: { color, size: 5, opacity: spy ? 0.82 : 0.88 },
      hovertemplate: `<b>%{x|%Y-%m-%d}</b><br>收盘 $%{y:,.2f}<br>TWAP $%{customdata[0]:,.2f}<br>溢价 %{customdata[1]:+.2f}%<br>风险 %{customdata[2]:.1f}/100 · 等级 ${level}<extra></extra>` });
  }
  return result;
}

export default function EtfGravityPlot({ history }: { history: GravityHistory }) {
  const host = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(() => window.matchMedia('(max-width: 700px)').matches);
  const [failed, setFailed] = useState(false);
  const series = useMemo(() => traces(history, compact), [history, compact]);

  useEffect(() => {
    const node = host.current!;
    const media = window.matchMedia('(max-width: 700px)');
    const resize = () => setCompact(media.matches);
    media.addEventListener('change', resize);
    return () => { media.removeEventListener('change', resize); purge(node); };
  }, []);

  useEffect(() => {
    let current = true;
    const spy = history.symbol === 'SPY';
    const theme = getComputedStyle(host.current!);
    const panel = theme.getPropertyValue('--risk-panel').trim();
    const grid = theme.getPropertyValue('--risk-border').trim();
    const ink = theme.getPropertyValue('--risk-text').trim();
    const layout: Partial<Layout> = {
      autosize: true, height: compact ? 485 : spy ? 560 : 550, uirevision: history.symbol,
      paper_bgcolor: panel, plot_bgcolor: panel, hovermode: 'closest',
      font: { family: theme.fontFamily, color: ink, size: compact ? 10 : 12 },
      margin: { l: compact ? 38 : 60, r: compact ? 10 : 20, t: 32, b: compact ? 30 : 40 },
      xaxis: { type: 'date', showgrid: spy, gridcolor: grid, tickformat: '%Y', nticks: compact ? 5 : 8,
        hoverformat: '%Y-%m-%d', zeroline: false },
      yaxis: { type: 'log', gridcolor: grid, dtick: 'D1', automargin: true,
        title: spy || compact ? undefined : { text: '价格（美元 · 对数）' } },
      legend: compact ? { orientation: 'h', x: 0, y: -0.12, yanchor: 'top', font: { size: 10 } }
        : { orientation: 'v', x: 1.02, y: 1, title: { text: '重力风险' } },
      hoverlabel: { bgcolor: theme.getPropertyValue('--risk-panel-2').trim(), bordercolor: '#527762', font: { color: ink } },
    };
    void drawPlot(host.current!, series, layout, { responsive: true, displaylogo: false,
      displayModeBar: 'hover', scrollZoom: false, modeBarButtonsToRemove: ['select2d', 'lasso2d'] })
      .then(() => { if (current) setFailed(false); })
      .catch(() => { if (current) setFailed(true); });
    return () => { current = false; };
  }, [series, compact, history.symbol]);
  return <><div className="etf-gravity-plot" ref={host} role="group" aria-label={`${history.symbol} 对数价格、200 周均线与十档风险图`} />
    {failed && <p role="alert">图表绘制失败，请刷新页面重试。</p>}</>;
}
