import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const require = createRequire(import.meta.url);
async function loadTs(relative) {
  const { outputText } = ts.transpileModule(readFileSync(new URL(relative, import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 }
  });
  const code = outputText.replace(/from 'undici'/g, "from '" + pathToFileURL(require.resolve('undici')).href + "'");
  return import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
}
const { ADDITIONAL_NEWS_SOURCES, scoreNews, parseReadhub, parseAdditionalSource, parseSyndication, parseXTrends, parseAibaseList, parseAibaseDetail, beijingNewsDay, mergeNewsItems, createNewsFeedService, safeNewsUrl, validNewsDate } = await loadTs('../server/newsFeed.ts');
const { selectNewsItems, newsForSource, newsCategoryCounts } = await loadTs('../src/lib/newsPresentation.ts');
const source = (id) => ADDITIONAL_NEWS_SOURCES.find((entry) => entry.id === id);
const now = Date.parse('2026-08-28T12:00:00Z');
const topic = (id, title) => ({ id, title, publishDate: '2026-08-28T08:00:00Z' });
const readhubRows = [topic('test-a', '测试新闻：第一条平台原榜新闻'), topic('test-b', '测试新闻：第二条平台原榜新闻')];
const rsc = '2a:' + JSON.stringify(['$', 'hydration', null, {
  state: { queries: [
    { queryKey: ['weekly-hot-topics', ''], state: { data: { data: { items: [topic('weekly', '周榜测试条目')] } } } },
    { queryKey: ['hot-topics'], state: { data: { data: { items: readhubRows } } } }
  ] }
}]) + '\n';
const readhubHtml = '<script>self.__next_f.push(' + JSON.stringify([1, rsc]) + ')</script>';
const readhub = parseReadhub(readhubHtml);
assert.equal(readhub.length, 2);
assert.deepEqual(readhub.map((entry) => entry.sourceRank), [1, 2]);
assert.equal(readhub[0].url, 'https://readhub.cn/topic/test-a');
assert.throws(() => parseReadhub(readhubHtml.replaceAll('hot-topics', 'weekly-topics')), /24 小时榜/);
assert.throws(() => parseReadhub('<html>login required</html>'), /24 小时榜/);

const weibo = parseAdditionalSource(source('weibo'), JSON.stringify({ ok: 1, data: { realtime: [
  { word: '测试热搜一', realpos: 1, num: 1080000 },
  { word: '测试广告', realpos: 2, is_ad: 1 },
  { word: '测试热搜三', realpos: 3, num: 90000 }
] } }));
assert.equal(weibo.length, 2);
assert.deepEqual(weibo.map((entry) => entry.sourceRank), [1, 3], 'Removing an ad must not renumber the source rank');
assert.equal(weibo[0].sourceHeat, '1080000 热度');
assert.equal(weibo[0].publishedAt, undefined);
const hf = parseAdditionalSource(source('huggingface'), JSON.stringify([
  { paper: { id: 'test-a', title: 'Test paper A', upvotes: 1, publishedAt: '2026-08-27T00:00:00Z' } },
  { paper: { id: 'test-b', title: 'Test paper B', upvotes: 9, publishedAt: '2026-08-27T00:00:00Z' } }
]));
assert.ok(hf[1].heat > hf[0].heat);
assert.ok(hf.every((item) => !item.sourceRank), 'Daily API order is not a documented hot-list rank');
const tencent = parseAdditionalSource(source('tencent'), JSON.stringify({ data: { tabs: [{ articleList: [
  { title: '测试腾讯早报', publish_time: '2026-08-28 10:00:00', link_info: { url: 'https://news.qq.com/test' } }
] }] } }));
assert.equal(validNewsDate(tencent[0].publishedAt, now), '2026-08-28T02:00:00.000Z');
assert.equal(tencent[0].sourceRank, undefined);
const hn = parseAdditionalSource(source('hackernews'), '<tr class="athing submission" id="1"><span class="rank">4.</span><span class="titleline"><a href="https://example.com/story">Test &amp; headline</a></span></tr><tr><span class="score">654 points</span><span class="age" title="2026-08-28T08:00:00Z"><a href="item?id=1">hours ago</a></span></tr>');
assert.equal(hn[0].sourceRank, 4);
assert.equal(hn[0].title, 'Test & headline');
assert.equal(hn[0].discussionUrl, 'https://news.ycombinator.com/item?id=1');
const github = parseAdditionalSource(source('github-trending'), '<article class="Box-row"><h2><a href="/test/repo">test/repo</a></h2><p>A test repo</p><a href="/test/repo/stargazers">8,940</a><span>1,984 stars today</span></article>');
assert.equal(github[0].sourceHeat, '1,984 今日新增 Stars');
assert.equal(github[0].publishedAt, undefined);
assert.equal(github[0].sourceRank, 1);

