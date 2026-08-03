import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ColorType,
  CrosshairMode,
  LineStyle,
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
import { ValuationGuideWhitepaperLauncher } from './ValuationGuideWhitepaper';

type TemperatureZone = 'cold' | 'low' | 'fair' | 'warm' | 'hot';

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
  id: string;
  name: string;
  code: string;
  pbLabel: string;
  generatedAt: string;
  hasTotalReturn: boolean;
  current: {
    marketValue: number;
    totalReturnValue?: number;
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
    totalReturnValue?: number;
    bookValue: number;
    anchorValue: number;
    pb: number;
  }>;
  methodology: string;
  sources: Array<{ label: string; url: string }>;
};

type BookValueHoverPoint = {
  time: string;
  marketValue: number;
  netAssetBaseline: number;
  fairValue: number;
};

type ValuationDashboard = {
  market?: 'china' | 'hongkong' | 'us';
  marketLabel?: string;
  coverage?: string;
  generatedAt: string;
  methodology: string;
  periodLabel: string;
  sources: Array<{ label: string; url: string }>;
  overall: TemperatureItem;
  markets: TemperatureItem[];
  industries: TemperatureItem[];
  charts: MarketChartSeries[];
  bookValueAnchor?: BookValueAnchor;
  bookValueAnchors?: BookValueAnchor[];
};

