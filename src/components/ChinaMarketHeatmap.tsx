import { hierarchy, treemap, type HierarchyRectangularNode } from 'd3-hierarchy';
import {
  ChevronLeft,
  ExternalLink,
  Maximize2,
  Minimize2,
  Minus,
  Plus,
  RefreshCw,
  Search,
  TriangleAlert,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { getMarketSessionStatus, type MarketSessionMarket } from '../lib/marketSessions';

type ChinaHeatmapStock = {
  code: string;
  name: string;
  exchange?: string;
  logoUrl?: string;
  fallbackLogoUrl?: string;
  price: number;
  previousClose?: number;
  change?: number;
  changePercent: number;
  marketCap: number;
  weight?: number;
  marketCapType?: 'actual' | 'representative-weight';
  industry: string;
  updatedAt?: string;
  marketState?: string;
  quoteProvider?: string;
  sourceDelaySeconds?: number;
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
  quoteStatus?: 'live' | 'delayed' | 'closed';
  sourceDelaySeconds?: number | null;
  quotePolicy?: string;
  refreshIntervalMs?: number;
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

type RegionalHeatmapConfig = {
  endpoint: string;
  sessionMarket: MarketSessionMarket;
  marketName: string;
  ariaLabel: string;
  searchSlotId: string;
  searchResultsId: string;
  loadingText: string;
  errorFallback: string;
  defaultCoverage: string;
  industryDisplayPriority: string[];
  logoPath?: (stock: ChinaHeatmapStock) => string;
  formatPrice?: (value: number) => string;
  formatMarketCap?: (value: number) => string;
  marketCapLabel?: string;
  searchEntityLabel?: string;
  industryAreaExponent?: number;
  stockAreaExponent?: number;
  industryAreaMultipliers?: Record<string, number>;
  stockAreaMultipliers?: Record<string, number>;
};

const REFRESH_INTERVAL_MS = 3_000;
const REGIONAL_HEATMAP_CLIENT_CACHE_MS = 2_500;
const REGIONAL_HEATMAP_SESSION_MAX_AGE_MS = 15 * 60_000;
const REGIONAL_HEATMAP_STORAGE_PREFIX = 'sparkflow:regional-heatmap:';
const MIN_ZOOM = 1;
const ABSOLUTE_MAX_ZOOM = 32;
const MIN_CHANGE_WIDTH = 56;
const MIN_CHANGE_HEIGHT = 40;
const INDUSTRY_AREA_EXPONENT = 1.22;
const STOCK_AREA_EXPONENT = 0.8;
const DEFAULT_MAP_VIEW: MapView = { scale: MIN_ZOOM, x: 0, y: 0 };

const CHINA_HEATMAP_CONFIG: RegionalHeatmapConfig = {
  endpoint: '/api/china-market-heatmap',
  sessionMarket: 'china',
  marketName: 'A 股',
  ariaLabel: 'A 股大盘热力图',
  searchSlotId: 'china-market-search-slot',
  searchResultsId: 'china-market-search-results',
  loadingText: '正在整理 A 股全市场热力图',
  errorFallback: 'A 股热力图加载失败',
  defaultCoverage: 'A 股总市值前 320 家公司',
  industryDisplayPriority: ['半导体', '银行Ⅱ'],
  logoPath: (stock) => `/stock-logos/${stock.code}.svg`,
};

const HONG_KONG_HEATMAP_CONFIG: RegionalHeatmapConfig = {
  endpoint: '/api/hong-kong-market-heatmap',
  sessionMarket: 'hongkong',
  marketName: '港股',
  ariaLabel: '港股大盘热力图',
  searchSlotId: 'hong-kong-market-search-slot',
  searchResultsId: 'hong-kong-market-search-results',
  loadingText: '正在整理港股主板热力图',
  errorFallback: '港股热力图加载失败',
  defaultCoverage: '港股主板总市值前 320 家公司',
  industryDisplayPriority: ['软件服务', '银行'],
  logoPath: (stock) => `/stock-logos/hk-${stock.code}.svg`,
};

const US_HEATMAP_CONFIG: RegionalHeatmapConfig = {
  endpoint: '/api/us-market-heatmap',
  sessionMarket: 'us',
  marketName: '美股',
  ariaLabel: '美股大盘热力图',
  searchSlotId: 'us-market-search-slot',
  searchResultsId: 'us-market-search-results',
  loadingText: '正在整理美股主要公司热力图',
  errorFallback: '美股热力图加载失败',
  defaultCoverage: '纳斯达克与纽交所总市值前 320 家公司',
  industryDisplayPriority: ['信息技术', '金融'],
  logoPath: (stock) => `/stock-logos/us-${stock.code}.svg`,
};

const CRYPTO_HEATMAP_CONFIG: RegionalHeatmapConfig = {
  endpoint: '/api/crypto-market-heatmap',
  sessionMarket: 'crypto',
  marketName: '加密市场',
  ariaLabel: '加密资产市场热力图',
  searchSlotId: 'crypto-market-search-slot',
  searchResultsId: 'crypto-market-search-results',
  loadingText: '正在整理主流加密资产热力图',
  errorFallback: '加密资产热力图加载失败',
  defaultCoverage: '主流加密资产市值前 120 项',
  industryDisplayPriority: ['公链与基础层', 'DeFi', 'Layer 2', '交易平台', 'AI 与算力', 'Meme'],
  logoPath: (stock) => stock.logoUrl || '',
  formatPrice: formatCryptoPrice,
  formatMarketCap: formatUsdMarketCap,
  searchEntityLabel: '资产',
  industryAreaExponent: 0.55,
  stockAreaExponent: 0.5,
  industryAreaMultipliers: { 公链与基础层: 1.75 },
  stockAreaMultipliers: { BTC: 1.9 },
};

export type InternationalMarketMode = 'japan' | 'korea' | 'india' | 'germany' | 'france' | 'uk';

const INTERNATIONAL_HEATMAP_CONFIGS: Record<InternationalMarketMode, RegionalHeatmapConfig> = {
  japan: {
    endpoint: '/api/global-market-heatmap?market=japan',
    sessionMarket: 'japan',
    marketName: '日股',
    ariaLabel: '日本股票市场热力图',
    searchSlotId: 'japan-market-search-slot',
    searchResultsId: 'japan-market-search-results',
    loadingText: '正在同步日本代表性公司行情…',
    errorFallback: '日本市场热力图加载失败',
    defaultCoverage: '日经225与TOPIX代表性龙头',
    industryDisplayPriority: ['汽车', '电子', '金融', '工业'],
    logoPath: (stock) => stock.logoUrl || stock.fallbackLogoUrl || '',
    formatPrice: (value) => `¥${value.toLocaleString('ja-JP', { maximumFractionDigits: 2 })}`,
    formatMarketCap: (value) => formatLocalMarketCap(value, '¥'),
    marketCapLabel: '总市值',
  },
  korea: {
    endpoint: '/api/global-market-heatmap?market=korea',
    sessionMarket: 'korea',
    marketName: '韩股',
    ariaLabel: '韩国股票市场热力图',
    searchSlotId: 'korea-market-search-slot',
    searchResultsId: 'korea-market-search-results',
    loadingText: '正在同步韩国代表性公司行情…',
    errorFallback: '韩国市场热力图加载失败',
    defaultCoverage: 'KOSPI与KOSDAQ代表性龙头',
    industryDisplayPriority: ['科技', '汽车', '医疗', '金融'],
    logoPath: (stock) => stock.logoUrl || stock.fallbackLogoUrl || '',
    formatPrice: (value) => `₩${value.toLocaleString('ko-KR', { maximumFractionDigits: 0 })}`,
    formatMarketCap: formatKrwMarketCap,
    marketCapLabel: '总市值',
    // 韩国 20 家代表样本高度集中于半导体龙头；压缩行业面积，避免样本集中度被 1.22 次幂再次放大。
    industryAreaExponent: 0.65,
    stockAreaExponent: 0.72,
  },
  india: {
    endpoint: '/api/global-market-heatmap?market=india',
    sessionMarket: 'india',
    marketName: '印股',
    ariaLabel: '印度股票市场热力图',
    searchSlotId: 'india-market-search-slot',
    searchResultsId: 'india-market-search-results',
    loadingText: '正在同步印度代表性公司行情…',
    errorFallback: '印度市场热力图加载失败',
    defaultCoverage: 'NIFTY 50与SENSEX代表性龙头',
    industryDisplayPriority: ['金融', '科技', '能源', '消费'],
    logoPath: (stock) => stock.logoUrl || stock.fallbackLogoUrl || '',
    formatPrice: (value) => `₹${value.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`,
    formatMarketCap: (value) => formatLocalMarketCap(value, '₹'),
    marketCapLabel: '总市值',
  },
  germany: {
    endpoint: '/api/global-market-heatmap?market=germany',
    sessionMarket: 'germany',
    marketName: '德股',
    ariaLabel: '德国股票市场热力图',
    searchSlotId: 'germany-market-search-slot',
    searchResultsId: 'germany-market-search-results',
    loadingText: '正在同步德国代表性公司行情…',
    errorFallback: '德国市场热力图加载失败',
    defaultCoverage: 'DAX与MDAX代表性龙头',
    industryDisplayPriority: ['工业', '科技', '金融', '汽车'],
    logoPath: (stock) => stock.logoUrl || stock.fallbackLogoUrl || '',
    formatPrice: (value) => `€${value.toLocaleString('de-DE', { maximumFractionDigits: 2 })}`,
    formatMarketCap: (value) => formatLocalMarketCap(value, '€'),
    marketCapLabel: '总市值',
  },
  france: {
    endpoint: '/api/global-market-heatmap?market=france',
    sessionMarket: 'france',
    marketName: '法股',
    ariaLabel: '法国股票市场热力图',
    searchSlotId: 'france-market-search-slot',
    searchResultsId: 'france-market-search-results',
    loadingText: '正在同步法国代表性公司行情…',
    errorFallback: '法国市场热力图加载失败',
    defaultCoverage: 'CAC 40与SBF 120代表性龙头',
    industryDisplayPriority: ['消费', '工业', '金融', '医疗'],
    logoPath: (stock) => stock.logoUrl || stock.fallbackLogoUrl || '',
    formatPrice: (value) => `€${value.toLocaleString('fr-FR', { maximumFractionDigits: 2 })}`,
    formatMarketCap: (value) => formatLocalMarketCap(value, '€'),
    marketCapLabel: '总市值',
  },
  uk: {
    endpoint: '/api/global-market-heatmap?market=uk',
    sessionMarket: 'uk',
    marketName: '英股',
    ariaLabel: '英国股票市场热力图',
    searchSlotId: 'uk-market-search-slot',
    searchResultsId: 'uk-market-search-results',
    loadingText: '正在同步英国代表性公司行情…',
    errorFallback: '英国市场热力图加载失败',
    defaultCoverage: '富时100与富时250代表性龙头',
    industryDisplayPriority: ['金融', '能源', '消费', '医疗'],
    logoPath: (stock) => stock.logoUrl || stock.fallbackLogoUrl || '',
    formatPrice: (value) => `${value.toLocaleString('en-GB', { maximumFractionDigits: 2 })}p`,
    formatMarketCap: (value) => formatLocalMarketCap(value, '£'),
    marketCapLabel: '总市值',
  },
};

type RegionalHeatmapCacheEntry = {
  storedAt: number;
  data: ChinaHeatmapResponse;
};

const regionalHeatmapClientCache = new Map<string, RegionalHeatmapCacheEntry>();
const regionalHeatmapClientInFlight = new Map<string, Promise<ChinaHeatmapResponse>>();
const regionalHeatmapPreloadedLogoUrls = new Set<string>();

function regionalHeatmapStorageKey(endpoint: string) {
  return `${REGIONAL_HEATMAP_STORAGE_PREFIX}${encodeURIComponent(endpoint)}`;
}

function readRegionalHeatmapCache(config: RegionalHeatmapConfig) {
  const memoryCached = regionalHeatmapClientCache.get(config.endpoint);
  if (memoryCached) return memoryCached;
  if (typeof window === 'undefined') return undefined;

  try {
    const raw = window.sessionStorage.getItem(regionalHeatmapStorageKey(config.endpoint));
    if (!raw) return undefined;
    const cached = JSON.parse(raw) as RegionalHeatmapCacheEntry;
    if (!cached?.storedAt || !cached.data?.stocks?.length || Date.now() - cached.storedAt > REGIONAL_HEATMAP_SESSION_MAX_AGE_MS) {
      window.sessionStorage.removeItem(regionalHeatmapStorageKey(config.endpoint));
      return undefined;
    }
    regionalHeatmapClientCache.set(config.endpoint, cached);
    return cached;
  } catch {
    return undefined;
  }
}

function preloadRegionalHeatmapLogos(config: RegionalHeatmapConfig, payload: ChinaHeatmapResponse) {
  if (typeof Image === 'undefined' || !config.logoPath) return;
  payload.stocks.forEach((stock) => {
    const logoUrl = config.logoPath?.(stock);
    if (!logoUrl || regionalHeatmapPreloadedLogoUrls.has(logoUrl)) return;
    regionalHeatmapPreloadedLogoUrls.add(logoUrl);
    const image = new Image();
    image.decoding = 'async';
    image.src = logoUrl;
  });
}

function storeRegionalHeatmapCache(config: RegionalHeatmapConfig, data: ChinaHeatmapResponse) {
  const entry = { storedAt: Date.now(), data };
  regionalHeatmapClientCache.set(config.endpoint, entry);
  preloadRegionalHeatmapLogos(config, data);
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(regionalHeatmapStorageKey(config.endpoint), JSON.stringify(entry));
  } catch {
    // 内存缓存仍然可用；浏览器禁用存储时无需阻断行情展示。
  }
}

function loadRegionalHeatmap(config: RegionalHeatmapConfig, maxAgeMs = REGIONAL_HEATMAP_CLIENT_CACHE_MS) {
  const cached = readRegionalHeatmapCache(config);
  if (cached && Date.now() - cached.storedAt < maxAgeMs) return Promise.resolve(cached.data);
  const running = regionalHeatmapClientInFlight.get(config.endpoint);
  if (running) return running;

  const request = fetch(config.endpoint, { cache: 'no-store' })
    .then(async (response) => {
      if (!response.ok) throw new Error(`行情接口返回 ${response.status}`);
      const payload = (await response.json()) as ChinaHeatmapResponse;
      if (!payload.stocks?.length) throw new Error('暂未取得有效行情');
      storeRegionalHeatmapCache(config, payload);
      return payload;
    })
    .catch((error) => {
      if (cached) return cached.data;
      throw error;
    })
    .finally(() => regionalHeatmapClientInFlight.delete(config.endpoint));
  regionalHeatmapClientInFlight.set(config.endpoint, request);
  return request;
}

export function prefetchInternationalMarketHeatmap(market: InternationalMarketMode) {
  return loadRegionalHeatmap(INTERNATIONAL_HEATMAP_CONFIGS[market]).then(() => undefined).catch(() => undefined);
}

export async function prefetchInternationalMarketHeatmaps() {
  await Promise.allSettled(
    (Object.keys(INTERNATIONAL_HEATMAP_CONFIGS) as InternationalMarketMode[])
      .map((market) => prefetchInternationalMarketHeatmap(market)),
  );
}

function formatMarketCap(value: number) {
  if (value >= 1e12) return `${(value / 1e12).toFixed(2)}万亿`;
  return `${(value / 1e8).toFixed(value >= 1e11 ? 0 : 1)}亿`;
}

function formatChange(value: number) {
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function cellColor(changePercent: number) {
  if (changePercent > 0.03) {
    const intensity = Math.min(Math.abs(changePercent) / 7, 1);
    const red = Math.round(116 + intensity * 126);
    const green = Math.round(30 + intensity * 24);
    const blue = Math.round(43 + intensity * 26);
    return `rgb(${red} ${green} ${blue})`;
  }
  if (changePercent < -0.03) {
    const intensity = Math.min(Math.abs(changePercent) / 10, 1);
    const mix = (from: number, to: number) => Math.round(from + (to - from) * intensity);
    return `rgb(${mix(4, 11)} ${mix(73, 166)} ${mix(42, 96)})`;
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

function createWeightedStockNodes(
  stocks: ChinaHeatmapStock[],
  targetWeight?: number,
  stockAreaExponent = STOCK_AREA_EXPONENT,
  stockAreaMultipliers?: Record<string, number>,
) {
  const scores = stocks.map((stock) => (
    Math.pow(stock.marketCap, stockAreaExponent) * (stockAreaMultipliers?.[stock.code] ?? 1)
  ));
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
  industryAreaExponent = INDUSTRY_AREA_EXPONENT,
  stockAreaExponent = STOCK_AREA_EXPONENT,
  industryAreaMultipliers?: Record<string, number>,
  stockAreaMultipliers?: Record<string, number>,
) {
  if (activeIndustry) {
    const members = stocks.filter((stock) => stock.industry === activeIndustry);
    return {
      name: activeIndustry,
      children: createWeightedStockNodes(
        members,
        undefined,
        stockAreaExponent,
        stockAreaMultipliers,
      ),
    } satisfies HeatmapNode;
  }

  return {
    name: '全部',
    children: [...groupStocks(stocks).entries()].map(([industry, members]) => {
      const sampledMarketCap = members.reduce((sum, stock) => sum + stock.marketCap, 0);
      const industryMarketCap = industryMarketCaps?.[industry] ?? sampledMarketCap;
      const industryWeight = Math.pow(industryMarketCap, industryAreaExponent)
        * (industryAreaMultipliers?.[industry] ?? 1);
      return {
        name: industry,
        children: createWeightedStockNodes(
          members,
          industryWeight,
          stockAreaExponent,
          stockAreaMultipliers,
        ),
      };
    }),
  } satisfies HeatmapNode;
}

function calculateLayout(
  stocks: ChinaHeatmapStock[],
  size: ContainerSize,
  activeIndustry: string | null,
  industryMarketCaps: Record<string, number> | undefined,
  industryDisplayPriority: string[],
  industryAreaExponent = INDUSTRY_AREA_EXPONENT,
  stockAreaExponent = STOCK_AREA_EXPONENT,
  industryAreaMultipliers?: Record<string, number>,
  stockAreaMultipliers?: Record<string, number>,
) {
  if (!stocks.length || size.width < 10 || size.height < 10) return undefined;

  const root = hierarchy<HeatmapNode>(buildTree(
    stocks,
    activeIndustry,
    industryMarketCaps,
    industryAreaExponent,
    stockAreaExponent,
    industryAreaMultipliers,
    stockAreaMultipliers,
  ))
    .sum((node) => node.weight ?? 0)
    .sort((left, right) => {
      if (left.depth === 1 && right.depth === 1) {
        const leftPriority = industryDisplayPriority.indexOf(left.data.name);
        const rightPriority = industryDisplayPriority.indexOf(right.data.name);
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

function calculateMaxZoom(layout?: HierarchyRectangularNode<HeatmapNode>) {
  const requiredZoom = (layout?.leaves() ?? []).reduce((required, node) => {
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
}

function formatUsdMarketCap(value: number) {
  if (value >= 1e12) return `$${(value / 1e12).toFixed(2)}T`;
  if (value >= 1e9) return `$${(value / 1e9).toFixed(value >= 1e11 ? 0 : 1)}B`;
  return `$${(value / 1e6).toFixed(0)}M`;
}

function formatCryptoPrice(value: number) {
  if (value >= 1_000) return `$${value.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  if (value >= 1) return `$${value.toFixed(2)}`;
  if (value >= 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(8)}`;
}

export function ChinaMarketHeatmap() {
  return <RegionalMarketHeatmap config={CHINA_HEATMAP_CONFIG} />;
}

export function HongKongMarketHeatmap() {
  return <RegionalMarketHeatmap config={HONG_KONG_HEATMAP_CONFIG} />;
}

export function UsMarketHeatmap() {
  return <RegionalMarketHeatmap config={US_HEATMAP_CONFIG} />;
}

export function CryptoMarketHeatmap() {
  return <RegionalMarketHeatmap config={CRYPTO_HEATMAP_CONFIG} />;
}

function formatKrwMarketCap(value: number) {
  if (value >= 1e12) return `₩${(value / 1e12).toFixed(value >= 1e14 ? 0 : 1)}万亿`;
  if (value >= 1e8) return `₩${(value / 1e8).toFixed(0)}亿`;
  return `₩${value.toLocaleString('ko-KR', { maximumFractionDigits: 0 })}`;
}

function formatLocalMarketCap(value: number, symbol: string) {
  if (value >= 1e12) return `${symbol}${(value / 1e12).toFixed(value >= 1e14 ? 0 : 1)}万亿`;
  if (value >= 1e8) return `${symbol}${(value / 1e8).toFixed(value >= 1e11 ? 0 : 1)}亿`;
  if (value >= 1e4) return `${symbol}${(value / 1e4).toFixed(1)}万`;
  return `${symbol}${value.toFixed(0)}`;
}

export function InternationalMarketHeatmap({ market }: { market: InternationalMarketMode }) {
  return <RegionalMarketHeatmap key={market} config={INTERNATIONAL_HEATMAP_CONFIGS[market]} />;
}

function StockCell({
  node,
  selected,
  expanded,
  logoPath,
  priceFormatter = (value) => value.toFixed(2),
  marketCapFormatter = formatMarketCap,
  marketCapLabel = '总市值',
  onSelect,
  onHover,
}: {
  node: HierarchyRectangularNode<HeatmapNode>;
  selected: boolean;
  expanded: boolean;
  logoPath?: (stock: ChinaHeatmapStock) => string;
  priceFormatter?: (value: number) => string;
  marketCapFormatter?: (value: number) => string;
  marketCapLabel?: string;
  onSelect: (stock: ChinaHeatmapStock) => void;
  onHover: (stock: ChinaHeatmapStock | null) => void;
}) {
  const stock = node.data.stock;
  const [logoFailed, setLogoFailed] = useState(!logoPath);
  if (!stock) return null;

  const width = node.x1 - node.x0;
  const height = node.y1 - node.y0;
  if (width <= 0 || height <= 0) return null;

  const visualWidth = width;
  const visualHeight = height;
  const showFullName = visualWidth >= 92 && visualHeight >= 48;
  const showInitial = !showFullName && visualWidth >= 40 && visualHeight >= 28;
  const showLogo = showFullName && visualHeight >= 78;
  const compactLogo = showLogo && visualHeight < 118;
  const largeLogo = expanded && visualWidth >= 180 && visualHeight >= 150;
  const showCode = showFullName
    && visualWidth >= 104
    && visualHeight >= 70
    && (!showLogo || visualHeight >= 132);
  const showValue = visualWidth >= MIN_CHANGE_WIDTH && visualHeight >= MIN_CHANGE_HEIGHT;
  const heatmapCellColor = cellColor(stock.changePercent);
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
  const tooltip = `${stock.name}（${stock.code}）\n现价 ${priceFormatter(stock.price)}\n涨跌 ${formatChange(stock.changePercent)}\n${marketCapLabel} ${marketCapFormatter(stock.marketCap)}${stock.updatedAt ? `\n更新 ${new Date(stock.updatedAt).toLocaleString('zh-CN', { hour12: false })}` : ''}`;

  return (
    <button
      type="button"
      data-stock-code={stock.code}
      title={tooltip}
      aria-label={tooltip.split('\n').join('，')}
      onClick={() => onSelect(stock)}
      onMouseEnter={() => onHover(stock)}
      onMouseLeave={() => onHover(null)}
      className={`market-heatmap-tile absolute min-h-0 min-w-0 overflow-hidden text-center text-white transition-[filter,box-shadow] duration-150 hover:z-30 hover:brightness-125 focus:z-30 focus:outline-none ${
        selected ? 'z-30' : ''
      }`}
      style={{
        '--heatmap-cell-color': heatmapCellColor,
        left: node.x0,
        top: node.y0,
        width,
        height,
        backgroundColor: heatmapCellColor,
        borderRadius: Math.min(3, width * 0.18, height * 0.18),
        boxShadow: selected ? 'inset 0 0 0 2px #2f8cff' : undefined,
      } as CSSProperties}
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
            className={`grid shrink-0 place-items-center overflow-hidden rounded-lg border border-white/18 bg-white font-bold text-[#111318] shadow-[0_3px_14px_rgba(0,0,0,0.34)] ${
              largeLogo
                ? 'mb-2 h-14 w-14 text-xl'
                : compactLogo
                  ? 'mb-1 h-8 w-8 text-xs'
                  : 'mb-1.5 h-10 w-10 text-sm'
            }`}
          >
            {logoFailed || !logoPath ? (
              stock.name.slice(0, 1)
            ) : (
              <img
                src={logoPath(stock)}
                alt=""
                loading="lazy"
                decoding="async"
                draggable={false}
                onError={(event) => {
                  const fallback = stock.fallbackLogoUrl;
                  if (fallback && event.currentTarget.dataset.fallbackTried !== 'true') {
                    event.currentTarget.dataset.fallbackTried = 'true';
                    event.currentTarget.src = fallback;
                    return;
                  }
                  setLogoFailed(true);
                }}
                className="pointer-events-none h-full w-full select-none object-contain"
              />
            )}
          </span>
        ) : null}
        {showFullName ? (
          <span className="max-w-full shrink-0 truncate font-semibold leading-tight" style={{ fontSize: nameSize }}>
            {stock.name}
          </span>
        ) : showInitial ? (
          <span className="shrink-0 font-semibold leading-none text-white/88" style={{ fontSize: nameSize }}>
            {stock.name.slice(0, 1)}
          </span>
        ) : null}
        {showCode ? <span className="mt-1 shrink-0 text-[9px] leading-none text-white/66">{stock.code}</span> : null}
        {showValue ? (
          <span
            className={`${showLogo ? 'mt-1' : 'mt-1.5'} shrink-0 font-mono font-semibold leading-none`}
            style={{ fontSize: valueSize }}
          >
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

function RegionalMarketHeatmap({ config }: { config: RegionalHeatmapConfig }) {
  const mapShellRef = useRef<HTMLDivElement | null>(null);
  const { ref, size } = useContainerSize();
  const initialCacheRef = useRef(readRegionalHeatmapCache(config));
  const [data, setData] = useState<ChinaHeatmapResponse | undefined>(() => initialCacheRef.current?.data);
  const [loading, setLoading] = useState(() => !initialCacheRef.current);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [activeIndustry, setActiveIndustry] = useState<string | null>(null);
  const [selectedCode, setSelectedCode] = useState('');
  const [hoveredCode, setHoveredCode] = useState('');
  const [hoveredIndustry, setHoveredIndustry] = useState('');
  const [fullscreen, setFullscreen] = useState(false);
  const [mapView, setMapView] = useState<MapView>(DEFAULT_MAP_VIEW);
  const [dragging, setDragging] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchIndex, setSearchIndex] = useState(0);
  const [searchPortal, setSearchPortal] = useState<HTMLElement | null>(null);
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
  const mountedRef = useRef(true);
  const [sessionNow, setSessionNow] = useState(() => new Date());

  useEffect(() => {
    setSearchPortal(document.getElementById(config.searchSlotId));
  }, [config.searchSlotId]);

  useEffect(() => {
    const timer = window.setInterval(() => setSessionNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const load = useCallback(async (signal?: AbortSignal, manual = false) => {
    if (manual) setRefreshing(true);
    try {
      const payload = await loadRegionalHeatmap(config, manual ? 0 : REGIONAL_HEATMAP_CLIENT_CACHE_MS);
      if (!mountedRef.current || signal?.aborted) return;
      setData(payload);
      setError('');
    } catch (caught) {
      if (!mountedRef.current || signal?.aborted) return;
      setError(caught instanceof Error ? caught.message : config.errorFallback);
    } finally {
      if (!mountedRef.current || signal?.aborted) return;
      setLoading(false);
      setRefreshing(false);
    }
  }, [config]);

  useEffect(() => {
    mountedRef.current = true;
    const controller = new AbortController();
    void load(controller.signal);

    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load(controller.signal);
    }, REFRESH_INTERVAL_MS);

    return () => {
      mountedRef.current = false;
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
      config.industryDisplayPriority,
      config.industryAreaExponent,
      config.stockAreaExponent,
      config.industryAreaMultipliers,
      config.stockAreaMultipliers,
    ),
    [activeIndustry, config.industryAreaExponent, config.industryAreaMultipliers, config.industryDisplayPriority, config.stockAreaExponent, config.stockAreaMultipliers, data?.industryMarketCaps, data?.stocks, size],
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
      config.industryDisplayPriority,
      config.industryAreaExponent,
      config.stockAreaExponent,
      config.industryAreaMultipliers,
      config.stockAreaMultipliers,
    ),
    [activeIndustry, config.industryAreaExponent, config.industryAreaMultipliers, config.industryDisplayPriority, config.stockAreaExponent, config.stockAreaMultipliers, data?.industryMarketCaps, data?.stocks, scaledSize],
  );
  const industryNodes = useMemo(
    () => activeIndustry ? [] : layout?.children ?? [],
    [activeIndustry, layout],
  );
  const stockNodes = useMemo(() => layout?.leaves() ?? [], [layout]);
  const maxZoom = useMemo(() => calculateMaxZoom(baseLayout), [baseLayout]);
  const searchResults = useMemo(() => {
    const query = searchQuery.trim().replace(/\s+/g, '').toLowerCase();
    if (!query) return [];

    const score = (stock: ChinaHeatmapStock) => {
      const code = stock.code.toLowerCase();
      const name = stock.name.replace(/\s+/g, '').toLowerCase();
      if (code === query) return 0;
      if (name === query) return 1;
      if (code.startsWith(query)) return 2;
      if (name.startsWith(query)) return 3;
      return 4;
    };

    return (data?.stocks ?? [])
      .filter((stock) => (
        stock.code.toLowerCase().includes(query)
        || stock.name.replace(/\s+/g, '').toLowerCase().includes(query)
      ))
      .sort((a, b) => score(a) - score(b) || b.marketCap - a.marketCap)
      .slice(0, 6);
  }, [data?.stocks, searchQuery]);

  useEffect(() => {
    setSearchIndex((current) => Math.min(current, Math.max(0, searchResults.length - 1)));
  }, [searchResults.length]);

  const focusSearchedStock = useCallback((stock: ChinaHeatmapStock) => {
    if (!data?.stocks.length || !size.width || !size.height) return;

    const fullLayout = calculateLayout(
      data.stocks,
      size,
      null,
      data.industryMarketCaps,
      config.industryDisplayPriority,
      config.industryAreaExponent,
      config.stockAreaExponent,
      config.industryAreaMultipliers,
      config.stockAreaMultipliers,
    );
    const baseNode = fullLayout?.leaves().find((node) => node.data.stock?.code === stock.code);
    if (!fullLayout || !baseNode) return;

    const baseWidth = Math.max(1, baseNode.x1 - baseNode.x0);
    const baseHeight = Math.max(1, baseNode.y1 - baseNode.y0);
    const fullMaxZoom = calculateMaxZoom(fullLayout);
    const targetScale = Math.min(
      fullMaxZoom,
      Math.max(2.4, 160 / baseWidth, 110 / baseHeight),
    );
    const targetSize = {
      width: Math.round(size.width * targetScale),
      height: Math.round(size.height * targetScale),
    };
    const targetLayout = calculateLayout(
      data.stocks,
      targetSize,
      null,
      data.industryMarketCaps,
      config.industryDisplayPriority,
      config.industryAreaExponent,
      config.stockAreaExponent,
      config.industryAreaMultipliers,
      config.stockAreaMultipliers,
    );
    const targetNode = targetLayout?.leaves().find((node) => node.data.stock?.code === stock.code);
    if (!targetNode) return;

    setActiveIndustry(null);
    setSelectedCode(stock.code);
    setHoveredCode('');
    setHoveredIndustry('');
    setMapView(clampMapView({
      scale: targetScale,
      x: size.width / 2 - (targetNode.x0 + targetNode.x1) / 2,
      y: size.height / 2 - (targetNode.y0 + targetNode.y1) / 2,
    }, size, fullMaxZoom));
    setSearchQuery(stock.name);
    setSearchOpen(false);
    setSearchIndex(0);
  }, [
    config.industryAreaExponent,
    config.industryAreaMultipliers,
    config.industryDisplayPriority,
    config.stockAreaExponent,
    config.stockAreaMultipliers,
    data,
    size,
  ]);

  const handleSearchKeyDown = useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSearchOpen(true);
      setSearchIndex((current) => Math.min(current + 1, Math.max(0, searchResults.length - 1)));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSearchIndex((current) => Math.max(0, current - 1));
      return;
    }
    if (event.key === 'Enter' && searchResults[searchIndex]) {
      event.preventDefault();
      focusSearchedStock(searchResults[searchIndex]);
      return;
    }
    if (event.key === 'Escape') {
      setSearchOpen(false);
      event.currentTarget.blur();
    }
  }, [focusSearchedStock, searchIndex, searchResults]);

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
  const sourceDelayLabel = data?.sourceDelaySeconds && data.sourceDelaySeconds >= 60
    ? `授权延迟约 ${Math.ceil(data.sourceDelaySeconds / 60)} 分钟`
    : '';
  const publicSnapshotExchange = config.sessionMarket === 'india'
    ? 'NSE'
    : config.sessionMarket === 'uk' ? 'LSE' : '';
  const isPublicSnapshotMarket = Boolean(publicSnapshotExchange);
  const quoteFreshnessLabel = data?.quoteStatus === 'closed'
    ? sourceDelayLabel ? `收盘快照 · ${sourceDelayLabel}` : '常规盘已收盘'
    : isPublicSnapshotMarket
      ? `公开行情快照 ${updatedAt}`
      : sourceDelayLabel || (data?.quoteStatus === 'live' ? '实时行情' : `抓取 ${updatedAt}`);
  const refreshSeconds = Math.max(1, Math.round((data?.refreshIntervalMs ?? REFRESH_INTERVAL_MS) / 1000));
  const sessionStatus = getMarketSessionStatus(config.sessionMarket, sessionNow);
  const sessionToneClass = sessionStatus.tone === 'live'
    ? 'bg-[#4ed9aa] shadow-[0_0_10px_rgba(78,217,170,0.48)]'
    : sessionStatus.tone === 'auction' || sessionStatus.tone === 'extended'
      ? 'bg-[#d6b566] shadow-[0_0_10px_rgba(214,181,102,0.4)]'
      : sessionStatus.tone === 'halted'
        ? 'bg-[#ff5c69] shadow-[0_0_10px_rgba(255,92,105,0.46)]'
        : 'bg-white/30';

  const openIndustry = useCallback((industry: string) => {
    setActiveIndustry(industry);
    setSelectedCode('');
    setHoveredCode('');
    setHoveredIndustry('');
    setMapView(DEFAULT_MAP_VIEW);
  }, []);

  const resetView = useCallback(() => {
    setActiveIndustry(null);
    setSelectedCode('');
    setHoveredCode('');
    setHoveredIndustry('');
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
      setHoveredIndustry('');
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

  const searchControl = searchPortal ? createPortal(
    <div className="relative z-[70] w-full">
      <div className="flex h-10 items-center gap-2 rounded-md border border-white/14 bg-[#0b0d10] px-3 shadow-[0_10px_28px_rgba(0,0,0,0.24)] transition-colors focus-within:border-[#69d5ff]/55">
        <Search size={15} className="shrink-0 text-white/42" />
        <input
          type="text"
          inputMode="search"
          value={searchQuery}
          onChange={(event) => {
            const value = event.target.value;
            setSearchQuery(value);
            setSearchOpen(Boolean(value.trim()));
            setSearchIndex(0);
          }}
          onFocus={() => setSearchOpen(Boolean(searchQuery.trim()))}
          onBlur={() => window.setTimeout(() => setSearchOpen(false), 120)}
          onKeyDown={handleSearchKeyDown}
          placeholder={`搜索${config.marketName}代码或${config.searchEntityLabel ?? '公司'}名称`}
          className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/32"
          role="combobox"
          aria-label={`搜索${config.marketName}${config.searchEntityLabel ?? '股票'}`}
          aria-expanded={searchOpen}
          aria-controls={config.searchResultsId}
          aria-autocomplete="list"
        />
        {searchQuery ? (
          <button
            type="button"
            onClick={() => {
              setSearchQuery('');
              setSearchOpen(false);
              setSearchIndex(0);
            }}
            className="grid h-7 w-7 shrink-0 place-items-center rounded text-white/42 transition hover:bg-white/8 hover:text-white"
            aria-label="清空股票搜索"
            title="清空"
          >
            <X size={14} />
          </button>
        ) : null}
      </div>

      {searchOpen && searchQuery.trim() ? (
        <div
          id={config.searchResultsId}
          role="listbox"
          className="absolute left-0 right-0 top-[44px] overflow-hidden rounded-md border border-white/14 bg-[#101216] shadow-[0_18px_46px_rgba(0,0,0,0.56)]"
        >
          {searchResults.length ? searchResults.map((stock, index) => (
            <button
              type="button"
              key={stock.code}
              role="option"
              aria-selected={searchIndex === index}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setSearchIndex(index)}
              onClick={() => focusSearchedStock(stock)}
              className={`flex w-full items-center gap-3 border-b border-white/7 px-3 py-2.5 text-left last:border-b-0 ${
                searchIndex === index ? 'bg-white/10' : 'hover:bg-white/7'
              }`}
            >
              <span className="relative grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-md bg-white text-xs font-bold text-[#111318]">
                <span>{stock.name.slice(0, 1)}</span>
                {config.logoPath ? (
                  <img
                    src={config.logoPath(stock)}
                    alt=""
                    className="pointer-events-none absolute inset-0 h-full w-full object-contain"
                    onError={(event) => {
                      event.currentTarget.style.display = 'none';
                    }}
                  />
                ) : null}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-white">{stock.name}</span>
                <span className="mt-0.5 block font-mono text-[10px] text-white/42">
                  {stock.code} · {stock.industry}
                </span>
              </span>
              <span className={`shrink-0 font-mono text-xs font-semibold ${
                stock.changePercent > 0.03
                  ? 'text-[#ff7885]'
                  : stock.changePercent < -0.03
                    ? 'text-[#58d7b1]'
                    : 'text-white/55'
              }`}>
                {formatChange(stock.changePercent)}
              </span>
            </button>
          )) : (
            <div className="px-4 py-4 text-center text-xs text-white/42">
              当前热力图中未找到匹配{config.searchEntityLabel ?? '股票'}
            </div>
          )}
        </div>
      ) : null}
    </div>,
    searchPortal,
  ) : null;

  return (
    <>
      {searchControl}
      <div
        ref={mapShellRef}
        className="flex h-full min-h-0 flex-col bg-[#060708] text-white"
        aria-label={config.ariaLabel}
      >
      <div className="flex min-h-10 shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-white/10 bg-[#080a0c] px-3 py-2 text-[10px] text-white/48">
        <div className="flex min-w-0 items-center gap-2.5">
          <i className={`h-2 w-2 shrink-0 rounded-full ${sessionToneClass}`} />
          <strong className="shrink-0 text-[11px] text-white/78">{sessionStatus.label}</strong>
          <span className="truncate">{sessionStatus.detail}</span>
          <span className="hidden text-white/28 md:inline">·</span>
          <span className="hidden md:inline">{sessionStatus.location} {sessionStatus.localTime.slice(0, 5)}</span>
        </div>
        <div className="flex items-center gap-2.5">
          <span className="hidden lg:inline">下次：{sessionStatus.nextLabel}</span>
          <span className="text-white/28">·</span>
          <span>{quoteFreshnessLabel} · 每 {refreshSeconds} 秒检查</span>
          <a
            href={sessionStatus.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="grid h-6 w-6 place-items-center text-white/42 transition hover:text-white"
            aria-label={`查看${config.marketName}交易日历`}
            title="交易所交易日历"
          >
            <ExternalLink size={12} />
          </a>
        </div>
      </div>
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
        onPointerLeave={() => {
          setHoveredCode('');
          setHoveredIndustry('');
        }}
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
              (() => {
                const width = node.x1 - node.x0;
                const height = node.y1 - node.y0;
                const compact = width < 54 || height < 48;
                const members = node.leaves()
                  .map((leaf) => leaf.data.stock)
                  .filter((stock): stock is ChinaHeatmapStock => Boolean(stock));
                const marketCap = members.reduce((sum, stock) => sum + stock.marketCap, 0);
                const changePercent = marketCap > 0
                  ? members.reduce(
                    (sum, stock) => sum + stock.changePercent * stock.marketCap,
                    0,
                  ) / marketCap
                  : 0;

                return (
                  <div
                    key={`${node.data.name}-frame`}
                    data-industry={node.data.name}
                    className="pointer-events-none absolute z-0 rounded-[5px]"
                    style={{
                      left: node.x0,
                      top: node.y0,
                      width,
                      height,
                      borderRadius: 5,
                      backgroundColor: compact ? cellColor(changePercent) : '#060709',
                    }}
                  />
                );
              })()
            ))}
            {industryNodes.map((node) => {
              const width = node.x1 - node.x0;
              const height = node.y1 - node.y0;
              const visualWidth = width;
              if (visualWidth < 40 || height < 48) return null;
              const label = visualWidth >= 96 ? node.data.name : node.data.name.slice(0, 1);
              return (
                <button
                  type="button"
                  key={`${node.data.name}-header`}
                  data-industry-button={node.data.name}
                  onClick={() => selectIndustry(node.data.name)}
                  onMouseEnter={() => setHoveredIndustry(node.data.name)}
                  onMouseLeave={() => setHoveredIndustry('')}
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
                logoPath={config.logoPath}
                priceFormatter={config.formatPrice}
                marketCapFormatter={config.formatMarketCap}
                marketCapLabel={config.marketCapLabel}
                onSelect={selectStock}
                onHover={(stock) => {
                  if (!dragging) {
                    setHoveredCode(stock?.code ?? '');
                    setHoveredIndustry(stock?.industry ?? '');
                  }
                }}
              />
            ))}
            {industryNodes.map((node) => (
              hoveredIndustry === node.data.name ? (
                <div
                  key={`${node.data.name}-hover-outline`}
                  data-industry-highlight={node.data.name}
                  className="pointer-events-none absolute z-30 rounded-[5px] border-[3px] border-[#2f8cff] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.14),0_0_0_1px_rgba(47,140,255,0.22)]"
                  style={{
                    left: node.x0,
                    top: node.y0,
                    width: node.x1 - node.x0,
                    height: node.y1 - node.y0,
                  }}
                />
              ) : null
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
              <p className="font-mono text-sm font-semibold">{config.formatPrice?.(focusedStock.price) ?? focusedStock.price.toFixed(2)}</p>
              <p className="mt-0.5 text-[9px] text-white/40">价格</p>
            </div>
            <div className="hidden shrink-0 sm:block">
              <p className="font-mono text-sm font-semibold">{config.formatMarketCap?.(focusedStock.marketCap) ?? formatMarketCap(focusedStock.marketCap)}</p>
              <p className="mt-0.5 text-[9px] text-white/40">{config.marketCapLabel ?? '总市值'}</p>
            </div>
            {focusedStock.previousClose !== undefined ? (
              <div className="hidden shrink-0 lg:block">
                <p className="font-mono text-sm font-semibold">{config.formatPrice?.(focusedStock.previousClose) ?? focusedStock.previousClose.toFixed(2)}</p>
                <p className="mt-0.5 text-[9px] text-white/40">昨收</p>
              </div>
            ) : null}
            {focusedStock.updatedAt ? (
              <div className="hidden shrink-0 xl:block">
                <p className="font-mono text-[11px] font-semibold">{new Date(focusedStock.updatedAt).toLocaleTimeString('zh-CN', { hour12: false })}</p>
                <p className="mt-0.5 text-[9px] text-white/40">
                  {['CLOSE', 'OUT_OF_SESSION'].includes(focusedStock.marketState || '')
                    ? '常规盘收盘'
                    : isPublicSnapshotMarket
                      ? '非交易所直连快照'
                      : focusedStock.sourceDelaySeconds && focusedStock.sourceDelaySeconds >= 60
                      ? `延迟 ${Math.ceil(focusedStock.sourceDelaySeconds / 60)} 分钟`
                      : '实时行情'}
                </p>
              </div>
            ) : null}
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
              <p className="text-sm font-semibold text-white/76">{config.loadingText}</p>
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
          <span>{activeIndustry ? `${activeIndustry} · 点击个股查看详情` : data?.coverage ?? config.defaultCoverage}</span>
          <span>{quoteFreshnessLabel} · 每 {refreshSeconds} 秒检查</span>
          {isPublicSnapshotMarket && data?.quotePolicy ? (
            <span className="text-[#d6b566]" title={data.quotePolicy}>非 {publicSnapshotExchange} 直连；3 秒为检查频率，行情可能延迟</span>
          ) : null}
        </div>
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 bg-[#c33144]" />上涨</span>
          <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 bg-[#087d48]" />下跌</span>
          <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 bg-[#3e4044]" />平盘</span>
          <button
            type="button"
            onClick={() => void load(undefined, true)}
            disabled={refreshing}
            className="inline-flex h-7 w-7 items-center justify-center text-white/56 transition hover:text-white disabled:opacity-45"
            aria-label={`刷新${config.marketName}热力图`}
            title="刷新"
          >
            <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>
      </div>
    </>
  );
}
