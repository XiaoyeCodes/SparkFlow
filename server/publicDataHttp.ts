import type { IncomingMessage, ServerResponse } from 'node:http';
import { createPublicDataCache } from './publicDataCache.ts';
import { resolvePublicDataPolicy } from '../src/lib/publicDataPolicy.ts';

export function createPublicDataHandler(cache: ReturnType<typeof createPublicDataCache>, coldTimeoutMs = 25_000) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    if (req.method !== 'GET' || req.headers.authorization) return false;
    const url = new URL(req.url || '/', 'http://public.local');
    if (url.pathname === '/api/public-data-cache/status' && !url.search) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify(cache.status()));
      return true;
    }
    const policy = resolvePublicDataPolicy(url);
    if (!policy || !cache.has(policy.key)) return false;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    // Shared on this host, NOT blindly shared at the CDN or in browser HTTP caches.
    res.setHeader('Cache-Control', 'no-store');
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const snapshot = await Promise.race([
        cache.read(policy.key),
        new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('preparing')), coldTimeoutMs); }),
      ]);
      if (res.destroyed) return true;
      res.setHeader('X-SparkFlow-Cache', snapshot.meta.state);
      res.setHeader('X-SparkFlow-Cache-Stored-At', snapshot.meta.storedAt);
      res.setHeader('X-SparkFlow-Cache-Refresh-At', snapshot.meta.refreshAt);
      res.setHeader('X-SparkFlow-Cache-Expires-At', snapshot.meta.expiresAt);
      res.end(snapshot.body ?? JSON.stringify({ ...snapshot.data as object, _publicCache: snapshot.meta }));
    } catch {
      if (res.destroyed) return true;
      res.statusCode = 503;
      res.setHeader('Retry-After', '5');
      res.setHeader('X-SparkFlow-Cache', 'unavailable');
      res.end(JSON.stringify({ error: 'public_data_preparing', detail: '公共数据正在准备或已过期，后台将自动重试', _publicCache: { state: 'unavailable' } }));
    } finally { if (timeout) clearTimeout(timeout); }
    return true;
  };
}