const zoneStyles: Record<TemperatureZone, { accent: string; text: string; background: string }> = {
  cold: {
    accent: '#0f9f88',
    text: 'text-[#6ed5b7]',
    background: 'bg-[#0f9f88]/10',
  },
  low: {
    accent: '#4ea98d',
    text: 'text-[#8ccfb8]',
    background: 'bg-[#4ea98d]/10',
  },
  fair: {
    accent: '#d6b566',
    text: 'text-[#e6cd8e]',
    background: 'bg-[#d6b566]/10',
  },
  warm: {
    accent: '#c47c55',
    text: 'text-[#e4aa7d]',
    background: 'bg-[#c47c55]/10',
  },
  hot: {
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

function BookValueAnchorChart({
  data,
  marketLabel,
  selectedMarketId,
}: {
  data: BookValueAnchor[];
  marketLabel: string;
  selectedMarketId?: string;
}) {
  const sectionRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [selectedId, setSelectedId] = useState(data[0]?.id || 'csi-all-share');
  const [range, setRange] = useState<'1y' | '3y' | '5y' | 'all'>('all');
  const [hoverPoint, setHoverPoint] = useState<BookValueHoverPoint | null>(null);
  const activeData = data.find((item) => item.id === selectedId) || data[0];

  useEffect(() => {
    const requestedId = selectedMarketId === 'all-market' ? data[0]?.id : selectedMarketId;
    if (requestedId && data.some((item) => item.id === requestedId)) setSelectedId(requestedId);
  }, [data, selectedMarketId]);
  const visiblePoints = useMemo(() => {
    if (range === 'all') return activeData.points;
    const latestPoint = activeData.points[activeData.points.length - 1];
    const latest = new Date(`${latestPoint?.time || activeData.current.updatedAt}T00:00:00`);
    const years = range === '1y' ? 1 : range === '3y' ? 3 : 5;
    latest.setFullYear(latest.getFullYear() - years);
    const start = latest.toISOString().slice(0, 10);
    return activeData.points.filter((point) => point.time >= start);
  }, [activeData, range]);
  const returnDecomposition = useMemo(() => {
    const first = visiblePoints[0];
    const last = visiblePoints[visiblePoints.length - 1];
    if (!first || !last || first.bookValue <= 0 || first.marketValue <= 0) return null;
    const useRawNetAssetProxy = activeData.id === 'sse-composite';

    const orderedPb = visiblePoints.map((point) => point.pb).sort((left, right) => left - right);
    const middle = Math.floor(orderedPb.length / 2);
    const medianPb = orderedPb.length % 2
      ? orderedPb[middle]
      : (orderedPb[middle - 1] + orderedPb[middle]) / 2;
    const lowerPbCount = orderedPb.filter((value) => value < last.pb).length;
    const equalPbCount = orderedPb.filter((value) => value === last.pb).length;
    const pbPercentile = (lowerPbCount + equalPbCount * 0.5) / orderedPb.length * 100;

    const priceFactor = last.marketValue / first.marketValue;
    const hasTotalReturn = first.totalReturnValue !== undefined
      && first.totalReturnValue > 0
      && last.totalReturnValue !== undefined
      && last.totalReturnValue > 0;
    const totalReturnFactor = hasTotalReturn
      ? last.totalReturnValue! / first.totalReturnValue!
      : priceFactor;
    const netAssetFactor = last.bookValue / first.bookValue;
    const valuationFactor = last.pb / first.pb;
    const dividendFactor = totalReturnFactor / priceFactor;
    const estimatedFairValue = last.bookValue * medianPb;
    const netAssetBaseline = useRawNetAssetProxy
      ? last.bookValue
      : last.bookValue * first.marketValue / first.bookValue;

    return {
      first,
      last,
      medianPb,
      pbPercentile,
      estimatedFairValue,
      netAssetBaseline,
      totalReturn: (totalReturnFactor - 1) * 100,
      netAssetGrowth: (netAssetFactor - 1) * 100,
      valuationChange: (valuationFactor - 1) * 100,
      dividendContribution: hasTotalReturn ? (dividendFactor - 1) * 100 : undefined,
      hasTotalReturn,
      pbMedianGap: (last.pb / medianPb - 1) * 100,
      points: visiblePoints.map((point) => ({
        ...point,
        netAssetBaseline: useRawNetAssetProxy
          ? point.bookValue
          : point.bookValue * first.marketValue / first.bookValue,
        fairValue: point.bookValue * medianPb,
      })),
    };
  }, [activeData.id, visiblePoints]);

  useEffect(() => {
    if (window.location.hash === '#return-decomposition') {
      sectionRef.current?.scrollIntoView({ block: 'start' });
    }
  }, []);

  useEffect(() => {
    if (!containerRef.current || !returnDecomposition?.points.length) return;
    const latestPoint = returnDecomposition.points[returnDecomposition.points.length - 1];
    setHoverPoint(latestPoint);
    const chart = createChart(containerRef.current, {
      autoSize: true,
      height: 480,
      layout: {
        background: { type: ColorType.Solid, color: '#0a0b0d' },
        textColor: 'rgba(226, 232, 240, 0.48)',
        fontFamily: '"IBM Plex Mono", "SFMono-Regular", Consolas, monospace',
      },
      localization: {
        locale: 'zh-CN',
        dateFormat: 'yyyy年MM月dd日',
      },
      grid: {
        vertLines: { color: 'rgba(255,255,255,0.025)' },
        horzLines: { color: 'rgba(255,255,255,0.06)' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: 'rgba(255,255,255,0.22)', labelBackgroundColor: '#34363b' },
        horzLine: { color: 'rgba(255,255,255,0.14)', labelVisible: false },
      },
      rightPriceScale: {
        visible: false,
      },
      leftPriceScale: {
        visible: true,
        borderColor: 'rgba(255,255,255,0.08)',
        scaleMargins: { top: 0.08, bottom: 0.08 },
      },
      timeScale: {
        borderColor: 'rgba(255,255,255,0.08)',
        rightOffset: 4,
        barSpacing: range === '1y' ? 7 : range === '3y' ? 4 : 2.5,
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
      priceScaleId: 'left',
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerBorderColor: '#d48419',
      crosshairMarkerBackgroundColor: '#0a0b0d',
    });
    marketLine.setData(visiblePoints.map((point) => ({
      time: point.time as Time,
      value: point.marketValue,
    })) as LineData<Time>[]);

    const anchorLine = chart.addSeries(LineSeries, {
      color: '#3d648b',
      lineWidth: 2,
      priceScaleId: 'left',
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerBorderColor: '#5b84ac',
      crosshairMarkerBackgroundColor: '#0a0b0d',
    });
    anchorLine.setData(returnDecomposition.points.map((point) => ({
      time: point.time as Time,
      value: point.netAssetBaseline,
    })) as LineData<Time>[]);

    const fairValueLine = chart.addSeries(LineSeries, {
      color: '#d6b566',
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      priceScaleId: 'left',
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerBorderColor: '#d6b566',
      crosshairMarkerBackgroundColor: '#0a0b0d',
    });
    fairValueLine.setData(returnDecomposition.points.map((point) => ({
      time: point.time as Time,
      value: point.fairValue,
    })) as LineData<Time>[]);

    chart.subscribeCrosshairMove((param) => {
      if (param.logical === undefined) {
        setHoverPoint(latestPoint);
        return;
      }
      const index = Math.max(0, Math.min(
        returnDecomposition.points.length - 1,
        Math.round(Number(param.logical)),
      ));
      setHoverPoint(returnDecomposition.points[index] || latestPoint);
    });

    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [range, returnDecomposition, visiblePoints]);

  if (!returnDecomposition) return null;

  const premium = returnDecomposition.pbMedianGap;
  const tone = premium > 5
    ? 'text-[#ed8e99]'
    : premium < -5
      ? 'text-[#6ed5b7]'
      : 'text-[#e6cd8e]';
  const gapLabel = Math.abs(premium) < 0.05
    ? '接近历史中枢'
    : premium > 0
      ? `高于中枢 ${premium.toFixed(1)}%`
      : `低于中枢 ${Math.abs(premium).toFixed(1)}%`;
  const rangeLabel = range === '1y'
    ? '近 1 年'
    : range === '3y'
      ? '近 3 年'
      : range === '5y'
        ? '近 5 年'
        : `${visiblePoints[0]?.time.slice(0, 4) || '--'} 年以来`;
  const contributionRows = [
    {
      label: returnDecomposition.hasTotalReturn ? '累计总回报' : '累计价格回报',
      value: returnDecomposition.totalReturn,
      color: returnDecomposition.totalReturn >= 0 ? '#d04b5a' : '#1aa382',
      note: returnDecomposition.hasTotalReturn ? `${activeData.name}全收益指数` : `${activeData.name}价格指数`,
    },
    {
      label: '净资产代理增长',
      value: returnDecomposition.netAssetGrowth,
      color: '#5b84ac',
      note: `价格 ÷ ${activeData.pbLabel}`,
    },
    {
      label: '估值变化',
      value: returnDecomposition.valuationChange,
      color: returnDecomposition.valuationChange > 0 ? '#d04b5a' : '#1aa382',
      note: '区间起止PB变化',
    },
    ...(returnDecomposition.dividendContribution !== undefined ? [{
      label: '股息贡献',
      value: returnDecomposition.dividendContribution,
      color: '#d6b566',
      note: '全收益相对价格指数',
    }] : []),
  ];
  const maxContribution = Math.max(...contributionRows.map((item) => Math.abs(item.value)), 1);
  const investmentGuide = returnDecomposition.pbPercentile < 20
    ? { level: '明显偏低', action: '可适当提高定投额', color: '#6ed5b7' }
    : returnDecomposition.pbPercentile < 40
      ? { level: '略偏低', action: '正常或小幅增加', color: '#74cbb1' }
      : returnDecomposition.pbPercentile < 60
        ? { level: '中性', action: '维持基础定投', color: '#e6cd8e' }
        : returnDecomposition.pbPercentile < 80
          ? { level: '略偏高', action: '减少新增资金', color: '#e29a66' }
          : { level: '明显偏高', action: '暂停加码并按目标仓位再平衡', color: '#ed8e99' };

  return (
    <div ref={sectionRef} id="return-decomposition" className="scroll-mt-24 border-t border-white/10 py-7" data-testid="book-value-anchor">
      <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="flex items-center gap-2 text-xs font-semibold text-[#d6b566]">
            <Scale size={14} /> 回报归因与均值回归
          </p>
          <h3 className="mt-2 text-xl font-bold text-white sm:text-2xl">{marketLabel}指数回报来源拆分与PB中枢参考</h3>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-white/42">
            {activeData.hasTotalReturn
              ? '把总回报拆成净资产代理增长、PB变化与股息贡献。'
              : '把价格回报拆成净资产代理增长与PB变化；缺少同口径全收益序列时不估算股息贡献。'}
            虚线按所选区间的PB中位数估算，
            用于判断当前估值相对历史中枢的位置，而不是企业内在价值。
          </p>
          <ValuationGuideWhitepaperLauncher />
        </div>
        <div className="flex flex-col items-start gap-2 sm:items-end">
          <div className="flex max-w-full flex-wrap items-center gap-px border border-white/10 bg-white/10 p-px">
            {data.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setSelectedId(item.id)}
                className={`h-9 px-3 text-xs font-semibold transition ${
                  activeData.id === item.id ? 'bg-white/12 text-white' : 'bg-[#090b0d] text-white/38 hover:text-white/70'
                }`}
                aria-pressed={activeData.id === item.id}
              >
                {item.name}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-px border border-white/10 bg-white/10 p-px">
            {([
              ['1y', '1年'],
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
      </div>

      <div className="mt-5 grid overflow-hidden border border-white/10 bg-[#0a0b0d] md:grid-cols-2 xl:grid-cols-[0.9fr_0.9fr_1.05fr_1.25fr]">
        <div className="border-b border-white/8 p-5 xl:border-b-0 xl:border-r">
          <p className="text-[11px] text-white/38">当前市场价格 · {activeData.name}</p>
          <p className="mt-2 font-mono text-2xl font-semibold text-[#d99a43]">
            {returnDecomposition.last.marketValue.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}
          </p>
        </div>
        <div className="border-b border-white/8 p-5 md:border-l xl:border-b-0 xl:border-l-0 xl:border-r">
          <p className="flex items-center gap-1.5 text-[11px] text-white/38">
            历史PB中枢参考
            <span title={`当前净资产代理乘以所选区间的${activeData.pbLabel}中位数，仅表示相对历史PB中枢。`}>
              <CircleHelp size={12} />
            </span>
          </p>
          <p className="mt-2 font-mono text-2xl font-semibold text-[#6f96bc]">
            {returnDecomposition.estimatedFairValue.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}
          </p>
        </div>
        <div className="border-b border-white/8 p-5 md:border-b-0 xl:border-r">
          <p className="text-[11px] text-white/38">当前PB相对历史中枢</p>
          <p className={`mt-2 font-mono text-2xl font-semibold ${tone}`}>{gapLabel}</p>
          <p className="mt-1 text-[10px] text-white/30">
            {rangeLabel} · 当前PB {returnDecomposition.last.pb.toFixed(2)}x · 中枢 {returnDecomposition.medianPb.toFixed(2)}x · 分位 {returnDecomposition.pbPercentile.toFixed(1)}%
          </p>
        </div>
        <div className="p-5 md:border-l xl:border-l-0">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] text-white/38">定投参考 · 当前PB {returnDecomposition.last.pb.toFixed(2)}x</p>
              <p className="mt-2 font-mono text-2xl font-semibold" style={{ color: investmentGuide.color }}>
                {investmentGuide.level}
              </p>
            </div>
            <span className="border border-white/10 px-2 py-1 font-mono text-[10px] text-white/52">
              {returnDecomposition.pbPercentile.toFixed(1)}%
            </span>
          </div>
          <p className="mt-1 text-xs font-semibold text-white/72">{investmentGuide.action}</p>
          <div className="relative mt-4 grid h-1.5 grid-cols-5 gap-px bg-black">
            {['#1aa382', '#4ea98d', '#d6b566', '#c47c55', '#d04b5a'].map((color) => (
              <span key={color} style={{ backgroundColor: color }} />
            ))}
            <span
              className="absolute top-1/2 h-3.5 w-px -translate-y-1/2 bg-white shadow-[0_0_0_2px_rgba(0,0,0,0.65)]"
              style={{ left: `${Math.max(1, Math.min(99, returnDecomposition.pbPercentile))}%` }}
            />
          </div>
          <div className="mt-1 flex justify-between font-mono text-[9px] text-white/24">
            <span>偏低</span><span>中性</span><span>偏高</span>
          </div>
        </div>
      </div>

      <div className="mt-4 border border-white/10 bg-[#0a0b0d] px-5 py-4">
        <div className={`grid gap-5 sm:grid-cols-2 ${returnDecomposition.hasTotalReturn ? 'xl:grid-cols-4' : 'xl:grid-cols-3'}`}>
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
                    width: `${Math.max(1.5, Math.abs(item.value) / maxContribution * 100)}%`,
                    backgroundColor: item.color,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4 overflow-hidden border border-white/10 bg-[#0a0b0d]">
        <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 border-b border-white/8 px-3 py-3 text-xs">
          <span className="flex items-center gap-2 text-[#d99a43]">
            <span className="h-0.5 w-4 bg-[#d48419]" /> {activeData.name}价格
          </span>
          <span className="flex items-center gap-2 text-[#6f96bc]">
            <span className="h-0.5 w-4 bg-[#3d648b]" />
            {activeData.id === 'sse-composite' ? '净资产代理（1x PB）' : '净资产代理（同起点）'}
          </span>
          <span className="flex items-center gap-2 text-[#e6cd8e]">
            <span className="w-4 border-t border-dashed border-[#d6b566]" /> 历史PB中枢
          </span>
        </div>
        <div className="relative">
          <div
            ref={containerRef}
            data-testid="book-value-chart"
            className="h-[360px] w-full sm:h-[480px]"
            aria-label={`${activeData.name}回报来源拆分与PB历史中枢参考图`}
          />
          {hoverPoint ? (
            <div
              data-testid="book-value-hover-readout"
              className="pointer-events-none absolute right-3 top-3 z-10 w-44 border border-white/12 bg-transparent px-3 py-2.5"
            >
              <p className="border-b border-white/8 pb-2 font-mono text-[10px] text-white/42">
                {hoverPoint.time}
              </p>
              <div className="mt-2 space-y-1.5 font-mono text-[10px]">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[#d99a43]">{activeData.name}</span>
                  <span className="text-white/82">{hoverPoint.marketValue.toFixed(2)}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[#6f96bc]">净资产代理</span>
                  <span className="text-white/82">{hoverPoint.netAssetBaseline.toFixed(2)}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[#e6cd8e]">历史PB中枢</span>
                  <span className="text-white/82">{hoverPoint.fairValue.toFixed(2)}</span>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-3 text-[11px] leading-5 text-white/34 lg:flex-row lg:items-start lg:justify-between">
        <p className="max-w-4xl">
          {activeData.methodology}
          {' '}{returnDecomposition.hasTotalReturn
            ? '乘法关系：总回报因子 = 净资产代理增长因子 × PB变化因子 × 股息贡献因子。'
            : '乘法关系：价格回报因子 = 净资产代理增长因子 × PB变化因子。'}
          本图是市场研究代理，不构成估值结论或买卖信号。
        </p>
        <div className="flex flex-wrap items-center gap-3">
          {activeData.sources.map((source) => (
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

    [
      { price: 20, color: 'rgba(15,159,136,0.42)' },
      { price: 40, color: 'rgba(78,169,141,0.38)' },
      { price: 60, color: 'rgba(214,181,102,0.38)' },
      { price: 80, color: 'rgba(208,75,90,0.42)' },
    ].forEach(({ price, color }) => {
      temperature.createPriceLine({
        price,
        color,
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: false,
      });
    });

    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [series]);

  return (
    <div className="relative overflow-hidden bg-[#06090c]">
      <div className="pointer-events-none absolute inset-y-0 left-[58px] right-0 z-0 flex flex-col">
        <div className="h-1/5 bg-[#d04b5a]/[0.05]" />
        <div className="h-1/5 bg-[#c47c55]/[0.04]" />
        <div className="h-1/5 bg-[#d6b566]/[0.032]" />
        <div className="h-1/5 bg-[#4ea98d]/[0.038]" />
        <div className="h-1/5 bg-[#0f9f88]/[0.05]" />
      </div>
      <div className="pointer-events-none absolute inset-y-7 left-[66px] z-20 flex flex-col justify-between py-4">
        <span className="border-l-2 border-[#d04b5a]/60 pl-2 text-[10px] font-semibold text-[#ed8e99]/75">过热</span>
        <span className="border-l-2 border-[#c47c55]/60 pl-2 text-[10px] font-semibold text-[#e4aa7d]/75">偏热</span>
        <span className="border-l-2 border-[#d6b566]/60 pl-2 text-[10px] font-semibold text-[#e6cd8e]/70">中性</span>
        <span className="border-l-2 border-[#4ea98d]/60 pl-2 text-[10px] font-semibold text-[#8ccfb8]/75">偏冷</span>
        <span className="border-l-2 border-[#0f9f88]/60 pl-2 text-[10px] font-semibold text-[#6ed5b7]/75">极冷</span>
      </div>
      <div
        ref={containerRef}
        data-testid="temperature-chart"
        className="relative z-10 h-[360px] w-full sm:h-[420px]"
        aria-label={`${series.name}近500日相对估值热度曲线`}
      />
    </div>
  );
}

function LoadingState({ marketLabel }: { marketLabel: string }) {
  return (
    <section className="mt-8 border-y border-white/10 py-10" data-testid={`${marketLabel}-temperature-panel`}>
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

export function MarketTemperaturePanel({ mode = 'china' }: { mode?: 'china' | 'hongkong' | 'us' }) {
  const marketLabel = mode === 'china' ? 'A股' : mode === 'hongkong' ? '港股' : '美股';
  const [data, setData] = useState<ValuationDashboard | null>(null);
  const [selectedId, setSelectedId] = useState('all-market');
  const [reloadKey, setReloadKey] = useState(0);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setError('');
    fetch(`/api/valuation-temperature?market=${mode}`, { signal: controller.signal })
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
  }, [mode, reloadKey]);

  const selectedMarket = useMemo(
    () => data?.markets.find((item) => item.id === selectedId) || data?.overall,
    [data, selectedId],
  );
  const selectedSeries = useMemo(
    () => data?.charts.find((item) => item.id === selectedId),
    [data, selectedId],
  );

  if (!data && !error) return <LoadingState marketLabel={marketLabel} />;

  if (!data) {
    return (
      <section className="mt-8 border-y border-white/10 py-10" data-testid={`${mode}-temperature-panel`}>
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

  const activeTemperature = selectedMarket || data.overall;
  const activeStyle = zoneStyles[activeTemperature.zone];
  const displayMarketLabel = data.marketLabel || marketLabel;
  const activeAnchor = selectedId === 'all-market'
    ? data.bookValueAnchors?.[0] || data.bookValueAnchor
    : data.bookValueAnchors?.find((item) => item.id === selectedId) || data.bookValueAnchor;
  const longTermPbLabel = activeAnchor?.pbLabel || (mode === 'china' ? '全A长期PB' : `${displayMarketLabel}成份股样本PB`);
  const markerPosition = Math.max(1.5, Math.min(98.5, activeTemperature.temperature));
  const pbPercentile = activeAnchor?.current.pbPercentile;
  const medianPbGap = activeAnchor?.current.premiumPercent;
  const valuationConclusion = selectedId === 'all-market'
    ? data.overall.temperature >= 80 && (pbPercentile ?? 50) >= 60
      ? {
          title: '短中长期估值均偏高',
          detail: '近500日相对估值热度与较长历史PB分位同时偏高，需要关注估值回归风险。',
          tone: 'text-[#ed8e99]',
        }
      : data.overall.temperature >= 60 && (pbPercentile ?? 50) < 60
        ? {
            title: '短期偏热，中长期中性偏低',
            detail: `主要市场PE、PB相对最近500日处于较高位置，但${longTermPbLabel}尚未进入偏高区，不代表全面高估。`,
            tone: 'text-[#e4aa7d]',
          }
        : data.overall.temperature < 40 && (pbPercentile ?? 50) <= 40
          ? {
              title: '短中长期估值均偏低',
              detail: '近500日相对估值热度与较长历史PB分位同时偏低，但仍需结合盈利和风险偏好确认。',
              tone: 'text-[#6ed5b7]',
            }
          : {
              title: '短中长期信号未形成共振',
              detail: '短周期热度与长期PB分位没有出现一致的极端信号，应分别观察市场拥挤度与定投位置。',
              tone: 'text-[#e6cd8e]',
            }
    : activeTemperature.temperature >= 80
      ? {
          title: `${activeTemperature.name}短期估值过热`,
          detail: `该市场PE/PB热度处于近500日高位；${longTermPbLabel}仅作为背景，不能替代${activeTemperature.name}自身的长期估值判断。`,
          tone: 'text-[#ed8e99]',
        }
      : activeTemperature.temperature >= 60
        ? {
            title: `${activeTemperature.name}短期估值偏热`,
            detail: `该市场PE/PB热度高于近500日多数交易日，需结合盈利变化与下方历史曲线判断拥挤程度。`,
            tone: 'text-[#e4aa7d]',
          }
        : activeTemperature.temperature < 20
          ? {
              title: `${activeTemperature.name}短期估值极冷`,
              detail: '相对估值已接近近500日低位，但低温不等于立即见底，仍需确认盈利和风险偏好是否企稳。',
              tone: 'text-[#6ed5b7]',
            }
          : activeTemperature.temperature < 40
            ? {
                title: `${activeTemperature.name}短期估值偏低`,
                detail: '相对估值低于近500日多数交易日，可继续观察基本面与资金是否同步改善。',
                tone: 'text-[#6ed5b7]',
              }
            : {
                title: `${activeTemperature.name}短期估值中性`,
                detail: 'PE/PB热度位于近500日中间区域，暂未出现明显极端信号。',
                tone: 'text-[#e6cd8e]',
              };

  return (
    <section className="mt-8 border-y border-white/10 py-8 sm:py-10" data-testid={`${mode}-temperature-panel`}>
      <header className="flex flex-col gap-4 border-b border-white/10 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-[#74c9dd]">
            <Thermometer size={14} /> Relative valuation heat
          </p>
          <h2 className="mt-2 text-2xl font-bold text-white sm:text-3xl">{displayMarketLabel}近500日相对估值热度</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-white/48">
            PE 60% + PB 40%。热度只反映约两年的短周期相对位置，不等同于长期估值或定投信号。
            {data.coverage ? ` ${data.coverage}。` : ''}
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
              <Activity size={14} /> 当前判断 · {activeTemperature.name}
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
              <p className="text-[10px] text-white/34">短周期 PE/PB 热度</p>
              <p className={`mt-2 font-mono text-xl font-semibold ${activeStyle.text}`}>
                {activeTemperature.temperature.toFixed(0)}°
              </p>
              <p className="mt-1 text-[10px] text-white/28">近500日 · PE 60% + PB 40%</p>
            </div>
            <div className="bg-[#090b0d] p-4">
              <p className="text-[10px] text-white/34">{mode === 'china' ? '全 A 中位 PB 分位' : `${displayMarketLabel}样本 PB 分位`}</p>
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
              <p className="text-xs font-semibold text-white/48">{activeTemperature.name} · 近500日 PE/PB 综合热度</p>
              <div className="mt-2 flex items-end gap-2">
                <strong className={`font-mono text-6xl leading-none ${activeStyle.text}`}>
                  {activeTemperature.temperature.toFixed(0)}
                </strong>
                <span className="mb-1 text-xl text-white/42">°</span>
              </div>
            </div>
            <span className={`px-2.5 py-1 text-xs font-semibold ${activeStyle.background} ${activeStyle.text}`}>
              {activeTemperature.zoneLabel}
            </span>
          </div>

          <div className="relative mt-8 pt-4">
            <div className="flex h-2 overflow-hidden bg-white/[0.04]">
              <div className="w-1/5 bg-[#0f9f88]" />
              <div className="w-1/5 bg-[#4ea98d]" />
              <div className="w-1/5 bg-[#d6b566]" />
              <div className="w-1/5 bg-[#c47c55]" />
              <div className="w-1/5 bg-[#d04b5a]" />
            </div>
            <span
              className="absolute top-0 h-5 w-px bg-white shadow-[0_0_10px_rgba(255,255,255,0.7)]"
              style={{ left: `${markerPosition}%` }}
            />
            <div className="mt-2 flex justify-between font-mono text-[10px] text-white/34">
              <span>0 极冷</span>
              <span>20</span>
              <span>40</span>
              <span>60</span>
              <span>80</span>
              <span>过热 100</span>
            </div>
          </div>

          <dl className="mt-7 grid grid-cols-3 gap-2 border-t border-white/8 pt-5">
            <div>
              <dt className="text-[10px] text-white/36">平均 PE</dt>
              <dd className="mt-1 font-mono text-sm font-semibold text-white/78">{activeTemperature.currentPe}</dd>
            </div>
            <div>
              <dt className="text-[10px] text-white/36">20日变化</dt>
              <dd className={`mt-1 flex items-center gap-1 font-mono text-sm font-semibold ${
                activeTemperature.temperatureDelta > 0 ? 'text-[#ed8e99]' : 'text-[#6ed5b7]'
              }`}>
                {activeTemperature.temperatureDelta > 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
                {Math.abs(activeTemperature.temperatureDelta).toFixed(1)}°
              </dd>
            </div>
            <div>
              <dt className="text-[10px] text-white/36">历史样本</dt>
              <dd className="mt-1 font-mono text-sm font-semibold text-white/78">{activeTemperature.sampleSize} 日</dd>
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

      {data.bookValueAnchors?.length ? (
        <BookValueAnchorChart data={data.bookValueAnchors} marketLabel={displayMarketLabel} selectedMarketId={selectedId} />
      ) : data.bookValueAnchor ? (
        <BookValueAnchorChart data={[data.bookValueAnchor]} marketLabel={displayMarketLabel} selectedMarketId={selectedId} />
      ) : null}

      {selectedSeries && selectedMarket ? (
        <div className="border-t border-white/10 pt-6">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="flex items-center gap-2 text-xs font-semibold text-[#d6b566]">
                <BarChart3 size={14} /> 相对估值热度历史
              </p>
              <h3 className="mt-1 text-lg font-bold text-white">{selectedSeries.name}</h3>
              <p className="mt-1 text-xs text-white/38">PE 60% + PB 40% · 近500个交易日相对分位</p>
            </div>
            <span className="flex items-center gap-2 font-mono text-xs text-[#e6cd8e]">
              <span className="h-0.5 w-4 bg-[#d6b566]" />
              当前 {selectedMarket.temperature.toFixed(0)}°
            </span>
          </div>
          <div className="overflow-hidden border border-white/10 bg-[#06090c]">
            <TemperatureChart key={selectedSeries.id} series={selectedSeries} />
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
