import { useEffect, useRef, useState } from 'react';
import { purge, react as drawPlot } from 'plotly.js-basic-dist-min';
import type { Data, Layout, PlotlyHTMLElement } from 'plotly.js';
import type { peWindow } from '../lib/forwardPe';

function line({ points, gaps, monthlyReference }: ReturnType<typeof peWindow>, color: string): Data {
  const x: string[] = [];
  const y: (number | null)[] = [];
  const labels: string[][] = [];
  // One hoverable series selects the nearest observation,
  // including the isolated monthly marks inside a gap in the main series.
  const samples = [
    ...points.map(p => ({ ...p, label: p.date, monthly: false })),
    ...monthlyReference.map(p => ({ date: p.month + '-15', value: p.value,
      label: p.month, source: 'Trendonify 月度参考', monthly: true })),
  ].sort((a, b) => a.date.localeCompare(b.date));
  let previousMonthly = false;
  for (const point of samples) {
    if (point.monthly || previousMonthly || gaps.has(point.date)) {
      x.push(point.date);
      y.push(null);
      labels.push([]);
    }
    x.push(point.date);
    y.push(point.value);
    labels.push([point.label, point.source]);
    previousMonthly = point.monthly;
  }
  return { x, y, customdata: labels, name: '前瞻市盈率', type: 'scatter', mode: 'lines',
    marker: { color }, line: { color, width: 2 }, connectgaps: false,
    hoverinfo: 'none' };
}

export default function ForwardPePlot({ view }: { view: ReturnType<typeof peWindow> }) {
  const host = useRef<HTMLDivElement>(null);
  const tooltip = useRef<HTMLDivElement>(null);
  const [reading, setReading] = useState<{ date: string; source: string; value: number } | null>(null);
  const [failed, setFailed] = useState(false);

  function positionTooltip({ clientX, clientY }: { clientX: number; clientY: number }) {
    const box = tooltip.current;
    const bounds = host.current?.getBoundingClientRect();
    if (!box || !bounds) return;
    const offset = 12;
    const left = clientX + offset + box.offsetWidth <= Math.min(bounds.right, window.innerWidth)
      ? clientX + offset : clientX - offset - box.offsetWidth;
    const top = clientY + offset + box.offsetHeight <= Math.min(bounds.bottom, window.innerHeight)
      ? clientY + offset : clientY - offset - box.offsetHeight;
    box.style.left = Math.max(0, left - bounds.left, -bounds.left) + 'px';
    box.style.top = Math.max(0, top - bounds.top, -bounds.top) + 'px';
  }
  useEffect(() => {
    const node = host.current!;
    return () => { purge(node); };
  }, []);
  useEffect(() => {
    const node = host.current!;
    let active = true;
    let graph: PlotlyHTMLElement | undefined;
    setReading(null);
    const theme = getComputedStyle(node);
    const color = (variable: string) => theme.getPropertyValue(variable).trim();
    const { latest, stats, monthlyReference } = view;
    const firstDate = [view.points[0].date, monthlyReference[0]?.month].filter(Boolean).sort()[0];
    const end = Date.parse(latest.date);
    const start = Date.parse(firstDate);
    const padding = Math.max(86400_000, (end - start) * 0.012);
    const lineColor = color('--pe-line-color');
    const crosshair = {
      showspikes: true, spikemode: 'across', spikesnap: 'hovered data',
      spikedash: '3px,4px', spikethickness: 1, spikecolor: '#9ca79e',
    } as const;
    const layout: Partial<Layout> = {
      autosize: true, height: 300, margin: { l: 42, r: 18, t: 14, b: 34 }, showlegend: false,
      paper_bgcolor: color('--risk-panel'), plot_bgcolor: color('--risk-panel'),
      font: { color: color('--risk-text'), family: theme.fontFamily, size: 11 },
      hovermode: 'x', hoverdistance: -1,
      xaxis: { ...crosshair, type: 'date', range: [new Date(start - padding), new Date(end + padding)],
        tickformat: '%Y', hoverformat: '%Y-%m-%d', nticks: 6, showgrid: false, fixedrange: true },
      yaxis: { ...crosshair, ticksuffix: '×', gridcolor: color('--risk-border'), zeroline: false, fixedrange: true },
      shapes: stats ? [
        { type: 'rect', xref: 'paper', x0: 0, x1: 1, y0: stats.q1, y1: stats.q3,
          layer: 'below', fillcolor: 'rgba(109,202,165,0.10)', line: { width: 0 } },
        { type: 'line', xref: 'paper', x0: 0, x1: 1, y0: stats.median, y1: stats.median,
          layer: 'below', line: { color: '#8baba0', width: 1.3, dash: 'dot' } },
      ] : [],
    };
    const traces: Data[] = [line(view, lineColor),
      { x: [latest.date], y: [latest.value], type: 'scatter', mode: 'markers',
        marker: { color: lineColor, size: 7 }, hoverinfo: 'skip' }];
    if (monthlyReference.length) {
      // Discrete marks preserve the published monthly precision and never bridge sources.
      traces.push({ type: 'scatter', mode: 'markers', name: 'Trendonify 月度参考',
        // Center labels within their calendar months; the tooltip only reports the source month.
        x: monthlyReference.map(p => p.month + '-15'),
        y: monthlyReference.map(p => p.value), hoverinfo: 'skip',
        marker: { color: '#94baf5', size: 5, symbol: 'diamond' },
      });
    }
    void drawPlot(node, traces, layout, { responsive: true, displayModeBar: false, scrollZoom: false })
      .then(plot => {
        if (!active) return;
        setFailed(false);
        graph = plot;
        plot.on('plotly_hover', ({ points, event }) => {
          const point = points[0];
          if (!Array.isArray(point?.customdata) || typeof point.y !== 'number') return;
          const [date, source] = point.customdata;
          positionTooltip(event);
          setReading({ date, source, value: point.y });
        });
        plot.on('plotly_unhover', () => setReading(null));
      })
      .catch(() => { if (active) setFailed(true); });
    return () => {
      active = false;
      graph?.removeAllListeners?.('plotly_hover');
      graph?.removeAllListeners?.('plotly_unhover');
    };
  }, [view]);
  return <><div className="pe-chart" onPointerMoveCapture={positionTooltip} onPointerLeave={() => setReading(null)}>
    <div ref={host} role="img" aria-label={'未来十二个月市盈率实线，包含历史一致预期和 Nasdaq 报告观测值' + (view.monthlyReference.length ? '，蓝色菱形为补充的月度观测' : '')} />
    <div ref={tooltip} className="pe-tooltip" role="tooltip" aria-hidden={!reading}>
      <time dateTime={reading?.date}>{reading?.date}</time>
      <div><span>前瞻市盈率</span><strong>{reading?.value.toFixed(2)}×</strong></div>
      <small>{reading?.source}</small>
    </div>
  </div>{failed && <p role="alert">估值曲线绘制失败，请刷新重试。</p>}</>;
}
