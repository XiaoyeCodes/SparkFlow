import assert from 'node:assert/strict';
import { pageDataFetch, peekPageData, rememberPageData, invalidatePageData } from '../src/lib/pageDataClient.ts';

const fetchOriginal = globalThis.fetch;
const nowOriginal = Date.now;
let now = Date.parse('2026-09-14T04:00:00Z');
Date.now = () => now;
let calls = 0;
const feed = (value = 'news') => ({ generatedAt: new Date(now).toISOString(), items: [{ title: value }], sources: [{ ok: true }] });
const brief = date => ({ snapshot: { date, generatedAt: `${date}T01:00:00Z`, summary: { headline: 'brief' }, markets: [] }, cache: { stale: false } });
const clear = () => ['/api/news-feed', '/api/daily-brief', '/api/daily-brief/details?view=flows', '/api/daily-brief/details?view=performance'].forEach(invalidatePageData);
try {
  let finish;
  globalThis.fetch = async () => { calls++; await new Promise(resolve => { finish = resolve; }); return Response.json(feed()); };
  const cancel = new AbortController();
  const a = pageDataFetch('/api/news-feed', { signal: cancel.signal });
  const b = pageDataFetch('/api/news-feed');
  cancel.abort();
  await assert.rejects(a);
  finish();
  await b;
  assert.equal(calls, 1, 'consumers share transport with independent cancellation');
  await pageDataFetch('/api/news-feed');
  assert.equal(calls, 1, 'navigation reuses memory');
  const clone = peekPageData('/api/news-feed'); clone.items[0].title = 'changed';
  assert.equal(peekPageData('/api/news-feed').items[0].title, 'news');
  now += 16_000;
  assert.ok(peekPageData('/api/news-feed'), 'usable snapshot can render during revalidation');
  globalThis.fetch = async () => { calls++; return Response.json(feed('updated')); };
  await pageDataFetch('/api/news-feed');
  assert.equal(calls, 2);
  await pageDataFetch('/api/news-feed?refresh=1');
  assert.equal(calls, 3, 'manual refresh bypasses tab cache');

  clear();
  globalThis.fetch = async () => { await new Promise(resolve => { finish = resolve; }); return Response.json(feed('removed subscription')); };
  const obsolete = pageDataFetch('/api/news-feed');
  invalidatePageData('/api/news-feed');
  globalThis.fetch = async () => Response.json(feed('new subscription'));
  await pageDataFetch('/api/news-feed?refresh=1');
  finish(); await obsolete;
  assert.equal(peekPageData('/api/news-feed').items[0].title, 'new subscription', 'late old transport cannot repopulate cache');

  clear();
  rememberPageData('/api/daily-brief', brief('2026-09-14'));
  now = Date.parse('2026-09-15T00:59:59Z');
  assert.ok(peekPageData('/api/daily-brief'));
  now += 1000;
  assert.equal(peekPageData('/api/daily-brief'), undefined, 'Beijing 09:00 removes the previous edition from the daily page');
  rememberPageData('/api/daily-brief', brief('2026-09-14'));
  assert.equal(peekPageData('/api/daily-brief'), undefined, 'old server response cannot repopulate yesterday after 09:00');
  rememberPageData('/api/daily-brief', { ...brief('2026-09-15'), cache: { stale: true } });
  assert.equal(peekPageData('/api/daily-brief'), undefined, 'fallback edition is not silently reused');
  now = Date.parse('2026-09-15T15:59:59Z');
  rememberPageData('/api/news-feed', feed());
  now += 1000;
  assert.equal(peekPageData('/api/news-feed'), undefined, 'today-only news expires at Beijing midnight');
  rememberPageData('/api/news-feed', { ...feed(), _pageCache: { expiresAt: new Date(now + 100).toISOString() } });
  now += 100;
  assert.equal(peekPageData('/api/news-feed'), undefined, 'server hard deadline wins');
  rememberPageData('/api/daily-brief/details?view=flows', { kind: 'flows', generatedAt: new Date(now).toISOString(), metrics: {}, price: [], activity: [], etfFlows: [], sources: [], errors: [] });
  assert.ok(peekPageData('/api/daily-brief/details?view=flows'));
  now += 6 * 3600_000;
  assert.equal(peekPageData('/api/daily-brief/details?view=flows'), undefined);
  rememberPageData('/api/daily-brief/details?view=flows', { kind: 'performance', generatedAt: new Date(now).toISOString(), series: [], sources: [], errors: [] });
  assert.equal(peekPageData('/api/daily-brief/details?view=flows'), undefined, 'mismatched detail kind cannot poison page cache');

  globalThis.fetch = async () => { calls++; return Response.json(feed()); };
  for (const url of ['/api/ibkr/status', '/api/news-sources', '/api/ai-chat', '/api/news-feed?user=a', 'https://example.com/api/news-feed']) {
    const before = calls; await pageDataFetch(url); await pageDataFetch(url);
    assert.equal(calls, before + 2, url);
  }
  for (const init of [{ method: 'POST', body: '{}' }, { headers: { Authorization: 'test' } }]) {
    const before = calls; await pageDataFetch('/api/news-feed', init); await pageDataFetch('/api/news-feed', init);
    assert.equal(calls, before + 2);
  }
  clear();
  globalThis.fetch = async () => Response.json({ error: 'not ready' }, { status: 503 });
  await pageDataFetch('/api/news-feed');
  assert.equal(peekPageData('/api/news-feed'), undefined);
} finally { clear(); globalThis.fetch = fetchOriginal; Date.now = nowOriginal; }
console.log('Page browser cache: reuse, cancellation, invalidation, refresh, edition/midnight deadlines and private API isolation passed.');
