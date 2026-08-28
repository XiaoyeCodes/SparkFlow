import { request as httpRequest } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin, PreviewServer, ViteDevServer } from 'vite';
import { createDailyHotService } from './dailyhotService';

export function dailyHotPlugin(): Plugin {
  let shutdown: (() => Promise<void>) | undefined;
  function attach(server: ViteDevServer | PreviewServer) {
    const service = createDailyHotService({ root: server.config.root, log: (message) => server.config.logger.info(message) });
    shutdown = service.stop;
    server.httpServer?.once('close', () => { void service.stop(); });
    void service.start().catch((error) => server.config.logger.warn(String(error)));
    const send = (res: ServerResponse, code: number, body: unknown) => {
      res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(body));
    };
    server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      if (!url.pathname.startsWith('/api/dailyhot/')) { next(); return; }
      if (req.method !== 'GET' && !(req.method === 'POST' && url.pathname === '/api/dailyhot/restart')) { send(res, 405, { error: 'Method not allowed' }); return; }
      if (url.pathname === '/api/dailyhot/status') { send(res, 200, service.getStatus()); return; }
      try {
        if (url.pathname === '/api/dailyhot/restart') {
          if (req.method !== 'POST' || !req.headers.origin || req.headers.origin !== `http://${req.headers.host}` || !req.headers['content-type']?.startsWith('application/json')) { send(res, 403, { error: 'Same-origin JSON request required' }); return; }
          send(res, 200, await service.start());
          return;
        }
        const route = url.pathname.slice('/api/dailyhot/'.length);
        if (!/^[a-z0-9-]+\/?$/.test(route)) { send(res, 404, { error: 'Unknown DailyHot route' }); return; }
        const status = await service.start();
        const upstream = new URL(`api/${route}${url.search}`, status.frontendUrl!);
        const proxy = httpRequest(upstream, { method: 'GET', headers: { Accept: req.headers.accept || 'application/json' }, timeout: 20_000 }, (response) => {
          if (res.destroyed) { response.destroy(); return; }
          res.writeHead(response.statusCode || 502, {
            'Content-Type': response.headers['content-type'] || 'application/json',
            ...(response.headers['content-encoding'] ? { 'Content-Encoding': response.headers['content-encoding'] } : {}),
            'Cache-Control': 'no-store'
          });
          response.pipe(res);
          response.on('error', () => res.destroy());
        });
        proxy.once('timeout', () => proxy.destroy(new Error('DailyHot 请求超时')));
        proxy.once('error', (error) => { if (!res.headersSent && !res.destroyed) send(res, 502, { code: 502, message: error.message }); else res.destroy(); });
        res.once('close', () => { if (!res.writableFinished) proxy.destroy(); });
        proxy.end();
      } catch (error) { if (!res.headersSent && !res.destroyed) send(res, 503, { error: error instanceof Error ? error.message : String(error) }); }
    });
  }
  return {
    name: 'sparkflow-managed-dailyhot',
    configureServer: attach,
    configurePreviewServer: attach,
    async closeBundle() { await shutdown?.(); }
  };
}
