import { expect, test } from '@playwright/test';

for (const entry of ['/terminal', '/logs']) {
test(`terminal from ${entry} paints prepared cards while individual requests wait, then receives live updates`, async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route(/^https:\/\/fonts\./, route => route.abort());
  const now = Date.now();
  const meta = { state: 'fresh', storedAt: new Date(now).toISOString(), refreshAt: new Date(now + 60_000).toISOString(), expiresAt: new Date(now + 180_000).toISOString() };
  const metric = (id: string, label: string, value: number) => ({ id, label, value, display: String(value), change: 1, status: 'live',
    updatedAt: new Date(now).toISOString(), sourceUrl: 'https://example.com', history: [{ time: '2026-10-01', value }] });
  const resources = {
    '/api/global-macro-dashboard?region=global&section=markets': { generatedAt: new Date(now).toISOString(), coreIndices: [{ id: 'nasdaq', name: '预热纳斯达克', symbol: '^NDX', price: 100, changePercent: 1, history: [], sourceUrl: 'https://example.com', status: 'live' }], _publicCache: meta },
    '/api/global-macro-dashboard?region=global&section=macro': { macro: [metric('ppi', 'PPI', 1)], _publicCache: meta },
    '/api/us-macro-card?id=ppi': { card: metric('ppi', 'PPI', 8.8), _publicCache: meta },
    '/api/global-macro-asset?id=gold': { asset: metric('gold', '黄金', 2345), _publicCache: meta },
    '/api/global-macro-core-index?id=nasdaq': { index: { id: 'nasdaq', name: '预热纳斯达克', symbol: '^NDX', price: 100, changePercent: 2.34, history: [], sourceUrl: 'https://example.com', status: 'live' }, _publicCache: meta },
    '/api/global-macro-fx-rate?id=usd-jpy': { rate: metric('usd-jpy', 'USD/JPY', 158.15), _publicCache: meta },
  };
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  let blocked = 0, bootstrapCalls = 0;
  await page.route('**/api/**', async route => {
    blocked++; await waiting;
    if (route.request().url().endsWith('/api/global-macro-asset?id=gold')) {
      return route.fulfill({ json: { asset: { ...metric('gold', '黄金', 2346), updatedAt: new Date(now + 3000).toISOString() }, _publicCache: meta } });
    }
    await route.fulfill({ status: 503, json: { error: 'fixture-unavailable' } });
  });
  await page.route('**/api/global-macro/bootstrap', route => { bootstrapCalls++; return route.fulfill({ json: { generatedAt: new Date(now).toISOString(), resources } }); });
  try {
    await page.goto(`http://127.0.0.1:5187${entry}`);
    if (entry !== '/terminal') {
      await expect.poll(() => bootstrapCalls).toBe(1);
      await page.locator('.sf-pill-nav-desktop a[href="/terminal"]').click();
    }
    await expect(page.locator('.macro-key-change-grid')).toContainText('2345');
    await expect(page.locator('.macro-core-index-card').first()).toContainText('+2.34%');
    await expect(page.locator('.macro-metric-card-ppi')).toContainText('8.8');
    await expect(page.locator('.global-macro-shell')).toContainText('158.15');
    await expect(page.locator('.macro-loading')).toHaveCount(0);
    expect(blocked).toBeGreaterThan(0);
    expect(bootstrapCalls).toBe(1);
    release();
    await expect(page.locator('.macro-key-change-grid')).toContainText('2346');
  } finally { release(); }
});
}

test('unavailable bootstrap leaves normal first-visit data loading functional', async ({ page }) => {
  await page.route('**/api/**', route => route.fulfill({ status: 503, json: { error: 'fixture-unavailable' } }));
  await page.route(/^https:\/\/fonts\./, route => route.abort());
  await page.route('**/api/global-macro-asset?id=gold', route => route.fulfill({ json: { asset: {
    id: 'gold', label: '黄金', value: 2500, display: '2500', change: 1, status: 'live', history: [], sourceUrl: 'https://example.com',
  } } }));
  await page.goto('http://127.0.0.1:5187/terminal');
  await expect(page.locator('.macro-key-change-grid')).toContainText('2500');
});
