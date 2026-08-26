import { AreaSeries, ColorType, CrosshairMode, LineSeries, LineStyle, createChart, type IChartApi, type Time } from 'lightweight-charts';
import { useEffect, useMemo, useRef, useState } from 'react';

type ReportScore = {
  label: string;
  value: number;
};

type ReportMetric = {
  value: string;
  label: string;
  source?: string;
};

type ReportLevel = {
  label: string;
  value: number;
  tone?: 'target' | 'risk' | 'support';
};

type EquityOverviewSpec = {
  type: 'equity-overview';
  symbol: string;
  title?: string;
  range?: '1mo' | '3mo' | '6mo' | '1y';
  scores: ReportScore[];
  metrics: ReportMetric[];
  levels?: ReportLevel[];
};

type EquityChartPoint = {
  time: string;
  close: number;
  sma20?: number;
  sma60?: number;
};

type EquityChartPayload = {
  symbol: string;
  generatedAt: string;
  source: { label: string; url: string };
  points: EquityChartPoint[];
};

const SYMBOL_PATTERN = /^[A-Za-z0-9.^=-]{1,24}$/;
const RANGE_VALUES = new Set(['1mo', '3mo', '6mo', '1y']);

function shortText(value: unknown, maxLength: number) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function parseSpec(raw: string): EquityOverviewSpec | null {
  if (!raw.trim() || raw.length > 20_000) return null;
  try {
    const candidate = JSON.parse(raw) as Record<string, unknown>;
    const symbol = shortText(candidate.symbol, 24).toUpperCase();
    if (candidate.type !== 'equity-overview' || !SYMBOL_PATTERN.test(symbol)) return null;
    const scores = Array.isArray(candidate.scores)
      ? candidate.scores.slice(0, 8).flatMap((item) => {
          if (!item || typeof item !== 'object') return [];
          const record = item as Record<string, unknown>;
          const label = shortText(record.label, 18);
          const value = Number(record.value);
          return label && Number.isFinite(value) ? [{ label, value: Math.max(0, Math.min(10, value)) }] : [];
        })
      : [];
    const metrics = Array.isArray(candidate.metrics)
      ? candidate.metrics.slice(0, 6).flatMap((item) => {
          if (!item || typeof item !== 'object') return [];
          const record = item as Record<string, unknown>;
          const value = shortText(record.value, 28);
          const label = shortText(record.label, 36);
          if (!value || !label) return [];
          return [{ value, label, source: shortText(record.source, 60) || undefined }];
        })
      : [];
    const levels = Array.isArray(candidate.levels)
      ? candidate.levels.slice(0, 6).flatMap((item) => {
          if (!item || typeof item !== 'object') return [];
          const record = item as Record<string, unknown>;
          const label = shortText(record.label, 24);
          const value = Number(record.value);
          const tone: ReportLevel['tone'] = record.tone === 'risk' || record.tone === 'support' ? record.tone : 'target';
          return label && Number.isFinite(value) && value > 0 ? [{ label, value, tone }] : [];
        })
      : [];
    if (scores.length < 3) return null;
    const range = typeof candidate.range === 'string' && RANGE_VALUES.has(candidate.range) ? candidate.range as EquityOverviewSpec['range'] : '3mo';
    return {
      type: 'equity-overview',
      symbol,
      title: shortText(candidate.title, 80) || undefined,
      range,
      scores,
      metrics,
      levels,
    };
  } catch {
    return null;
  }
}

function ScoreRadar({ scores }: { scores: ReportScore[] }) {
  const size = 280;
  const center = size / 2;
  const radius = 88;
  const point = (index: number, factor: number) => {
    const angle = -Math.PI / 2 + index * Math.PI * 2 / scores.length;
    return [center + Math.cos(angle) * radius * factor, center + Math.sin(angle) * radius * factor] as const;
  };
  const polygon = (factor: number) => scores.map((_score, index) => point(index, factor).join(',')).join(' ');
  const scorePolygon = scores.map((score, index) => point(index, score.value / 10).join(',')).join(' ');

  return (
    <svg className="equity-report-radar" viewBox={`0 0 ${size} ${size}`} role="img" aria-label="个股研究多维评分雷达图">
      {[.2, .4, .6, .8, 1].map((factor) => <polygon key={factor} points={polygon(factor)} className="radar-ring" />)}
      {scores.map((score, index) => {
        const [outerX, outerY] = point(index, 1);
        const [labelX, labelY] = point(index, 1.27);
        return (
          <g key={`${score.label}-${index}`}>
            <line x1={center} y1={center} x2={outerX} y2={outerY} />
            <text x={labelX} y={labelY + 4} textAnchor={labelX > center + 8 ? 'start' : labelX < center - 8 ? 'end' : 'middle'}>{score.label}</text>
            <circle cx={point(index, score.value / 10)[0]} cy={point(index, score.value / 10)[1]} r="3.2" />
          </g>
        );
      })}
      <polygon points={scorePolygon} className="radar-value" />
      <text x={center} y={center - 4} textAnchor="middle" className="radar-score">{(scores.reduce((sum, score) => sum + score.value, 0) / scores.length).toFixed(1)}</text>
      <text x={center} y={center + 14} textAnchor="middle" className="radar-score-label">综合均分</text>
    </svg>
  );
}

