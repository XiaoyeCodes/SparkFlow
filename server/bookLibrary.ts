import { createReadStream } from 'node:fs';
import { open, stat } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin, PreviewServer, ViteDevServer } from 'vite';
import { financialFreedomBooks } from '../src/data/financialFreedomBooks.ts';
import { createUserDataPaths } from './userData.ts';

const documents = financialFreedomBooks.flatMap(book => book.documents!);
const allowed = new Map(documents.map(file => [file.fileName, file]));
export const BOOK_LIBRARY_REVISION = new URL(documents[0].url).pathname.split('/')[3];
const endpoint = '/api/books/financial-freedom';
const pdfAssetsRoot = path.dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));

export function validBookPdf(bytes: Uint8Array, size: number) {
  return bytes.byteLength === size && Buffer.from(bytes.subarray(0, 1024)).includes('%PDF-')
    && Buffer.from(bytes.subarray(-2048)).includes('%%EOF');
}

export function createBookLibrary(options: { directory: string }) {
  const cachedFile = async (target: string, expectedSize: number) => {
    try {
      if ((await stat(target)).size !== expectedSize) return false;
      const handle = await open(target, 'r');
      try {
        const head = Buffer.alloc(Math.min(1024, expectedSize));
        const tail = Buffer.alloc(Math.min(2048, expectedSize));
        await handle.read(head, 0, head.length, 0);
        await handle.read(tail, 0, tail.length, expectedSize - tail.length);
        return head.includes('%PDF-') && tail.includes('%%EOF');
      } finally { await handle.close(); }
    } catch { return false; }
  };

  const getFile = async (fileName: string): Promise<string> => {
    const file = allowed.get(fileName);
    if (!file) throw new Error('Unknown book file');
    const target = path.join(options.directory, BOOK_LIBRARY_REVISION, file.fileName);
    if (!await cachedFile(target, file.sizeBytes)) throw new Error('Local PDF unavailable');
    return target;
  };

  const handle = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = new URL(req.url || '/', 'http://books.local');
    if (url.pathname.startsWith('/api/books/pdf-assets/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
      const asset = /^\/api\/books\/pdf-assets\/(cmaps|standard_fonts)\/([A-Za-z0-9_-]+\.(bcmap|pfb|ttf))$/.exec(url.pathname);
      if (!asset || (asset[1] === 'cmaps') !== (asset[3] === 'bcmap')) { res.writeHead(404); res.end(); return; }
      try {
        const target = path.join(pdfAssetsRoot, asset[1], asset[2]);
        const size = (await stat(target)).size;
        res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': size, 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' });
        if (req.method === 'HEAD') { res.end(); return; }
        const stream = createReadStream(target);
        stream.on('error', () => res.destroy()); res.once('close', () => stream.destroy()); stream.pipe(res);
      } catch { res.writeHead(404); res.end(); }
      return;
    }
    if (url.pathname !== endpoint) { next(); return; }
    const jsonError = (status: number, message: string) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ error: message }));
    };
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.setHeader('Allow', 'GET, HEAD'); jsonError(405, 'Method not allowed'); return; }
    const file = allowed.get(url.searchParams.get('file') || '');
    if (!file) { jsonError(404, '书籍文件不存在'); return; }
    try {
      const target = await getFile(file.fileName);
      if (res.destroyed) return;
      let start = 0, end = file.sizeBytes - 1;
      const range = req.headers.range;
      if (range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(range);
        if (match && (match[1] || match[2])) {
          start = match[1] ? Number(match[1]) : Math.max(0, file.sizeBytes - Number(match[2]));
          end = match[1] && match[2] ? Math.min(Number(match[2]), end) : end;
        }
        if (!match || !(match[1] || match[2]) || start > end || start >= file.sizeBytes || (match[1] === '' && Number(match[2]) === 0)) {
          res.writeHead(416, { 'Content-Range': `bytes */${file.sizeBytes}` }); res.end(); return;
        }
      }
      res.writeHead(range ? 206 : 200, {
        'Content-Type': 'application/pdf', 'Content-Length': end - start + 1,
        'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
        'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff',
        ...(range ? { 'Content-Range': `bytes ${start}-${end}/${file.sizeBytes}` } : {}),
      });
      if (req.method === 'HEAD') { res.end(); return; }
      const stream = createReadStream(target, { start, end });
      stream.on('error', () => res.destroy());
      res.once('close', () => stream.destroy());
      stream.pipe(res);
    } catch { if (!res.destroyed) jsonError(404, '本地书籍文件不存在或不完整，请重新下载书籍。'); }
  };
  return { getFile, handle };
}

export function bookLibraryPlugin(): Plugin {
  const attach = (server: ViteDevServer | PreviewServer) => {
    const library = createBookLibrary({
      directory: path.join(createUserDataPaths(server.config.root).booksDir, 'financial-freedom'),
    });
    server.middlewares.use((req, res, next) => { void library.handle(req, res, next); });
  };
  return { name: 'sparkflow-book-library', configureServer: attach, configurePreviewServer: attach };
}
