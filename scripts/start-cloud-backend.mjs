import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfigFromFile } from 'vite';
import { createCloudGateway } from '../server/cloudGateway.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
process.env.SPARKFLOW_CLOUD_MODE = '1';
process.env.SPARKFLOW_IMPORT_LEGACY_DATA = '0';
process.env.SPARKFLOW_STATE_DIR ||= '/data/public-cache';
process.env.SPARKFLOW_USER_DATA_DIR ||= '/data/private';
process.env.SPARKFLOW_FOREIGN_PROXY ??= 'direct';
process.env.SPARKFLOW_DIGEST_PROXY ??= 'direct';
process.env.SPARKFLOW_VALUATION_PROXY ??= 'direct';
process.env.SPARKFLOW_STRATEGY_PROXY ??= 'direct';
process.env.NODE_ENV = 'production';

const gateway = createCloudGateway({ publicOrigin: process.env.SPARKFLOW_PUBLIC_ORIGIN, ownerToken: process.env.SPARKFLOW_OWNER_TOKEN });
const middleware = [];
const app = (req, res) => {
  let position = 0;
  const next = error => {
    if (res.writableEnded || res.destroyed) return;
    if (error) {
      console.error('[cloud-backend] request failed:', error instanceof Error ? error.name : 'Error');
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ error: 'request_failed', detail: '后台请求失败，请稍后重试' })); return;
    }
    const handler = middleware[position++];
    if (!handler) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end('{"error":"not_found"}'); return; }
    try { Promise.resolve(handler(req, res, next)).catch(next); } catch (caught) { next(caught); }
  };
  next();
};
middleware.push(gateway);
const httpServer = createServer(app);
httpServer.requestTimeout = 20 * 60_000;
httpServer.headersTimeout = 60_000;
const loaded = await loadConfigFromFile({ command: 'serve', mode: 'production' }, path.join(root, 'vite.config.ts'));
if (!loaded) throw new Error('SparkFlow API configuration could not be loaded');
const expected = new Set(['ibkr-valuation-monitor', 'ibkr-account-workbench', 'sparkflow-book-library', 'sparkflow-daily-digests', 'sparkflow-stock-strategy', 'sparkflow-allweather-api']);
const plugins = loaded.config.plugins.flat(Infinity).filter(plugin => plugin && typeof plugin === 'object' && expected.has(plugin.name));
for (const name of expected) if (!plugins.some(plugin => plugin.name === name)) throw new Error(`Required API module missing: ${name}`);
const config = { ...loaded.config, root, mode: 'production', command: 'serve', env: { MODE: 'production', PROD: true, DEV: false } };
const server = { config, httpServer, middlewares: { use: handler => middleware.push(handler) } };
const hookFunction = hook => typeof hook === 'function' ? hook : hook?.handler;
for (const plugin of plugins) await hookFunction(plugin.configResolved)?.call(plugin, config);
for (const plugin of plugins) await hookFunction(plugin.configurePreviewServer)?.call(plugin, server);

const port = Number(process.env.PORT || 8080);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT must be between 1024 and 65535');
httpServer.listen(port, process.env.SPARKFLOW_BIND_HOST || '0.0.0.0', () => console.log(`[cloud-backend] ${plugins.length} API modules listening on port ${port}`));
const stop = () => {
  httpServer.close(async () => {
    for (const plugin of plugins) await hookFunction(plugin.closeBundle)?.call(plugin);
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 15_000).unref();
};
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
