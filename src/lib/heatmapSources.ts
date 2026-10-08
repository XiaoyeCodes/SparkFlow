export type HeatmapMarketId = 'china' | 'hongkong' | 'us';
export type HeatmapQuoteSource = 'eastmoney' | 'sina';

export const DEFAULT_HEATMAP_QUOTE_SOURCE: HeatmapQuoteSource = 'sina';
let preparedSources: Record<HeatmapMarketId, HeatmapQuoteSource> | undefined;
export function peekPreparedHeatmapSources() { return preparedSources && { ...preparedSources }; }
export function rememberHeatmapSources(value: unknown) { preparedSources = normalizeHeatmapSources(value); }
export const HEATMAP_SOURCE_LABELS: Record<HeatmapQuoteSource, string> = {
  sina: '新浪财经',
  eastmoney: '东方财富',
};

export function resolveHeatmapQuoteSource(value: unknown): HeatmapQuoteSource {
  return value === 'eastmoney' || value === 'sina' ? value : DEFAULT_HEATMAP_QUOTE_SOURCE;
}

export function normalizeHeatmapSources(value: unknown): Record<HeatmapMarketId, HeatmapQuoteSource> {
  const settings = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    china: resolveHeatmapQuoteSource(settings.china),
    hongkong: resolveHeatmapQuoteSource(settings.hongkong),
    us: resolveHeatmapQuoteSource(settings.us),
  };
}
