import { useEffect, useRef, useState } from 'react';
import { purge, react as drawPlot } from 'plotly.js-basic-dist-min';
import type { Data, Layout } from 'plotly.js';
import type { peWindow } from '../lib/forwardPe';

function line({ points, gaps }: ReturnType<typeof peWindow>, color: string): Data {
  const x: string[] = [];
  const y: (number | null)[] = [];
  const sources: string[] = [];
  for (const point of points) {
    if (gaps.has(point.date)) {
      x.push(point.date);
      y.push(null);
      sources.push('');
    }
    x.push(point.date);
    y.push(point.value);
    sources.push(point.source);
  }
  return { x, y, customdata: sources, name: '前瞻市盈率', type: 'scatter', mode: points.length === 1 ? 'markers' : 'lines',
    marker: { color }, line: { color, width: 2 }, connectgaps: false,
    hovertemplate: '%{x|%Y-%m-%d}<br>%{customdata} · %{y:.2f} 倍<extra></extra>' };
}

export default function ForwardPePlot({ view }: { view: ReturnType<typeof peWindow> }) {
  const host = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const node = host.current!;
    return () => { purge(node); };
  }, []);
  useEffect(() => {
    const node = host.current!;
    let active = true;
    const theme = getComputedStyle(node);
    const color = (variable: string) => theme.getPropertyValue(variable).trim();
    const { latest, stats, monthlyReference } = view;
    const firstDate = [view.points[0].date, monthlyReference[0]?.month].filter(Boolean).sort()[0];
    const end = Date.parse(latest.date);
    const start = Date.parse(firstDate);
    const padding = Math.max(86400_000, (end - start) * 0.012);
    const layout: Partial<Layout> = {
      autosize: true, height: 300, margin: { l: 42, r: 18, t: 14, b: 34 }, showlegend: false,
      paper_bgcolor: color('--risk-panel'), plot_bgcolor: color('--risk-panel'),
      font: { color: color('--risk-text'), family: theme.fontFamily, size: 11 },
      hoverlabel: { bgcolor: color('--risk-panel-2'), font: { color: color('--risk-text') } },
      xaxis: { type: 'date', range: [new Date(start - padding), new Date(end + padding)],
        tickformat: '%Y', hoverformat: '%Y-%m-%d', nticks: 6, showgrid: false, fixedrange: true },
      yaxis: { ticksuffix: '×', gridcolor: color('--risk-border'), zeroline: false, fixedrange: true },
      shapes: stats ? [
        { type: 'rect', xref: 'paper', x0: 0, x1: 1, y0: stats.q1, y1: stats.q3,
          layer: 'below', fillcolor: 'rgba(109,202,165,0.10)', line: { width: 0 } },
        { type: 'line', xref: 'paper', x0: 0, x1: 1, y0: stats.median, y1: stats.median,
          layer: 'below', line: { color: '#8baba0', width: 1.3, dash: 'dot' } },
      ] : [],
    };
    const lineColor = color('--pe-line-color');
    const traces: Data[] = [line(view, lineColor),
      { x: [latest.date], y: [latest.value], type: 'scatter', mode: 'markers',
        marker: { color: lineColor, size: 7 },
        customdata: [view.points[view.points.length - 1].source],
        hovertemplate: '最新 · %{x|%Y-%m-%d}<br>%{customdata} · %{y:.2f} 倍<extra></extra>' }];
    if (monthlyReference.length) {
      // Discrete marks preserve the published monthly precision and never bridge sources.
      traces.push({ type: 'scatter', mode: 'markers', name: 'Trendonify 月度参考',
        // Center labels within their calendar months; the tooltip only reports the source month.
        x: monthlyReference.map(p => p.month + '-15'),
        y: monthlyReference.map(p => p.value), customdata: monthlyReference.map(p => p.month),
        marker: { color: '#94baf5', size: 5, symbol: 'diamond' },
        hovertemplate: '%{customdata} · 月度参考<br>Trendonify %{y:.2f} 倍<extra></extra>' });
    }
    void drawPlot(node, traces, layout, { responsive: true, displayModeBar: false, scrollZoom: false })
      .then(() => { if (active) setFailed(false); })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [view]);
  return <><div ref={host} role="img" aria-label={'未来十二个月市盈率实线，包含历史一致预期和 Nasdaq 报告观测值' + (view.monthlyReference.length ? '，蓝色菱形为补充的月度观测' : '')} />
    {failed && <p role="alert">估值曲线绘制失败，请刷新重试。</p>}</>;
}