const official = { ...source('readhub'), sourceWeight: 90 };
const policy = scoreNews({ title: '央行公布降息政策并实施', url: 'https://example.com/policy', publishedAt: '2026-08-28T10:00:00Z' }, official, now);
const entertainment = scoreNews({ title: '明星演唱会登上文娱热搜第一', url: 'https://example.com/entertainment', sourceRank: 1 }, source('weibo'), now);
const rumor = scoreNews({ title: '据悉央行可能降息', url: 'https://example.com/rumor', sourceRank: 1 }, source('readhub'), now);
const researchPrediction = scoreNews({ title: '研究机构称央行将达成新协议', url: 'https://example.com/prediction' }, source('readhub'), now);
assert.ok(policy.importance > entertainment.importance);
assert.ok(policy.weight > entertainment.weight, 'Entertainment heat must not overtake a major verified-time policy event');
assert.ok(entertainment.importance <= 42);
assert.equal(entertainment.category, 'society');
assert.ok(rumor.importance <= 58);
assert.ok(researchPrediction.importance <= 58);
assert.equal(entertainment.publishedAt, undefined);
assert.equal(entertainment.recency, 0);
assert.equal(validNewsDate('bad', now), undefined);
assert.equal(validNewsDate('2027-01-01', now), undefined);
assert.equal(safeNewsUrl('javascript:alert(1)'), '');
assert.equal(safeNewsUrl('//example.com/story', 'https://readhub.cn'), 'https://example.com/story');
for (const rank of [1, 3, 10, 20, 30]) {
  const item = scoreNews({ title: 'Test news', url: 'https://example.com/' + rank, sourceRank: rank }, source('readhub'), now);
  assert.equal(item.sourceRank, rank);
  assert.ok(Number.isFinite(item.weight) && item.weight >= 0 && item.weight <= 100);
}

const duplicateA = scoreNews({ ...readhub[0], sourceRank: 7 }, source('readhub'), now);
const duplicateB = scoreNews({ ...readhub[0], sourceRank: 2, sourceHeat: '100 回复' }, source('v2ex'), now);
const separate = scoreNews(readhub[1], source('readhub'), now);
const merged = mergeNewsItems([duplicateA, duplicateB, separate]);
assert.equal(merged.length, 2);
assert.equal(merged.find((entry) => entry.title === duplicateA.title).appearances.length, 2);
assert.equal(newsForSource(merged, 'v2ex')[0].sourceRank, 2);
assert.equal(newsForSource(merged, 'v2ex')[0].weight, duplicateB.weight);
assert.deepEqual(newsForSource(merged, 'v2ex')[0].ranking, duplicateB.ranking);
assert.equal(newsForSource(merged, 'readhub').find((entry) => entry.title === duplicateA.title).sourceRank, 7);
assert.deepEqual(selectNewsItems(merged, 'all', 'source', 'readhub').map((entry) => entry.sourceRank), [2, 7]);
assert.equal(newsCategoryCounts(merged).filter((entry) => entry.id !== 'all').reduce((sum, entry) => sum + entry.count, 0), merged.length);
const many = Array.from({ length: 100 }, (_, index) => scoreNews({ title: 'Distinct ' + index, url: 'https://example.com/' + index }, source('readhub'), now));
assert.equal(mergeNewsItems(many).length, 100, 'Merging must not truncate the global feed at 80');

