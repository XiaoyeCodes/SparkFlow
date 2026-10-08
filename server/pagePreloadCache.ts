import type { IncomingMessage, ServerResponse } from 'node:http';
import { createPublicDataCache, type SnapshotStore } from './publicDataCache.ts';

const hour = 3600_000;
const canonical = (input: string) => {
  const url = new URL(input, 'http://page.local');
  url.searchParams.sort();
  return url.pathname + url.search;
};

// Fixed page dependencies only; arbitrary symbols, subscriptions and account data
// stay with their own services and never enter this shared snapshot store.
export const PAGE_PRELOAD_RESOURCES = [
  ...(['flows', 'performance'] as const).map(view => ({
    key: canonical(`/api/daily-brief/details?view=${view}`), refreshMs: hour, maxAgeMs: 24 * hour,
  })),
  { key: '/api/daily-brief/watchlist', refreshMs: 5 * 60_000, maxAgeMs: 30 * 60_000 },
  ...(['VOO', 'QQQ'] as const).flatMap(ticker => [
    { key: `/api/risk-radar/history?ticker=${ticker}`, refreshMs: hour, maxAgeMs: 24 * hour },
    ...(['1y', '2y'] as const).map(range => ({
      key: canonical(`/api/equity-report-chart?symbol=${ticker}&range=${range}`), refreshMs: hour, maxAgeMs: 24 * hour,
    })),
  ]),
] as const;

export function validatePagePreload(key: string, value: unknown) {
  if (!value || typeof value !== 'object') return false;
  const data = value as Record<string, any>;
  const url = new URL(key, 'http://page.local');
  if (url.pathname === '/api/daily-brief/details') {
    return data.kind === url.searchParams.get('view') && Array.isArray(data.sources)
      && (data.kind === 'performance' ? data.series?.some((series: any) => series.points?.length > 1)
        : data.price?.length > 1 || data.etfFlows?.length > 1);
  }
  if (url.pathname === '/api/daily-brief/watchlist') return Array.isArray(data.items) && data.items.length > 0;
  if (url.pathname === '/api/risk-radar/history') {
    return data.ticker === url.searchParams.get('ticker') && data.events?.length === 3
      && data.events.every((event: any) => Number.isFinite(event.price) && Number.isFinite(event.sma));
  }
  return data.symbol === url.searchParams.get('symbol') && data.points?.length >= 200
    && data.points.every((point: any) => typeof point.time === 'string' && Number.isFinite(point.close) && point.close > 0);
}

export function createPagePreloadCache(options: {
  load: (key: string) => Promise<unknown>;
  store: SnapshotStore;
  now?: () => number;
}) {
  const cache = createPublicDataCache({
    now: options.now, store: options.store, concurrency: 2,
    maxEntries: PAGE_PRELOAD_RESOURCES.length, maxEntryBytes: 8 * 1024 * 1024,
    resources: PAGE_PRELOAD_RESOURCES.map(resource => ({ ...resource, warm: true,
      load: () => options.load(resource.key), validate: value => validatePagePreload(resource.key, value),
    })),
  });
  return {
    start: () => cache.start(), stop: () => cache.stop(), status: () => cache.status(),
    tick: () => cache.tick(), read: (key: string) => cache.read(canonical(key)),
    async serve(req: IncomingMessage, res: ServerResponse) {
      if (req.method !== 'GET' || req.headers.authorization) return false;
      const key = canonical(req.url || '/');
      if (!cache.has(key)) return false;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      try {
        const snapshot = await cache.read(key);
        if (res.destroyed) return true;
        res.setHeader('X-SparkFlow-Cache', snapshot.meta.state);
        res.setHeader('X-SparkFlow-Cache-Stored-At', snapshot.meta.storedAt);
        res.end(JSON.stringify({ ...snapshot.data as object, _pageCache: snapshot.meta }));
      } catch {
        if (res.destroyed) return true;
        res.statusCode = 503;
        res.setHeader('Retry-After', '5');
        res.end(JSON.stringify({ error: 'page_data_preparing', detail: '页面数据正在后台准备，请稍后重试' }));
      }
      return true;
    },
  };
}
