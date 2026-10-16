import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { ProxyAgent, fetch } from 'undici';
import { financialFreedomBooks } from '../src/data/financialFreedomBooks.ts';
import { createUserDataPaths } from '../server/userData.ts';
import { BOOK_LIBRARY_REVISION, validBookPdf } from '../server/bookLibrary.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const directory = path.join(createUserDataPaths(root).booksDir, 'financial-freedom', BOOK_LIBRARY_REVISION);
const files = financialFreedomBooks.flatMap(book => book.documents);
const proxy = new ProxyAgent(process.env.SPARKFLOW_BOOKS_PROXY || 'http://127.0.0.1:7890');
await mkdir(directory, { recursive: true });
let completed = 0;
let failures = 0;

async function download(file) {
  const target = path.join(directory, file.fileName);
  const cached = await readFile(target).catch(() => null);
  if (cached && validBookPdf(cached, file.sizeBytes)) {
    console.log(`[${++completed}/${files.length}] Already downloaded: ${file.fileName}`); return;
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    const temporary = `${target}.${randomUUID()}.part`;
    try {
      const response = await fetch(file.url, { dispatcher: attempt < 2 ? proxy : undefined, signal: AbortSignal.timeout(120_000), redirect: 'error' });
      if (!response.ok) { await response.body?.cancel(); throw new Error(`HTTP ${response.status}`); }
      const chunks = [];
      let size = 0;
      for await (const chunk of response.body) {
        size += chunk.byteLength;
        if (size > file.sizeBytes) throw new Error('Unexpected file size');
        chunks.push(chunk);
      }
      const bytes = Buffer.concat(chunks);
      if (!validBookPdf(bytes, file.sizeBytes)) throw new Error('Incomplete PDF');
      await writeFile(temporary, bytes, { mode: 0o600 });
      await rename(temporary, target);
      console.log(`[${++completed}/${files.length}] Downloaded: ${file.fileName} (${(size / 1048576).toFixed(1)} MB)`);
      return;
    } catch (error) {
      console.warn(`Attempt ${attempt + 1} failed for ${file.fileName}: ${error.message}`);
    } finally { await unlink(temporary).catch(() => undefined); }
  }
  failures++;
}

try {
  let cursor = 0;
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (cursor < files.length) await download(files[cursor++]);
  }));
  console.log(`Local book library: ${directory}`);
  if (failures) { console.error(`${failures} files could not be downloaded.`); process.exitCode = 1; }
  else console.log(`All ${files.length} PDFs verified. Reading uses local files only.`);
} finally { await proxy.close(); }
