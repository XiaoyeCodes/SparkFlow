export type CoreMarketMode = 'china' | 'hongkong' | 'us' | 'crypto';

export type DailyMarketResource =
  | 'valuation'
  | 'bitcoin-cycle';

type DailyCacheEnvelope<T> = {
  version: 1;
  beijingDate: string;
  storedAt: string;
  data: T;
};

export type DailyCacheBackend = {
  read(key: string): Promise<string | null>;
  write(key: string, value: string): Promise<void>;
  removeOtherDates?(currentBeijingDate: string): Promise<void>;
};

type DailyMarketCacheOptions = {
  backend: DailyCacheBackend;
  now?: () => Date;
};

type LoadDailyMarketDataOptions<T> = {
  market: CoreMarketMode;
  resource: DailyMarketResource;
  loader: () => Promise<T>;
  force?: boolean;
};

const CACHE_VERSION = 1;
const CACHE_NAME = 'sparkflow-market-daily-v1';
const CACHE_PATH = '/__sparkflow_market_daily_cache__/';
const LOCAL_STORAGE_PREFIX = 'sparkflow:market-daily:v1:';

export function getBeijingDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function cacheKey(date: string, market: CoreMarketMode, resource: DailyMarketResource) {
  // Bump only the Hong Kong valuation payload after expanding its market coverage.
  const revision = market === 'hongkong' && resource === 'valuation' ? ':r2' : '';
  return `${date}:${market}:${resource}${revision}`;
}

function isEnvelope<T>(value: unknown, date: string): value is DailyCacheEnvelope<T> {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<DailyCacheEnvelope<T>>;
  return entry.version === CACHE_VERSION && entry.beijingDate === date && 'data' in entry;
}

function createBrowserBackend(): DailyCacheBackend {
  const requestFor = (key: string) => new Request(
    new URL(`${CACHE_PATH}${encodeURIComponent(key)}`, window.location.origin).toString(),
  );

  const readLocalStorage = (key: string) => {
    try {
      return window.localStorage.getItem(`${LOCAL_STORAGE_PREFIX}${key}`);
    } catch {
      return null;
    }
  };

  return {
    async read(key) {
      if ('caches' in window) {
        try {
          const cache = await window.caches.open(CACHE_NAME);
          const response = await cache.match(requestFor(key));
          if (response) return response.text();
        } catch {
          // Cache Storage may be disabled; localStorage remains a small-data fallback.
        }
      }
      return readLocalStorage(key);
    },
    async write(key, value) {
      if ('caches' in window) {
        try {
          const cache = await window.caches.open(CACHE_NAME);
          await cache.put(requestFor(key), new Response(value, {
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
          }));
          return;
        } catch {
          // Fall through when Cache Storage is unavailable.
        }
      }
      try {
        window.localStorage.setItem(`${LOCAL_STORAGE_PREFIX}${key}`, value);
      } catch {
        // The in-memory cache still prevents duplicate requests in this session.
      }
    },
    async removeOtherDates(currentBeijingDate) {
      if ('caches' in window) {
        try {
          const cache = await window.caches.open(CACHE_NAME);
          const requests = await cache.keys();
          await Promise.all(requests.map((request) => {
            const encodedKey = new URL(request.url).pathname.slice(CACHE_PATH.length);
            const key = decodeURIComponent(encodedKey);
            return key.startsWith(`${currentBeijingDate}:`) ? Promise.resolve(false) : cache.delete(request);
          }));
        } catch {
          // Cleanup is opportunistic and must never block rendering.
        }
      }
      try {
        const keepPrefix = `${LOCAL_STORAGE_PREFIX}${currentBeijingDate}:`;
        const staleKeys: string[] = [];
        for (let index = 0; index < window.localStorage.length; index += 1) {
          const key = window.localStorage.key(index);
          if (key?.startsWith(LOCAL_STORAGE_PREFIX) && !key.startsWith(keepPrefix)) staleKeys.push(key);
        }
        staleKeys.forEach((key) => window.localStorage.removeItem(key));
      } catch {
        // Cleanup is opportunistic and must never block rendering.
      }
    },
  };
}

function createUnavailableBackend(): DailyCacheBackend {
  return {
    async read() { return null; },
    async write() {},
  };
}

export function createDailyMarketCache({ backend, now = () => new Date() }: DailyMarketCacheOptions) {
  const memory = new Map<string, DailyCacheEnvelope<unknown>>();
  const inFlight = new Map<string, Promise<unknown>>();
  let lastCleanupDate = '';

  const read = async <T>(market: CoreMarketMode, resource: DailyMarketResource) => {
    const date = getBeijingDate(now());
    const key = cacheKey(date, market, resource);
    const memoryEntry = memory.get(key);
    if (memoryEntry && isEnvelope<T>(memoryEntry, date)) return memoryEntry.data as T;

    try {
      const raw = await backend.read(key);
      if (!raw) return undefined;
      const parsed = JSON.parse(raw) as unknown;
      if (!isEnvelope<T>(parsed, date)) return undefined;
      memory.set(key, parsed);
      return parsed.data;
    } catch {
      return undefined;
    }
  };

  const load = async <T>({ market, resource, loader, force = false }: LoadDailyMarketDataOptions<T>) => {
    const date = getBeijingDate(now());
    const key = cacheKey(date, market, resource);
    if (!force) {
      const cached = await read<T>(market, resource);
      if (cached !== undefined) return cached;
    }

    const running = inFlight.get(key) as Promise<T> | undefined;
    if (running) return running;

    const request = loader().then(async (data) => {
      const envelope: DailyCacheEnvelope<T> = {
        version: CACHE_VERSION,
        beijingDate: date,
        storedAt: now().toISOString(),
        data,
      };
      memory.set(key, envelope);
      await backend.write(key, JSON.stringify(envelope));
      if (lastCleanupDate !== date) {
        lastCleanupDate = date;
        await backend.removeOtherDates?.(date);
      }
      return data;
    }).finally(() => inFlight.delete(key));

    inFlight.set(key, request);
    return request;
  };

  return { load, read };
}

const dailyMarketCache = createDailyMarketCache({
  backend: typeof window === 'undefined' ? createUnavailableBackend() : createBrowserBackend(),
});

export const loadDailyMarketData = dailyMarketCache.load;
export const readDailyMarketData = dailyMarketCache.read;
