import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type PublicResource = {
  key: string;
  refreshMs: number;
  maxAgeMs: number;
  warm?: boolean;
  persist?: boolean;
  load: () => Promise<unknown>;
  validate: (data: unknown) => boolean;
};
export type PublicCacheMeta = {
  state: 'fresh' | 'stale';
  storedAt: string;
  refreshAt: string;
  expiresAt: string;
};
type Snapshot = { version: 1; key: string; storedAt: number; data: unknown };
type Entry = Snapshot & { expiresAt: number; bytes: number; touchedAt: number; json: string };
type Job = { resource: PublicResource; resolve: () => void; reject: (error: Error) => void; promise: Promise<void>; urgent: boolean };
export type SnapshotStore = { read(key: string): Promise<string | null>; write(key: string, value: string): Promise<void> };

export function createPublicSnapshotStore(directory: string, maxBytes = 2 * 1024 * 1024): SnapshotStore {
  // Resource keys never become filesystem paths. Only allowlisted hashes are read.
  const target = (key: string) => path.join(directory, createHash('sha256').update(key).digest('hex') + '.json');
  return {
    async read(key) {
      try {
        const file = target(key);
        if ((await stat(file)).size > maxBytes) return null;
        return await readFile(file, 'utf8');
      } catch { return null; }
    },
    async write(key, value) {
      if (Buffer.byteLength(value) > maxBytes) return;
      await mkdir(directory, { recursive: true });
      const file = target(key);
      const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, value, 'utf8');
        await rename(temporary, file);
      } finally { await unlink(temporary).catch(() => undefined); }
    },
  };
}

// A source's publication/validity boundary always overrides our cache lifetime.
export function publicPayloadDeadline(data: unknown): number {
  if (!data || typeof data !== 'object') return Infinity;
  let deadline = Infinity;
  for (const [key, value] of Object.entries(data)) {
    if (key === 'validUntil' && value != null) {
      const parsed = typeof value === 'string' ? Date.parse(value) : NaN;
      deadline = Math.min(deadline, Number.isFinite(parsed) ? parsed : 0);
    } else if (value && typeof value === 'object') deadline = Math.min(deadline, publicPayloadDeadline(value));
  }
  return deadline;
}

