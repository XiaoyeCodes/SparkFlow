import { createHash, randomBytes } from 'node:crypto';
import { link, mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Plugin } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ValuationDashboard, ValuationInputs, ValuationLookback } from '../src/lib/ibkr/valuationTypes.ts';
import { loadValuationInputs } from './ibkrValuationData.ts';
import { computeValuationDashboard, VALUATION_RULES } from './ibkrValuationModel.ts';
import { allowedLocalRequest, allowedPublicReadRequest } from './localRequest.ts';

const horizons: ValuationLookback[] = [1, 3, 5, 10];
export const VALUATION_REFRESH_MS = 3600_000;
export const VALUATION_PUBLIC_CACHE_SECONDS = 21_600;
const RISK_RADAR_REPAIR_MS = 60_000;
interface StoredSnapshot {
  schemaVersion: 1;
  id: string;
  fetchedAt: string;
  inputs: ValuationInputs;
  windows: Record<ValuationLookback, ValuationDashboard & { snapshotId: string }>;
}
export function createValuationService(options: {
  stateDir?: string;
  load?: (options?: { force?: boolean }) => Promise<ValuationInputs>;
} = {}) {
  const directory = path.join(options.stateDir ?? path.resolve('.sparkflow'), 'valuation-audit');
  const load = options.load ?? loadValuationInputs;
  let latest: StoredSnapshot | null = null;
  let pending: Promise<StoredSnapshot> | null = null;
  let checkedAt = 0;
  let riskRadarRepairAt = 0;
  let restored: Promise<void> | undefined;
  let refreshError: string | null = null;
  function isStoredSnapshot(value: unknown, expectedId: string): value is StoredSnapshot {
    if (!value || typeof value !== 'object') return false;
    const candidate = value as Partial<StoredSnapshot>;
    if (candidate.schemaVersion !== 1 || candidate.id !== expectedId || !/^[a-f0-9]{24}$/.test(expectedId)
      || typeof candidate.fetchedAt !== 'string' || !Number.isFinite(Date.parse(candidate.fetchedAt))
      || candidate.inputs?.fetchedAt !== candidate.fetchedAt || !candidate.windows) return false;
    return horizons.every(years => {
      const item = candidate.windows?.[years];
      return Boolean(item && item.snapshotId === expectedId && item.fetchedAt === candidate.fetchedAt
        && item.lookbackYears === years && typeof item.rules?.version === 'string'
        && item.audit?.inputs?.fetchedAt === candidate.fetchedAt && Array.isArray(item.metrics)
        && Array.isArray(item.score?.contributions) && Array.isArray(item.chart?.points));
    });
  }
  async function readSnapshot(id: string): Promise<StoredSnapshot> {
    const value: unknown = JSON.parse(await readFile(path.join(directory, `${id}.json`), 'utf8'));
    if (!isStoredSnapshot(value, id)) throw new Error('快照文件格式无效');
    return value;
  }
  async function persist(snapshot: StoredSnapshot): Promise<StoredSnapshot> {
    await mkdir(directory, { recursive: true });
    const temporary = path.join(directory, `${snapshot.id}.${randomBytes(6).toString('hex')}.tmp`);
    await writeFile(temporary, JSON.stringify(snapshot), 'utf8');
    let savedSnapshot = snapshot;
    try {
      // Link a complete temporary file atomically. An existing audit is immutable,
      // including when two service instances refresh the same inputs together.
      await link(temporary, path.join(directory, `${snapshot.id}.json`));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      savedSnapshot = await readSnapshot(snapshot.id);
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
    const saved = await history();
    // Retain a bounded public-market audit, without deleting any account records.
    await Promise.all(saved.slice(48).map(row => unlink(path.join(directory, `${row.id}.json`)).catch(() => undefined)));
    return savedSnapshot;
  }
  async function restore() {
    if (!restored) restored = (async () => {
      try {
        const pointer = JSON.parse(await readFile(path.join(directory, 'latest.json'), 'utf8'));
        if (!/^[a-f0-9]{24}$/.test(pointer.id)) throw new Error('INVALID_POINTER');
        latest = await readSnapshot(pointer.id);
        checkedAt = Math.min(Date.now(), Number(pointer.checkedAt) || Date.parse(latest.fetchedAt));
      } catch {
        const saved = await history();
        if (saved[0]) { latest = await readSnapshot(saved[0].id); checkedAt = Math.min(Date.now(), Date.parse(latest.fetchedAt)); }
      }
      // Old audits remain immutable, but an incompatible snapshot must never be
      // served as the current display while its replacement loads.
      if (latest && latest.windows[5].rules.version !== VALUATION_RULES.version) {
        latest = null;
        checkedAt = 0;
      }
    })();
    return restored;
  }
  function refresh(force = false): Promise<StoredSnapshot> {
    if (pending) return pending;
    pending = (async () => {
      const inputs = structuredClone(await load({ force }));
      if (latest && !Object.values(inputs.series).some(series => series && series.current !== null && !['missing', 'stale'].includes(series.status))) {
        throw new Error('NO_FRESH_MARKET_DATA');
      }
      const computed = Object.fromEntries(horizons.map(years => [years, computeValuationDashboard(inputs, years)])) as Record<ValuationLookback, ValuationDashboard>;
      if (latest && riskRadarComplete(latest.windows[5]) && !riskRadarComplete(computed[5])) {
        throw new Error('INCOMPLETE_RISK_RADAR_DATA');
      }
      const id = createHash('sha256').update(JSON.stringify({ inputs, rules: computed[1].rules })).digest('hex').slice(0, 24);
      const windows = Object.fromEntries(horizons.map(years => [years, { ...computed[years], snapshotId: id }])) as StoredSnapshot['windows'];
      const snapshot = await persist({ schemaVersion: 1, id, fetchedAt: inputs.fetchedAt, inputs, windows });
      checkedAt = Date.now();
      latest = snapshot;
      refreshError = null;
      const pointer = path.join(directory, `latest.${randomBytes(6).toString('hex')}.tmp`);
      try {
        await writeFile(pointer, JSON.stringify({ id: snapshot.id, checkedAt }), 'utf8');
        await rename(pointer, path.join(directory, 'latest.json'));
      } finally { await unlink(pointer).catch(() => undefined); }
      return snapshot;
    })().catch(error => {
      refreshError = '行情更新失败，保留上次缓存';
      if (latest) checkedAt = Date.now();
      throw error;
    }).finally(() => { pending = null; });
    return pending;
  }
  async function current(force = false): Promise<StoredSnapshot> {
    await restore();
    if (latest) {
      if (Date.now() - checkedAt < (force ? 10_000 : VALUATION_REFRESH_MS)) return latest;
      if (!force) { void refresh().catch(() => undefined); return latest; }
    }
    return refresh(force);
  }
  function dashboard(snapshot: StoredSnapshot, years: ValuationLookback) {
    return { ...structuredClone(snapshot.windows[years]), cache: cacheMeta() };
  }
  function cacheMeta() {
    return {
      checkedAt: new Date(checkedAt).toISOString(), nextCheckAt: new Date(checkedAt + VALUATION_REFRESH_MS).toISOString(),
      refreshing: Boolean(pending), error: refreshError,
    };
  }
  function riskRadarComplete(view: ValuationDashboard) {
    const snapshots = [view.riskRadar.marketCap, view.riskRadar.gdp, view.riskRadar.cape,
      view.riskRadar.treasury2y, view.treasury, view.sentiment];
    return snapshots.every(item => item?.eligible && typeof item.current === 'number' && Number.isFinite(item.current));
  }
  function bundle(snapshot: StoredSnapshot) {
    return structuredClone({ id: snapshot.id, fetchedAt: snapshot.fetchedAt, windows: snapshot.windows });
  }
  async function history() {
    const files = await readdir(directory).catch(() => [] as string[]);
    const values: { id: string; fetchedAt: string }[] = [];
    // Read one audit at a time because each can contain four full historical windows.
    for (const file of files.filter(file => /^[a-f0-9]{24}\.json$/.test(file))) {
      try {
        const value = await readSnapshot(file.slice(0, -5));
        values.push({ id: value.id, fetchedAt: value.fetchedAt });
      } catch { /* A damaged or old-schema record must not block new snapshots. */ }
    }
    return values.sort((a, b) => Date.parse(b.fetchedAt) - Date.parse(a.fetchedAt) || a.id.localeCompare(b.id));
  }
  async function audit(id: string) {
    if (!/^[a-f0-9]{24}$/.test(id)) throw new Error('无效快照编号');
    return bundle(await readSnapshot(id));
  }
  return {
    get: async (years: ValuationLookback, force = false) => {
      if (!horizons.includes(years)) throw new Error('VALUATION_LOOKBACK_INVALID');
      return dashboard(await current(force), years);
    },
    riskRadar: async () => {
      let snapshot = await current();
      let view = snapshot.windows[5];
      // A transient source failure used to leave a fresh-looking empty snapshot
      // in memory for an hour. Repair it synchronously, while throttling repair
      // work so concurrent public visitors still share one upstream refresh.
      if (!riskRadarComplete(view) && Date.now() - riskRadarRepairAt >= RISK_RADAR_REPAIR_MS) {
        riskRadarRepairAt = Date.now();
        try {
          snapshot = await refresh(true);
          view = snapshot.windows[5];
        } catch { /* Return the partial snapshot without allowing it into long-lived caches. */ }
      }
      return structuredClone({ fetchedAt: view.fetchedAt, treasury: view.treasury, sentiment: view.sentiment,
        riskRadar: view.riskRadar, complete: riskRadarComplete(view), cache: cacheMeta() });
    },
    snapshot: async () => bundle(await current()), history, audit,
    refresh: async () => { await restore(); return current(true); },
  };
}

export function ibkrValuationPlugin(): Plugin {
  const service = createValuationService();
  const install = (server: { httpServer?: { once: (event: string, callback: () => void) => unknown } | null; middlewares: { use: (handler: (req: IncomingMessage, res: ServerResponse, next: () => void) => void) => unknown } }) => {
    // The app service maintains the hourly cache even when this page is closed.
    void service.get(5).catch(() => undefined);
    const timer = setInterval(() => { void service.refresh().catch(() => undefined); }, VALUATION_REFRESH_MS);
    timer.unref();
    server.httpServer?.once('close', () => clearInterval(timer));
    server.middlewares.use((req, res, next) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (url.pathname !== '/api/ibkr-valuation' && !url.pathname.startsWith('/api/ibkr-valuation/')) return next();
      const send = (status: number, payload: unknown, cacheControl = 'no-store') => {
        res.statusCode = status;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', cacheControl);
        res.setHeader('Vary', 'Accept-Encoding');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.end(JSON.stringify(payload));
      };
      if (!allowedPublicReadRequest(req.headers)) return send(403, { error: '只允许同源读取公开行情' });
      if (req.method !== 'GET') return send(405, { error: '只读行情接口仅接受 GET' });
      void (async () => {
        if (url.pathname === '/api/ibkr-valuation/risk-radar') {
          res.setHeader('X-SparkFlow-Refresh-Mode', 'scheduled-cache');
          const payload = await service.riskRadar();
          const cacheControl = payload.complete
            ? `public, max-age=300, s-maxage=${VALUATION_PUBLIC_CACHE_SECONDS}, stale-while-revalidate=86400`
            : 'no-store';
          return send(200, payload, cacheControl);
        }
        if (url.pathname === '/api/ibkr-valuation/history') return send(200, { snapshots: await service.history() });
        if (url.pathname === '/api/ibkr-valuation/snapshot') return send(200, await service.snapshot());
        if (url.pathname.startsWith('/api/ibkr-valuation/audit/')) {
          const id = url.pathname.slice('/api/ibkr-valuation/audit/'.length);
          if (!/^[a-f0-9]{24}$/.test(id)) return send(400, { error: '无效快照编号' });
          try { return send(200, await service.audit(id)); } catch { return send(404, { error: '该快照不存在或已超出保留范围' }); }
        }
        if (url.pathname !== '/api/ibkr-valuation') return send(404, { error: '行情接口不存在' });
        const requested = url.searchParams.get('years') ?? '5';
        if (!['1', '3', '5', '10'].includes(requested)) return send(400, { error: '回看窗口仅支持 1 / 3 / 5 / 10 年' });
        // Public visitors can only read the shared snapshot. A force refresh is
        // intentionally honored on localhost; scheduled service refreshes own
        // all upstream traffic in production.
        const force = url.searchParams.get('fresh') === '1' && allowedLocalRequest(req.headers, req.socket.localPort ?? 0);
        const cacheControl = force ? 'no-store' : `public, max-age=300, s-maxage=${VALUATION_PUBLIC_CACHE_SECONDS}, stale-while-revalidate=86400`;
        res.setHeader('X-SparkFlow-Refresh-Mode', force ? 'forced-local' : 'scheduled-cache');
        return send(200, await service.get(Number(requested) as ValuationLookback, force), cacheControl);
      })().catch(() => { if (!res.writableEnded) send(503, { error: '市场数据暂不可用，请稍后刷新。上次导出的计算记录仍可离线查看。' }); });
    });
  };
  return { name: 'ibkr-valuation-monitor', configureServer: install, configurePreviewServer: install };
}
