import { expect, test, type Page } from '@playwright/test';

function fixtures() {
  const now = Date.now(), timestamp = new Date(now).toISOString();
  const meta = { state: 'fresh', storedAt: timestamp, refreshAt: new Date(now + 3000).toISOString(), expiresAt: new Date(now + 90_000).toISOString() };
  const intelligence = { generatedAt: timestamp, dataMode: 'live', confidence: 100, confidenceLabel: '测试', warning: '', errors: [],
    summary: { score: 50, scoreLabel: '测试', stance: '测试', riskLevel: '测试', headline: '测试', disclaimer: '测试' },
    indices: [{ id: 'sh', code: '000001', name: '提前准备的上证指数', region: 'CN', market: 'china', price: 3835.54, change: -1, changePercent: -0.17,
      sourceUrl: 'https://example.com', updatedAt: timestamp, validation: { status: 'verified', source: '测试' } }],
    breadth: { advancers: 10, decliners: 20, flat: 2, advanceRatio: 0.3 },
    sectors: { total: 1, sampleSize: 1, positiveRatio: 0.5, flowBalance: 0, leaders: [], laggards: [] },
    reports: [], news: [], scores: [], sources: [], _publicCache: meta };
  const heatmap = { generatedAt: timestamp, count: 1, coverage: '测试', source: '新浪财经', sourceUrl: 'https://example.com',
    stocks: [{ code: '600000', name: '提前准备的股票', exchange: 'SH', industry: '银行', price: 10, changePercent: 1.23, marketCap: 100_000_000_000, sourceUrl: 'https://example.com', updatedAt: timestamp }], _publicCache: meta };
  const news = { generatedAt: timestamp, proxy: '', categories: [],
    sources: [{ id: 'test', label: '测试来源', ok: true, count: 1, category: 'finance', origin: 'domestic', route: 'direct' }],
    items: [{ id: 'prepared', title: '提前准备的新闻正文', url: 'https://example.com', source: '测试来源', sourceId: 'test', category: 'finance',
      categoryLabel: '财经', origin: 'domestic', route: 'direct', publishedAt: timestamp, heat: 80, importance: 80, recency: 100, weight: 80, weightLabel: '高' }],
    _pageCache: { ...meta, expiresAt: new Date(now + 1800_000).toISOString() } };
  const global = { generatedAt: timestamp, resources: { '/api/global-macro-dashboard?region=global&section=markets': {
    generatedAt: timestamp, coreIndices: [], markets: [{ id: 'shanghai', name: '上证指数', symbol: '000001.SS', price: 3835.54, changePercent: -0.17,
      sourceUrl: 'https://example.com', market: 'china', region: 'apac', latitude: 31.2, longitude: 121.5, session: { label: '交易中', tone: 'live' }, history: [] }], _publicCache: meta,
  } } };
  return { now, intelligence, heatmap, news, global };
}

async function installPreparedRoutes(page: Page) {
  const data = fixtures();
  let release!: () => void, waitingRequests = 0;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  await page.route(/^https:\/\/fonts\./, route => route.abort());
  await page.route('**/api/**', async route => { waitingRequests++; await waiting; await route.fulfill({ status: 503, json: {} }); });
  await page.route('**/api/market/bootstrap', route => route.fulfill({ json: { sources: { china: 'sina', hongkong: 'sina', us: 'sina' },
    resources: { '/api/public-market-intelligence': data.intelligence, '/api/china-market-heatmap?source=sina': data.heatmap } } }));
  await page.route('**/api/news-feed/prepared*', route => route.fulfill({ json: data.news }));
  await page.route('**/api/global-macro/bootstrap', route => route.fulfill({ json: data.global }));
  return { ...data, release, waitingRequests: () => waitingRequests };
}

