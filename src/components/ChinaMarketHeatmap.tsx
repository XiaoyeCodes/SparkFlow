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
  industrySourceUrl?: string;
  industryMarketCaps?: Record<string, number>;
  stocks: ChinaHeatmapStock[];
};

type HeatmapNode = {
  name: string;
  stock?: ChinaHeatmapStock;
  weight?: number;
  children?: HeatmapNode[];
};

type ContainerSize = {
  width: number;
  height: number;
};

type MapView = {
  scale: number;
  x: number;
  y: number;
};

const REFRESH_INTERVAL_MS = 10_000;
const MIN_ZOOM = 1;
const ABSOLUTE_MAX_ZOOM = 32;
const MIN_CHANGE_WIDTH = 56;
const MIN_CHANGE_HEIGHT = 40;
const INDUSTRY_AREA_EXPONENT = 1.22;
const STOCK_AREA_EXPONENT = 0.8;
const INDUSTRY_DISPLAY_PRIORITY = ['半导体', '银行Ⅱ'];
const DEFAULT_MAP_VIEW: MapView = { scale: MIN_ZOOM, x: 0, y: 0 };

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

function clampMapView(view: MapView, size: ContainerSize, maxZoom: number): MapView {
  const scale = Math.min(maxZoom, Math.max(MIN_ZOOM, view.scale));
  if (scale === MIN_ZOOM || !size.width || !size.height) {
    return DEFAULT_MAP_VIEW;
  }

  return {
    scale,
    x: Math.min(0, Math.max(size.width * (1 - scale), view.x)),
    y: Math.min(0, Math.max(size.height * (1 - scale), view.y)),
  };
}