export function createPublicDataCache(options: {
  resources: PublicResource[];
  store?: SnapshotStore;
  now?: () => number;
  concurrency?: number;
  maxEntries?: number;
  maxBytes?: number;
  maxEntryBytes?: number;
  idleMs?: number;
}) {
  const now = options.now ?? Date.now;
  const concurrency = Math.max(1, Math.min(4, options.concurrency ?? 2));
  const maxEntries = options.maxEntries ?? 160;
  const maxBytes = options.maxBytes ?? 32 * 1024 * 1024;
  const maxEntryBytes = options.maxEntryBytes ?? 2 * 1024 * 1024;
  const resources = new Map(options.resources.map(resource => [resource.key, resource]));
  if (resources.size !== options.resources.length) throw new Error('Duplicate public resource key');
  const entries = new Map<string, Entry>();
  const jobs = new Map<string, Job>();
  const queue: Job[] = [];
  const lastUsed = new Map<string, number>();
  const retryAt = new Map<string, number>();
  const failures = new Map<string, number>();
  let active = 0;
  let bytes = 0;
  let closed = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  let initialized: Promise<void> | undefined;
  let diskErrors = 0;

  const remove = (key: string) => {
    const entry = entries.get(key);
    if (entry) bytes -= entry.bytes;
    entries.delete(key);
  };
  const put = (snapshot: Snapshot, resource: PublicResource) => {
    if (!Number.isFinite(snapshot.storedAt) || snapshot.storedAt > now() || !resource.validate(snapshot.data)) return false;
    const expiresAt = Math.min(snapshot.storedAt + resource.maxAgeMs, publicPayloadDeadline(snapshot.data));
    if (expiresAt <= now()) return false;
    const encoded = JSON.stringify(snapshot);
    const size = Buffer.byteLength(encoded);
    if (size > maxEntryBytes || size > maxBytes) return false;
    remove(resource.key);
    while (entries.size >= maxEntries || bytes + size > maxBytes) {
      const oldest = [...entries.values()].sort((a, b) => a.touchedAt - b.touchedAt)[0];
      if (!oldest) break;
      remove(oldest.key);
    }
    // Detach from legacy loaders that may later mutate their own cached objects.
    const stable = JSON.parse(encoded) as Snapshot;
    entries.set(resource.key, { ...stable, expiresAt, bytes: size, touchedAt: now(), json: JSON.stringify(stable.data) });
    bytes += size;
    return true;
  };
  const initialize = () => initialized ??= (async () => {
    if (!options.store) return;
    // Sequential disk reads keep startup I/O modest on older Windows machines.
    for (const resource of resources.values()) {
      if (closed) return;
      if (resource.persist === false) continue;
      try {
        const raw = await options.store.read(resource.key);
        if (!raw || Buffer.byteLength(raw) > maxEntryBytes) continue;
        const snapshot = JSON.parse(raw) as Snapshot;
        if (snapshot?.version === 1 && snapshot.key === resource.key && !closed) put(snapshot, resource);
      } catch { diskErrors++; }
    }
  })();

  const pump = () => {
    if (closed) return;
    while (active < concurrency && queue.length) {
      const index = Math.max(0, queue.findIndex(job => job.urgent));
      const job = queue.splice(index, 1)[0];
      active++;
      void (async () => {
        try {
          const data = await job.resource.load();
          if (closed) throw new Error('Public cache stopped');
          const snapshot: Snapshot = { version: 1, key: job.resource.key, storedAt: now(), data };
          if (!put(snapshot, job.resource)) throw new Error('Public data invalid, expired or too large');
          failures.delete(job.resource.key);
          retryAt.delete(job.resource.key);
          if (options.store && job.resource.persist !== false) {
            try { await options.store.write(job.resource.key, JSON.stringify(snapshot)); }
            catch { diskErrors++; } // A full/read-only disk must not break memory caching.
          }
          job.resolve();
        } catch {
          const count = (failures.get(job.resource.key) ?? 0) + 1;
          failures.set(job.resource.key, count);
          retryAt.set(job.resource.key, now() + Math.min(300_000, 5_000 * 2 ** Math.min(count - 1, 6)));
          job.reject(new Error('公共数据暂不可用，后台将自动重试'));
        } finally {
          active--;
          jobs.delete(job.resource.key);
          pump();
        }
      })();
    }
  };
  const enqueue = (resource: PublicResource, urgent = false): Promise<void> => {
    const existing = jobs.get(resource.key);
    if (existing) { existing.urgent ||= urgent; return existing.promise; }
    if (closed || (retryAt.get(resource.key) ?? 0) > now()) return Promise.reject(new Error('公共数据正在等待重试'));
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
    const job = { resource, resolve, reject, promise, urgent };
    jobs.set(resource.key, job);
    queue.push(job);
    pump();
    return promise;
  };
  const tick = async () => {
    await initialize();
    if (closed) return;
    for (const resource of resources.values()) {
      const entry = entries.get(resource.key);
      if (entry && entry.expiresAt <= now()) remove(resource.key);
      const used = lastUsed.get(resource.key);
      if (!resource.warm && (used === undefined || now() - used > (options.idleMs ?? 30 * 60_000))) continue;
      if (!entry || Math.min(entry.storedAt + resource.refreshMs, entry.expiresAt) <= now()) {
        void enqueue(resource).catch(() => undefined);
      }
    }
  };
  const result = (entry: Entry, resource: PublicResource) => {
    entry.touchedAt = now();
    const refreshAt = Math.min(entry.storedAt + resource.refreshMs, entry.expiresAt);
    const meta: PublicCacheMeta = {
      state: now() < refreshAt ? 'fresh' : 'stale',
      storedAt: new Date(entry.storedAt).toISOString(),
      refreshAt: new Date(refreshAt).toISOString(),
      expiresAt: new Date(entry.expiresAt).toISOString(),
    };
    // Serialize the large payload once per refresh, not once per visitor.
    const body = entry.json.endsWith('}') ? `${entry.json.slice(0, -1)}${entry.json === '{}' ? '' : ','}"_publicCache":${JSON.stringify(meta)}}` : undefined;
    return { data: entry.data, meta, body };
  };
  return {
    initialize,
    tick,
    has: (key: string) => resources.has(key),
    async refresh(key: string) {
      await initialize();
      const resource = resources.get(key);
      if (!resource) throw new Error('Not an allowlisted public resource');
      await enqueue(resource, true);
    },
    async read(key: string) {
      await initialize();
      if (closed) throw new Error('Public cache stopped');
      const resource = resources.get(key);
      if (!resource) throw new Error('Not an allowlisted public resource');
      lastUsed.set(key, now());
      const entry = entries.get(key);
      if (entry && entry.expiresAt > now()) {
        if (now() >= entry.storedAt + resource.refreshMs) void enqueue(resource, true).catch(() => undefined);
        return result(entry, resource);
      }
      if (entry) remove(key);
      await enqueue(resource, true);
      const loaded = entries.get(key);
      if (!loaded || loaded.expiresAt <= now()) throw new Error('公共数据已过期');
      return result(loaded, resource);
    },
    start(intervalMs = 1_000) {
      if (closed || timer) return;
      void tick().catch(() => undefined);
      timer = setInterval(() => { void tick().catch(() => undefined); }, intervalMs);
      timer.unref?.();
    },
    stop() {
      closed = true;
      if (timer) clearInterval(timer);
      timer = undefined;
      for (const job of queue.splice(0)) { jobs.delete(job.resource.key); job.reject(new Error('Public cache stopped')); }
    },
    status() {
      return {
        enabled: !closed, active, queued: queue.length, entries: entries.size, bytes, maxBytes, diskErrors,
        resources: [...resources.values()].map(resource => {
          const entry = entries.get(resource.key);
          return {
            key: resource.key, warm: Boolean(resource.warm),
            state: !entry || entry.expiresAt <= now() ? 'empty' : now() < entry.storedAt + resource.refreshMs ? 'fresh' : 'stale',
            storedAt: entry ? new Date(entry.storedAt).toISOString() : null,
            expiresAt: entry ? new Date(entry.expiresAt).toISOString() : null,
            refreshing: jobs.has(resource.key), failures: failures.get(resource.key) ?? 0,
          };
        }),
      };
    },
  };
}