test('first market and news clicks use prepared data even while normal reads wait', async ({ page }) => {
  const data = await installPreparedRoutes(page);
  await page.setViewportSize({ width: 1600, height: 1000 });
  try {
    await page.goto('http://127.0.0.1:5187/logs');
    await page.evaluate(async () => { const path = '/src/lib/pagePreparation.ts'; const helpers = await import(path); await Promise.all([helpers.prepareMarketData(), helpers.prepareNewsData()]); });
    await page.locator('.sf-pill-nav-desktop a[href="/market"]').click();
    await expect(page.getByText('提前准备的股票', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('提前准备的上证指数', { exact: true }).first()).toBeVisible();
    await expect(page.locator('.page-enter')).toHaveCSS('filter', 'blur(0px)');
    await expect(page.getByText('正在整理 A 股全市场热力图', { exact: true })).toHaveCount(0);
    expect(data.waitingRequests()).toBeGreaterThan(0);
    // Expire the 15s browser reuse window, while retaining the real snapshot deadline.
    await page.clock.setFixedTime(data.now + 16_000);
    await page.locator('.sf-pill-nav-desktop a[href="/signals"]').click();
    await expect(page.getByText('提前准备的新闻正文', { exact: true })).toBeVisible();
    await expect(page.locator('.page-enter')).toHaveCSS('filter', 'blur(0px)');
    await expect(page.locator('.signals-item').first()).toHaveCSS('opacity', '1');
    await expect(page.locator('.signals-loading')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '刷新新闻' })).toHaveAttribute('aria-busy', 'false');
  } finally { data.release(); }
});

test('globe image is decoded and uploaded before clicking and renderer survives navigation', async ({ page }) => {
  const data = await installPreparedRoutes(page);
  await page.setViewportSize({ width: 1600, height: 1000 });
  let imageRequests = 0;
  await page.route('**/textures/earth-day.jpg', route => { imageRequests++; return route.continue(); });
  try {
    await page.goto('http://127.0.0.1:5187/logs');
    await page.evaluate(async () => { const path = '/src/lib/terminalGlobeResources.ts'; await (await import(path)).prepareTerminalGlobeResources(); });
    expect(imageRequests).toBe(1);
    await page.locator('.sf-pill-nav-desktop a[href="/terminal"]').click();
    await expect(page.locator('.macro-holo')).toHaveAttribute('data-earth-texture', 'ready');
    await page.evaluate(() => { (window as any).__testGlobeCanvas = document.querySelector('.macro-holo canvas'); });
    // Use the SPA router so a new document cannot accidentally satisfy persistence.
    await page.locator('.sf-pill-nav-desktop a[href="/signals"]').click({ force: true });
    await expect(page.locator('.macro-holo')).toHaveCount(0);
    await page.locator('.sf-pill-nav-desktop a[href="/terminal"]').click();
    await expect(page.locator('.macro-holo')).toHaveAttribute('data-earth-texture', 'ready');
    expect(await page.evaluate(() => (window as any).__testGlobeCanvas === document.querySelector('.macro-holo canvas'))).toBe(true);
    expect(imageRequests).toBe(1);
  } finally { data.release(); }
});

test('late prepared news cannot restore a subscription-invalidated snapshot', async ({ page }) => {
  const data = await installPreparedRoutes(page);
  let releasePrepared!: () => void;
  const preparedWait = new Promise<void>(resolve => { releasePrepared = resolve; });
  let requested = false;
  try {
    await page.goto('http://127.0.0.1:5187/logs');
    await page.evaluate(async () => { const path = '/src/lib/pagePreparation.ts'; await (await import(path)).prepareNewsData(); });
    await page.route('**/api/news-feed/prepared*', async route => {
      requested = true; await preparedWait; await route.fulfill({ json: data.news });
    });
    await page.clock.setFixedTime(data.now + 32_000);
    await page.evaluate(async () => {
      const path = '/src/lib/pagePreparation.ts';
      (window as any).__lateNewsPreparation = (await import(path)).prepareNewsData();
    });
    await expect.poll(() => requested).toBe(true);
    await page.evaluate(async () => { const path = '/src/lib/pageDataClient.ts'; (await import(path)).invalidatePageData('/api/news-feed'); });
    releasePrepared();
    expect(await page.evaluate(async () => {
      await (window as any).__lateNewsPreparation;
      const path = '/src/lib/pageDataClient.ts';
      return (await import(path)).peekPageData('/api/news-feed') === undefined;
    })).toBe(true);
  } finally { releasePrepared(); data.release(); }
});
