import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AreaSeries,
  ColorType,
  CrosshairMode,
  LineSeries,
  LineStyle,
  PriceScaleMode,
  createChart,
  type IChartApi,
  type Time,
} from 'lightweight-charts';
import { Bitcoin, CalendarClock, RefreshCw, Sparkles, TriangleAlert } from 'lucide-react';

type BitcoinPricePoint = {
  time: string;
  value: number;
};

type BitcoinHalving = {
  date: string;
  label: string;
  blockReward: string;
  estimated?: boolean;
};

type BitcoinProjection = {
  horizon: string;
  model: string;
  points: BitcoinPricePoint[];
  futureHalvings: BitcoinHalving[];
  horizonScenario: { low: number; base: number; high: number };
  assumptions: string[];
  researchSources: Array<{ label: string; url: string }>;
};

type BitcoinCycleHistory = {
  generatedAt: string;
  source: { label: string; url: string };
  methodology: string;
  points: BitcoinPricePoint[];
  halvings: BitcoinHalving[];
  projection: BitcoinProjection;
};

type HalvingPosition = BitcoinHalving & { x: number };

const DAY_MS = 24 * 60 * 60 * 1000;
const ESTIMATED_CYCLE_DAYS = 365.25 * 4;

function formatUsd(value: number) {
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: value >= 1_000 ? 0 : 2,
  }).format(value);
}

function formatDate(value: string) {
  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'UTC',
  }).format(date);
}

