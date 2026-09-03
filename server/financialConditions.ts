import { readFileSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  FinancialConditionMetric,
  FinancialConditionPoint,
  FinancialConditionsSnapshot,
  FinancialSeriesId,
} from '../src/lib/financialConditionsTypes.ts';

const DAY = 86_400_000;
const TTL = 6 * 60 * 60_000;
const RETRY = 15 * 60_000;
const IDS: FinancialSeriesId[] = ['NFCI', 'BAMLH0A0HYM2'];

export function buildFinancialConditionMetric(
  seriesId: FinancialSeriesId,
  points: FinancialConditionPoint[],
  now = Date.now(),
): FinancialConditionMetric {
  const dated = new Map<number, number>();
  for (const point of points) {
    const time = Date.parse(point.time);
    if (!Number.isFinite(time) || time > now || !Number.isFinite(point.value)) continue;
    // Negative NFCI is valid: it means looser-than-average conditions.
    if (seriesId === 'BAMLH0A0HYM2' && point.value < 0) continue;
    dated.set(time, point.value);
  }
  const history = [...dated.entries()].sort(([a], [b]) => a - b)
    .map(([time, value]) => ({ time: new Date(time).toISOString(), value }));
  const latest = history.at(-1);
  if (!latest) throw new Error(`${seriesId}: 无有效数据`);
  const latestTime = Date.parse(latest.time);
  const weekAgo = latestTime - 7 * DAY;
  // Weekly NFCI must compare adjacent weeks; daily OAS allows weekends/holidays.
  const tolerance = seriesId === 'NFCI' ? 0 : 4 * DAY;
  const previous = [...history].reverse().find(point => Date.parse(point.time) <= weekAgo
    && Date.parse(point.time) >= weekAgo - tolerance);
  return {
    seriesId,
    value: latest.value,
    observedAt: latest.time,
    fetchedAt: new Date(now).toISOString(),
    changeWeek: previous ? Number((latest.value - previous.value).toFixed(6)) : null,
    comparisonAt: previous?.time ?? null,
    history: history.slice(seriesId === 'NFCI' ? -26 : -32),
    sourceUrl: `https://fred.stlouisfed.org/series/${seriesId}`,
    stale: now - latestTime > (seriesId === 'NFCI' ? 14 : 7) * DAY,
  };
}

export function createFinancialConditionsService({ stateDir, getSeries, now = Date.now }: {
  stateDir: string;
  getSeries: (id: FinancialSeriesId) => Promise<FinancialConditionPoint[]>;
  now?: () => number;
}) {
  const file = path.join(stateDir, 'financial-conditions.json');
  const cache = new Map<FinancialSeriesId, FinancialConditionMetric>();
  let nextRefresh = 0;
  let inFlight: Promise<FinancialConditionsSnapshot> | null = null;
  try {
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    for (const id of IDS) {
      const metric = saved?.[id];
      if (!Array.isArray(metric?.history) || !Number.isFinite(Date.parse(metric.fetchedAt))) continue;
      const validated = buildFinancialConditionMetric(id, metric.history, Date.parse(metric.fetchedAt));
      if (validated.value !== metric.value || validated.observedAt !== metric.observedAt) continue;
      cache.set(id, { ...validated, stale: Boolean(metric.stale) || validated.stale });
    }
    if (cache.size === IDS.length) {
      const metrics = [...cache.values()];
      if (metrics.every(metric => !metric.stale)) {
        nextRefresh = Math.min(...metrics.map(metric => Date.parse(metric.fetchedAt))) + TTL;
      }
    }
  } catch {
    // No usable durable snapshot yet. Fetch the two series independently.
  }

  const snapshot = (): FinancialConditionsSnapshot => {
    const read = (id: FinancialSeriesId) => {
      const metric = cache.get(id);
      if (!metric) return null;
      return {
        ...metric,
        stale: metric.stale || now() - Date.parse(metric.observedAt) > (id === 'NFCI' ? 14 : 7) * DAY
          || now() - Date.parse(metric.fetchedAt) > TTL * 2,
      };
    };
    return { nfci: read('NFCI'), creditSpread: read('BAMLH0A0HYM2') };
  };

  const refresh = () => {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      const results = await Promise.allSettled(IDS.map(async id => {
        const metric = buildFinancialConditionMetric(id, await getSeries(id), now());
        const previous = cache.get(id);
        if (previous && metric.observedAt < previous.observedAt) throw new Error(`${id}: 上游日期倒退`);
        cache.set(id, metric);
      }));
      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          const metric = cache.get(IDS[index]);
          if (metric) cache.set(IDS[index], { ...metric, stale: true });
        }
      });
      nextRefresh = now() + (results.every(result => result.status === 'fulfilled') ? TTL : RETRY);
      if (cache.size) {
        try {
          await mkdir(stateDir, { recursive: true });
          await writeFile(`${file}.tmp`, JSON.stringify(Object.fromEntries(cache)), 'utf8');
          await rename(`${file}.tmp`, file);
        } catch {
          // A disk write failure must not discard valid in-memory source data.
        }
      }
      return snapshot();
    })().finally(() => { inFlight = null; });
    return inFlight;
  };

  return {
    get(forceRefresh = false): Promise<FinancialConditionsSnapshot> {
      if (forceRefresh) return refresh();
      if (now() < nextRefresh) return Promise.resolve(snapshot());
      if (cache.size) {
        void refresh();
        return Promise.resolve(snapshot());
      }
      return refresh();
    },
  };
}
