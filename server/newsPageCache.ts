import { createHash } from 'node:crypto';
import { createPublicDataCache, type SnapshotStore } from './publicDataCache.ts';
import type { NewsFeed } from '../src/lib/newsTypes.ts';

// Same bounded cache engine, but a separate store and subscription fingerprint.
// This page payload must never enter the visitor-independent public allowlist.
export function createNewsPageCache(options: {
  subscriptions: () => Promise<unknown>;
  load: (force: boolean) => Promise<NewsFeed>;
  store: SnapshotStore;
  now?: () => number;
  version?: string;
}) {
  const now = options.now ?? Date.now;
  let current: { key: string; cache: ReturnType<typeof createPublicDataCache>; lastManualRefresh: number; manual?: Promise<void> } | undefined;
  let stopped = false;
  let resolving: Promise<NonNullable<typeof current>> | undefined;
  const resolve = () => resolving ??= (async () => {
    const key = createHash('sha256').update(JSON.stringify({
      subscriptions: await options.subscriptions(), version: options.version || ''
    })).digest('hex');
    if (stopped) throw new Error('News cache stopped');
    if (current?.key === key) return current;
    current?.cache.stop();
    const cache = createPublicDataCache({
      now, concurrency: 1, maxEntries: 1, maxEntryBytes: 8 * 1024 * 1024,
      // One file is replaced on subscription changes. Its embedded key prevents
      // restoring a snapshot for a different configuration after a restart.
      store: { read: () => options.store.read('current'), write: (_, value) => options.store.write('current', value) },
      resources: [{ key, refreshMs: 120_000, maxAgeMs: 1800_000, warm: true,
        validate: value => {
          const data = value as NewsFeed;
          return Array.isArray(data?.items) && Array.isArray(data.sources)
            && data.sources.some(source => source.ok);
        },
        load: async () => {
          const data = await options.load(true);
          const deadlines = data.sources.filter(source => source.stale && source.fetchedAt)
            .map(source => Date.parse(source.fetchedAt!) + 1800_000);
          const midnight = Math.floor((now() + 8 * 3600_000) / 86400_000) * 86400_000 + 16 * 3600_000;
          return { ...data, proxy: '', sources: data.sources.map(source => ({ ...source, proxy: undefined })),
            validUntil: new Date(Math.min(midnight, Date.parse(data.generatedAt) + 1800_000, ...deadlines)).toISOString() };
        },
      }],
    });
    current = { key, cache, lastManualRefresh: -Infinity };
    cache.start();
    return current;
  })().finally(() => { resolving = undefined; });

  return {
    async get(force = false): Promise<NewsFeed> {
      const entry = await resolve();
      if (force && !entry.manual && now() - entry.lastManualRefresh >= 15_000) {
        entry.lastManualRefresh = now();
        entry.manual = entry.cache.refresh(entry.key).finally(() => { entry.manual = undefined; });
      }
      if (force && entry.manual) await entry.manual;
      const result = await entry.cache.read(entry.key);
      return { ...result.data as NewsFeed, _pageCache: result.meta };
    },
    start() {
      const tick = () => { void resolve().catch(() => undefined); };
      tick();
      const timer = setInterval(tick, 60_000);
      timer.unref?.();
      return () => { stopped = true; clearInterval(timer); current?.cache.stop(); };
    },
  };
}
