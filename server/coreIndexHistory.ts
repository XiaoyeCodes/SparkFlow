export const CORE_INDEX_HISTORY_CONFIG = {
  nasdaq: { symbol: '^NDX', fredId: 'NASDAQ100' },
  sp500: { symbol: '^GSPC', fredId: 'SP500' },
  shanghai: { symbol: '000001.SS', fredId: null },
  sox: { symbol: '^SOX', fredId: 'NASDAQSOX' },
} as const;
export type CoreIndexHistoryId = keyof typeof CORE_INDEX_HISTORY_CONFIG;
type Point = { time: string; value: number };
export type CoreIndexHistorySnapshot = {
  id: CoreIndexHistoryId; symbol: string; history: Point[]; sourceUrl: string; updatedAt: string; fetchedAt: string;
};

export function normalizeCoreIndexHistory(points: Point[], now = Date.now()) {
  const byDate = new Map<string, number>();
  for (const point of points) {
    const time = Date.parse(point.time);
    if (!Number.isFinite(time) || time > now || !Number.isFinite(point.value) || point.value <= 0) continue;
    byDate.set(new Date(time).toISOString().slice(0, 10), point.value);
  }
  const history = [...byDate].sort(([a], [b]) => a.localeCompare(b))
    .filter(([date]) => now - Date.parse(date) <= 45 * 86400_000)
    .slice(-22).map(([date, value]) => ({ time: `${date}T00:00:00.000Z`, value }));
  if (history.length < 2 || now - Date.parse(history.at(-1)!.time) > 14 * 86400_000) {
    throw new Error('核心指数缺少近期有效日线');
  }
  return history;
}

export function createCoreIndexHistoryLoader({ fred, shanghai, yahoo, now = Date.now }: {
  fred: (seriesId: string) => Promise<Point[]>;
  shanghai: () => Promise<{ history: Point[]; sourceUrl: string }>;
  yahoo: (symbol: string) => Promise<{ history: Point[]; sourceUrl: string }>;
  now?: () => number;
}) {
  const snapshots = new Map<CoreIndexHistoryId, CoreIndexHistorySnapshot>();
  const pending = new Map<CoreIndexHistoryId, Promise<CoreIndexHistorySnapshot>>();
  const peek = (id: CoreIndexHistoryId) => {
    const saved = snapshots.get(id);
    return saved && now() - Date.parse(saved.fetchedAt) < 6 * 3600_000 ? saved : undefined;
  };
  return {
    peek,
    get(id: CoreIndexHistoryId) {
      const config = CORE_INDEX_HISTORY_CONFIG[id];
      if (!config) return Promise.reject(new Error('不支持的核心指数'));
      const saved = peek(id);
      if (saved && now() - Date.parse(saved.fetchedAt) < 300_000) return Promise.resolve(saved);
      const running = pending.get(id);
      if (running) return running;
      const request = (async () => {
        let data: { history: Point[]; sourceUrl: string };
        try {
          data = config.fredId ? { history: await fred(config.fredId), sourceUrl: `https://fred.stlouisfed.org/series/${config.fredId}` }
            : await shanghai();
          data.history = normalizeCoreIndexHistory(data.history, now());
        } catch {
          data = await yahoo(config.symbol);
          data.history = normalizeCoreIndexHistory(data.history, now());
        }
        if (saved && data.history.at(-1)!.time < saved.updatedAt) throw new Error('核心指数历史日期倒退');
        const snapshot = { id, symbol: config.symbol, ...data, updatedAt: data.history.at(-1)!.time, fetchedAt: new Date(now()).toISOString() };
        snapshots.set(id, snapshot);
        return snapshot;
      })().finally(() => pending.delete(id));
      pending.set(id, request);
      return request;
    },
  };
}
