import { createServer } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { getRequestListener } from '@hono/node-server';

const root = path.dirname(fileURLToPath(import.meta.url));
const webRoot = await realpath(path.join(root, 'web-dist'));
const { default: api } = await import('./api-runtime/app.js');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2' };
let port = 0;
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

const server = createServer(getRequestListener(async (request) => {
  const url = new URL(request.url);
  // Loopback binding plus Host validation prevents DNS rebinding. The browser
  // sees this on a different origin from SparkFlow, isolating all web storage.
  if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(request.headers.get('host') || '')) return json({ error: 'Invalid Host' }, 403);
  if (!['GET', 'HEAD'].includes(request.method)) return json({ error: 'Read-only service' }, 405);
  if (url.pathname === '/health') return json({ ok: true, service: 'sparkflow-dailyhot', apiVersion: '2.0.8', pid: process.pid });
  if (url.pathname.startsWith('/api/')) {
    const origin = request.headers.get('origin');
    if (request.headers.get('sec-fetch-site') === 'cross-site' || (origin && ![`http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(origin))) return json({ error: 'Cross-origin API requests are not allowed' }, 403);
    if (!/^\/api\/[a-z0-9-]+\/?$/.test(url.pathname)) return json({ error: 'Unknown API route' }, 404);
    url.pathname = url.pathname.slice(4);
    try {
      const response = await api.fetch(new Request(url, { method: request.method, signal: request.signal }));
      // Upstream parsers can return HTTP 200 with a malformed list after a
      // publisher changes its page. Do not present that as a working board.
      if (response.ok && response.headers.get('content-type')?.includes('application/json') && url.pathname !== '/all') {
        const body = await response.clone().json();
        if (!Array.isArray(body.data) || !body.data.length || body.data.some((item) => !item || typeof item.title !== 'string' || !item.title.trim() || !/^https?:\/\//i.test(item.url || ''))) {
          return json({ code: 502, message: '来源返回的榜单结构异常或没有有效条目，可能已改版', source: url.pathname.slice(1) }, 502);
        }
      }
      if (!response.ok && !response.headers.get('content-type')?.includes('application/json')) {
        const detail = (await response.text()).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
        const reason = detail.match(/Request failed with status code \d+|timeout of \d+ms exceeded|ECONNRESET|ENOTFOUND/)?.[0];
        return json({ code: response.status, message: reason || '该平台暂时无法获取，请稍后重试', source: url.pathname.slice(1) }, response.status);
      }
      const headers = new Headers(response.headers);
      for (const key of [...headers.keys()]) if (key.startsWith('access-control-')) headers.delete(key);
      headers.set('Cache-Control', 'no-store');
      return new Response(response.body, { status: response.status, headers });
    } catch (error) { return json({ code: 502, message: error instanceof Error ? error.message : 'Upstream source failed' }, 502); }
  }
  try {
    const pathname = decodeURIComponent(url.pathname);
    if (pathname.includes('\\') || pathname.split('/').some((part) => part.startsWith('.'))) return json({ error: 'Invalid path' }, 403);
    const target = await realpath(path.resolve(webRoot, '.' + (pathname === '/' ? '/index.html' : pathname)));
    if (!target.startsWith(webRoot + path.sep) || !(await stat(target)).isFile()) return json({ error: 'Not found' }, 404);
    return new Response(request.method === 'HEAD' ? null : await readFile(target), { headers: {
      'Content-Type': types[path.extname(target)] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': target.endsWith('index.html') ? 'no-cache' : 'public, max-age=3600'
    } });
  } catch { return json({ error: 'Not found' }, 404); }
}));

let closing = false;
function shutdown() {
  if (closing) return;
  closing = true;
  server.close(() => process.exit(0));
  server.closeIdleConnections();
  setTimeout(() => { server.closeAllConnections(); process.exit(0); }, 1500).unref();
}
process.on('message', (message) => { if (message?.type === 'shutdown') shutdown(); });
process.once('disconnect', shutdown);
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
server.once('error', (error) => { console.error('[dailyhot]', error.message); process.exit(1); });
server.listen(0, '127.0.0.1', () => {
  port = server.address().port;
  if (process.send) process.send({ type: 'ready', port, pid: process.pid });
  else { console.error('DailyHot must be started by SparkFlow.'); shutdown(); }
});