function zoomMapView(
  current: MapView,
  nextScale: number,
  anchor: { x: number; y: number },
  size: ContainerSize,
  maxZoom: number,
) {
  const scale = Math.min(maxZoom, Math.max(MIN_ZOOM, nextScale));
  if (scale === MIN_ZOOM) return DEFAULT_MAP_VIEW;

  const ratio = scale / current.scale;
  return clampMapView({
    scale,
    x: anchor.x - (anchor.x - current.x) * ratio,
    y: anchor.y - (anchor.y - current.y) * ratio,
  }, size, maxZoom);
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

function createWeightedStockNodes(stocks: ChinaHeatmapStock[], targetWeight?: number) {
  const scores = stocks.map((stock) => Math.pow(stock.marketCap, STOCK_AREA_EXPONENT));
  const scoreTotal = scores.reduce((sum, score) => sum + score, 0);
  const groupWeight = targetWeight ?? scoreTotal;

  return stocks.map((stock, index) => ({
    name: stock.name,
    stock,
    weight: scoreTotal > 0 ? groupWeight * (scores[index] / scoreTotal) : 0,
  }));
}

function buildTree(
  stocks: ChinaHeatmapStock[],
  activeIndustry: string | null,
  industryMarketCaps?: Record<string, number>,
) {
  if (activeIndustry) {
    const members = stocks.filter((stock) => stock.industry === activeIndustry);
    return {
      name: activeIndustry,
      children: createWeightedStockNodes(members),
    } satisfies HeatmapNode;
  }

  return {
    name: '全部',
    children: [...groupStocks(stocks).entries()].map(([industry, members]) => {
      const sampledMarketCap = members.reduce((sum, stock) => sum + stock.marketCap, 0);
      const industryMarketCap = industryMarketCaps?.[industry] ?? sampledMarketCap;
      const industryWeight = Math.pow(industryMarketCap, INDUSTRY_AREA_EXPONENT);
      return {
        name: industry,
        children: createWeightedStockNodes(members, industryWeight),
      };
    }),
  } satisfies HeatmapNode;
}

function calculateLayout(
  stocks: ChinaHeatmapStock[],
  size: ContainerSize,
  activeIndustry: string | null,
  industryMarketCaps: Record<string, number> | undefined,
) {
  if (!stocks.length || size.width < 10 || size.height < 10) return undefined;

  const root = hierarchy<HeatmapNode>(buildTree(stocks, activeIndustry, industryMarketCaps))
    .sum((node) => node.weight ?? 0)
    .sort((left, right) => {
      if (left.depth === 1 && right.depth === 1) {
        const leftPriority = INDUSTRY_DISPLAY_PRIORITY.indexOf(left.data.name);
        const rightPriority = INDUSTRY_DISPLAY_PRIORITY.indexOf(right.data.name);
        const leftRank = leftPriority === -1 ? Number.POSITIVE_INFINITY : leftPriority;
        const rightRank = rightPriority === -1 ? Number.POSITIVE_INFINITY : rightPriority;
        if (leftRank !== rightRank) return leftRank - rightRank;
      }
      return (right.value ?? 0) - (left.value ?? 0);
    });

  return treemap<HeatmapNode>()
    .size([size.width, size.height])
    .paddingOuter(activeIndustry ? 3 : 4)
    .paddingInner((node) => node.depth === 0 ? 6 : 3)
    .paddingTop((node) => (!activeIndustry && node.depth === 1 ? 27 : 0))
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

  const visualWidth = width;
  const visualHeight = height;
  const showFullName = visualWidth >= 92 && visualHeight >= 48;
  const showInitial = !showFullName && visualWidth >= 40 && visualHeight >= 28;
  const showLogo = visualWidth >= 112 && visualHeight >= 96;
  const showCode = showFullName && visualWidth >= 104 && visualHeight >= 70;
  const showValue = visualWidth >= MIN_CHANGE_WIDTH && visualHeight >= MIN_CHANGE_HEIGHT;
  const nameSize = expanded && visualWidth >= 180 && visualHeight >= 150
    ? 22
    : visualWidth >= 145 && visualHeight >= 92
      ? 16
      : visualWidth >= 104
        ? 12
        : 10;
  const valueSize = expanded && visualWidth >= 180 && visualHeight >= 150
    ? 20
    : visualWidth >= 112
      ? 14
      : 11;
  const tooltip = `${stock.name}（${stock.code}）\n现价 ${stock.price.toFixed(2)}\n涨跌 ${formatChange(stock.changePercent)}\n总市值 ${formatMarketCap(stock.marketCap)}`;

  return (
    <button
      type="button"
      data-stock-code={stock.code}
      title={tooltip}
      aria-label={tooltip.split('\n').join('，')}
      onClick={() => onSelect(stock)}
      onMouseEnter={() => onHover(stock)}
      onMouseLeave={() => onHover(null)}
      className={`absolute min-h-0 min-w-0 overflow-hidden text-center text-white transition-[filter,box-shadow] duration-150 hover:z-30 hover:brightness-125 focus:z-30 focus:outline-none ${
        selected ? 'z-30' : ''
      }`}
      style={{
        left: node.x0,
        top: node.y0,
        width,
        height,
        backgroundColor: cellColor(stock.changePercent),
        borderRadius: 3,
        boxShadow: selected ? 'inset 0 0 0 2px #2f8cff' : undefined,
      }}
    >
      <span
        className="absolute left-1/2 top-1/2 flex flex-col items-center justify-center overflow-hidden px-1"
        style={{
          width: '100%',
          height: '100%',
          transform: 'translate(-50%, -50%)',
        }}
      >
        {showLogo ? (
          <span
            className={`mb-2 grid shrink-0 place-items-center rounded-full border border-white/24 bg-black/28 font-bold text-white shadow-[0_2px_12px_rgba(0,0,0,0.32)] backdrop-blur-sm ${
              expanded && visualWidth >= 180 && visualHeight >= 150 ? 'h-14 w-14 text-xl' : 'h-9 w-9 text-sm'
            }`}
          >
            {stock.name.slice(0, 1)}
          </span>
        ) : null}
        {showFullName ? (
          <span className="max-w-full truncate font-semibold leading-tight" style={{ fontSize: nameSize }}>
            {stock.name}
          </span>
        ) : showInitial ? (
          <span className="font-semibold leading-none text-white/88" style={{ fontSize: nameSize }}>
            {stock.name.slice(0, 1)}
          </span>
        ) : null}
        {showCode ? <span className="mt-1 text-[9px] leading-none text-white/66">{stock.code}</span> : null}
        {showValue ? (
          <span className="mt-1.5 font-mono font-semibold leading-none" style={{ fontSize: valueSize }}>
            {formatChange(stock.changePercent)}
          </span>
        ) : null}
      </span>
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
  const [mapView, setMapView] = useState<MapView>(DEFAULT_MAP_VIEW);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{
    pointerId: number;
    clientX: number;
    clientY: number;
    x: number;
    y: number;
    moved: boolean;
    clickTarget?: {
      type: 'stock' | 'industry';
      value: string;
    };
  } | null>(null);
  const suppressClickRef = useRef(false);

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

  const baseLayout = useMemo(
    () => calculateLayout(
      data?.stocks ?? [],
      size,
      activeIndustry,
      data?.industryMarketCaps,
    ),
    [activeIndustry, data?.industryMarketCaps, data?.stocks, size],
  );
  const scaledSize = useMemo(() => ({
    width: Math.max(0, Math.round(size.width * mapView.scale)),
    height: Math.max(0, Math.round(size.height * mapView.scale)),
  }), [mapView.scale, size.height, size.width]);
  const layout = useMemo(
    () => calculateLayout(
      data?.stocks ?? [],
      scaledSize,
      activeIndustry,
      data?.industryMarketCaps,
    ),
    [activeIndustry, data?.industryMarketCaps, data?.stocks, scaledSize],
  );
  const industryNodes = useMemo(
    () => activeIndustry ? [] : layout?.children ?? [],
    [activeIndustry, layout],
  );
  const stockNodes = useMemo(() => layout?.leaves() ?? [], [layout]);
  const maxZoom = useMemo(() => {
    const requiredZoom = (baseLayout?.leaves() ?? []).reduce((required, node) => {
      const width = node.x1 - node.x0;
      const height = node.y1 - node.y0;
      if (width < 3 || height < 3) return required;
      return Math.max(
        required,
        MIN_CHANGE_WIDTH / width,
        MIN_CHANGE_HEIGHT / height,
      );
    }, MIN_ZOOM);

    return Math.min(
      ABSOLUTE_MAX_ZOOM,
      Math.max(4, Math.ceil(requiredZoom * 10) / 10),
    );
  }, [baseLayout]);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const multiplier = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 0.045 : 0.0015;
      const factor = Math.exp(-event.deltaY * multiplier);
      const anchor = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };
      setMapView((current) => zoomMapView(
        current,
        current.scale * factor,
        anchor,
        size,
        maxZoom,
      ));
    };

    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [maxZoom, ref, size]);

  useEffect(() => {
    setMapView((current) => clampMapView(current, size, maxZoom));
  }, [maxZoom, size]);

  const selectedStock = data?.stocks.find((stock) => stock.code === selectedCode);
  const hoveredStock = data?.stocks.find((stock) => stock.code === hoveredCode);
  const focusedStock = hoveredStock ?? selectedStock;
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
    setMapView(DEFAULT_MAP_VIEW);
  }, []);

  const resetView = useCallback(() => {
    setActiveIndustry(null);
    setSelectedCode('');
    setHoveredCode('');
    setMapView(DEFAULT_MAP_VIEW);
  }, []);

  const zoomIn = useCallback(() => {
    setMapView((current) => zoomMapView(
      current,
      current.scale * 1.35,
      { x: size.width / 2, y: size.height / 2 },
      size,
      maxZoom,
    ));
  }, [maxZoom, size]);

  const zoomOut = useCallback(() => {
    setMapView((current) => zoomMapView(
      current,
      current.scale / 1.35,
      { x: size.width / 2, y: size.height / 2 },
      size,
      maxZoom,
    ));
  }, [maxZoom, size]);

  const beginDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (mapView.scale <= MIN_ZOOM || event.button !== 0) return;
    if ((event.target as HTMLElement).closest('[data-map-fixed]')) return;
    if (dragRef.current) return;

    const target = (event.target as HTMLElement).closest<HTMLElement>(
      '[data-stock-code], [data-industry-button]',
    );
    const clickTarget = target?.dataset.stockCode
      ? { type: 'stock' as const, value: target.dataset.stockCode }
      : target?.dataset.industryButton
        ? { type: 'industry' as const, value: target.dataset.industryButton }
        : undefined;

    dragRef.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      x: mapView.x,
      y: mapView.y,
      moved: false,
      clickTarget,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [mapView]);

  const moveDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    const deltaX = event.clientX - drag.clientX;
    const deltaY = event.clientY - drag.clientY;
    if (!drag.moved) {
      if (Math.hypot(deltaX, deltaY) < 5) return;
      drag.moved = true;
      setHoveredCode('');
      setDragging(true);
    }

    setMapView((current) => clampMapView({
      scale: current.scale,
      x: drag.x + deltaX,
      y: drag.y + deltaY,
    }, size, maxZoom));
  }, [maxZoom, size]);

  const endDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
    setDragging(false);

    if (drag.moved) {
      suppressClickRef.current = true;
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
      return;
    }

    if (drag.clickTarget) {
      suppressClickRef.current = true;
      if (drag.clickTarget.type === 'stock') {
        const code = drag.clickTarget.value;
        setSelectedCode((current) => current === code ? '' : code);
      } else {
        openIndustry(drag.clickTarget.value);
      }
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
    }
  }, [openIndustry]);

  const selectStock = useCallback((stock: ChinaHeatmapStock) => {
    if (suppressClickRef.current) return;
    setSelectedCode((current) => current === stock.code ? '' : stock.code);
  }, []);

  const selectIndustry = useCallback((industry: string) => {
    if (suppressClickRef.current) return;
    openIndustry(industry);
  }, [openIndustry]);

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

      <div
        ref={ref}
        className={`relative min-h-0 flex-1 overflow-hidden bg-[#0b0c0e] ${
          mapView.scale > MIN_ZOOM ? (dragging ? 'cursor-grabbing' : 'cursor-grab') : ''
        }`}
        style={{ touchAction: 'none' }}
        data-zoom-scale={mapView.scale.toFixed(3)}
        data-max-zoom={maxZoom.toFixed(1)}
        onPointerDown={beginDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {layout ? (
          <div
            className="absolute"
            style={{
              left: Math.round(mapView.x),
              top: Math.round(mapView.y),
              width: scaledSize.width,
              height: scaledSize.height,
            }}
          >
            {industryNodes.map((node) => (
              <div
                key={`${node.data.name}-frame`}
                data-industry={node.data.name}
                className="pointer-events-none absolute z-0 rounded-[5px] bg-[#060709]"
                style={{
                  left: node.x0,
                  top: node.y0,
                  width: node.x1 - node.x0,
                  height: node.y1 - node.y0,
                  borderRadius: 5,
                }}
              />
            ))}
            {industryNodes.map((node) => {
              const width = node.x1 - node.x0;
              const visualWidth = width;
              if (visualWidth < 40) return null;
              const label = visualWidth >= 96 ? node.data.name : node.data.name.slice(0, 1);
              return (
                <button
                  type="button"
                  key={`${node.data.name}-header`}
                  data-industry-button={node.data.name}
                  onClick={() => selectIndustry(node.data.name)}
                  className="absolute z-20 flex items-center overflow-hidden rounded-t-[4px] bg-[#101216] px-2 text-left text-[10px] font-semibold text-white/72 transition hover:bg-[#20242a] hover:text-white"
                  style={{
                    left: node.x0 + 2,
                    top: node.y0 + 2,
                    width: Math.max(0, visualWidth - 4),
                    height: 23,
                  }}
                  title={`放大查看 ${node.data.name}`}
                >
                  <span className="truncate">{label}</span>
                  {visualWidth >= 72 ? <span className="ml-1 text-white/42">›</span> : null}
                </button>
              );
            })}
            {stockNodes.map((node) => (
              <StockCell
                key={node.data.stock?.code ?? node.data.name}
                node={node}
                selected={node.data.stock?.code === selectedCode}
                expanded={Boolean(activeIndustry)}
                onSelect={selectStock}
                onHover={(stock) => {
                  if (!dragging) setHoveredCode(stock?.code ?? '');
                }}
              />
            ))}
          </div>
        ) : null}

        <div
          data-map-fixed
          className="absolute right-3 top-1/2 z-40 -translate-y-1/2 overflow-hidden rounded-md border border-white/12 bg-[#17191d]/94 shadow-[0_10px_28px_rgba(0,0,0,0.42)] backdrop-blur"
        >
          <MapControl label="放大热力图" disabled={mapView.scale >= maxZoom - 0.01} onClick={zoomIn}>
            <Plus size={19} />
          </MapControl>
          <div className="h-px bg-white/10" />
          <MapControl label="缩小热力图" disabled={mapView.scale <= MIN_ZOOM + 0.01} onClick={zoomOut}>
            <Minus size={19} />
          </MapControl>
          <div className="h-px bg-white/10" />
          <MapControl label={fullscreen ? '退出全屏' : '全屏查看'} onClick={() => void toggleFullscreen()}>
            {fullscreen ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
          </MapControl>
        </div>

        {focusedStock ? (
          <div
            data-map-fixed
            className="absolute bottom-4 left-1/2 z-40 flex max-w-[calc(100%-32px)] -translate-x-1/2 items-center gap-4 rounded-md border border-white/12 bg-[#17191d]/96 px-4 py-3 shadow-[0_14px_36px_rgba(0,0,0,0.48)] backdrop-blur-xl"
          >
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
