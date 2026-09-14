import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
});

test('public cache survives page switches without a global banner; section failures remain visible', async ({ page }) => {
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
  for (const section of ['metrics', 'policy', 'news']) expect(requests.get(section)).toEqual(first[section]);
  expect(requests.get('indices')).toBeGreaterThan(first.indices);

  // Explicit browser invalidation simulates a fresh visitor receiving stale server data.
  stale = true;
  await page.reload();
  await expect(page.locator('.china-news-list')).toContainText('公共数据预加载回归新闻');
  await expect(page.getByText(/部分公共数据使用上次缓存|缓存保存于/)).toHaveCount(0);
  await page.screenshot({ path: 'output/cache-audit/no-global-notice.png' });
  await page.route('**/api/china-macro-dashboard?*', route => route.fulfill({ status: 503, json: {
    error: 'public_data_preparing', _publicCache: { state: 'unavailable' },
  } }));
  await page.reload();
  await expect(page.locator('.china-command-error')).toContainText('中国宏观数据分区均未加载成功');
  await expect(page.locator('.china-command-error').getByRole('button', { name: '重新获取' })).toBeVisible();
  await expect(page.getByText('部分公共数据尚未就绪或已过期，后台正在重试')).toHaveCount(0);
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

test('China live indices update on the three-second path and recover after a failed poll', async ({ page }) => {
  await page.route('**/api/**', route => route.fulfill({ status: 503, json: { error: 'fixture-unavailable' } }));
  let calls = 0;
  await page.route('**/api/china-macro-dashboard?section=indices', route => {
    calls++;
    if (calls === 2) return route.fulfill({ status: 503, json: { _publicCache: { state: 'unavailable' } } });
    const now = Date.now();
    return route.fulfill({ json: { indices: [{ id: 'live', name: '三秒回归指数', price: calls === 1 ? 3100 : 3200,
      changePercent: 1, updatedAt: new Date(now).toISOString(), sourceUrl: 'https://example.com' }],
      _publicCache: { state: 'fresh', storedAt: new Date(now).toISOString(), refreshAt: new Date(now + 3000).toISOString(), expiresAt: new Date(now + 90000).toISOString() },
    } });
  });
  await page.goto('http://127.0.0.1:5187/market#china-macro');
  await expect(page.locator('.china-index-tape')).toContainText('3,100');
  await expect.poll(() => calls, { timeout: 5000 }).toBeGreaterThanOrEqual(2);
  await expect(page.locator('.china-index-tape')).toContainText('3,100');
  await expect(page.locator('.china-index-tape')).toContainText('3,200', { timeout: 5000 });
});

test('global gold card continues after three failures and rejects an older quote', async ({ page }) => {
  await page.route('**/api/**', route => route.fulfill({ status: 503, json: { error: 'fixture-unavailable' } }));
  let calls = 0;
  const base = Date.now();
  await page.route('**/api/global-macro-asset?id=gold', route => {
    calls++;
    if (calls >= 2 && calls <= 4) return route.fulfill({ status: 503, json: { error: 'temporary-network-failure' } });
    const price = calls === 1 ? 2345 : calls === 5 ? 2346 : 2344;
    return route.fulfill({ json: { asset: { id: 'gold', label: '黄金', value: price, display: String(price), change: 1,
      updatedAt: new Date(base + (calls === 5 ? 2000 : calls === 1 ? 1000 : 0)).toISOString(),
      status: 'live', sourceUrl: 'https://example.com/gold', history: [] },
      _publicCache: { state: 'fresh', expiresAt: new Date(base + 90000).toISOString() },
    } });
  });
  await page.goto('http://127.0.0.1:5187/terminal');
  const gold = page.locator('.macro-key-change-grid').getByText('2345', { exact: true });
  await expect(gold).toBeVisible();
  await expect(page.locator('.macro-key-change-grid')).toContainText('2346', { timeout: 16000 });
  await expect.poll(() => calls, { timeout: 5000 }).toBeGreaterThanOrEqual(6);
  await expect(page.locator('.macro-key-change-grid')).toContainText('2346');
  await expect(page.locator('.macro-key-change-grid')).not.toContainText('2344');
});