let currentTime = now;
let calls = 0;
let failing = false;
const service = createNewsFeedService([], async () => [], '', {
  additionalSources: [source('readhub')], now: () => currentTime,
  transport: async () => { calls++; if (failing) throw new Error('fixture unavailable'); return { text: readhubHtml, route: 'direct' }; }
});
const [first, concurrent] = await Promise.all([service(), service()]);
assert.equal(calls, 1, 'Concurrent clients share one fetch');
assert.deepEqual(first, concurrent);
assert.equal(first.items.length, 2);
await service(true);
assert.equal(calls, 1, 'Manual refresh has a minimum interval');
currentTime += 130_000;
failing = true;
const stale = await service();
assert.equal(stale.sources[0].ok, false);
assert.equal(stale.sources[0].stale, true);
assert.ok(stale.items.every((item) => item.stale));
assert.equal(stale.sources[0].fetchedAt, first.sources[0].fetchedAt, 'Failure does not reset last successful fetch time');
assert.ok(stale.items[0].weight < first.items[0].weight);
currentTime += 31 * 60_000;
const expired = await service();
assert.equal(expired.items.length, 0);
assert.equal(expired.sources[0].stale, false);
assert.equal(expired.sources[0].ok, false);
const hung = createNewsFeedService([], async () => [], '', {
  additionalSources: [source('readhub')], sourceTimeoutMs: 10,
  transport: async () => new Promise(() => {})
});
const timedOut = await hung();
assert.equal(timedOut.sources[0].ok, false);
assert.match(timedOut.sources[0].error, /超时/);
console.log('News feed checks passed: source parsers, original ranks, heat, scoring, time safety, deduplication, source projection, cache and failure isolation.');

const rssItem = (title, date = 'Fri, 28 Aug 2026 10:00:00 GMT', extra = '') => `<item><title><![CDATA[${title}]]></title><link>https://example.com/${encodeURIComponent(title)}</link><pubDate>${date}</pubDate>${extra}</item>`;
const xml = '<rss><channel>' + rssItem('Test &amp; headline', undefined, '<description><![CDATA[<p>A summary</p>]]></description>') + '</channel></rss>';
const rss = parseSyndication(xml, source('nyt-world'));
assert.equal(rss[0].title, 'Test & headline');
assert.equal(rss[0].summary, 'A summary');
assert.equal(parseSyndication('<rss>' + rssItem('Encoded HTML', undefined, '<description>&lt;p&gt;Visible&lt;/p&gt;&lt;a href=&quot;https://example.com&quot;&gt;Link&lt;/a&gt;</description>') + '</rss>', source('nyt-world'))[0].summary, 'Visible Link');
assert.equal(rss[0].sourceOrder, 1);
assert.equal(rss[0].sourceRank, undefined);
assert.throws(() => parseSyndication('<html>正在进行安全检测</html>', source('nyt-world')), /安全验证拦截/);
assert.throws(() => parseSyndication('<rss><channel>', source('nyt-world')), /不完整/);
assert.throws(() => parseSyndication('<!DOCTYPE rss><rss></rss>', source('nyt-world')), /DTD/);
const atom = parseSyndication(`<feed><entry><title>Atom entry</title><link rel="self" href="https://example.com/self.xml"/><link rel="alternate" type="text/html" href="/story"/><updated>2026-08-28T09:00:00Z</updated></entry><entry><title>Unsafe</title><link href="javascript:alert(1)"/></entry></feed>`, source('nyt-world'));
assert.equal(atom.length, 1);
assert.equal(atom[0].url, 'https://rss.nytimes.com/story');
assert.equal(atom[0].publishedAt, '2026-08-28T09:00:00Z');
const google = parseSyndication('<rss>' + rssItem('Story - Reuters', undefined, '<source url="https://www.reuters.com">Reuters</source>') + rssItem('Other publisher', undefined, '<source url="https://reuters.com.evil.example">Reuters</source>') + '</rss>', source('reuters'));
assert.equal(google.length, 1, 'Google search results must belong to the requested publisher');
assert.equal(google[0].title, 'Story');
assert.equal(google[0].summary, undefined);
const recentXml = '<rss>' + Array.from({ length: 35 }, (_, i) => rssItem('Old ' + i, 'Mon, 27 Jan 2025 14:24:53 GMT')).join('') + rssItem('Recent') + rssItem('Unknown', 'bad') + '</rss>';
const recentService = createNewsFeedService([], async () => [], '', { additionalSources: [source('nyt-world')], now: () => now, transport: async () => ({ text: recentXml, route: 'proxy' }) });
const recentFeed = await recentService();
assert.equal(recentFeed.items.length, 1, 'Filter the last 24h before applying the per-source limit');
assert.equal(recentFeed.items[0].sourceOrder, 36, 'RSS order is retained even when older entries are filtered out');
assert.equal(recentFeed.items[0].delivery, 'official-rss');
assert.equal(recentFeed.items[0].heat, 0);
assert.equal(recentFeed.sources[0].ok, true);
const emptyService = createNewsFeedService([], async () => [], '', { additionalSources: [source('bbc-world')], transport: async () => ({ text: '<rss><channel></channel></rss>', route: 'proxy' }) });
assert.equal((await emptyService()).sources[0].ok, true, 'A valid empty feed is not a connection error');
const international = scoreNews({ ...readhub[0] }, source('reuters'), now);
const internationalMerged = mergeNewsItems([duplicateA, international]);
assert.equal(newsForSource(internationalMerged, 'international').length, 1);
assert.equal(newsForSource(internationalMerged, 'international')[0].sourceId, 'reuters');
assert.equal(newsForSource([duplicateA], 'international').length, 0);
assert.ok(scoreNews({ title: 'Federal Reserve announces interest rate cuts', url: 'https://example.com/policy' }, source('nyt-world'), now).importance > scoreNews({ title: 'A day at the office', url: 'https://example.com/neutral' }, source('nyt-world'), now).importance);
assert.equal(ADDITIONAL_NEWS_SOURCES.filter((s) => ['official-rss', 'google-news'].includes(s.delivery)).length, 10);
console.log('International checks passed: RSS/Atom, original order, publisher attribution, 24h window, empty feeds and English scoring.');

