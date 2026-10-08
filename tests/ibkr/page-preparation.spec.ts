import { expect, test, type Page } from '@playwright/test';
import { emptySnapshot } from '../../src/lib/ibkr/store';
import type { WorkbenchState } from '../../src/lib/ibkr/workbenchTypes';

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
  const sessions = [{ session_id: 'prepared-session', title: '提前准备的研究记录', status: 'ready', created_at: timestamp, updated_at: timestamp }];
  const workbench: WorkbenchState = {
    source: 'mcp', gatewayMode: 'live', connection: { state: 'connected', detail: '预加载账户', tools: [], accounts: [] },
    snapshot: { ...emptySnapshot('live'), snapshotId: 'prepared-account', accountKey: 'live:prepared', connection: 'connected', state: 'ready', baseCurrency: 'USD', asOf: timestamp, metrics: { netLiquidation: '125000', unrealizedPnl: '8500', buyingPower: '40000', maintenanceMargin: '12000' }, cash: [{ currency: 'USD', amount: '18000' }] },
    quotes: [], evidence: [], alerts: [], reports: [], jobs: [], preferences: { horizon: 'both', targetWeight: null, cashFloor: null, maxDrawdown: null, daily: false, eventAnalysis: false, maxAutomatic: 0, cooldownMinutes: 60, maxAiCalls: 12 },
    ai: { provider: 'fixture', model: 'prepared', fingerprint: 'prepared', configured: true, enabled: false, fields: [], usedToday: 0 }, nextSyncAt: null, calendarSupported: true,
  };
  return { now, intelligence, heatmap, news, global, sessions, workbench };
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
  await page.route('**/api/vibe/research/sessions', route => route.fulfill({ json: data.sessions }));
  await page.route('**/api/ibkr-workbench/state', route => route.fulfill({ json: data.workbench }));
  return { ...data, release, waitingRequests: () => waitingRequests };
}

test('all stock markets and crypto decode logos before opening a heatmap', async ({ page }) => {
  const data = await installPreparedRoutes(page);
  const resources: Record<string, unknown> = { '/api/public-market-intelligence': data.intelligence };
  const primary = ['/stock-logos/600000.svg', '/stock-logos/hk-00700.svg', '/stock-logos/us-NVDA.svg', '/stock-logos/crypto-BTC.svg'];
  const add = (key: string, code: string, logoUrl?: string, fallbackLogoUrl?: string) => {
    resources[key] = { ...data.heatmap, stocks: [{ ...data.heatmap.stocks[0], code, logoUrl, fallbackLogoUrl }] };
  };
  add('/api/china-market-heatmap?source=sina', '600000');
  add('/api/hong-kong-market-heatmap?source=sina', '00700');
  add('/api/us-market-heatmap?source=sina', 'NVDA');
  add('/api/crypto-market-heatmap', 'BTC', primary[3]);
  for (const market of ['japan', 'korea', 'india', 'germany', 'france', 'uk']) {
    primary.push(`/stock-logos/prepared-${market}.svg`);
    add(`/api/global-market-heatmap?market=${market}`, market, primary.at(-1), market === 'japan' ? '/stock-logos/prepared-japan-fallback.svg' : undefined);
  }
  const requested = new Map<string, number>();
  await page.route('**/stock-logos/**', route => {
    const path = new URL(route.request().url()).pathname;
    requested.set(path, (requested.get(path) || 0) + 1);
    return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="green"/></svg>' });
  });
  await page.route('**/api/market/bootstrap', route => route.fulfill({ json: { sources: { china: 'sina', hongkong: 'sina', us: 'sina' }, resources } }));
  await page.setViewportSize({ width: 1600, height: 1000 });
  try {
    await page.goto('http://127.0.0.1:5187/logs');
    await expect.poll(() => primary.every(src => requested.has(src))).toBe(true);
    expect(requested.has('/stock-logos/prepared-japan-fallback.svg')).toBe(true);
    await page.evaluate(async resources => {
      const path = '/src/lib/heatmapLogoPreload.ts';
      await (await import(path)).prepareHeatmapLogoResources(resources);
    }, resources);
    expect([...requested.values()].every(count => count === 1)).toBe(true);
    await page.locator('.sf-pill-nav-desktop a[href="/market"]').click();
    for (const [label, src] of [['A 股', primary[0]], ['港股', primary[1]], ['美股', primary[2]], ['加密', primary[3]]]) {
      const button = page.locator('.market-selector-tab').filter({ hasText: label }).first();
      if (label !== 'A 股') await button.click();
      const logo = page.locator(`.market-heatmap-tile img[src="${src}"]`).first();
      await expect(logo).toBeVisible();
      await expect(logo).toHaveAttribute('loading', 'eager');
      expect(await logo.evaluate(img => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0)).toBe(true);
    }
    expect([...requested.values()].every(count => count === 1)).toBe(true);
    const before = [...requested.entries()];
    await page.evaluate(async resources => {
      const path = '/src/lib/heatmapLogoPreload.ts';
      await (await import(path)).prepareHeatmapLogoResources(resources);
    }, resources);
    expect([...requested.entries()]).toEqual(before);
  } finally { data.release(); }
});

