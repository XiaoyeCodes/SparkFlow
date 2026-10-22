import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { dailyDigestsPlugin } from '../../server/dailyDigestsPlugin.ts';
import { digestSchedule } from '../../server/dailyDigests.ts';
import { DAILY_DIGESTS } from '../../src/lib/dailyDigestTypes.ts';

test('real cache HTTP routes return local HTML/CSP/ETag and downloads; unknown IDs and POST are rejected', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sparkflow-digest-http-'));
  const previousRoot = process.env.SPARKFLOW_USER_DATA_DIR;
  process.env.SPARKFLOW_USER_DATA_DIR = path.join(root, 'UserData');
  let handler;
  const server = createServer((req, res) => handler(req, res, () => { res.statusCode = 404; res.end(); }));
  try {
    for (const spec of DAILY_DIGESTS) {
      const date = digestSchedule(Date.now(), spec.hour).dueDate;
      const content = { id: spec.id, editionDate: date, sourceDate: date, sourceUrl: 'https://example.com/source', generatedAt: new Date().toISOString(), html: `<!doctype html><html><head></head><body style="background:#eef4ee;color:#282622">缓存原文 #fcfaf6<span style='color:#48443e;background:#FCFAF6'>行情文字</span></body></html>`, text: '缓存原文', data: { verified: true }, generatorVersion: 2, itemCount: 1, quality: 'ready', warnings: [] };
      const edition = { ...content, schema: 1, revision: createHash('sha256').update(JSON.stringify(content)).digest('hex') };
      const dir = path.join(root, `UserData/reports/daily-digests/${spec.id}`);
      await mkdir(dir, { recursive: true }); await writeFile(path.join(dir, 'latest.json'), JSON.stringify(edition));
    }
    let feedCalls = 0;
    const plugin = dailyDigestsPlugin({ marketFeed: async () => { feedCalls++; throw new Error('cache reads cannot fetch markets'); } });
    plugin.configureServer({ config: { root }, httpServer: server, middlewares: { use: value => { handler = value; } } });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api/daily-digests`;
    const status = await fetch(base); assert.equal(status.status, 200);
    const index = await status.json(); assert.equal(index.items.every(i => i.state === 'ready'), true);
    assert.equal(index.items.length,3);
    assert.equal(JSON.stringify(index).includes('<html>'), false);
    const doc = await fetch(base + '/jin10/document');
    assert.match(doc.headers.get('content-security-policy'), /default-src 'none'/);
    assert.match(doc.headers.get('content-type'), /text\/html.*utf-8/);
    const markup = await doc.text();
    assert.match(markup, /background:#0d211e;color:#e2f0ea/);
    assert.match(markup, /缓存原文 #fcfaf6/); // Source text must not undergo palette substitution.
    assert.match(markup, /style='color:#c6d8d0;background:#0d211e'/);
    assert.equal(doc.headers.get('etag'), `"${index.items.find(i => i.id === 'jin10').edition.revision}"`);
    assert.equal((await fetch(base + '/jin10/document', { headers: { 'If-None-Match': doc.headers.get('etag') } })).status, 304);
    const text = await fetch(base + '/jin10/text'); assert.equal(await text.text(), '缓存原文');
    assert.match(text.headers.get('content-disposition'), /attachment/);
    assert.deepEqual(await (await fetch(base + '/jin10/data')).json(), { verified: true });
    assert.equal((await fetch(base+'/aibase/article')).status,200);
    assert.equal((await fetch(base+'/daily60/article')).status,200);
    const article = await (await fetch(base + '/jin10/article')).json();
    assert.equal(article.id, 'jin10'); assert.deepEqual(article.data, {verified:true});
    assert.equal(article.revision, index.items.find(i=>i.id==='jin10').edition.revision);
    assert.equal(await (await fetch(base + '/markets')).json(),null);
    assert.equal((await fetch(base + '/markets/refresh',{method:'POST'})).status,405);
    assert.equal(feedCalls,0);
    assert.equal((await fetch(base, { method: 'POST' })).status, 405);
    assert.equal((await fetch(base + '/unknown/document')).status, 404);
    assert.equal((await fetch(base + '/jin10/document', { method: 'HEAD' })).status, 200);
  } finally {
    await new Promise(resolve => server.close(resolve));
    if (previousRoot === undefined) delete process.env.SPARKFLOW_USER_DATA_DIR; else process.env.SPARKFLOW_USER_DATA_DIR = previousRoot;
    await rm(root, { recursive: true, force: true });
  }
});