function PriceChart({ payload, levels = [] }: { payload: EquityChartPayload; levels?: ReportLevel[] }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || payload.points.length < 2) return;
    const chart = createChart(container, {
      width: container.clientWidth,
      height: 270,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#718b82',
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: 10,
      },
      grid: {
        vertLines: { color: 'rgba(103, 177, 156, .07)' },
        horzLines: { color: 'rgba(103, 177, 156, .11)' },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: 'rgba(103, 177, 156, .18)' },
      timeScale: { borderColor: 'rgba(103, 177, 156, .18)', timeVisible: false },
    });
    chartRef.current = chart;
    const closeSeries = chart.addSeries(AreaSeries, {
      lineColor: '#63d6b5',
      lineWidth: 2,
      topColor: 'rgba(99, 214, 181, .23)',
      bottomColor: 'rgba(99, 214, 181, .015)',
      priceLineVisible: false,
    });
    const sma20Series = chart.addSeries(LineSeries, { color: '#e1a14b', lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
    const sma60Series = chart.addSeries(LineSeries, { color: '#76dcc5', lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
    closeSeries.setData(payload.points.map((point) => ({ time: point.time.slice(0, 10) as Time, value: point.close })));
    sma20Series.setData(payload.points.flatMap((point) => point.sma20 === undefined ? [] : [{ time: point.time.slice(0, 10) as Time, value: point.sma20 }]));
    sma60Series.setData(payload.points.flatMap((point) => point.sma60 === undefined ? [] : [{ time: point.time.slice(0, 10) as Time, value: point.sma60 }]));
    levels.forEach((level) => closeSeries.createPriceLine({
      price: level.value,
      color: level.tone === 'risk' ? '#ef7180' : level.tone === 'support' ? '#76dcc5' : '#e1a14b',
      lineStyle: LineStyle.Dashed,
      lineWidth: 1,
      axisLabelVisible: true,
      title: level.label,
    }));
    chart.timeScale().fitContent();
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) chart.applyOptions({ width });
    });
    observer.observe(container);
    return () => {
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
    };
  }, [levels, payload]);

  return <div ref={containerRef} className="equity-report-price-canvas" aria-label={`${payload.symbol} 价格趋势图`} />;
}

export function EquityReportVisualization({ raw }: { raw: string }) {
  const spec = useMemo(() => parseSpec(raw), [raw]);
  const [payload, setPayload] = useState<EquityChartPayload | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!spec) return;
    const controller = new AbortController();
    setPayload(null);
    setError('');
    fetch(`/api/equity-report-chart?symbol=${encodeURIComponent(spec.symbol)}&range=${encodeURIComponent(spec.range || '3mo')}`, { signal: controller.signal })
      .then(async (response) => {
        const result = await response.json().catch(() => ({})) as EquityChartPayload & { error?: string };
        if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
        return result;
      })
      .then(setPayload)
      .catch((reason) => {
        if (reason instanceof DOMException && reason.name === 'AbortError') return;
        setError(reason instanceof Error ? reason.message : '价格序列暂时不可用');
      });
    return () => controller.abort();
  }, [spec]);

  if (!spec) return <div className="equity-report-viz-error">图表数据格式无效，已阻止渲染。</div>;

  return (
    <section className="equity-report-viz" aria-label={`${spec.symbol} 综合评分与价格趋势`}>
      <header>
        <span>01</span>
        <div><strong>{spec.title || '综合评分与价格趋势'}</strong><small>{spec.symbol} · 已核验市场序列</small></div>
      </header>
      <div className="equity-report-viz-grid">
        <div className="equity-report-radar-panel"><small>多维综合评分</small><ScoreRadar scores={spec.scores} /></div>
        <div className="equity-report-price-panel">
          <div className="equity-report-chart-title"><span>近期价格、均线与决策参考位</span><div><i className="is-close" />收盘<i className="is-sma20" />SMA20<i className="is-sma60" />SMA60</div></div>
          {payload ? <PriceChart payload={payload} levels={spec.levels} /> : <div className="equity-report-price-loading">{error || '正在读取已验证价格序列'}</div>}
          {payload ? <a href={payload.source.url} target="_blank" rel="noreferrer">{payload.source.label} · 数据更新 {payload.generatedAt.slice(0, 10)}</a> : null}
        </div>
      </div>
      {spec.metrics.length ? <div className="equity-report-metrics">{spec.metrics.map((metric, index) => <div key={`${metric.label}-${index}`}><strong>{metric.value}</strong><span>{metric.label}</span><small>{metric.source || '研究团队核验'}</small></div>)}</div> : null}
    </section>
  );
}
