import { request, type IncomingHttpHeaders } from 'node:http';
import type { Duplex } from 'node:stream';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Plugin } from 'vite';
import { allowedIbkrAccountContextRequest } from './ibkrAccountContext.ts';
import { allowedIbkrAccountReportRequest } from './ibkrAccountReports.ts';

export function allowedLocalRequest(headers: IncomingHttpHeaders, port: number) {
  const host = `127.0.0.1:${port}`;
  return headers.host === host && (!headers.origin || headers.origin === `http://${host}`) && headers['sec-fetch-site'] !== 'cross-site';
}

export function allowedTerminalHttpRequest(method: string | undefined, pathname: string) {
  if (pathname.startsWith('/api/ibkr-terminal/paper/')) {
    const action = pathname.slice('/api/ibkr-terminal/paper/'.length);
    return method === 'GET' ? ['status', 'contract', 'reconcile'].includes(action)
      : method === 'POST' && ['configure', 'preview', 'confirm', 'cancel', 'stop'].includes(action);
  }
  if (method === 'GET') return ['/api/ibkr-terminal/session', '/api/ibkr-terminal/snapshot',
    '/api/ibkr-terminal/market/contracts', '/api/ibkr-terminal/market/quote',
    '/api/ibkr-terminal/strategies', '/api/ibkr-terminal/backtests', '/api/ibkr-terminal/backtests/jobs'].includes(pathname)
    || /^\/api\/ibkr-terminal\/backtests\/[0-9a-f]{64}$/.test(pathname)
    || /^\/api\/ibkr-terminal\/backtests\/jobs\/backtest(?:%3A|:)[0-9a-f]{32}$/i.test(pathname)
    || allowedIbkrAccountContextRequest(method, pathname)
    || allowedIbkrAccountReportRequest(method, pathname);
  if (method !== 'POST') return false;
  return pathname === '/api/ibkr-terminal/orders/preview'
    || /^\/api\/ibkr-terminal\/orders\/previews\/[^/]+\/confirm$/.test(pathname)
    || /^\/api\/ibkr-terminal\/backtests\/jobs\/backtest(?:%3A|:)[0-9a-f]{32}\/cancel$/i.test(pathname)
    || allowedIbkrAccountContextRequest(method, pathname)
    || allowedIbkrAccountReportRequest(method, pathname);
}

async function requestBody(req: import('node:http').IncomingMessage, limit = 16 * 1024) {
  const contentType = req.headers['content-type'] || '';
  if (!contentType.toLowerCase().startsWith('application/json')) throw new Error('CONTENT_TYPE');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > limit) throw new Error('BODY_TOO_LARGE');
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

export function ibkrTerminalProxy(options: { servicePort?: number; tokenPath?: string } = {}): Plugin {
  let dispose = () => {};
  const servicePort = options.servicePort ?? 8765;
  return {
    name: 'ibkr-terminal-readonly-proxy',
    config: () => ({ server: { fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/.sparkflow/**'] } } }),
    closeBundle: () => dispose(),
    configureServer(server) {
      const tokenPath = options.tokenPath ?? path.join(server.config.root, '.sparkflow/ibkr-terminal/session.token');
      const localPort = () => { const address = server.httpServer?.address(); return address && typeof address !== 'string' ? address.port : 0; };
      const sockets = new Set<Duplex>();
      let closed = false;
      const track = (socket: Duplex) => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); };
      const upgrade = async (req: import('node:http').IncomingMessage, socket: Duplex, head: Buffer) => {
        if (!req.url?.startsWith('/api/ibkr-terminal/')) return;
        const deny = (status: number) => { socket.end(`HTTP/1.1 ${status} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); };
        const incoming = new URL(req.url, `http://127.0.0.1:${localPort()}`);
        if (incoming.pathname !== '/api/ibkr-terminal/events' || !req.headers.origin || !allowedLocalRequest(req.headers, localPort()) || req.method !== 'GET') { deny(403); return; }
        track(socket);
        socket.on('error', () => socket.destroy());
        try {
          const token = (await readFile(tokenPath, 'utf8')).trim();
          if (closed || socket.destroyed) { socket.destroy(); return; }
          const upstream = request({ host: '127.0.0.1', port: servicePort, path: incoming.pathname + incoming.search, method: 'GET', headers: {
            Authorization: `Bearer ${token}`, Connection: 'Upgrade', Upgrade: 'websocket',
            'Sec-WebSocket-Key': req.headers['sec-websocket-key'] || '', 'Sec-WebSocket-Version': '13',
          } });
          socket.once('close', () => upstream.destroy());
          upstream.setTimeout(5000, () => upstream.destroy(new Error('websocket handshake timeout')));
          upstream.on('error', () => socket.destroy());
          upstream.on('response', response => { response.resume(); deny(response.statusCode ?? 502); });
          upstream.on('upgrade', (response, remote, remoteHead) => {
            if (closed || socket.destroyed) { remote.destroy(); return; }
            track(remote);
            remote.setTimeout(0);
            remote.on('error', () => socket.destroy());
            remote.once('close', () => socket.destroy());
            socket.once('close', () => remote.destroy());
            socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${response.headers['sec-websocket-accept']}\r\n\r\n`);
            if (remoteHead.length) socket.write(remoteHead);
            if (head.length) remote.write(head);
            socket.pipe(remote).pipe(socket);
          });
          upstream.end();
        } catch { deny(503); }
      };
      server.httpServer?.on('upgrade', upgrade);
      dispose = () => { closed = true; server.httpServer?.off('upgrade', upgrade); for (const socket of sockets) socket.destroy(); sockets.clear(); };
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/ibkr-terminal/')) return next();
        const address = server.httpServer?.address();
        const port = address && typeof address !== 'string' ? address.port : 0;
        res.setHeader('Cache-Control', 'no-store');
        const incoming = new URL(req.url, `http://127.0.0.1:${port}`);
        if (!allowedLocalRequest(req.headers, port) || !allowedTerminalHttpRequest(req.method, incoming.pathname)) {
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.statusCode = 403; res.end(JSON.stringify({ detail: '本地只读接口拒绝此请求。' })); return;
        }
        try {
          const token = (await readFile(tokenPath, 'utf8')).trim();
          const body = req.method === 'POST' ? await requestBody(req) : undefined;
          const upstream = await fetch(`http://127.0.0.1:${servicePort}${incoming.pathname}${incoming.search}`, {
            method: req.method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
            body, signal: AbortSignal.timeout(['/api/ibkr-terminal/paper/preview','/api/ibkr-terminal/paper/reconcile'].includes(incoming.pathname) ? 30000
              : incoming.pathname === '/api/ibkr-terminal/market-data' ? 12000 : 5000), redirect: 'error',
          });
          res.statusCode = upstream.status;
          res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/octet-stream');
          const disposition = upstream.headers.get('content-disposition');
          if (disposition) res.setHeader('Content-Disposition', disposition);
          res.end(Buffer.from(await upstream.arrayBuffer()));
        } catch (error) {
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.statusCode = error instanceof Error && error.message === 'BODY_TOO_LARGE' ? 413
            : error instanceof Error && error.message === 'CONTENT_TYPE' ? 415 : 503;
          res.end(JSON.stringify({ detail: res.statusCode === 413 ? '请求体过大。' : res.statusCode === 415 ? '只接受 JSON。' : '本地账户服务未连接。' }));
        }
      });
    },
  };
}