const { validateFeedUrl, validateSubscription, isPublicIpv4, createSubscriptionStore, fetchPublicFeed } = await loadTs('../server/newsSubscriptions.ts');
for (const address of ['127.0.0.1', '10.1.1.1', '169.254.169.254', '100.64.0.1', '192.168.0.1', '198.18.0.1', '224.1.1.1', '1..1.1']) assert.equal(isPublicIpv4(address), false);
assert.equal(isPublicIpv4('8.8.8.8'), true);
assert.equal(isPublicIpv4('192.0.66.108'), true, 'Public hosting ranges are not the IETF 192.0.0.0/24 block');
for (const address of ['192.0.0.8', '192.0.2.1', '192.88.99.2', '198.51.100.1', '203.0.113.1']) assert.equal(isPublicIpv4(address), false);
for (const url of ['http://example.com/rss', 'https://localhost/rss', 'https://127.1/feed', 'https://0x7f000001/', 'https://[::1]/', 'https://user:pass@example.com/feed', 'https://example.com:1234/', 'file:///etc/passwd']) assert.throws(() => validateFeedUrl(url));
await assert.rejects(fetchPublicFeed('https://127.0.0.1/'), /内网/);
const subscription = { label: 'Test subscription', url: 'https://example.com/feed#fragment', category: 'world', origin: 'foreign' };
assert.equal(validateSubscription(subscription).url, 'https://example.com/feed');
assert.throws(() => validateSubscription({ ...subscription, category: 'oops' }));
assert.throws(() => validateSubscription({ ...subscription, label: '' }));
const { mkdtemp, unlink, rmdir, writeFile } = await import('node:fs/promises');
const { tmpdir } = await import('node:os');
const { join } = await import('node:path');
const testDir = await mkdtemp(join(tmpdir(), 'sparkflow-news-test-'));
const filename = join(testDir, 'subscriptions.json');
try {
  const store = createSubscriptionStore(filename);
  assert.deepEqual(await store.list(), []);
  const added = await store.add(subscription);
  assert.equal((await createSubscriptionStore(filename).list())[0].id, added[0].id, 'Subscriptions survive service restart');
  await assert.rejects(store.add(subscription), /已添加/);
  const results = await Promise.allSettled([store.add({ ...subscription, url: 'https://example.com/second' }), store.add({ ...subscription, url: 'https://example.com/second' })]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1, 'Serialize concurrent writes');
  assert.equal((await store.remove(added[0].id)).length, 1);
  await writeFile(filename, 'broken json');
  await assert.rejects(store.add(subscription), /无法读取/, 'Do not overwrite corrupted user configuration');
} finally { await unlink(filename).catch(() => {}); await rmdir(testDir); }
console.log('Custom subscription checks passed: URL safety, private IP rejection, persistence, duplicate protection and atomic serialized writes.');

