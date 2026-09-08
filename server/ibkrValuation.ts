import { createHash, randomBytes } from 'node:crypto';
import { link, mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Plugin } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ValuationDashboard, ValuationInputs, ValuationLookback } from '../src/lib/ibkr/valuationTypes.ts';
import { loadValuationInputs } from './ibkrValuationData.ts';
import { computeValuationDashboard } from './ibkrValuationModel.ts';
import { allowedLocalRequest } from './localRequest.ts';

const horizons: ValuationLookback[] = [1, 3, 5, 10];
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
  async function current(force = false): Promise<StoredSnapshot> {
    if (pending) return pending;
    if (latest && Date.now() - checkedAt < (force ? 10_000 : 55_000)) return latest;
    pending = (async () => {
      const inputs = structuredClone(await load({ force }));
      const computed = Object.fromEntries(horizons.map(years => [years, computeValuationDashboard(inputs, years)])) as Record<ValuationLookback, ValuationDashboard>;
      const id = createHash('sha256').update(JSON.stringify({ inputs, rules: computed[1].rules })).digest('hex').slice(0, 24);
      const windows = Object.fromEntries(horizons.map(years => [years, { ...computed[years], snapshotId: id }])) as StoredSnapshot['windows'];
      const snapshot = await persist({ schemaVersion: 1, id, fetchedAt: inputs.fetchedAt, inputs, windows });
      checkedAt = Date.now();
      latest = snapshot;
      return snapshot;
    })().finally(() => { pending = null; });
    return pending;
  }
  function dashboard(snapshot: StoredSnapshot, years: ValuationLookback) {
    return structuredClone(snapshot.windows[years]);
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
    snapshot: async () => bundle(await current()), history, audit,
  };
}

export function ibkrValuationPlugin(): Plugin {
  const service = createValuationService();
  const install = (server: { middlewares: { use: (handler: (req: IncomingMessage, res: ServerResponse, next: () => void) => void) => unknown } }) => {
    server.middlewares.use((req, res, next) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (url.pathname !== '/api/ibkr-valuation' && !url.pathname.startsWith('/api/ibkr-valuation/')) return next();
      const send = (status: number, payload: unknown) => {
        res.statusCode = status;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.end(JSON.stringify(payload));
      };
      if (!allowedLocalRequest(req.headers, req.socket.localPort ?? 0)) return send(403, { error: '只允许本机同源访问' });
      if (req.method !== 'GET') return send(405, { error: '只读行情接口仅接受 GET' });
      void (async () => {
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
        return send(200, await service.get(Number(requested) as ValuationLookback, url.searchParams.get('fresh') === '1'));
      })().catch(() => { if (!res.writableEnded) send(503, { error: '市场数据暂不可用，请稍后刷新。上次导出的计算记录仍可离线查看。' }); });
    });
  };
  return { name: 'ibkr-valuation-monitor', configureServer: install, configurePreviewServer: install };
}
