import { hierarchy, treemap, type HierarchyRectangularNode } from 'd3-hierarchy';
import {
  ChevronLeft,
  ExternalLink,
  Maximize2,
  Minimize2,
  Minus,
  Plus,
  RefreshCw,
  TriangleAlert,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type ChinaHeatmapStock = {
  code: string;
  name: string;
  price: number;
  changePercent: number;
  marketCap: number;
  industry: string;
  updatedAt?: string;
  sourceUrl: string;
};

type ChinaHeatmapResponse = {
  generatedAt: string;
  count: number;
  coverage: string;
  source: string;
  sourceUrl: string;
  stocks: ChinaHeatmapStock[];
};

type HeatmapNode = {
  name: string;
  stock?: ChinaHeatmapStock;
  children?: HeatmapNode[];
};

type ContainerSize = {
  width: number;
  height: number;
};

const REFRESH_INTERVAL_MS = 10_000;

function formatMarketCap(value: number) {
  if (value >= 1e12) return `${(value / 1e12).toFixed(2)}万亿`;
  return `${(value / 1e8).toFixed(value >= 1e11 ? 0 : 1)}亿`;
}

function formatChange(value: number) {
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function cellColor(changePercent: number) {
  const intensity = Math.min(Math.abs(changePercent) / 7, 1);
  if (changePercent > 0.03) {
    const red = Math.round(116 + intensity * 126);
    const green = Math.round(30 + intensity * 24);
    const blue = Math.round(43 + intensity * 26);
    return `rgb(${red} ${green} ${blue})`;
  }
  if (changePercent < -0.03) {
    const red = Math.round(13 - intensity * 3);
    const green = Math.round(70 + intensity * 83);
    const blue = Math.round(53 + intensity * 76);
    return `rgb(${red} ${green} ${blue})`;
  }
  return 'rgb(62 64 68)';
}

function useContainerSize() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<ContainerSize>({ width: 0, height: 0 });

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const update = () => {
      const rect = element.getBoundingClientRect();
      setSize({
        width: Math.max(0, Math.floor(rect.width)),
        height: Math.max(0, Math.floor(rect.height)),
      });
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return { ref, size };
}

function groupStocks(stocks: ChinaHeatmapStock[]) {
  const industries = new Map<string, ChinaHeatmapStock[]>();
  for (const stock of stocks) {
    const group = industries.get(stock.industry) ?? [];
    group.push(stock);
    industries.set(stock.industry, group);
  }
  return industries;
}

function buildTree(stocks: ChinaHeatmapStock[], activeIndustry: string | null) {
  if (activeIndustry) {
    return {
      name: activeIndustry,
      children: stocks
        .filter((stock) => stock.industry === activeIndustry)
        .map((stock) => ({ name: stock.name, stock })),
    } satisfies HeatmapNode;
  }

  return {
    name: '全部',
    children: [...groupStocks(stocks).entries()].map(([industry, members]) => ({
      name: industry,
      children: members.map((stock) => ({ name: stock.name, stock })),
    })),
  } satisfies HeatmapNode;
}

function calculateLayout(
  stocks: ChinaHeatmapStock[],
  size: ContainerSize,
  activeIndustry: string | null,
) {
  if (!stocks.length || size.width < 10 || size.height < 10) return undefined;

  const root = hierarchy<HeatmapNode>(buildTree(stocks, activeIndustry))
    .sum((node) => node.stock?.marketCap ?? 0)
    .sort((left, right) => (right.value ?? 0) - (left.value ?? 0));

  return treemap<HeatmapNode>()
    .size([size.width, size.height])
    .paddingOuter(activeIndustry ? 1 : 2)
    .paddingInner(2)
    .paddingTop((node) => (!activeIndustry && node.depth === 1 ? 25 : 0))
    .round(true)(root);
}

function StockCell({
  node,
  selected,
  expanded,
  onSelect,
  onHover,
}: {
  node: HierarchyRectangularNode<HeatmapNode>;
  selected: boolean;
  expanded: boolean;
  onSelect: (stock: ChinaHeatmapStock) => void;
  onHover: (stock: ChinaHeatmapStock | null) => void;
}) {
  const stock = node.data.stock;
  if (!stock) return null;

  const width = node.x1 - node.x0;
  const height = node.y1 - node.y0;
  if (width < 3 || height < 3) return null;

  const showName = width >= 46 && height >= 28;
  const showLogo = width >= 82 && height >= 72;
  const showCode = width >= 78 && height >= 56;
  const showValue = width >= 58 && height >= 42;
  const nameSize = expanded && width >= 180 && height >= 150
    ? 22
    : width >= 135 && height >= 92
      ? 16
      : width >= 80
        ? 12
        : 10;
  const valueSize = expanded && width >= 180 && height >= 150 ? 20 : width >= 100 ? 14 : 11;
  const tooltip = `${stock.name}（${stock.code}）\n现价 ${stock.price.toFixed(2)}\n涨跌 ${formatChange(stock.changePercent)}\n总市值 ${formatMarketCap(stock.marketCap)}`;

  return (
    <button
      type="button"
      title={tooltip}
      aria-label={tooltip.split('\n').join('，')}
      onClick={() => onSelect(stock)}
      onMouseEnter={() => onHover(stock)}
      onMouseLeave={() => onHover(null)}
      className={`absolute flex min-h-0 min-w-0 flex-col items-center justify-center overflow-hidden border border-black/60 px-1 text-center text-white transition-[filter,box-shadow] duration-150 hover:z-30 hover:brightness-125 focus:z-30 focus:outline-none ${
        selected ? 'z-30 shadow-[inset_0_0_0_3px_#2f8cff]' : ''
      }`}
      style={{
        left: node.x0,
        top: node.y0,
        width,
        height,
        backgroundColor: cellColor(stock.changePercent),
      }}
    >
      {showLogo ? (
        <span
          className={`mb-2 grid shrink-0 place-items-center rounded-full border border-white/24 bg-black/28 font-bold text-white shadow-[0_2px_12px_rgba(0,0,0,0.32)] backdrop-blur-sm ${
            expanded && width >= 180 && height >= 150 ? 'h-14 w-14 text-xl' : 'h-9 w-9 text-sm'
          }`}
        >
          {stock.name.slice(0, 1)}
        </span>
      ) : null}
      {showName ? (
        <span className="max-w-full truncate font-semibold leading-tight" style={{ fontSize: nameSize }}>
          {stock.name}
        </span>
      ) : null}
      {showCode ? <span className="mt-1 text-[9px] leading-none text-white/66">{stock.code}</span> : null}
      {showValue ? (
        <span className="mt-1.5 font-mono font-semibold leading-none" style={{ fontSize: valueSize }}>
          {formatChange(stock.changePercent)}
        </span>
      ) : null}
    </button>
  );
}

function MapControl({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="grid h-9 w-9 place-items-center text-white/74 transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-25"
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  );
}

export function ChinaMarketHeatmap() {
  const mapShellRef = useRef<HTMLDivElement | null>(null);
  const { ref, size } = useContainerSize();
  const [data, setData] = useState<ChinaHeatmapResponse>();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [activeIndustry, setActiveIndustry] = useState<string | null>(null);
  const [selectedCode, setSelectedCode] = useState('');
  const [hoveredCode, setHoveredCode] = useState('');
  const [fullscreen, setFullscreen] = useState(false);

  const load = useCallback(async (signal?: AbortSignal, manual = false) => {
    if (manual) setRefreshing(true);
    try {
      const response = await fetch('/api/china-market-heatmap', { signal, cache: 'no-store' });
      if (!response.ok) throw new Error(`行情接口返回 ${response.status}`);
      const payload = (await response.json()) as ChinaHeatmapResponse;
      if (!payload.stocks?.length) throw new Error('暂未取得有效行情');
      setData(payload);
      setError('');
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === 'AbortError') return;
      setError(caught instanceof Error ? caught.message : 'A 股热力图加载失败');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);

    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load(controller.signal);
    }, REFRESH_INTERVAL_MS);

    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [load]);

  useEffect(() => {
    const onFullscreenChange = () => setFullscreen(document.fullscreenElement === mapShellRef.current);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  const layout = useMemo(
    () => calculateLayout(data?.stocks ?? [], size, activeIndustry),
    [activeIndustry, data?.stocks, size],
  );
  const industryNodes = activeIndustry ? [] : layout?.children ?? [];
  const stockNodes = layout?.leaves() ?? [];
  const selectedStock = data?.stocks.find((stock) => stock.code === selectedCode);
  const hoveredStock = data?.stocks.find((stock) => stock.code === hoveredCode);
  const focusedStock = hoveredStock ?? selectedStock;
  const largestIndustry = useMemo(() => {
    if (!data?.stocks.length) return '';
    return [...groupStocks(data.stocks).entries()]
      .map(([industry, members]) => ({
        industry,
        marketCap: members.reduce((sum, stock) => sum + stock.marketCap, 0),
      }))
      .sort((left, right) => right.marketCap - left.marketCap)[0]?.industry ?? '';
  }, [data?.stocks]);
  const updatedAt = data?.generatedAt
    ? new Intl.DateTimeFormat('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }).format(new Date(data.generatedAt))
    : '--:--:--';

  const openIndustry = useCallback((industry: string) => {
    setActiveIndustry(industry);
    setSelectedCode('');
    setHoveredCode('');
  }, []);

  const resetView = useCallback(() => {
    setActiveIndustry(null);
    setSelectedCode('');
    setHoveredCode('');
  }, []);

  const zoomIn = useCallback(() => {
    if (activeIndustry) return;
    const industry = focusedStock?.industry || largestIndustry;
    if (industry) openIndustry(industry);
  }, [activeIndustry, focusedStock?.industry, largestIndustry, openIndustry]);

  const toggleFullscreen = useCallback(async () => {
    if (document.fullscreenElement === mapShellRef.current) {
      await document.exitFullscreen();
      return;
    }
    await mapShellRef.current?.requestFullscreen();
  }, []);

  return (
    <div
      ref={mapShellRef}
      className="flex h-full min-h-0 flex-col bg-[#060708] text-white"
      aria-label="A 股大盘热力图"
    >
      {activeIndustry ? (
        <div className="flex h-10 shrink-0 items-center border-b border-white/14 bg-[#090a0c] px-2">
          <button
            type="button"
            onClick={resetView}
            className="inline-flex h-8 items-center gap-1.5 px-1 text-xs font-semibold text-white/82 transition hover:text-white"
          >
            <ChevronLeft size={16} />
            全部
          </button>
          <span className="mx-2 text-white/24">·</span>
          <span className="truncate text-xs font-semibold">{activeIndustry}</span>
        </div>
      ) : null}

      <div ref={ref} className="relative min-h-0 flex-1 overflow-hidden bg-[#0b0c0e]">
        {layout ? (
          <>
            {industryNodes.map((node) => (
              <div
                key={`${node.data.name}-frame`}
                className="pointer-events-none absolute z-10 border border-white/22"
                style={{
                  left: node.x0,
                  top: node.y0,
                  width: node.x1 - node.x0,
                  height: node.y1 - node.y0,
                }}
              />
            ))}
            {industryNodes.map((node) => {
              const width = node.x1 - node.x0;
              if (width < 28) return null;
              return (
                <button
                  type="button"
                  key={`${node.data.name}-header`}
                  onClick={() => openIndustry(node.data.name)}
                  className="absolute z-20 flex h-[24px] items-center overflow-hidden bg-[#08090b] px-2 text-left text-[10px] font-semibold text-white/82 transition hover:bg-[#202227] hover:text-white"
                  style={{
                    left: node.x0 + 1,
                    top: node.y0 + 1,
                    width: Math.max(0, width - 2),
                  }}
                  title={`放大查看 ${node.data.name}`}
                >
                  <span className="truncate">{node.data.name}</span>
                  <span className="ml-1 text-white/54">›</span>
                </button>
              );
            })}
            {stockNodes.map((node) => (
              <StockCell
                key={node.data.stock?.code ?? node.data.name}
                node={node}
                selected={node.data.stock?.code === selectedCode}
                expanded={Boolean(activeIndustry)}
                onSelect={(stock) => setSelectedCode((current) => current === stock.code ? '' : stock.code)}
                onHover={(stock) => setHoveredCode(stock?.code ?? '')}
              />
            ))}
          </>
        ) : null}

        <div className="absolute right-3 top-1/2 z-40 -translate-y-1/2 overflow-hidden rounded-md border border-white/12 bg-[#17191d]/94 shadow-[0_10px_28px_rgba(0,0,0,0.42)] backdrop-blur">
          <MapControl label="放大行业" disabled={Boolean(activeIndustry)} onClick={zoomIn}>
            <Plus size={19} />
          </MapControl>
          <div className="h-px bg-white/10" />
          <MapControl label="返回全部" disabled={!activeIndustry} onClick={resetView}>
            <Minus size={19} />
          </MapControl>
          <div className="h-px bg-white/10" />
          <MapControl label={fullscreen ? '退出全屏' : '全屏查看'} onClick={() => void toggleFullscreen()}>
            {fullscreen ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
          </MapControl>
        </div>

        {focusedStock ? (
          <div className="absolute bottom-4 left-1/2 z-40 flex max-w-[calc(100%-32px)] -translate-x-1/2 items-center gap-4 rounded-md border border-white/12 bg-[#17191d]/96 px-4 py-3 shadow-[0_14px_36px_rgba(0,0,0,0.48)] backdrop-blur-xl">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-white/24 bg-black/34 text-sm font-bold text-white">
              {focusedStock.name.slice(0, 1)}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{focusedStock.name}</p>
              <p className="mt-0.5 font-mono text-[10px] text-white/46">{focusedStock.code} · {focusedStock.industry}</p>
            </div>
            <div className="hidden h-8 w-px bg-white/12 sm:block" />
            <div className="hidden shrink-0 sm:block">
              <p className="font-mono text-sm font-semibold">{focusedStock.price.toFixed(2)}</p>
              <p className="mt-0.5 text-[9px] text-white/40">价格</p>
            </div>
            <div className="hidden shrink-0 sm:block">
              <p className="font-mono text-sm font-semibold">{formatMarketCap(focusedStock.marketCap)}</p>
              <p className="mt-0.5 text-[9px] text-white/40">总市值</p>
            </div>
            <div className="shrink-0">
              <p className={`font-mono text-sm font-semibold ${focusedStock.changePercent >= 0 ? 'text-[#ff6673]' : 'text-[#35d6aa]'}`}>
                {formatChange(focusedStock.changePercent)}
              </p>
              <p className="mt-0.5 text-[9px] text-white/40">涨跌</p>
            </div>
            <a
              href={focusedStock.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="grid h-8 w-8 shrink-0 place-items-center text-white/54 transition hover:text-white"
              aria-label={`查看 ${focusedStock.name} 详情`}
              title="查看行情详情"
            >
              <ExternalLink size={15} />
            </a>
          </div>
        ) : null}

        {loading && !data ? (
          <div className="absolute inset-0 z-50 grid place-items-center bg-black/42">
            <div className="text-center">
              <div className="mx-auto mb-3 h-7 w-7 animate-spin rounded-full border-2 border-white/18 border-t-[#69d5ff]" />
              <p className="text-sm font-semibold text-white/76">正在整理 A 股全市场热力图</p>
            </div>
          </div>
        ) : null}

        {error && !data ? (
          <div className="absolute inset-0 z-50 grid place-items-center px-6 text-center">
            <div>
              <TriangleAlert className="mx-auto mb-3 text-[#d6b566]" size={24} />
              <p className="text-sm font-semibold text-white/78">热力图暂时无法加载</p>
              <p className="mt-2 text-xs text-white/42">{error}</p>
              <button
                type="button"
                onClick={() => void load(undefined, true)}
                className="mt-4 inline-flex h-9 items-center gap-2 border border-white/15 px-3 text-xs font-semibold text-white/72 transition hover:border-white/35 hover:text-white"
              >
                <RefreshCw size={14} />
                重试
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <div className="flex min-h-11 shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-white/10 bg-[#090a0c] px-3 py-2 text-[11px] text-white/48">
        <div className="flex items-center gap-3">
          <span className="font-semibold text-white/64">{data?.source ?? '东方财富'}</span>
          <span>{activeIndustry ? `${activeIndustry} · 点击个股查看详情` : data?.coverage ?? 'A 股总市值前 320 家公司'}</span>
          <span>更新 {updatedAt}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 bg-[#c33144]" />上涨</span>
          <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 bg-[#0d8d70]" />下跌</span>
          <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 bg-[#3e4044]" />平盘</span>
          <button
            type="button"
            onClick={() => void load(undefined, true)}
            disabled={refreshing}
            className="inline-flex h-7 w-7 items-center justify-center text-white/56 transition hover:text-white disabled:opacity-45"
            aria-label="刷新 A 股热力图"
            title="刷新"
          >
            <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>
    </div>
  );
}