export function BitcoinCycleChart() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const [data, setData] = useState<BitcoinCycleHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [halvingPositions, setHalvingPositions] = useState<HalvingPosition[]>([]);
  const [hoveredPoint, setHoveredPoint] = useState<BitcoinPricePoint | null>(null);
  const [scaleMode, setScaleMode] = useState<'linear' | 'log'>('linear');
  const [projectionEnabled, setProjectionEnabled] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    fetch('/api/bitcoin-cycle-history', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(payload.error || `HTTP ${response.status}`);
        }
        return response.json() as Promise<BitcoinCycleHistory>;
      })
      .then((payload) => {
        setData(payload);
        setHoveredPoint(payload.points[payload.points.length - 1] || null);
      })
      .catch((reason) => {
        if (reason instanceof DOMException && reason.name === 'AbortError') return;
        setError(reason instanceof Error ? reason.message : '比特币历史数据暂时不可用');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [reloadKey]);

  const updateHalvingPositions = useCallback(() => {
    if (!chartRef.current || !data) return;
    const visibleHalvings = projectionEnabled
      ? [...data.halvings, ...data.projection.futureHalvings]
      : data.halvings;
    const next = visibleHalvings.flatMap((halving) => {
      const x = chartRef.current?.timeScale().timeToCoordinate(halving.date as Time);
      return x === null || x === undefined ? [] : [{ ...halving, x }];
    });
    setHalvingPositions(next);
  }, [data, projectionEnabled]);

  useEffect(() => {
    if (!containerRef.current || !data?.points.length) return;
    const container = containerRef.current;
    const chart = createChart(container, {
      width: container.clientWidth,
      height: container.clientHeight,
      layout: {
        background: { type: ColorType.Solid, color: '#080b0d' },
        textColor: 'rgba(255,255,255,0.46)',
        fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: 'rgba(255,255,255,0.035)' },
        horzLines: { color: 'rgba(255,255,255,0.055)' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: 'rgba(214,181,102,0.38)', labelBackgroundColor: '#775d25' },
        horzLine: { color: 'rgba(214,181,102,0.22)', labelBackgroundColor: '#775d25' },
      },
      rightPriceScale: {
        mode: scaleMode === 'log' ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal,
        borderColor: 'rgba(255,255,255,0.12)',
        scaleMargins: { top: 0.12, bottom: scaleMode === 'linear' ? 0 : 0.1 },
      },
      timeScale: {
        borderColor: 'rgba(255,255,255,0.12)',
        timeVisible: false,
        rightOffset: 6,
        barSpacing: 3,
        minBarSpacing: 0.03,
      },
      handleScroll: true,
      handleScale: true,
    });
    chartRef.current = chart;

    const series = chart.addSeries(AreaSeries, {
      lineColor: '#d6b566',
      lineWidth: 2,
      topColor: 'rgba(214,181,102,0.19)',
      bottomColor: 'rgba(214,181,102,0.01)',
      priceFormat: {
        type: 'custom',
        formatter: (price: number) => formatUsd(price),
        minMove: 0.01,
      },
      lastValueVisible: true,
      priceLineVisible: true,
      priceLineColor: 'rgba(214,181,102,0.42)',
    });
    series.setData(data.points);
    if (projectionEnabled) {
      const projection = chart.addSeries(LineSeries, {
        color: '#78b9d4',
        lineWidth: 2,
        lineStyle: LineStyle.Dashed,
        priceFormat: {
          type: 'custom',
          formatter: (price: number) => formatUsd(price),
          minMove: 0.01,
        },
        lastValueVisible: true,
        priceLineVisible: false,
        title: '2035 模型推演',
      });
      projection.setData(data.projection.points);
    }
    chart.timeScale().fitContent();

    const visiblePoints = projectionEnabled
      ? [...data.points, ...data.projection.points]
      : data.points;
    const pointByTime = new Map(visiblePoints.map((point) => [point.time, point]));
    chart.subscribeCrosshairMove((param) => {
      if (!param.time) {
        setHoveredPoint(data.points[data.points.length - 1] || null);
        return;
      }
      setHoveredPoint(pointByTime.get(String(param.time)) || null);
    });

    const update = () => window.requestAnimationFrame(updateHalvingPositions);
    const resizeObserver = new ResizeObserver(() => {
      chart.applyOptions({ width: container.clientWidth, height: container.clientHeight });
      chart.timeScale().fitContent();
      update();
    });
    resizeObserver.observe(container);
    chart.timeScale().subscribeVisibleTimeRangeChange(update);
    update();

    return () => {
      resizeObserver.disconnect();
      chart.timeScale().unsubscribeVisibleTimeRangeChange(update);
      chart.remove();
      chartRef.current = null;
    };
  }, [data, projectionEnabled, scaleMode, updateHalvingPositions]);

  const cycleBands = useMemo(() => {
    if (!data || halvingPositions.length === 0 || !containerRef.current) return [];
    const width = containerRef.current.clientWidth;
    return halvingPositions.map((halving, index) => ({
      left: halving.x,
      right: halvingPositions[index + 1]?.x ?? width,
      label: halving.estimated
        ? `预计第 ${index + 1} 个减半周期`
        : index === data.halvings.length - 1
          ? '当前减半周期'
          : `第 ${index + 1} 个减半周期`,
    }));
  }, [data, halvingPositions]);

  const currentCycleProgress = useMemo(() => {
    const latest = data?.points[data.points.length - 1];
    const lastHalving = data?.halvings[data.halvings.length - 1];
    if (!latest || !lastHalving) return null;
    const elapsedDays = (new Date(`${latest.time}T00:00:00Z`).getTime()
      - new Date(`${lastHalving.date}T00:00:00Z`).getTime()) / DAY_MS;
    return Math.max(0, Math.min(100, elapsedDays / ESTIMATED_CYCLE_DAYS * 100));
  }, [data]);

  return (
    <section className="market-bitcoin-cycle mt-8 border-t border-white/10 pt-7" data-testid="bitcoin-cycle-chart">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#d6b566]">
            <Bitcoin size={14} /> Bitcoin Halving Cycles
          </div>
          <h2 className="mt-2 text-2xl font-semibold text-white">比特币减半周期走势图</h2>
          <p className="mt-1 text-xs leading-5 text-white/42">
            BTC/USD 日线 · {scaleMode === 'linear' ? '线性坐标，按真实美元价格比例显示' : '对数坐标，用于观察长期倍数变化'} · 阴影表示约四年的减半周期
          </p>
        </div>
        <div className="flex flex-wrap items-end justify-end gap-4">
          <button
            type="button"
            role="switch"
            aria-checked={projectionEnabled}
            onClick={() => setProjectionEnabled((value) => !value)}
            className={`market-bitcoin-control inline-flex h-9 items-center gap-2 border px-3 text-xs font-semibold transition ${projectionEnabled ? 'border-[#78b9d4]/45 bg-[#78b9d4]/10 text-[#a7d8eb]' : 'border-white/12 bg-[#090c0e] text-white/46 hover:text-white/78'}`}
          >
            <Sparkles size={13} /> 2035 周期推演
            <span className={`relative h-4 w-7 rounded-full transition ${projectionEnabled ? 'bg-[#78b9d4]/70' : 'bg-white/12'}`}>
              <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition ${projectionEnabled ? 'left-3.5' : 'left-0.5'}`} />
            </span>
          </button>
          <div className="market-bitcoin-control flex h-9 border border-white/12 bg-[#090c0e] p-0.5" aria-label="价格坐标模式">
            <button
              type="button"
              onClick={() => setScaleMode('linear')}
              className={`px-3 text-xs font-semibold transition ${scaleMode === 'linear' ? 'bg-white/10 text-white' : 'text-white/42 hover:text-white/72'}`}
              aria-pressed={scaleMode === 'linear'}
            >
              线性
            </button>
            <button
              type="button"
              onClick={() => setScaleMode('log')}
              className={`px-3 text-xs font-semibold transition ${scaleMode === 'log' ? 'bg-white/10 text-white' : 'text-white/42 hover:text-white/72'}`}
              aria-pressed={scaleMode === 'log'}
            >
              对数
            </button>
          </div>
          {hoveredPoint ? (
            <div className="text-right">
              <p className="text-[11px] text-white/36">{formatDate(hoveredPoint.time)}</p>
              <p className="mt-1 font-mono text-xl font-semibold text-[#e3c878]">{formatUsd(hoveredPoint.value)}</p>
            </div>
          ) : null}
        </div>
      </div>

      {loading ? (
        <div className="mt-5 flex h-[420px] items-center justify-center border border-white/10 bg-[#080b0d] sm:h-[500px]">
          <RefreshCw className="animate-spin text-[#d6b566]" size={20} />
        </div>
      ) : error || !data ? (
        <div className="mt-5 flex h-64 items-center justify-center border border-[#d6b566]/20 bg-[#d6b566]/[0.035] px-5 text-center">
          <div>
            <TriangleAlert className="mx-auto text-[#d6b566]" size={22} />
            <p className="mt-3 text-sm text-white/64">{error || '比特币历史数据暂时不可用'}</p>
            <button
              type="button"
              onClick={() => setReloadKey((value) => value + 1)}
              className="mt-4 inline-flex h-9 items-center gap-2 border border-white/16 px-4 text-xs font-semibold text-white/70 transition hover:border-white/35 hover:text-white"
            >
              <RefreshCw size={13} /> 重新加载
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="market-bitcoin-chart relative mt-5 overflow-hidden border border-white/10 bg-[#080b0d]">
            <div ref={containerRef} className="relative z-0 h-[420px] w-full sm:h-[500px]" />
            <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
              {cycleBands.map((band, index) => (
                <div
                  key={band.label}
                  className={index % 2 === 0 ? 'absolute bottom-6 top-0 bg-[#d6b566]/[0.025]' : 'absolute bottom-6 top-0 bg-[#4f789d]/[0.025]'}
                  style={{ left: band.left, width: Math.max(0, band.right - band.left) }}
                >
                  <span className="absolute bottom-3 left-3 hidden text-[10px] font-semibold text-white/24 md:block">
                    {band.label}
                  </span>
                </div>
              ))}
              {halvingPositions.map((halving, index) => (
                <div
                  key={halving.date}
                  className={`absolute bottom-6 top-0 border-l border-dashed ${halving.estimated ? 'border-[#78b9d4]/55' : 'border-[#d6b566]/45'}`}
                  style={{ left: halving.x }}
                >
                  <div className={`absolute left-2 whitespace-nowrap border bg-[#111417]/90 px-2 py-1.5 text-[10px] leading-4 text-white/66 ${halving.estimated ? 'border-[#78b9d4]/30' : 'border-[#d6b566]/25'} ${index % 2 === 0 ? 'top-3' : 'top-14'}`}>
                    <span className={`font-semibold ${halving.estimated ? 'text-[#9bd3e8]' : 'text-[#e3c878]'}`}>{halving.label}</span>
                    <span className="ml-2 hidden text-white/36 sm:inline">{halving.blockReward}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="market-bitcoin-cycle-grid mt-4 grid gap-px border border-white/10 bg-white/10 sm:grid-cols-2 xl:grid-cols-5">
            {data.halvings.map((halving) => (
              <div key={halving.date} className="market-bitcoin-cycle-card bg-[#0a0d0f] px-4 py-3">
                <div className="flex items-center gap-2 text-[11px] text-white/36">
                  <CalendarClock size={13} /> {formatDate(halving.date)}
                </div>
                <p className="mt-1 text-sm font-semibold text-white/82">{halving.label}</p>
                <p className="mt-1 text-[11px] text-[#d6b566]/72">区块奖励 {halving.blockReward}</p>
              </div>
            ))}
            <div className="market-bitcoin-cycle-card bg-[#0a0d0f] px-4 py-3">
              <p className="text-[11px] text-white/36">当前周期进度</p>
              <p className="mt-1 text-sm font-semibold text-white/82">
                {currentCycleProgress === null ? '--' : `${currentCycleProgress.toFixed(1)}%`}
              </p>
              <p className="mt-1 text-[11px] text-white/36">按约四年周期估算，不代表价格预测</p>
            </div>
          </div>

          {projectionEnabled ? (
            <div className="market-bitcoin-projection mt-4 border border-[#78b9d4]/20 bg-[#78b9d4]/[0.045] p-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#78b9d4]">
                    <Sparkles size={13} /> Model Projection · Not Market Data
                  </div>
                  <p className="mt-2 text-sm font-semibold text-white/82">2035 年模型中枢 {formatUsd(data.projection.horizonScenario.base)}</p>
                  <p className="mt-1 text-xs text-white/42">宽幅情景区间 {formatUsd(data.projection.horizonScenario.low)} 至 {formatUsd(data.projection.horizonScenario.high)}</p>
                </div>
                <p className="max-w-xl text-xs leading-5 text-white/42">{data.projection.model}。虚线仅用于研究情景，不是未来真实 K 线、目标价或收益承诺。</p>
              </div>
              <div className="mt-3 grid gap-2 text-[11px] leading-5 text-white/38 lg:grid-cols-3">
                {data.projection.assumptions.map((assumption) => <p key={assumption}>{assumption}</p>)}
              </div>
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[10px] text-white/30">
                {data.projection.researchSources.map((source) => (
                  <a key={source.url} href={source.url} target="_blank" rel="noreferrer" className="transition hover:text-white/65">{source.label}</a>
                ))}
              </div>
            </div>
          ) : null}

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] leading-5 text-white/34">
            <p>{data.methodology}</p>
            <a href={data.source.url} target="_blank" rel="noreferrer" className="shrink-0 transition hover:text-white/70">
              数据：{data.source.label} · 更新于 {formatDate(data.generatedAt)}
            </a>
          </div>
        </>
      )}
    </section>
  );
}
