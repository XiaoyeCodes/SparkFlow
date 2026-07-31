import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ColorType,
  CrosshairMode,
  LineSeries,
  createChart,
  type LineData,
  type Time,
} from 'lightweight-charts';
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  CircleHelp,
  RefreshCw,
  Scale,
  Thermometer,
} from 'lucide-react';

type TemperatureZone = 'low' | 'fair' | 'high';

type TemperatureItem = {
  id: string;
  name: string;
  code: string;
  category: 'market' | 'industry';
  temperature: number;
  temperatureDelta: number;
  zone: TemperatureZone;
  zoneLabel: string;
  currentPe: number;
  currentPb?: number;
  sampleSize: number;
  updatedAt: string;
  marketCap?: number;
};

type TemperaturePoint = {
  time: string;
  value: number;
};

type MarketChartSeries = {
  id: string;
  name: string;
  ticker: string;
  sourceUrl: string;
  temperature: TemperaturePoint[];
};

type BookValueAnchor = {
  name: string;
  code: string;
  generatedAt: string;
  current: {
    marketValue: number;
    anchorValue: number;
    pb: number;
    fairPb: number;
    pbPercentile: number;
    premiumPercent: number;
    status: string;
    updatedAt: string;
  };
  points: Array<{
    time: string;
    marketValue: number;
    bookValue: number;
    anchorValue: number;
    pb: number;
  }>;
  methodology: string;
  sources: Array<{ label: string; url: string }>;
};

type ValuationDashboard = {
  generatedAt: string;
  methodology: string;
  periodLabel: string;
  sources: Array<{ label: string; url: string }>;
  overall: TemperatureItem;
  markets: TemperatureItem[];
  industries: TemperatureItem[];
  charts: MarketChartSeries[];
  bookValueAnchor?: BookValueAnchor;
};

const zoneStyles: Record<TemperatureZone, { accent: string; text: string; background: string }> = {
  low: {
    accent: '#1aa382',
    text: 'text-[#6ed5b7]',
    background: 'bg-[#1aa382]/10',
  },
  fair: {
    accent: '#d6b566',
    text: 'text-[#e6cd8e]',
    background: 'bg-[#d6b566]/10',
  },
  high: {
    accent: '#d04b5a',
    text: 'text-[#ed8e99]',
    background: 'bg-[#d04b5a]/10',
  },
};

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatMarketCap(value?: number) {
  if (!value) return '--';
  return `${(value / 100_000_000_000).toFixed(1)} 千亿`;
}