const zhihu = parseAdditionalSource(source('zhihu'), JSON.stringify({ code: 200, data: [
  { title: 'Question A', link: 'https://www.zhihu.com/question/123', hot_value_desc: '640 万热度', created_at: now - 3600_000 },
  { title: 'Invalid external', link: 'https://evil.example/question/999' },
  { title: 'Question C', link: 'https://www.zhihu.com/question/456', hot_value_desc: '120 万热度' }
] }), now);
assert.deepEqual(zhihu.map((i) => i.sourceRank), [1, 3]);
assert.equal(zhihu[0].sourceHeat, '640 万热度');
assert.equal(zhihu[0].publishedAt, new Date(now - 3600_000).toISOString());
assert.equal(zhihu[1].publishedAt, undefined);
assert.throws(() => parseAdditionalSource(source('zhihu'), '{"code":500,"data":[]}', now), /异常/);
const reddit = parseAdditionalSource(source('reddit'), '<feed><entry><title>Hot item</title><link href="https://www.reddit.com/r/test/comments/123/item"/><published>2026-08-28T03:00:00Z</published></entry></feed>', now);
assert.equal(reddit[0].sourceRank, 1);
assert.equal(reddit[0].sourceHeat, undefined);
assert.equal(reddit[0].discussionUrl, reddit[0].url);
assert.equal(newsForSource([scoreNews(reddit[0], source('reddit'), now)], 'international', now).length, 0, 'Community RSS is not an international media source');
const trendCard = (at, topic) => `<h3 class=title data-timestamp=${at / 1000}>Time</h3><ol class=trend-card__list><li><span class=trend-name><a href="https://twitter.com/search?q=${topic}">${topic}</a><span class=tweet-count>12K posts</span></span></li></ol>`;
const trends = parseXTrends(trendCard(now - 7200_000, 'Old') + trendCard(now - 1800_000, 'Newest'), now);
assert.equal(trends[0].title, 'Newest');
assert.equal(trends[0].publishedAt, undefined, 'A trend snapshot is not publication time');
assert.equal(trends[0].boardObservedAt, new Date(now - 1800_000).toISOString());
assert.equal(trends[0].sourceRank, 1);
assert.equal(trends[0].sourceHeat, '12K posts');
assert.throws(() => parseXTrends(trendCard(now - 5 * 3600_000, 'Expired'), now), /超过 4 小时/);
assert.throws(() => parseXTrends('<html>Changed</html>', now), /不可用/);

