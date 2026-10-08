import { marketBootstrapKeys, type MarketBootstrap } from '../src/lib/marketPreload.ts';
import { normalizeHeatmapSources } from '../src/lib/heatmapSources.ts';
import type { createPublicDataCache } from './publicDataCache.ts';

export async function readMarketBootstrap(cache: ReturnType<typeof createPublicDataCache> | undefined, sources: unknown): Promise<MarketBootstrap> {
  const selected = normalizeHeatmapSources(sources);
  const resources: Record<string, unknown> = {};
  if (cache) await Promise.all(marketBootstrapKeys(selected).map(async key => {
    const prepared = await cache.readPrepared(key);
    if (prepared) resources[key] = { ...prepared.data as object, _publicCache: prepared.meta };
  }));
  return { sources: selected, resources };
}
