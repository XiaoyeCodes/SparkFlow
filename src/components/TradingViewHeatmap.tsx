import { RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

type HeatmapMode = 'stocks' | 'etfs';

const HEATMAP_SCRIPT_URL = 'https://s3.tradingview.com/external-embedding/embed-widget-stock-heatmap.js';
let heatmapWarmupStarted = false;
let heatmapParkingLot: HTMLDivElement | null = null;
const parkedHeatmaps: Partial<Record<HeatmapMode, HTMLDivElement>> = {};

const heatmapConfig: Record<HeatmapMode, Record<string, unknown>> = {
  stocks: {
    dataSource: 'SPX500',
    blockSize: 'market_cap_basic',
    blockColor: 'change',
    grouping: 'sector',
    locale: 'zh_CN',
    symbolUrl: '',
    colorTheme: 'dark',
    hasTopBar: false,
    isDataSetEnabled: false,
    isZoomEnabled: true,
    hasSymbolTooltip: true,
    isMonoSize: false,
    width: '100%',
    height: '100%'
  },
  etfs: {
    dataSource: 'AllUSEtf',
    blockSize: 'aum',
    blockColor: 'change',
    grouping: 'asset_class',
    locale: 'zh_CN',
    symbolUrl: '',
    colorTheme: 'dark',
    hasTopBar: false,
    isDataSetEnabled: false,
    isZoomEnabled: true,
    hasSymbolTooltip: true,
    width: '100%',
    height: '100%'
  }
};

function getHeatmapParkingLot() {
  if (heatmapParkingLot) return heatmapParkingLot;

  heatmapParkingLot = document.createElement('div');
  heatmapParkingLot.setAttribute('aria-hidden', 'true');
  heatmapParkingLot.style.cssText =
    'position:absolute;left:-10000px;top:0;width:1px;height:1px;overflow:hidden;visibility:hidden;pointer-events:none;';
  document.body.appendChild(heatmapParkingLot);

  return heatmapParkingLot;
}

function parkHeatmap(mode: HeatmapMode, mount: HTMLDivElement | null) {
  if (!mount) return;

  parkedHeatmaps[mode] = mount;
  getHeatmapParkingLot().appendChild(mount);
}

function createHeatmapMount(mode: HeatmapMode, onReady: () => void, onError: () => void) {
  const mount = document.createElement('div');
  mount.className = 'tradingview-widget-container h-full max-h-full w-full overflow-hidden';

  const widget = document.createElement('div');
  widget.className = 'tradingview-widget-container__widget h-full w-full';

  const copyright = document.createElement('div');
  copyright.className = 'tradingview-widget-copyright sr-only';

  const script = document.createElement('script');
  script.src = HEATMAP_SCRIPT_URL;
  script.type = 'text/javascript';
  script.async = true;
  script.innerHTML = JSON.stringify(heatmapConfig[mode]);
  script.onload = onReady;
  script.onerror = onError;

  mount.appendChild(widget);
  mount.appendChild(copyright);
  mount.appendChild(script);

  return mount;
}

export function preloadTradingViewHeatmap() {
  if (typeof document === 'undefined' || heatmapWarmupStarted) return;

  heatmapWarmupStarted = true;

  const preconnect = document.createElement('link');
  preconnect.rel = 'preconnect';
  preconnect.href = 'https://s3.tradingview.com';
  preconnect.crossOrigin = 'anonymous';
  document.head.appendChild(preconnect);

  const dnsPrefetch = document.createElement('link');
  dnsPrefetch.rel = 'dns-prefetch';
  dnsPrefetch.href = 'https://s3.tradingview.com';
  document.head.appendChild(dnsPrefetch);

  const preload = document.createElement('link');
  preload.rel = 'preload';
  preload.as = 'script';
  preload.href = HEATMAP_SCRIPT_URL;
  document.head.appendChild(preload);

  const warmup = () => {
    const holder = document.createElement('div');
    holder.className = 'tradingview-widget-container';
    holder.setAttribute('aria-hidden', 'true');
    holder.style.cssText =
      'position:absolute;left:-10000px;top:0;width:960px;height:540px;overflow:hidden;visibility:hidden;pointer-events:none;';

    const widget = document.createElement('div');
    widget.className = 'tradingview-widget-container__widget h-full w-full';

    const script = document.createElement('script');
    script.src = HEATMAP_SCRIPT_URL;
    script.type = 'text/javascript';
    script.async = true;
    script.innerHTML = JSON.stringify(heatmapConfig.stocks);

    holder.appendChild(widget);
    holder.appendChild(script);
    document.body.appendChild(holder);
  };

  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(warmup, { timeout: 2200 });
  } else {
    globalThis.setTimeout(warmup, 900);
  }
}

