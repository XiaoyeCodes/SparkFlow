import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createBookLibrary, BOOK_LIBRARY_REVISION, validBookPdf } from '../server/bookLibrary.ts';
import { financialFreedomBooks } from '../src/data/financialFreedomBooks.ts';

const directory = await mkdtemp(path.join(tmpdir(), 'sparkflow-book-library-'));
const library = createBookLibrary({ directory });
const file = financialFreedomBooks[0].documents[0];
const document = Buffer.alloc(file.sizeBytes, 32);
document.write('%PDF-1.7\n'); document.write('\n%%EOF\n', document.length - 7);
const target = path.join(directory, BOOK_LIBRARY_REVISION, file.fileName);
const server = createServer((req, res) => { void library.handle(req, res, () => { res.writeHead(404); res.end(); }); });
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const url = `http://127.0.0.1:${server.address().port}${file.readerUrl}`;
try {
  assert.equal(validBookPdf(document, file.sizeBytes), true);
  assert.equal(validBookPdf(document.subarray(0, -1), file.sizeBytes), false);
  let response = await fetch(url);
  assert.equal(response.status, 404, 'missing local files fail clearly without fetching a remote copy');
  await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, document);
  assert.equal(await library.getFile(file.fileName), target);
  response = await fetch(url);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/pdf');
  assert.equal(response.headers.get('accept-ranges'), 'bytes');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), document);
  response = await fetch(url, { method: 'HEAD' });
  assert.equal(response.headers.get('content-length'), String(file.sizeBytes));
  assert.equal((await response.arrayBuffer()).byteLength, 0);
  for (const [range, start, end] of [['bytes=0-31', 0, 31], ['bytes=-16', file.sizeBytes - 16, file.sizeBytes - 1], [`bytes=${file.sizeBytes - 10}-`, file.sizeBytes - 10, file.sizeBytes - 1]]) {
    response = await fetch(url, { headers: { Range: range } });
    assert.equal(response.status, 206);
    assert.equal(response.headers.get('content-range'), `bytes ${start}-${end}/${file.sizeBytes}`);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), document.subarray(start, end + 1));
  }
  for (const range of ['bytes=999999999-', 'bytes=12-1', 'bytes=-0', 'bytes=-', 'bytes=0-1,4-5']) {
    response = await fetch(url, { headers: { Range: range } }); assert.equal(response.status, 416);
  }
  response = await fetch(url, { method: 'POST' }); assert.equal(response.status, 405);
  response = await fetch(url.replace(/file=.*/, 'file=..%2F..%2Fsettings%2Fintegration-settings.json'));
  assert.equal(response.status, 404, 'only the 17 catalog filenames may be read');
  await writeFile(target, document.subarray(0, 100));
  response = await fetch(url); assert.equal(response.status, 404, 'truncated files are never served');
  await writeFile(target, Buffer.alloc(file.sizeBytes));
  response = await fetch(url); assert.equal(response.status, 404, 'non-PDF bytes are never served');
  await writeFile(target, document);
  assert.equal(await createBookLibrary({ directory }).getFile(file.fileName), target, 'local books survive service restart');
  const origin = new URL(url).origin;
  for (const asset of ['cmaps/UniGB-UCS2-H.bcmap', 'standard_fonts/FoxitSerif.pfb']) {
    response = await fetch(`${origin}/api/books/pdf-assets/${asset}`);
    assert.equal(response.status, 200, 'Chinese character maps and standard fonts are served locally');
    assert.ok((await response.arrayBuffer()).byteLength > 100);
  }
  for (const asset of ['cmaps/../../package.json', 'standard_fonts/.env', 'cmaps/FoxitSerif.pfb']) {
    response = await fetch(`${origin}/api/books/pdf-assets/${asset}`); assert.equal(response.status, 404);
  }
  console.log('Book library: local-only files, restart persistence, full/HEAD/range reads, corruption checks and catalog allowlist passed.');
} finally {
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  const resolved = path.resolve(directory);
  assert.ok(resolved.startsWith(path.resolve(tmpdir()) + path.sep) && path.basename(resolved).startsWith('sparkflow-book-library-'));
  await rm(resolved, { recursive: true, force: true });
}
