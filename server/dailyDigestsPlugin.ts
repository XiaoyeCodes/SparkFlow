import path from 'node:path';
import type { Plugin, ViteDevServer, PreviewServer } from 'vite';
import { createUserDataPaths } from './userData.ts';
import { createDailyDigests, pythonDigestGenerator } from './dailyDigests.ts';
import { DAILY_DIGESTS, type DailyDigestId, type DigestMarketSnapshot } from '../src/lib/dailyDigestTypes.ts';
import { digestDocumentRevision, themeDailyDigest } from './dailyDigestTheme.ts';
import { createDailyDigestMarkets, createDigestFeedTransport, type DigestFeed } from './dailyDigestMarkets.ts';

export function dailyDigestsPlugin(options: { marketFeed?: DigestFeed } = {}): Plugin {
  const install = (server: ViteDevServer | PreviewServer) => {
    const root = server.config.root;
    const cacheDir = path.join(createUserDataPaths(root).reportsDir, 'daily-digests');
    const transport = options.marketFeed ? null : createDigestFeedTransport();
    const markets = createDailyDigestMarkets({ cacheDir, feed: options.marketFeed ?? transport!.feed });
    const generateNews = pythonDigestGenerator(root, cacheDir);
    const service = createDailyDigests({ cacheDir,
      requiresUpgrade: (id, edition) => id === 'jin10' && (edition.generatorVersion ?? 0) < 2,
      generate: async (id, date, signal) => {
        if (id !== 'jin10') return generateNews(id, date, signal);
        const [news] = await Promise.all([generateNews(id, date, signal), markets.refresh()]);
        const snapshot = markets.snapshot();
        if (snapshot.available !== 9) throw new Error('财经日报行情尚未全部通过校验：' + snapshot.rows.filter(r => !r.quote).map(r => r.name).join('、'));
        return { ...news, generatorVersion: 2, data: { ...news.data as object, market: snapshot }, quality: snapshot.rows.every(r => r.state === 'current') ? 'ready' : 'degraded', warnings: snapshot.rows.filter(r => r.state !== 'current').map(r => `${r.name} 使用带原始时间的上次成功报价`) };
      },
    });
    const cachedMarkets = (): DigestMarketSnapshot | undefined => {
      const value = (service.edition('jin10')?.data as { market?: DigestMarketSnapshot } | undefined)?.market;
      return value?.schema === 1 && Array.isArray(value.rows) ? value : undefined;
    };
    const ready = markets.start().then(() => service.start()).catch(error => console.error('[daily-digests]', error));
    server.httpServer?.once('close', () => { service.stop(); markets.stop(); transport?.close(); });
    server.middlewares.use((req, res, next) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (url.pathname !== '/api/daily-digests' && !url.pathname.startsWith('/api/daily-digests/')) return next();
      void (async () => {
        await ready;
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        if (req.method !== 'GET' && req.method !== 'HEAD') { res.statusCode = 405; res.setHeader('Allow', 'GET, HEAD'); res.end(); return; }
        if (url.pathname === '/api/daily-digests/markets') {
          res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(req.method === 'HEAD' ? undefined : JSON.stringify(cachedMarkets() ?? null)); return;
        }
        if (url.pathname === '/api/daily-digests') {
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          const status = service.status();
          status.markets = cachedMarkets();
          status.items = status.items.map(item => ({ ...item, edition: item.edition ? { ...item.edition, revision: digestDocumentRevision(item.edition.revision) } : null }));
          res.end(req.method === 'HEAD' ? undefined : JSON.stringify(status)); return;
        }
        const match = /^\/api\/daily-digests\/(jin10|aibase|daily60)\/(document|article|text|data)$/.exec(url.pathname);
        if (!match || !DAILY_DIGESTS.some(s => s.id === match[1])) { res.statusCode = 404; res.end(); return; }
        const edition = service.edition(match[1] as DailyDigestId);
        if (!edition) { res.statusCode = 404; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ error: '本期尚未生成，请查看日报状态' })); return; }
        const revision = ['document','article'].includes(match[2]) ? digestDocumentRevision(edition.revision) : edition.revision;
        res.setHeader('ETag', `"${revision}"`);
        if (req.headers['if-none-match'] === `"${revision}"`) { res.statusCode = 304; res.end(); return; }
        if (match[2] === 'article') {
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(req.method === 'HEAD' ? undefined : JSON.stringify({ id: edition.id, revision, sourceDate: edition.sourceDate, generatedAt: edition.generatedAt, sourceUrl: edition.sourceUrl, data: edition.data }));
        } else if (match[2] === 'document') {
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'");
          res.end(req.method === 'HEAD' ? undefined : themeDailyDigest(edition.html));
        } else {
          res.setHeader('Content-Type', match[2] === 'text' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8');
          res.setHeader('Content-Disposition', `attachment; filename="${edition.id}-${edition.editionDate}.${match[2] === 'text' ? 'txt' : 'json'}"`);
          const data = edition.data as { news?: { title?: string; introduction?: string; body_text?: string; disclaimer?: string } };
          const captured = cachedMarkets();
          const text = edition.id === 'jin10' && data.news?.body_text && captured ? [data.news.title, data.news.introduction, '本期市场参考报价 · 采集于 ' + (captured.checkedAt ?? '尚未完成'),
            ...captured.rows.map(row => `${row.name} | ${row.quote ? row.quote.price + ' ' + row.unit + ' | ' + (row.quote.changeBp !== undefined ? row.quote.changeBp.toFixed(2) + 'bp' : row.quote.changePercent.toFixed(2) + '%') + ' | ' + row.quote.source + ' | ' + row.quote.instrument + ' | 报价 ' + (row.quote.quotedAt ?? row.quote.observationDate ?? '统计快照') + (row.state === 'cached' ? ' · 上次成功缓存' : '') : '暂无可核验报价'}`),
            data.news.body_text, data.news.disclaimer, edition.sourceUrl].join('\n\n') : edition.text;
          res.end(req.method === 'HEAD' ? undefined : match[2] === 'text' ? text : JSON.stringify(edition.data, null, 2));
        }
      })().catch(error => { console.error('[daily-digests]', error); if (!res.headersSent) { res.statusCode = 500; res.setHeader('Content-Type', 'application/json'); } res.end(JSON.stringify({ error: '日报缓存读取失败' })); });
    });
  };
  return { name: 'sparkflow-daily-digests', configureServer: install, configurePreviewServer: install };
}
