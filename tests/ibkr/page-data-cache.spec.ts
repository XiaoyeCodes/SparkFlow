import { expect, test } from '@playwright/test';

test.beforeEach(async ({ context }) => {
  await context.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
});

test('daily brief and news reuse data on navigation and support explicit refresh', async ({ page }) => {
  const now = Date.now();
  const edition = new Date(now - 3600_000).toISOString().slice(0, 10);
  let briefReads = 0, newsReads = 0, briefRefreshes = 0, newsRefreshes = 0;
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const brief = (refreshed = false) => ({ snapshot: {
    version: 18, date: edition, slot: 'morning', generatedAt: new Date(Date.parse(`${edition}T01:00:00Z`) + (refreshed ? 1 : 0)).toISOString(), updatedAt: new Date(now).toISOString(), summaryMode: 'ai',
    summary: { headline: refreshed ? '简报手动刷新成功' : '简报缓存测试标题', regime: '测试', tone: 'balanced', highlights: [], risks: [], watchlist: [], portfolioNotes: [] },
    markets: [], macro: [], news: [], sources: [], errors: [], portfolio: { connected: false, positions: [] },
  }, cache: { hit: true, generated: false } });
  const news = (refreshed = false) => ({
    generatedAt: new Date(now).toISOString(), proxy: '', categories: [],
    sources: [{ id: 'test', label: '测试数据源', ok: true, count: 1, category: 'finance', origin: 'domestic', route: 'direct' }],
    items: [{ id: 'test-item', title: refreshed ? '新闻手动刷新成功' : '今日新闻缓存测试标题', url: 'https://example.com/news', source: '测试数据源', sourceId: 'test',
      category: 'finance', categoryLabel: '财经', origin: 'domestic', route: 'direct', publishedAt: new Date(now).toISOString(), heat: 70, importance: 70, recency: 100, weight: 80, weightLabel: '高' }],
  });
  await page.route('**/api/**', route => route.fulfill({ status: 503, json: { error: 'not_in_fixture' } }));
  await page.route('**/api/news-sources', route => route.fulfill({ json: { sources: [] } }));
  await page.route('**/api/daily-brief', route => { briefReads++; return route.fulfill({ json: brief() }); });
  await page.route('**/api/daily-brief/refresh', route => { briefRefreshes++; return route.fulfill({ json: brief(true) }); });
  let detailReads = 0;
  await page.route('**/api/daily-brief/details?view=performance', route => { detailReads++; return route.fulfill({ json: {
    kind: 'performance', generatedAt: new Date(now).toISOString(), startDate: '2012-05-18', series: [], sources: [], errors: [],
  } }); });
  await page.route('**/api/news-feed*', route => {
    const refreshed = new URL(route.request().url()).searchParams.get('refresh') === '1';
    newsReads++; if (refreshed) newsRefreshes++;
    return route.fulfill({ json: news(refreshed) });
  });
  await page.goto('http://127.0.0.1:5187/council');
  await expect(page.getByText('简报缓存测试标题').first()).toBeVisible();
  const briefBaseline = briefReads;
  await page.locator('a[href="/signals"]').first().click();
  await expect(page.getByText('今日新闻缓存测试标题').first()).toBeVisible();
  const newsBaseline = newsReads;
  await page.locator('a[href="/council"]').first().click();
  await expect(page.getByText('简报缓存测试标题').first()).toBeVisible();
  expect(briefReads).toBe(briefBaseline);
  await page.getByRole('button', { name: /刷新全部数据/ }).click();
  await expect(page.getByText('简报手动刷新成功').first()).toBeVisible();
  expect(briefRefreshes).toBe(1);
  await page.locator('a[href="/signals"]').first().click();
  await expect(page.getByText('今日新闻缓存测试标题').first()).toBeVisible();
  expect(newsReads).toBe(newsBaseline);
  await page.getByRole('button', { name: '刷新新闻' }).click();
  await expect(page.getByText('新闻手动刷新成功').first()).toBeVisible();
  expect(newsRefreshes).toBe(1);
  // Detail pages are also available through their direct routes.
  await page.goto('http://127.0.0.1:5187/council/details/judgement');
  await expect(page.getByRole('heading', { name: '综合评级与今日判断' })).toBeVisible();
  const detailBriefBaseline = briefReads;
  await page.locator('a[href="/council/details/performance"]').first().click();
  await expect(page.getByRole('heading', { name: '最大回撤区间' })).toBeVisible();
  await page.locator('a[href="/council/details/judgement"]').first().click();
  await expect(page.getByRole('heading', { name: '综合评级与今日判断' })).toBeVisible();
  expect(briefReads).toBe(detailBriefBaseline);
  await page.locator('a[href="/council/details/performance"]').first().click();
  await expect(page.getByRole('heading', { name: '最大回撤区间' })).toBeVisible();
  expect(detailReads).toBe(1);
  expect(errors).toEqual([]);
});

test('removing a subscription invalidates news cache and stale snapshot is labelled', async ({ page }) => {
  const now = new Date().toISOString();
  let removed = false;
  let refreshes = 0;
  const custom = { id: 'custom', label: '待移除测试源', url: 'https://example.com/feed', category: 'world', origin: 'domestic' };
  await page.route('**/api/**', route => route.fulfill({ status: 503, json: {} }));
  await page.route('**/api/news-sources', route => {
    if (route.request().method() === 'DELETE') removed = true;
    return route.fulfill({ json: { sources: removed ? [] : [custom] } });
  });
  await page.route('**/api/news-feed*', route => {
    if (new URL(route.request().url()).searchParams.get('refresh') === '1') refreshes++;
    return route.fulfill({ json: { generatedAt: now, proxy: '', categories: [], items: [],
      sources: removed ? [] : [{ ...custom, ok: true, count: 0 }],
      _pageCache: { state: 'stale', storedAt: now, expiresAt: new Date(Date.now() + 60_000).toISOString() },
    } });
  });
  await page.goto('http://127.0.0.1:5187/signals');
  await expect(page.getByRole('status').filter({ hasText: '正在显示上次新闻快照' })).toBeVisible();
  await page.getByText('管理数据源 / 添加订阅', { exact: true }).click();
  await page.getByRole('button', { name: '移除订阅 待移除测试源' }).click();
  await page.getByRole('button', { name: '确认移除' }).click();
  await expect(page.getByText('订阅已移除。', { exact: true })).toBeVisible();
  expect(refreshes).toBe(1);
  const cached = await page.evaluate(async () => {
    const modulePath = '/src/lib/pageDataClient.ts';
    return (await import(/* @vite-ignore */ modulePath)).peekPageData('/api/news-feed');
  });
  expect(cached.sources).toEqual([]);
});