export function TradingViewHeatmap({ mode }: { mode: HeatmapMode }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const activeMountRef = useRef<HTMLDivElement | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'slow'>('loading');
  const loadedAt = useMemo(
    () =>
      new Intl.DateTimeFormat('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      }).format(new Date()),
    [reloadKey]
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    preloadTradingViewHeatmap();
    container.innerHTML = '';
    setLoadState('loading');

    const slowTimer = window.setTimeout(() => {
      setLoadState((state) => (state === 'loading' ? 'slow' : state));
    }, 5000);

    const mountTimer = window.setTimeout(() => {
      const liveContainer = containerRef.current;
      if (!liveContainer) return;

      liveContainer.innerHTML = '';
      if (reloadKey > 0) {
        parkedHeatmaps[mode]?.remove();
        delete parkedHeatmaps[mode];
      }

      const cachedMount = parkedHeatmaps[mode];
      const mount =
        cachedMount ??
        createHeatmapMount(
          mode,
          () => setLoadState('ready'),
          () => setLoadState('slow')
        );

      delete parkedHeatmaps[mode];
      activeMountRef.current = mount;
      liveContainer.appendChild(mount);

      if (cachedMount) {
        setLoadState('ready');
      }
    }, 0);

    return () => {
      window.clearTimeout(mountTimer);
      window.clearTimeout(slowTimer);
      parkHeatmap(mode, activeMountRef.current);
      activeMountRef.current = null;
    };
  }, [mode, reloadKey]);

  return (
    <div className="relative h-full max-h-full w-full overflow-hidden bg-[#060607]" aria-label="TradingView stock heatmap">
      <div ref={containerRef} className="tradingview-widget-container h-full max-h-full w-full overflow-hidden" />
      {loadState !== 'ready' ? (
        <div className="pointer-events-none absolute inset-0 grid place-items-center bg-black/58 text-center backdrop-blur-sm">
          <div>
            <div className="mx-auto mb-3 h-7 w-7 animate-spin rounded-full border-2 border-white/18 border-t-[#8ad7ff]" />
            <p className="text-sm font-semibold text-white/78">
              {loadState === 'slow' ? 'TradingView 连接较慢，仍在等待行情图' : '正在加载 TradingView 热力图'}
            </p>
            <p className="mt-2 text-xs text-white/42">海外行情源可能存在网络延迟</p>
          </div>
        </div>
      ) : null}
      <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between gap-3 rounded-md border border-white/10 bg-black/62 px-3 py-2 text-[11px] text-white/52 backdrop-blur-xl">
        <span>嵌入式行情可能不同于交易所实时数据 · 加载于 {loadedAt}</span>
        <button
          type="button"
          onClick={() => setReloadKey((key) => key + 1)}
          className="inline-flex h-7 items-center gap-1.5 rounded-md border border-white/10 px-2 font-semibold text-white/72 transition hover:border-[#8ad7ff]/40 hover:text-white"
        >
          <RefreshCw size={13} strokeWidth={1.8} />
          刷新
        </button>
      </div>
    </div>
  );
}