const trendBoard = (region, titles, at = now - 1800_000) => `<h1>${region} X (Twitter) Trends for last 24 hours</h1><h3 data-timestamp="${at / 1000}">Time</h3><ol class="trend-card__list">${titles.map((title) => `<li><a href="https://twitter.com/search?q=${encodeURIComponent(title)}">${title}</a><span class="tweet-count">12K posts</span></li>`).join('')}</ol>`;
const worldTopics = ['Trending English', '中国经济新政策', '映画鑑賞後の感情', '台灣地震最新消息', '東京大学', 'OpenAI发布新模型', 'MVP級', '改称指示', '万博', '한국뉴스', '学习中文ｶﾀｶﾅ', '中文のニュース', '中文한국'];
while (worldTopics.length < 50) worldTopics.push('English topic ' + (worldTopics.length + 1));
worldTopics[30] = '中文日报新消息';
worldTopics.push('中文话题但排在第51名');
const worldBoard = trendBoard('Worldwide', worldTopics);
const chineseTrends = parseAdditionalSource(source('x-trends-zh'), worldBoard, now);
assert.deepEqual(chineseTrends.map((item) => item.sourceRank), [2, 4, 6, 31], 'Filter before the 30-item output cap, preserve original rank gaps, ignore ranks beyond 50');
assert.deepEqual(chineseTrends.map((item) => item.sourceOrder), [2, 4, 6, 31]);
assert.equal(chineseTrends.every((item) => item.sourceHeat === '12K posts' && !item.publishedAt), true);
assert.equal(parseAdditionalSource(source('x-trends'), worldBoard, now).length, 30, 'Global view still displays 30 items');
const usBoard = trendBoard('United States', ['中国经济新政策', 'American topic']);
assert.equal(source('x-trends-us').url, 'https://trends24.in/united-states/');
assert.equal(parseAdditionalSource(source('x-trends-us'), usBoard, now)[0].sourceRank, 1);
assert.throws(() => parseAdditionalSource(source('x-trends-us'), worldBoard, now), /地区不匹配/);
assert.throws(() => parseAdditionalSource(source('x-trends-zh'), usBoard, now), /地区不匹配/);
assert.throws(() => parseAdditionalSource(source('x-trends-zh'), trendBoard('Worldwide', []), now), /没有有效话题/);
assert.throws(() => parseAdditionalSource(source('x-trends-zh'), trendBoard('Worldwide', ['中文话题'], now - 5 * 3600_000), now), /超过 4 小时/);
assert.deepEqual(parseAdditionalSource(source('x-trends-zh'), trendBoard('Worldwide', ['English', '初音', '東京大学', '全国大会', '新作発表', '万博']), now), [], 'Do not infer Chinese from Han characters alone');
const xSources = ['x-trends', 'x-trends-us', 'x-trends-zh'].map(source);
for (const entry of xSources) assert.equal(scoreNews({ title: 'Test', url: 'https://x.com/search?q=test' }, entry, now).ranking.importanceReasons.includes('社区线索需核验，热度不代表可信度'), true);

