// Page-local data may include configured subscriptions or AI output. Keep it in
// tab memory, separate from the visitor-independent public dashboard cache.
type Entry = { body: string; until: number; expiresAt: number };
const entries = new Map<string, Entry>();
const pending = new Map<string, { promise: Promise<Response>; controller: AbortController }>();
const MAX_BYTES = 16 * 1024 * 1024;

function resource(input: string) {
  const origin = typeof location === 'undefined' ? 'http://page.local' : location.origin;
  const url = new URL(input, origin);
  if (url.origin !== origin || url.username || url.password) return;
  if (url.pathname === '/api/news-feed' && [...url.searchParams].every(([k, v]) => k === 'refresh' && v === '1')) {
    return { key: '/api/news-feed', reuseMs: 15_000, maxAgeMs: 30 * 60_000 };
  }
  if (url.pathname === '/api/daily-brief' && [...url.searchParams].every(([k, v]) => k === 'retry-content' && v === '1')) {
    return { key: '/api/daily-brief', reuseMs: 15_000, maxAgeMs: 24 * 3600_000 };
  }
  if (url.pathname === '/api/daily-brief/details' && url.searchParams.size === 1 && ['flows', 'performance'].includes(url.searchParams.get('view') || '')) {
    return { key: url.pathname + url.search, reuseMs: 15_000, maxAgeMs: 6 * 3600_000 };
  }
}

function deadline(key: string, data: any, now: number, maxAgeMs: number) {
  if (!data || typeof data !== 'object' || data.error) return 0;
  let expiry = now + maxAgeMs;
  if (key === '/api/daily-brief') {
    if (!data.snapshot?.summary || !Array.isArray(data.snapshot.markets) || data.cache?.stale) return 0;
    // An edition is valid until 09:00 Beijing time on the following day.
    expiry = Date.parse(`${data.snapshot.date}T09:00:00+08:00`) + 24 * 3600_000;
  } else {
    if (key === '/api/news-feed' && (!Array.isArray(data.items) || !Array.isArray(data.sources))) return 0;
    if (key.includes('/details?')) {
      if (!key.endsWith(`view=${data.kind}`) || !Array.isArray(data.sources) || !Array.isArray(data.errors)) return 0;
      if (data.kind === 'flows' && (!data.metrics || !Array.isArray(data.price) || !Array.isArray(data.activity) || !Array.isArray(data.etfFlows))) return 0;
      if (data.kind === 'performance' && !Array.isArray(data.series)) return 0;
    }
    expiry = Math.min(expiry, Date.parse(data.generatedAt) + maxAgeMs);
    if (key === '/api/news-feed') {
      // Revalidate at midnight so yesterday-only sources cannot reappear.
      expiry = Math.min(expiry, Math.floor((now + 8 * 3600_000) / 86400_000) * 86400_000 + 16 * 3600_000);
    }
  }
  if (data._pageCache?.expiresAt) expiry = Math.min(expiry, Date.parse(data._pageCache.expiresAt));
  return Number.isFinite(expiry) ? expiry : 0;
}

export function rememberPageData(input: string, data: unknown) {
  const policy = resource(input);
  if (!policy) return;
  const now = Date.now();
  const expiresAt = deadline(policy.key, data, now, policy.maxAgeMs);
  entries.delete(policy.key);
  if (expiresAt <= now) return;
  const body = JSON.stringify(data);
  if (body.length * 2 > MAX_BYTES / 2) return;
  while ([...entries.values()].reduce((sum, entry) => sum + entry.body.length * 2, body.length * 2) > MAX_BYTES) {
    entries.delete(entries.keys().next().value!);
  }
  entries.set(policy.key, { body, expiresAt, until: Math.min(expiresAt, now + policy.reuseMs) });
}

export function peekPageData<T>(input: string): T | undefined {
  const key = resource(input)?.key;
  const entry = key && entries.get(key);
  if (!entry) return;
  if (entry.expiresAt <= Date.now()) { entries.delete(key); return; }
  return JSON.parse(entry.body) as T;
}

export function invalidatePageData(input: string) {
  const key = resource(input)?.key;
  if (!key) return;
  entries.delete(key);
  pending.get(key)?.controller.abort();
  pending.delete(key);
}

function waitFor(promise: Promise<Response>, signal?: AbortSignal | null): Promise<Response> {
  if (!signal) return promise.then(response => response.clone());
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(signal.reason); };
    signal.addEventListener('abort', abort, { once: true });
    promise.then(response => { signal.removeEventListener('abort', abort); if (!signal.aborted) resolve(response.clone()); }, error => {
      signal.removeEventListener('abort', abort); reject(error);
    });
  });
}

export function pageDataFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const policy = resource(input);
  if (!policy || (init.method || 'GET').toUpperCase() !== 'GET' || init.body != null
    || [...new Headers(init.headers).keys()].some(key => key !== 'accept')
    || (init.credentials && init.credentials !== 'same-origin')) return fetch(input, init);
  if (init.signal?.aborted) return Promise.reject(init.signal.reason);
  const forced = init.cache === 'reload' || input.includes('refresh=1');
  if (forced) invalidatePageData(input);
  const cached = entries.get(policy.key);
  if (cached && cached.until > Date.now()) return Promise.resolve(new Response(cached.body, { headers: { 'Content-Type': 'application/json' } }));
  let active = pending.get(policy.key);
  if (!active) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120_000);
    const promise = (async () => {
      try {
        const response = await fetch(input, { ...init, cache: 'no-store', signal: controller.signal });
        const data = await response.clone().json().catch(() => null);
        if (!controller.signal.aborted && response.ok) rememberPageData(input, data);
        return response;
      } finally {
        clearTimeout(timer);
        if (pending.get(policy.key)?.controller === controller) pending.delete(policy.key);
      }
    })();
    active = { controller, promise };
    pending.set(policy.key, active);
  }
  return waitFor(active.promise, init.signal);
}
