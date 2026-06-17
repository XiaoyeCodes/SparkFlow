import { useEffect, useRef } from 'react';

type HeatmapMode = 'stocks' | 'etfs';

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

export function TradingViewHeatmap({ mode }: { mode: HeatmapMode }) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.innerHTML = '';
    let mountTimer = window.setTimeout(() => {
      const liveContainer = containerRef.current;
      if (!liveContainer) return;

      liveContainer.innerHTML = '';
      const widget = document.createElement('div');
      widget.className = 'tradingview-widget-container__widget h-full w-full';

      const copyright = document.createElement('div');
      copyright.className = 'tradingview-widget-copyright sr-only';

      const script = document.createElement('script');
      script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-stock-heatmap.js';
      script.type = 'text/javascript';
      script.async = true;
      script.innerHTML = JSON.stringify(heatmapConfig[mode]);

      liveContainer.appendChild(widget);
      liveContainer.appendChild(copyright);
      liveContainer.appendChild(script);
    }, 0);

    return () => {
      window.clearTimeout(mountTimer);
      mountTimer = 0;
      container.innerHTML = '';
    };
  }, [mode]);

  return (
    <div className="h-full max-h-full w-full overflow-hidden bg-[#060607]" aria-label="TradingView stock heatmap">
      <div ref={containerRef} className="tradingview-widget-container h-full max-h-full w-full overflow-hidden" />
    </div>
  );
}