test('logo warmup limits concurrent image requests without delaying other markets', async ({ page }) => {
  const data = await installPreparedRoutes(page);
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const requested: string[] = [];
  let active = 0, maximum = 0;
  await page.route('**/stock-logos/concurrency-*', async route => {
    requested.push(new URL(route.request().url()).pathname);
    maximum = Math.max(maximum, ++active);
    await waiting;
    active--;
    await route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"/>' });
  });
  const resources = Object.fromEntries(['crypto', 'japan', 'korea'].map(market => [
    market === 'crypto' ? '/api/crypto-market-heatmap' : `/api/global-market-heatmap?market=${market}`,
    { stocks: Array.from({ length: 8 }, (_, index) => ({ code: `${market}-${index}`, marketCap: 100 - index, logoUrl: `/stock-logos/concurrency-${market}-${index}.svg` })) },
  ]));
  try {
    await page.goto('http://127.0.0.1:5187/logs');
    await page.evaluate(async resources => {
      const path = '/src/lib/heatmapLogoPreload.ts';
      (window as any).__logoWarmup = (await import(path)).prepareHeatmapLogoResources(resources);
    }, resources);
    await expect.poll(() => requested.length).toBe(6);
    expect(requested.slice(0, 3)).toEqual([
      '/stock-logos/concurrency-crypto-0.svg', '/stock-logos/concurrency-japan-0.svg', '/stock-logos/concurrency-korea-0.svg',
    ]);
    release();
    await page.evaluate(async () => { await (window as any).__logoWarmup; });
    expect(maximum).toBeLessThanOrEqual(6);
    expect(requested).toHaveLength(24);
  } finally { release(); data.release(); }
});

test('failed heatmap logos use a decoded fallback and can retry after cooldown', async ({ page }) => {
  const data = await installPreparedRoutes(page);
  let primaryCalls = 0;
  await page.route('**/stock-logos/retry-logo.svg', route => {
    primaryCalls++;
    return primaryCalls === 1 ? route.fulfill({ status: 404 }) : route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"/>' });
  });
  await page.route('**/stock-logos/retry-fallback.svg', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"/>' }));
  const resources = { '/api/crypto-market-heatmap': { stocks: [{ code: 'TEST', logoUrl: '/stock-logos/retry-logo.svg', fallbackLogoUrl: '/stock-logos/retry-fallback.svg' }] } };
  try {
    await page.goto('http://127.0.0.1:5187/logs');
    const preferred = () => page.evaluate(async resources => {
      const path = '/src/lib/heatmapLogoPreload.ts';
      const helpers = await import(path);
      await helpers.prepareHeatmapLogoResources(resources);
      return helpers.preloadedHeatmapLogoSrc('/stock-logos/retry-logo.svg', '/stock-logos/retry-fallback.svg');
    }, resources);
    expect(await preferred()).toBe('/stock-logos/retry-fallback.svg');
    expect(await preferred()).toBe('/stock-logos/retry-fallback.svg');
    expect(primaryCalls).toBe(1);
    await page.clock.setFixedTime(data.now + 65_000);
    expect(await preferred()).toBe('/stock-logos/retry-logo.svg');
    expect(primaryCalls).toBe(2);
  } finally { data.release(); }
});

test('assistant history and account state render from navigation-time preparation', async ({ page }) => {
  const data = await installPreparedRoutes(page);
  await page.setViewportSize({ width: 1600, height: 1000 });
  try {
    await page.goto('http://127.0.0.1:5187/logs');
    await page.evaluate(async () => {
      const path = '/src/lib/pagePreparation.ts';
      const helpers = await import(path);
      await Promise.all([helpers.prepareAssistantData(), helpers.prepareWorkbenchData()]);
    });
    await page.locator('.sf-pill-nav-desktop a[href="/assistant"]').click();
    await expect(page.getByText('提前准备的研究记录', { exact: true })).toBeVisible();
    await page.locator('.sf-pill-nav-desktop a[href="/ibkr"]').click();
    await expect(page.getByText('正在载入账户工作台…', { exact: true })).toHaveCount(0);
    await expect(page.getByText('125,000.00', { exact: true }).first()).toBeVisible();
    expect(data.waitingRequests()).toBeGreaterThan(0);
  } finally { data.release(); }
});

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
