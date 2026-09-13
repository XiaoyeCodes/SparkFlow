import { expect, test } from '@playwright/test';

test('public cache survives page switches and shows stale/unavailable provenance', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const requests = new Map<string, number>();
  let stale = false;
  const now = Date.now();
  const meta = () => ({ state: stale ? 'stale' : 'fresh', storedAt: new Date(now).toISOString(),
    refreshAt: new Date(stale ? now - 1 : now + 60_000).toISOString(), expiresAt: new Date(now + 300_000).toISOString() });
  await page.route('**/api/**', route => route.fulfill({ status: 503, json: { error: 'not_in_fixture' } }));
  for (const endpoint of ['china-gdp', 'china-income', 'china-fisher?*']) {
    await page.route(`**/api/${endpoint}`, route => route.fulfill({ json: {
      status: 'unavailable', years: [], report: null, mode: new URL(route.request().url()).searchParams.get('mode'),
      validUntil: new Date(now).toISOString(), nextCheckAt: new Date(now + 60_000).toISOString(),
    } }));
  }
  await page.route('**/api/china-macro-dashboard?*', route => {
    const url = new URL(route.request().url());
    const section = url.searchParams.get('section')!;
    requests.set(section, (requests.get(section) || 0) + 1);
    expect(url.searchParams.has('fresh')).toBe(false);
    const payload = section === 'indices' ? { indices: [{ id: 'sh', name: '缓存上证指数', price: 3300, changePercent: 1, sourceUrl: 'https://example.com' }] }
      : section === 'metrics' ? { metrics: [{ id: 'official-pmi', label: '官方制造业 PMI', value: 50.2, display: '50.2', period: '2026-08', status: 'live', source: '测试来源', sourceUrl: 'https://example.com' }] }
      : section === 'news' ? { news: [{ id: 'test', title: '公共数据预加载回归新闻', url: 'https://example.com', source: '测试来源', publishedAt: new Date(now).toISOString() }] }
      : { policy: { stage: '公共缓存测试', direction: '测试', creditState: '测试', nextData: '测试', policies: [] } };
    return route.fulfill({ json: { ...payload, _publicCache: meta() } });
  });
  await page.goto('http://127.0.0.1:5187/market#china-macro');
  await expect(page.locator('.china-index-tape')).toContainText('缓存上证指数');
  await expect(page.locator('.china-news-list')).toContainText('公共数据预加载回归新闻');
  const first = Object.fromEntries(requests);
  await page.getByTitle('返回股票市场').click();
  await expect(page.locator('.china-command-shell')).toHaveCount(0);
  await page.getByRole('button', { name: '中国宏观', exact: true }).click();
  await expect(page.locator('.china-news-list')).toContainText('公共数据预加载回归新闻');
  expect(Object.fromEntries(requests)).toEqual(first);

  // Explicit browser invalidation simulates a fresh visitor receiving stale server data.
  stale = true;
  await page.reload();
  await expect(page.getByRole('status').filter({ hasText: '部分公共数据使用上次缓存' })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: '缓存保存于' })).toBeVisible();
  await page.screenshot({ path: 'output/public-data-stale-notice.png' });
  await page.route('**/api/china-macro-dashboard?*', route => route.fulfill({ status: 503, json: {
    error: 'public_data_preparing', _publicCache: { state: 'unavailable' },
  } }));
  await page.reload();
  await expect(page.getByRole('status').filter({ hasText: '部分公共数据尚未就绪或已过期' })).toBeVisible();
});

test('client shared transport never memoizes account endpoints', async ({ page }) => {
  await page.route('**/api/**', route => route.fulfill({ json: {} }));
  let calls = 0;
  await page.route('**/api/ibkr/status', route => { calls++; return route.fulfill({ json: { account: calls } }); });
  await page.goto('http://127.0.0.1:5187/market#china-macro');
  const values = await page.evaluate(async () => {
    // Import only the actual app helper through Vite; do not duplicate its logic.
    const modulePath = '/src/lib/publicDataClient.ts';
    const { publicDataFetch } = await import(/* @vite-ignore */ modulePath);
    return Promise.all([publicDataFetch('/api/ibkr/status').then((response: Response) => response.json()), publicDataFetch('/api/ibkr/status').then((response: Response) => response.json())]);
  });
  expect(calls).toBe(2);
  expect(values.map(value => value.account)).toEqual([1, 2]);
});
