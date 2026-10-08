import { normalizeHeatmapSources } from './heatmapSources.ts';
export const MARKET_DATA_PREPARED = 'sparkflow:market-data-prepared';
export const NEWS_DATA_PREPARED = 'sparkflow:news-data-prepared';

export function marketBootstrapKeys(sources: unknown) {
  const selected = normalizeHeatmapSources(sources);
  return ['/api/public-market-intelligence', '/api/market-quotes',
    ...(['china', 'hongkong', 'us'] as const).map(market =>
      `/api/${market === 'hongkong' ? 'hong-kong' : market}-market-heatmap?source=${selected[market]}`),
    '/api/crypto-market-heatmap',
    ...['japan', 'korea', 'india', 'germany', 'france', 'uk'].map(market => `/api/global-market-heatmap?market=${market}`),
  ];
}

export type MarketBootstrap = { sources: ReturnType<typeof normalizeHeatmapSources>; resources: Record<string, unknown> };
