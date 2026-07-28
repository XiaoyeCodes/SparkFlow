import { hierarchy, treemap, type HierarchyRectangularNode } from 'd3-hierarchy';
import { RefreshCw, TriangleAlert } from 'lucide-react';
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
  const intensity = Math.min(Math.abs(changePercent) / 6, 1);
  if (changePercent > 0.03) {
    const red = Math.round(112 + intensity * 78);
    const green = Math.round(36 + intensity * 12);
    const blue = Math.round(47 + intensity * 13);
    return `rgb(${red} ${green} ${blue})`;
  }
  if (changePercent < -0.03) {
    const red = Math.round(16 + intensity * 10);
    const green = Math.round(83 + intensity * 52);
    const blue = Math.round(65 + intensity * 33);
    return `rgb(${red} ${green} ${blue})`;
  }
  return 'rgb(54 57 62)';
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

function buildTree(stocks: ChinaHeatmapStock[]) {
  const industries = new Map<string, ChinaHeatmapStock[]>();
  for (const stock of stocks) {
    const group = industries.get(stock.industry) ?? [];
    group.push(stock);
    industries.set(stock.industry, group);
  }

  return {
    name: 'A股',
    children: [...industries.entries()].map(([industry, members]) => ({
      name: industry,
      children: members.map((stock) => ({ name: stock.name, stock })),
    })),
  } satisfies HeatmapNode;
}

function calculateLayout(stocks: ChinaHeatmapStock[], size: ContainerSize) {
  if (!stocks.length || size.width < 10 || size.height < 10) return undefined;

  const root = hierarchy<HeatmapNode>(buildTree(stocks))
    .sum((node) => node.stock?.marketCap ?? 0)
    .sort((left, right) => (right.value ?? 0) - (left.value ?? 0));

  return treemap<HeatmapNode>()
    .size([size.width, size.height])
    .paddingOuter(2)
    .paddingInner(2)
    .paddingTop((node) => (node.depth === 1 ? 23 : 0))
    .round(true)(root);
}

function StockCell({ node }: { node: HierarchyRectangularNode<HeatmapNode> }) {
  const stock = node.data.stock;
  if (!stock) return null;

  const width = node.x1 - node.x0;
  const height = node.y1 - node.y0;
  if (width < 3 || height < 3) return null;

  const showName = width >= 48 && height >= 28;
  const showCode = width >= 72 && height >= 52;
  const showValue = width >= 62 && height >= 42;
  const nameSize = width >= 125 && height >= 76 ? 15 : width >= 78 ? 12 : 10;
  const tooltip = `${stock.name}（${stock.code}）\n现价 ${stock.price.toFixed(2)}\n涨跌 ${formatChange(stock.changePercent)}\n总市值 ${formatMarketCap(stock.marketCap)}`;

  return (
    <a
      href={stock.sourceUrl}
      target="_blank"
      rel="noreferrer"
      title={tooltip}
      aria-label={tooltip.split('\n').join('，')}
      className="absolute flex min-h-0 min-w-0 flex-col items-center justify-center overflow-hidden border border-black/35 px-1 text-center text-white transition-[filter] duration-150 hover:z-20 hover:brightness-125 focus:z-20 focus:outline-none focus:ring-2 focus:ring-white/75"
      style={{
        left: node.x0,
        top: node.y0,
        width,
        height,
        backgroundColor: cellColor(stock.changePercent),
      }}
    >
      {showName ? (
        <span className="max-w-full truncate font-bold leading-tight" style={{ fontSize: nameSize }}>
          {stock.name}
        </span>
      ) : null}
      {showCode ? <span className="mt-0.5 text-[9px] leading-none text-white/65">{stock.code}</span> : null}
      {showValue ? (
        <span className="mt-1 font-mono text-[11px] font-semibold leading-none">{formatChange(stock.changePercent)}</span>
      ) : null}
    </a>
  );
}

export function ChinaMarketHeatmap() {
  const { ref, size } = useContainerSize();
  const [data, setData] = useState<ChinaHeatmapResponse>();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

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

  const layout = useMemo(() => calculateLayout(data?.stocks ?? [], size), [data?.stocks, size]);
  const industryNodes = layout?.children ?? [];
  const stockNodes = layout?.leaves() ?? [];
  const updatedAt = data?.generatedAt
    ? new Intl.DateTimeFormat('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }).format(new Date(data.generatedAt))
    : '--:--:--';

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#060708]" aria-label="A 股大盘热力图">
      <div ref={ref} className="relative min-h-0 flex-1 overflow-hidden">
        {layout ? (
          <>
            {industryNodes.map((node) => (
              <div
                key={node.data.name}
                className="pointer-events-none absolute z-10 overflow-hidden border border-white/16 bg-black/18"
                style={{
                  left: node.x0,
                  top: node.y0,
                  width: node.x1 - node.x0,
                  height: node.y1 - node.y0,
                }}
              >
                <div className="flex h-[22px] items-center px-2 text-[10px] font-bold text-white/76">
                  <span className="truncate">{node.data.name}</span>
                </div>
              </div>
            ))}
            {stockNodes.map((node) => (
              <StockCell key={node.data.stock?.code ?? node.data.name} node={node} />
            ))}
          </>
        ) : null}

        {loading && !data ? (
          <div className="absolute inset-0 grid place-items-center bg-black/42">
            <div className="text-center">
              <div className="mx-auto mb-3 h-7 w-7 animate-spin rounded-full border-2 border-white/18 border-t-[#69d5ff]" />
              <p className="text-sm font-semibold text-white/76">正在整理 A 股全市场热力图</p>
            </div>
          </div>
        ) : null}

        {error && !data ? (
          <div className="absolute inset-0 grid place-items-center px-6 text-center">
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
          <span>{data?.coverage ?? 'A 股总市值前 320 家公司'}</span>
          <span>更新 {updatedAt}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 bg-[#a92f42]" />上涨</span>
          <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 bg-[#147b5e]" />下跌</span>
          <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 bg-[#36393e]" />平盘</span>
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