let xClock = now, xFailed = false, xNoChinese = false;
const xRequests = [];
const xFeed = createNewsFeedService([], async () => [], '', {
  additionalSources: xSources, now: () => xClock,
  transport: async (entry) => {
    xRequests.push(entry.url);
    if (xFailed) throw new Error('Trends connection failed');
    return { route: 'proxy', text: entry.id === 'x-trends-us' ? usBoard : xNoChinese ? trendBoard('Worldwide', ['English only']) : worldBoard };
  }
});
const xFirst = await xFeed();
assert.equal(xRequests.filter((url) => url === 'https://trends24.in/').length, 1, 'Global and Chinese share one request and snapshot');
assert.equal(xRequests.filter((url) => url.endsWith('/united-states/')).length, 1);
assert.deepEqual(xFirst.sources.map((entry) => entry.count), [30, 2, 4]);
const commonTrend = xFirst.items.find((item) => item.title === '中国经济新政策');
assert.equal(commonTrend.appearances.length, 3, 'Same topic merges without losing regional appearances');
assert.equal(newsForSource([commonTrend], 'x-trends-us', now)[0].sourceRank, 1);
assert.equal(newsForSource([commonTrend], 'x-trends-zh', now)[0].sourceRank, 2);
assert.equal(newsForSource([commonTrend], 'x-trends-zh', now)[0].sourceRankLabel, '全球原榜 · 中文筛选');
assert.equal(newsForSource([commonTrend], 'international', now).length, 0);
assert.deepEqual(selectNewsItems(xFirst.items, 'all', 'source', 'x-trends-zh', now).map((item) => item.sourceRank), [2, 4, 6, 31]);
xClock += 16_000; xNoChinese = true;
const xEmpty = await xFeed(true);
const chineseStatus = xEmpty.sources.find((entry) => entry.id === 'x-trends-zh');
assert.equal(chineseStatus.ok, true, 'A valid board without Chinese matches is connected, not an error');
assert.equal(chineseStatus.count, 0);
assert.equal(chineseStatus.stale, false);
assert.match(chineseStatus.emptyMessage, /暂无匹配/);
assert.equal(newsForSource(xEmpty.items, 'x-trends-zh', xClock).length, 0, 'Do not retain an earlier Chinese board when the latest board has no matches');
xClock += 16_000; xFailed = true;
const xCached = await xFeed(true);
assert.equal(xCached.sources.every((entry) => !entry.ok && entry.stale), true);
assert.equal(newsForSource(xCached.items, 'x-trends-us', xClock)[0].stale, true);
xClock += 31 * 60_000;
const xExpiredCache = await xFeed(true);
assert.equal(xExpiredCache.items.length, 0);
assert.equal(xExpiredCache.sources.every((entry) => !entry.ok && !entry.stale), true);
let edgeClock = now;
const xEdgeFeed = createNewsFeedService([], async () => [], '', {
  additionalSources: [source('x-trends-zh')], now: () => edgeClock,
  transport: async () => {
    if (edgeClock !== now) throw new Error('Offline');
    return { route: 'proxy', text: trendBoard('Worldwide', ['中文话题'], now - 4 * 3600_000 + 10_000) };
  }
});
assert.equal((await xEdgeFeed()).items.length, 1);
edgeClock += 16_000;
assert.equal((await xEdgeFeed(true)).items.length, 0, 'Cached filtered trends also expire at four hours');
const xInvalidFeed = createNewsFeedService([], async () => [], '', {
  additionalSources: [source('x-trends-zh')], now: () => now,
  transport: async () => ({ route: 'proxy', text: trendBoard('Worldwide', []) })
});
assert.equal((await xInvalidFeed()).sources[0].ok, false, 'A broken source is not treated as a normal empty filter');
console.log('X regional/filter checks passed: fixed US region, Chinese heuristic, original ranks, projection, shared requests, empty states and cache expiry.');