function BookValueAnchorChart({ data }: { data: BookValueAnchor }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [range, setRange] = useState<'3y' | '5y' | 'all'>('all');
  const visiblePoints = useMemo(() => {
    if (range === 'all') return data.points;
    const latestPoint = data.points[data.points.length - 1];
    const latest = new Date(`${latestPoint?.time || data.current.updatedAt}T00:00:00`);
    latest.setFullYear(latest.getFullYear() - (range === '3y' ? 3 : 5));
    const start = latest.toISOString().slice(0, 10);
    return data.points.filter((point) => point.time >= start);
  }, [data, range]);
  const meanReversion = useMemo(() => {
    const first = visiblePoints[0];
    const last = visiblePoints[visiblePoints.length - 1];
    if (!first || !last || first.anchorValue <= 0 || first.marketValue <= 0) return null;

    const estimateFor = (anchorValue: number) => (
      anchorValue * first.marketValue / first.anchorValue
    );
    const estimatedValue = estimateFor(last.anchorValue);

    return {
      last,
      estimatedValue,
      priceChange: (last.marketValue / first.marketValue - 1) * 100,
      netAssetGrowth: (last.anchorValue / first.anchorValue - 1) * 100,
      valuationChange: (last.marketValue / estimatedValue - 1) * 100,
      points: visiblePoints.map((point) => ({
        ...point,
        estimatedValue: estimateFor(point.anchorValue),
      })),
    };
  }, [visiblePoints]);

  useEffect(() => {
    if (!containerRef.current || !meanReversion?.points.length) return;
    const chart = createChart(containerRef.current, {
      autoSize: true,
      height: 480,
      layout: {
        background: { type: ColorType.Solid, color: '#0a0b0d' },
        textColor: 'rgba(226, 232, 240, 0.48)',
        fontFamily: '"IBM Plex Mono", "SFMono-Regular", Consolas, monospace',
      },
      grid: {
        vertLines: { color: 'rgba(255,255,255,0.025)' },
        horzLines: { color: 'rgba(255,255,255,0.06)' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: 'rgba(255,255,255,0.22)', labelBackgroundColor: '#34363b' },
        horzLine: { color: 'rgba(255,255,255,0.14)', labelBackgroundColor: '#34363b' },
      },
      rightPriceScale: {
        borderColor: 'rgba(255,255,255,0.08)',
        scaleMargins: { top: 0.08, bottom: 0.08 },
      },
      leftPriceScale: { visible: false },
      timeScale: {
        borderColor: 'rgba(255,255,255,0.08)',
        rightOffset: 4,
        barSpacing: range === '3y' ? 5 : 2.5,
        minBarSpacing: 0.35,
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: false,
      },
      handleScale: {
        axisPressedMouseMove: true,
        mouseWheel: true,
        pinch: true,
      },
    });

    const marketLine = chart.addSeries(LineSeries, {
      color: '#d48419',
      lineWidth: 2,
      priceScaleId: 'right',
      priceLineVisible: false,
      lastValueVisible: true,
      crosshairMarkerBorderColor: '#d48419',
      crosshairMarkerBackgroundColor: '#0a0b0d',
      title: '中证全指',
    });
    marketLine.setData(visiblePoints.map((point) => ({
      time: point.time as Time,
      value: point.marketValue,
    })) as LineData<Time>[]);

    const anchorLine = chart.addSeries(LineSeries, {
      color: '#3d648b',
      lineWidth: 2,
      priceScaleId: 'right',
      priceLineVisible: false,
      lastValueVisible: true,
      crosshairMarkerBorderColor: '#5b84ac',
      crosshairMarkerBackgroundColor: '#0a0b0d',
      title: '净资产估算价值',
    });
    anchorLine.setData(meanReversion.points.map((point) => ({
      time: point.time as Time,
      value: point.estimatedValue,
    })) as LineData<Time>[]);

    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [meanReversion, range, visiblePoints]);

  if (!meanReversion) return null;

  const premium = meanReversion.valuationChange;
  const tone = premium > 5
    ? 'text-[#ed8e99]'
    : premium < -5
      ? 'text-[#6ed5b7]'
      : 'text-[#e6cd8e]';
  const gapLabel = Math.abs(premium) < 0.05
    ? '基本不变'
    : premium > 0
      ? `扩张 ${premium.toFixed(1)}%`
      : `收缩 ${Math.abs(premium).toFixed(1)}%`;
  const rangeLabel = range === '3y' ? '近 3 年' : range === '5y' ? '近 5 年' : '全部历史';
  const contributionRows = [
    {
      label: '净资产增长',
      value: meanReversion.netAssetGrowth,
      color: '#5b84ac',
      note: '企业价值增长',
    },
    {
      label: '估值变化',
      value: meanReversion.valuationChange,
      color: meanReversion.valuationChange > 0 ? '#d04b5a' : '#1aa382',
      note: meanReversion.valuationChange > 0 ? '市场情绪抬升' : '市场情绪压低',
    },
    {
      label: '市场价格变化',
      value: meanReversion.priceChange,
      color: '#d48419',
      note: '所选区间涨跌',
    },
  ];

  return (
    <div className="border-t border-white/10 py-7" data-testid="book-value-anchor">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="flex items-center gap-2 text-xs font-semibold text-[#d6b566]">
            <Scale size={14} /> 均值回归
          </p>
          <h3 className="mt-2 text-xl font-bold text-white sm:text-2xl">A股价格与净资产均值回归参考</h3>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-white/42">
            两条线从所选区间同一起点出发。橙线是中证全指价格，蓝线是随全 A 净资产增长推算的基准线；
            两者的距离表示 PB 相对区间起点的扩张或收缩，不代表市场低估或高估的绝对幅度。
          </p>
        </div>
        <div className="flex items-center gap-px border border-white/10 bg-white/10 p-px">
          {([
            ['3y', '3年'],
            ['5y', '5年'],
            ['all', '全部'],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setRange(value)}
              className={`h-8 min-w-14 px-3 text-xs font-semibold transition ${
                range === value ? 'bg-white/12 text-white' : 'bg-[#090b0d] text-white/38 hover:text-white/70'
              }`}
              aria-pressed={range === value}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-5 grid overflow-hidden border border-white/10 bg-[#0a0b0d] lg:grid-cols-[1fr_1fr_1.2fr]">
        <div className="border-b border-white/8 p-5 lg:border-b-0 lg:border-r">
          <p className="text-[11px] text-white/38">当前市场价格 · 中证全指</p>
          <p className="mt-2 font-mono text-2xl font-semibold text-[#d99a43]">
            {meanReversion.last.marketValue.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}
          </p>
        </div>
        <div className="border-b border-white/8 p-5 lg:border-b-0 lg:border-r">
          <p className="flex items-center gap-1.5 text-[11px] text-white/38">
            净资产增长基准线
            <span title="以所选区间起点为基准，按全 A 净资产增长推算，仅用于拆分价格变化。">
              <CircleHelp size={12} />
            </span>
          </p>
          <p className="mt-2 font-mono text-2xl font-semibold text-[#6f96bc]">
            {meanReversion.estimatedValue.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}
          </p>
        </div>
        <div className="p-5">
          <p className="text-[11px] text-white/38">PB 相对区间起点</p>
          <p className={`mt-2 font-mono text-2xl font-semibold ${tone}`}>{gapLabel}</p>
          <p className="mt-1 text-[10px] text-white/30">
            {rangeLabel}基准 · 当前 PB {data.current.pb.toFixed(2)}x · 历史分位 {data.current.pbPercentile.toFixed(1)}%
          </p>
        </div>
      </div>

      <div className="mt-4 border border-white/10 bg-[#0a0b0d] px-5 py-4">
        <div className="grid gap-5 lg:grid-cols-3">
          {contributionRows.map((item) => (
            <div key={item.label}>
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold text-white/72">{item.label}</p>
                  <p className="mt-1 text-[10px] text-white/28">{item.note}</p>
                </div>
                <span className="font-mono text-base font-semibold text-white/82">
                  {item.value > 0 ? '+' : ''}{item.value.toFixed(1)}%
                </span>
              </div>
              <div className="mt-3 h-1.5 overflow-hidden bg-white/8">
                <div
                  className="h-full transition-[width] duration-500"
                  style={{
                    width: `${Math.max(3, Math.min(100, Math.abs(item.value)))}%`,
                    backgroundColor: item.color,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4 overflow-hidden border border-white/10 bg-[#0a0b0d]">
        <div className="flex items-center justify-center gap-6 border-b border-white/8 py-3 text-xs">
          <span className="flex items-center gap-2 text-[#d99a43]">
            <span className="h-0.5 w-4 bg-[#d48419]" /> 市场价格
          </span>
          <span className="flex items-center gap-2 text-[#6f96bc]">
            <span className="h-0.5 w-4 bg-[#3d648b]" /> 净资产增长基准
          </span>
        </div>
        <div
          ref={containerRef}
          data-testid="book-value-chart"
          className="h-[360px] w-full sm:h-[480px]"
          aria-label="A股市场价格与净资产增长基准均值回归参考图"
        />
      </div>

      <div className="mt-4 flex flex-col gap-3 text-[11px] leading-5 text-white/34 lg:flex-row lg:items-start lg:justify-between">
        <p className="max-w-4xl">
          估算方法：中证全指 ÷ 全 A 中位 PB 得到净资产代理，再将所选区间起点归一为同一价格。
          蓝线反映净资产增长，并非企业逐项估值或内在价值；公开数据未计入股息再投资。
          图中的扩张或收缩只相对于所选区间起点，不可单独用于判断高估低估。
        </p>
        <div className="flex flex-wrap items-center gap-3">
          {data.sources.map((source) => (
            <a
              key={source.url}
              href={source.url}
              target="_blank"
              rel="noreferrer"
              className="transition hover:text-white/70"
            >
              {source.label}
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}

function TemperatureChart({ series }: { series: MarketChartSeries }) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!containerRef.current || !series.temperature.length) return;

    const chart = createChart(containerRef.current, {
      autoSize: true,
      height: 420,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: 'rgba(226, 232, 240, 0.54)',
        fontFamily: '"IBM Plex Mono", "SFMono-Regular", Consolas, monospace',
      },
      grid: {
        vertLines: { color: 'rgba(255,255,255,0.035)' },
        horzLines: { color: 'rgba(255,255,255,0.055)' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: 'rgba(214,181,102,0.48)', labelBackgroundColor: '#7c662f' },
        horzLine: { color: 'rgba(214,181,102,0.34)', labelBackgroundColor: '#7c662f' },
      },
      rightPriceScale: {
        visible: false,
      },
      leftPriceScale: {
        visible: true,
        borderColor: 'rgba(255,255,255,0.1)',
        scaleMargins: { top: 0.04, bottom: 0.04 },
      },
      timeScale: {
        borderColor: 'rgba(255,255,255,0.1)',
        timeVisible: false,
        rightOffset: 8,
        barSpacing: 3,
        minBarSpacing: 0.8,
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: false,
      },
      handleScale: {
        axisPressedMouseMove: true,
        mouseWheel: true,
        pinch: true,
      },
    });

    const temperature = chart.addSeries(LineSeries, {
      color: '#d6b566',
      lineWidth: 3,
      priceScaleId: 'left',
      priceLineVisible: false,
      lastValueVisible: true,
      crosshairMarkerBorderColor: '#d6b566',
      crosshairMarkerBackgroundColor: '#06090c',
      autoscaleInfoProvider: () => ({
        priceRange: { minValue: 0, maxValue: 100 },
      }),
      priceFormat: {
        type: 'custom',
        formatter: (value: number) => `${Math.round(value)}°`,
      },
    });
    temperature.setData(series.temperature.map((item) => ({
      time: item.time as Time,
      value: item.value,
    })) as LineData<Time>[]);

    temperature.createPriceLine({
      price: 30,
      color: 'rgba(26,163,130,0.55)',
      lineWidth: 1,
      lineStyle: 2,
      axisLabelVisible: true,
      title: '低估 / 中估',
    });
    temperature.createPriceLine({
      price: 70,
      color: 'rgba(208,75,90,0.55)',
      lineWidth: 1,
      lineStyle: 2,
      axisLabelVisible: true,
      title: '中估 / 高估',
    });

    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [series]);

  return (
    <div className="relative overflow-hidden bg-[#06090c]">
      <div className="pointer-events-none absolute inset-y-0 left-[58px] right-0 z-0 flex flex-col">
        <div className="h-[30%] bg-[#d04b5a]/[0.045]" />
        <div className="h-[40%] bg-[#d6b566]/[0.035]" />
        <div className="h-[30%] bg-[#1aa382]/[0.045]" />
      </div>
      <div className="pointer-events-none absolute inset-y-7 left-[66px] z-20 flex flex-col justify-between py-4">
        <span className="border-l-2 border-[#d04b5a]/60 pl-2 text-[10px] font-semibold text-[#ed8e99]/75">高温区</span>
        <span className="border-l-2 border-[#d6b566]/60 pl-2 text-[10px] font-semibold text-[#e6cd8e]/70">中温区</span>
        <span className="border-l-2 border-[#1aa382]/60 pl-2 text-[10px] font-semibold text-[#6ed5b7]/75">低温区</span>
      </div>
      <div
        ref={containerRef}
        data-testid="temperature-chart"
        className="relative z-10 h-[360px] w-full sm:h-[420px]"
        aria-label={`${series.name}估值温度历史曲线`}
      />
    </div>
  );
}

function LoadingState() {
  return (
    <section className="mt-8 border-y border-white/10 py-10" data-testid="china-temperature-panel">
      <div className="animate-pulse">
        <div className="h-4 w-40 bg-white/10" />
        <div className="mt-4 h-9 w-72 max-w-full bg-white/10" />
        <div className="mt-7 grid gap-3 lg:grid-cols-[minmax(240px,0.75fr)_1.8fr]">
          <div className="h-56 bg-white/[0.05]" />
          <div className="h-56 bg-white/[0.05]" />
        </div>
        <div className="mt-5 h-[360px] bg-white/[0.05]" />
      </div>
    </section>
  );
}

export function MarketTemperaturePanel() {
  const [data, setData] = useState<ValuationDashboard | null>(null);
  const [selectedId, setSelectedId] = useState('all-market');
  const [reloadKey, setReloadKey] = useState(0);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    setError('');
    fetch('/api/china-valuation-temperature', { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload?.error || '估值温度数据暂时不可用');
        return payload as ValuationDashboard;
      })
      .then((payload) => {
        setData(payload);
        if (!payload.charts.some((item) => item.id === selectedId)) {
          setSelectedId(payload.charts[0]?.id || 'all-market');
        }
      })
      .catch((reason) => {
        if (reason instanceof DOMException && reason.name === 'AbortError') return;
        setError(reason instanceof Error ? reason.message : '估值温度数据暂时不可用');
      });
    return () => controller.abort();
  }, [reloadKey]);

  const selectedMarket = useMemo(
    () => data?.markets.find((item) => item.id === selectedId) || data?.overall,
    [data, selectedId],
  );
  const selectedSeries = useMemo(
    () => data?.charts.find((item) => item.id === selectedId) || data?.charts[0],
    [data, selectedId],
  );

  if (!data && !error) return <LoadingState />;

  if (!data) {
    return (
      <section className="mt-8 border-y border-white/10 py-10" data-testid="china-temperature-panel">
        <div className="flex min-h-48 flex-col items-center justify-center text-center">
          <Thermometer className="text-[#d6b566]" size={26} />
          <p className="mt-4 text-sm text-white/60">{error}</p>
          <button
            type="button"
            onClick={() => setReloadKey((current) => current + 1)}
            className="mt-5 inline-flex h-9 items-center gap-2 border border-white/15 px-4 text-xs font-semibold text-white/72 transition hover:border-white/35 hover:text-white"
          >
            <RefreshCw size={14} /> 重新获取
          </button>
        </div>
      </section>
    );
  }

  const overallStyle = zoneStyles[data.overall.zone];
  const markerPosition = Math.max(1.5, Math.min(98.5, data.overall.temperature));
  const pbPercentile = data.bookValueAnchor?.current.pbPercentile;
  const medianPbGap = data.bookValueAnchor?.current.premiumPercent;
  const valuationConclusion = data.overall.temperature >= 70 && (pbPercentile ?? 50) < 70
    ? {
        title: '结构性偏热，整体估值中性',
        detail: '近500日 PE 热度处于高位，但全 A 中位 PB 仍在历史中位区域，当前不是“全面高估”或“明显低估”的单边市场。',
        tone: 'text-[#e6cd8e]',
      }
    : data.overall.temperature >= 70
      ? {
          title: '整体估值偏高',
          detail: '近期 PE 热度与较长历史 PB 分位同时偏高，需要更重视估值回归风险。',
          tone: 'text-[#ed8e99]',
        }
      : data.overall.temperature < 30 && (pbPercentile ?? 50) <= 30
        ? {
            title: '整体估值偏低',
            detail: '近期 PE 热度与较长历史 PB 分位同时偏低，但仍需结合盈利趋势确认。',
            tone: 'text-[#6ed5b7]',
          }
        : {
            title: '整体估值中性',
            detail: '近期 PE 热度与较长历史 PB 分位未形成一致的极端信号，适合继续观察结构差异。',
            tone: 'text-[#e6cd8e]',
          };

  return (
    <section className="mt-8 border-y border-white/10 py-8 sm:py-10" data-testid="china-temperature-panel">
      <header className="flex flex-col gap-4 border-b border-white/10 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-[#74c9dd]">
            <Thermometer size={14} /> Valuation temperature
          </p>
          <h2 className="mt-2 text-2xl font-bold text-white sm:text-3xl">A股估值温度计</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-white/48">
            用公开估值分位观察市场冷热。温度表示近500个交易日 PE 的相对位置，不等同于全市场的绝对高估或低估。
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs text-white/42">
          <span>更新 {formatDate(data.generatedAt)}</span>
          <button
            type="button"
            onClick={() => setReloadKey((current) => current + 1)}
            className="grid size-9 place-items-center border border-white/12 text-white/52 transition hover:border-white/30 hover:text-white"
            title="刷新估值温度"
            aria-label="刷新估值温度"
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </header>

      <div className="mt-6 border border-[#d6b566]/25 bg-[#d6b566]/[0.045] p-5 sm:p-6">
        <div className="grid gap-5 xl:grid-cols-[1.2fr_1.8fr] xl:items-center">
          <div>
            <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/42">
              <Activity size={14} /> 当前综合判断
            </p>
            <p className={`mt-2 text-xl font-bold sm:text-2xl ${valuationConclusion.tone}`}>
              {valuationConclusion.title}
            </p>
            <p className="mt-2 max-w-xl text-xs leading-5 text-white/48">{valuationConclusion.detail}</p>
            <p className="mt-3 text-[10px] text-white/28">
              数据可信度：中等 · 行情可交叉验证，估值数据来自公开第三方，结论是量化参考而非权威定价。
            </p>
          </div>
          <div className="grid gap-px overflow-hidden border border-white/10 bg-white/10 sm:grid-cols-3">
            <div className="bg-[#090b0d] p-4">
              <p className="text-[10px] text-white/34">短期 PE 热度</p>
              <p className={`mt-2 font-mono text-xl font-semibold ${overallStyle.text}`}>
                {data.overall.temperature.toFixed(0)}°
              </p>
              <p className="mt-1 text-[10px] text-white/28">近500个交易日</p>
            </div>
            <div className="bg-[#090b0d] p-4">
              <p className="text-[10px] text-white/34">全 A 中位 PB 分位</p>
              <p className="mt-2 font-mono text-xl font-semibold text-[#e6cd8e]">
                {pbPercentile !== undefined ? `${pbPercentile.toFixed(1)}%` : '--'}
              </p>
              <p className="mt-1 text-[10px] text-white/28">较长历史样本</p>
            </div>
            <div className="bg-[#090b0d] p-4">
              <p className="text-[10px] text-white/34">历史中位 PB 价值锚</p>
              <p className={`mt-2 font-mono text-xl font-semibold ${
                (medianPbGap ?? 0) > 5
                  ? 'text-[#ed8e99]'
                  : (medianPbGap ?? 0) < -5
                    ? 'text-[#6ed5b7]'
                    : 'text-[#e6cd8e]'
              }`}>
                {medianPbGap !== undefined
                  ? `${medianPbGap > 0 ? '溢价' : '折价'} ${Math.abs(medianPbGap).toFixed(1)}%`
                  : '--'}
              </p>
              <p className="mt-1 text-[10px] text-white/28">接近合理区间</p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-5 py-6 xl:grid-cols-[minmax(290px,0.72fr)_1.65fr]">
        <div className="border border-white/10 bg-[#090b0d] p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold text-white/48">近500日 PE 热度</p>
              <div className="mt-2 flex items-end gap-2">
                <strong className={`font-mono text-6xl leading-none ${overallStyle.text}`}>
                  {data.overall.temperature.toFixed(0)}
                </strong>
                <span className="mb-1 text-xl text-white/42">°C</span>
              </div>
            </div>
            <span className={`px-2.5 py-1 text-xs font-semibold ${overallStyle.background} ${overallStyle.text}`}>
              {data.overall.zoneLabel}
            </span>
          </div>

          <div className="relative mt-8 pt-4">
            <div className="flex h-2 overflow-hidden bg-white/[0.04]">
              <div className="w-[30%] bg-[#1aa382]" />
              <div className="w-[40%] bg-[#d6b566]" />
              <div className="w-[30%] bg-[#d04b5a]" />
            </div>
            <span
              className="absolute top-0 h-5 w-px bg-white shadow-[0_0_10px_rgba(255,255,255,0.7)]"
              style={{ left: `${markerPosition}%` }}
            />
            <div className="mt-2 flex justify-between font-mono text-[10px] text-white/34">
              <span>0 冷</span>
              <span>30</span>
              <span>70</span>
              <span>热 100</span>
            </div>
          </div>

          <dl className="mt-7 grid grid-cols-3 gap-2 border-t border-white/8 pt-5">
            <div>
              <dt className="text-[10px] text-white/36">平均 PE</dt>
              <dd className="mt-1 font-mono text-sm font-semibold text-white/78">{data.overall.currentPe}</dd>
            </div>
            <div>
              <dt className="text-[10px] text-white/36">20日变化</dt>
              <dd className={`mt-1 flex items-center gap-1 font-mono text-sm font-semibold ${
                data.overall.temperatureDelta > 0 ? 'text-[#ed8e99]' : 'text-[#6ed5b7]'
              }`}>
                {data.overall.temperatureDelta > 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
                {Math.abs(data.overall.temperatureDelta).toFixed(1)}°
              </dd>
            </div>
            <div>
              <dt className="text-[10px] text-white/36">历史样本</dt>
              <dd className="mt-1 font-mono text-sm font-semibold text-white/78">{data.overall.sampleSize} 日</dd>
            </div>
          </dl>
        </div>

        <div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-white/48">主要市场</p>
              <p className="mt-1 text-xs text-white/30">点击切换下方历史图表</p>
            </div>
            <span className="font-mono text-[10px] text-white/30">{data.periodLabel}</span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
            {data.markets.map((item) => {
              const style = zoneStyles[item.zone];
              const selected = item.id === selectedId;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedId(item.id)}
                  className={`min-h-24 border p-3 text-left transition ${
                    selected
                      ? 'border-[#d6b566]/65 bg-[#d6b566]/[0.07]'
                      : 'border-white/10 bg-[#090b0d] hover:border-white/24'
                  }`}
                  aria-pressed={selected}
                >
                  <span className="block truncate text-xs font-semibold text-white/68">{item.name}</span>
                  <span className={`mt-3 block font-mono text-2xl font-semibold ${style.text}`}>
                    {item.temperature.toFixed(0)}°
                  </span>
                  <span className="mt-1 block text-[10px] text-white/35">PE {item.currentPe}</span>
                </button>
              );
            })}
          </div>

          <div className="mt-5 flex items-center justify-between">
            <p className="text-xs font-semibold text-white/48">重点行业估值温度</p>
            <p className="text-[10px] text-white/30">PE 60% + PB 40%</p>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-px overflow-hidden border border-white/10 bg-white/10 sm:grid-cols-5">
            {data.industries.map((item) => {
              const style = zoneStyles[item.zone];
              return (
                <div key={item.id} className="min-h-[92px] bg-[#090b0d] p-3">
                  <div className="flex items-start justify-between gap-2">
                    <span className="truncate text-xs font-semibold text-white/70" title={item.name}>{item.name}</span>
                    <span className={`font-mono text-sm font-semibold ${style.text}`}>{item.temperature.toFixed(0)}°</span>
                  </div>
                  <p className="mt-3 font-mono text-[10px] text-white/38">
                    PE {item.currentPe} {item.currentPb ? `· PB ${item.currentPb}` : ''}
                  </p>
                  <p className="mt-1 truncate text-[10px] text-white/28">市值 {formatMarketCap(item.marketCap)}</p>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {data.bookValueAnchor ? <BookValueAnchorChart data={data.bookValueAnchor} /> : null}

      {selectedSeries && selectedMarket ? (
        <div className="border-t border-white/10 pt-6">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="flex items-center gap-2 text-xs font-semibold text-[#d6b566]">
                <BarChart3 size={14} /> 估值温度历史
              </p>
              <h3 className="mt-1 text-lg font-bold text-white">{selectedSeries.name}</h3>
              <p className="mt-1 text-xs text-white/38">近 500 个交易日 · 历史估值分位</p>
            </div>
            <span className="flex items-center gap-2 font-mono text-xs text-[#e6cd8e]">
              <span className="h-0.5 w-4 bg-[#d6b566]" />
              当前 {selectedMarket.temperature.toFixed(0)}°
            </span>
          </div>
          <div className="overflow-hidden border border-white/10 bg-[#06090c]">
            <TemperatureChart series={selectedSeries} />
          </div>
          <div className="mt-4 flex flex-col gap-3 text-[11px] leading-5 text-white/34 lg:flex-row lg:items-start lg:justify-between">
            <p className="max-w-4xl">{data.methodology}</p>
            <div className="flex shrink-0 items-center gap-3">
              <Activity size={13} />
              {data.sources.map((source) => (
                <a
                  key={source.url}
                  href={source.url}
                  target="_blank"
                  rel="noreferrer"
                  className="transition hover:text-white/70"
                >
                  {source.label}
                </a>
              ))}
              <a
                href="https://www.tradingview.com/"
                target="_blank"
                rel="noreferrer"
                className="transition hover:text-white/70"
              >
                图表技术 TradingView
              </a>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
