import { resolvePublicDataPolicy, isUsablePublicPayload } from './publicDataPolicy.ts';

type CacheMeta = { state: string; storedAt?: string; refreshAt?: string; expiresAt?: string };
type ClientEntry = { body: string; headers: [string, string][]; until: number; expiresAt: number; bytes: number };
type Notice = { key: string; state: string; storedAt?: string; expiresAt?: string; observedAt: number };
const entries = new Map<string, ClientEntry>();
const pending = new Map<string, Promise<Response>>();
const notices = new Map<string, Notice>();
const listeners = new Set<() => void>();
let noticeVersion = 0;
let bytes = 0;
const MAX_BYTES = 16 * 1024 * 1024;
const MAX_ENTRIES = 100;

function notify(key: string, meta: CacheMeta) {
  notices.set(key, { key, ...meta, observedAt: Date.now() });
  noticeVersion++;
  listeners.forEach(listener => listener());
}
export const subscribePublicData = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const publicDataVersion = () => noticeVersion;
export function getPublicDataNotices(scope: 'china' | 'global' | 'market') {
  return [...notices.values()].filter(item => {
    if (Date.now() - item.observedAt > 10 * 60_000) return false;
    if (scope === 'china') return /^\/api\/china-(macro|fisher|gdp|income)/.test(item.key);
    if (scope === 'global') return /global-|us-macro|fed-net|financial-conditions/.test(item.key);
    return !/china-(macro|fisher|gdp|income)|global-macro|us-macro|fed-net|financial-conditions/.test(item.key);
  }).filter(item => item.state === 'stale' || item.state === 'unavailable' || (item.expiresAt && Date.parse(item.expiresAt) <= Date.now()));
}
function remove(key: string) {
  const entry = entries.get(key);
  if (entry) bytes -= entry.bytes;
  entries.delete(key);
}
function lookup(key: string, allowStale = false) {
  const entry = entries.get(key);
  if (!entry) return;
  if (entry.expiresAt <= Date.now()) { remove(key); return; }
  if (!allowStale && entry.until <= Date.now()) return;
  entries.delete(key); entries.set(key, entry);
  return entry;
}
export function peekPublicData<T>(url: string): T | undefined {
  const policy = resolvePublicDataPolicy(url);
  const entry = policy && lookup(policy.key, true);
  // Components must never mutate the shared cached object.
  return entry ? JSON.parse(entry.body) as T : undefined;
}
function independentWait(promise: Promise<Response>, signal?: AbortSignal | null): Promise<Response> {
  if (!signal) return promise.then(response => response.clone());
  if (signal.aborted) return Promise.reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
  return new Promise((resolve, reject) => {
    const abort = () => { cleanup(); reject(signal.reason ?? new DOMException('Aborted', 'AbortError')); };
    const cleanup = () => signal.removeEventListener('abort', abort);
    signal.addEventListener('abort', abort, { once: true });
    promise.then(response => { cleanup(); if (!signal.aborted) resolve(response.clone()); }, error => { cleanup(); reject(error); });
  });
}

// Explicit helper, never a global fetch patch. POST, private APIs, custom headers
// and external URLs always go directly to fetch, outside this cache.
export function publicDataFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const origin = typeof location === 'undefined' ? 'http://public.local' : location.origin;
  const url = new URL(input, origin);
  const headers = new Headers(init.headers);
  const policy = resolvePublicDataPolicy(url);
  if (!policy || url.origin !== origin || (init.method ?? 'GET').toUpperCase() !== 'GET'
    || init.body != null || [...headers.keys()].some(key => key !== 'accept')
    || (init.credentials && init.credentials !== 'same-origin')) return fetch(input, init);
  if (init.signal?.aborted) return Promise.reject(init.signal.reason ?? new DOMException('Aborted', 'AbortError'));
  const bypass = init.cache === 'reload' || url.searchParams.get('fresh') === '1' || url.searchParams.get('refresh') === '1';
  const cached = !bypass && lookup(policy.key);
  if (cached) return independentWait(Promise.resolve(new Response(cached.body, { headers: cached.headers })), init.signal);
  const previous = lookup(policy.key, true);
  if (previous && previous.until <= Date.now()) {
    const meta = JSON.parse(previous.body)._publicCache as CacheMeta | undefined;
    if (meta) notify(policy.key, { ...meta, state: 'stale' });
  }
  let request = pending.get(policy.key);
  if (!request) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);
    request = (async () => {
      try {
        const response = await fetch(policy.key, { ...init, signal: controller.signal, cache: 'no-store' });
        const data = await response.clone().json().catch(() => null);
        const meta: CacheMeta | undefined = data?._publicCache;
        if (meta) notify(policy.key, meta);
        else if (!response.ok) notify(policy.key, { state: 'unavailable' });
        else if (notices.has(policy.key)) { notices.delete(policy.key); noticeVersion++; listeners.forEach(listener => listener()); }
        if (response.ok && isUsablePublicPayload(data)) {
          const sourceExpiry = typeof data.validUntil === 'string' ? Date.parse(data.validUntil) : Infinity;
          const hardExpiry = meta?.expiresAt ? Date.parse(meta.expiresAt) : Infinity;
          const refreshAt = meta?.refreshAt ? Date.parse(meta.refreshAt) : Infinity;
          const until = Math.min(Date.now() + policy.clientMs, hardExpiry, sourceExpiry,
            meta?.state === 'stale' ? Date.now() + 1000 : refreshAt);
          const body = JSON.stringify(data);
          const size = body.length * 2;
          // Real-time quotes keep a bounded first-paint snapshot, but every poll
          // checks the shared server cache instead of adding another 3s TTL.
          if ((until > Date.now() || policy.realtime) && size <= 2 * 1024 * 1024 && hardExpiry > Date.now()) {
            remove(policy.key);
            while (entries.size && (entries.size >= MAX_ENTRIES || bytes + size > MAX_BYTES)) remove(entries.keys().next().value!);
            entries.set(policy.key, { body, headers: [...response.headers.entries()], until,
              expiresAt: Math.min(hardExpiry, sourceExpiry, Date.now() + policy.maxAgeMs), bytes: size });
            bytes += size;
          }
        }
        return response;
      } catch (error) {
        notify(policy.key, { state: 'unavailable' });
        throw error;
      } finally { clearTimeout(timer); pending.delete(policy.key); }
    })();
    pending.set(policy.key, request);
  }
  return independentWait(request, init.signal);
}

export function clearPublicDataMemory() {
  entries.clear(); bytes = 0; notices.clear(); noticeVersion++; listeners.forEach(listener => listener());
}