function nuxtFixture(data) {
  const values = [['ShallowReactive', 1]];
  function encode(value) {
    const index = values.length; values.push(null);
    values[index] = Array.isArray(value) ? value.map(encode) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, child]) => [key, encode(child)])) : value;
    return index;
  }
  encode({ data });
  return '<script type="application/json" id="__NUXT_DATA__">' + JSON.stringify(values) + '</script>';
}
const dailyRow = (oid, createTime) => ({ oid, title: 'AI日报：测试模型与工具', createTime });
const dailyList = (rows) => nuxtFixture({ getDailyNews: { code: 200, data: { list: rows } }, getAIHotRank: { code: 200, data: { list: [dailyRow(999, '2026-08-28 16:00:00')] } } });
const dailyDetail = (createTime) => nuxtFixture({ getDailyNewsDetail: { code: 200, data: {
  title: 'AI日报：测试模型与工具', createTime, description: 'Daily description',
  summary: '<p>Welcome</p><p><strong>1、模型发布</strong></p><p>A summary</p><p><strong>2、工具上线</strong></p>'
} }, getSimilarAIIArticles: { code: 200, data: [dailyRow(999, '2026-08-28 16:00:00')] } });
assert.equal(beijingNewsDay('2026-08-28T15:59:59Z'), '2026-08-28');
assert.equal(beijingNewsDay('2026-08-28T16:00:00Z'), '2026-08-29');
const todayList = dailyList([dailyRow(1, '2026-08-27 16:00:00'), dailyRow(2, '2026-08-28 16:00:00'), dailyRow(3, '2026-08-29 16:00:00')]);
const todayDailies = parseAibaseList(todayList, now);
assert.equal(todayDailies.length, 1);
assert.equal(todayDailies[0].url, 'https://news.aibase.cn/daily/2');
assert.equal(todayDailies[0].publishedAt, '2026-08-28T08:00:00.000Z');
assert.equal(parseAibaseList(dailyList([dailyRow(1, '2026-08-27 16:00:00')]), now)[0].url, 'https://news.aibase.cn/daily/1', 'Use yesterday when today is unpublished, not the newer hot-rank entries');
assert.equal(parseAibaseList(dailyList([dailyRow(2, '2026-08-28 16:00:00')]), Date.parse('2026-08-30T12:00:00Z'))[0].url, 'https://news.aibase.cn/daily/2', 'Keep the most recent issue over weekends');
assert.equal(parseAibaseList(dailyList([dailyRow(4, '2026-08-28 20:01:00')]), now).length, 0, 'Even a near-future issue is not published yet');
assert.equal(parseAibaseList(dailyList([dailyRow(1, 'bad')]), now).length, 0);
assert.equal(parseAibaseList(dailyList([]), now).length, 0);
assert.throws(() => parseAibaseList('<html>Changed</html>', now), /结构/);
const daily = parseAibaseDetail(dailyDetail('2026-08-28 16:00:00'), todayDailies[0], now)[0];
assert.equal(daily.summary, '1、模型发布；2、工具上线');
assert.equal(daily.sourceRank, undefined, 'A daily digest is not a hot-list rank');
assert.equal(parseAibaseDetail(dailyDetail('2026-08-27 16:00:00'), todayDailies[0], now)[0].publishedAt, '2026-08-27T08:00:00.000Z', 'Keep the actual detail publication date');
assert.throws(() => parseAibaseDetail(dailyDetail('2026-08-29 16:00:00'), todayDailies[0], now), /尚未发布/);
let dailyClock = Date.parse('2026-08-28T15:59:50Z');
let dailyCalls = 0;
let dailyFailure = false;
const dailyService = createNewsFeedService([], async () => [], '', {
  additionalSources: [source('aibase')], now: () => dailyClock,
  transport: async (s) => { dailyCalls++; if (dailyFailure) throw new Error('fixture daily unavailable'); return { text: s.url.endsWith('/daily') ? todayList : dailyDetail('2026-08-28 16:00:00'), route: 'direct' }; }
});
const beforeMidnight = await dailyService();
assert.equal(beforeMidnight.items.length, 1);
assert.equal(beforeMidnight.items[0].source, 'aibase');
assert.equal(beforeMidnight.items[0].todayOnly, false);
assert.equal(dailyCalls, 2, 'Fetch one latest detail after list verification');
dailyClock += 11_000; dailyFailure = true;
const afterMidnight = await dailyService();
assert.equal(afterMidnight.items.length, 1, 'Retain the last successful issue across midnight when refresh fails');
assert.equal(afterMidnight.sources[0].count, 1);
assert.equal(afterMidnight.sources[0].stale, true);
assert.equal(afterMidnight.items[0].publishedAt, beforeMidnight.items[0].publishedAt);
assert.equal(dailyCalls, 3);
assert.equal(newsForSource(beforeMidnight.items, 'all', dailyClock).length, 1, 'Client keeps the latest issue after midnight');
assert.equal(selectNewsItems(beforeMidnight.items, 'all', 'heat', 'aibase', dailyClock).length, 1);
let missingCalls = 0;
const unpublished = createNewsFeedService([], async () => [], '', { additionalSources: [source('aibase')], now: () => now,
  transport: async (s) => { missingCalls++; return { text: s.url.endsWith('/daily') ? dailyList([dailyRow(1, '2026-08-27 16:00:00')]) : dailyDetail('2026-08-27 16:00:00'), route: 'direct' }; }
});
const unpublishedResult = await unpublished();
assert.equal(unpublishedResult.sources[0].ok, true);
assert.equal(unpublishedResult.items.length, 1);
assert.equal(unpublishedResult.items[0].publishedAt, '2026-08-27T08:00:00.000Z');
assert.equal(unpublishedResult.items[0].stale, false, 'An older publication fetched successfully is not failed-cache content');
assert.equal(missingCalls, 2, 'Fetch the most recent available detail even if it is yesterday');
console.log('Community and AIBase checks passed: attribution, original ranks, real timestamps, latest trend card, latest daily fallback, weekend retention, midnight cache and client display.');
