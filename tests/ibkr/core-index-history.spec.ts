import { expect, test } from '@playwright/test';

for (const prepared of [false, true]) {
test(`core index curves load independently (${prepared ? 'prepared snapshot' : 'late history'}) and survive quote-only updates`, async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.clock.install();
  await page.route(/^https:\/\/fonts\./, route => route.abort());
  const ids = ['nasdaq', 'sp500', 'shanghai', 'sox'];
  const now = Date.now(), updatedAt = new Date(now).toISOString();
  const history = [{ time: '2026-10-09', value: 100 }, { time: '2026-10-12', value: 104 }, { time: '2026-10-13', value: 102 }];
  const index = (id: string) => ({ id, name: id, symbol: id, price: 102, changePercent: 2.34, updatedAt, sourceUrl: 'https://example.com', status: 'live', history: [] });
  const series = (id: string) => ({ id, symbol: id, history, updatedAt, sourceUrl: 'https://example.com/history' });
  const meta = { storedAt: updatedAt, state: 'fresh', refreshAt: new Date(now + 300_000).toISOString(), expiresAt: new Date(now + 3600_000).toISOString() };
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const requested = new Set<string>();
  let quoteCalls = 0;
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/global-macro/bootstrap') {
      return route.fulfill({ json: { generatedAt: updatedAt, resources: Object.fromEntries(ids.flatMap(id => [
        [`/api/global-macro-core-index?id=${id}`, { index: index(id), _publicCache: meta }],
        ...(prepared ? [[`/api/global-macro-core-index-history?id=${id}`, { series: series(id), _publicCache: meta }]] : []),
      ])) } });
    }
    if (url.pathname === '/api/global-macro-core-index') { quoteCalls++; return route.fulfill({ json: { index: index(url.searchParams.get('id')!) } }); }
    if (url.pathname === '/api/global-macro-core-index-history') {
      const id = url.searchParams.get('id')!; requested.add(id);
      await waiting;
      return route.fulfill({ json: { series: series(id) } });
    }
    return route.fulfill({ status: 503, json: {} });
  });
  try {
    await page.goto('http://127.0.0.1:5187/terminal');
    const cards = page.locator('.macro-core-index-card');
    await expect(cards).toHaveCount(4);
    if (!prepared) {
      await expect.poll(() => requested.size).toBe(4);
      await expect(cards.locator('.macro-line-empty')).toHaveCount(4);
      release();
    }
    await expect(cards.locator('polyline')).toHaveCount(4);
    await expect(cards.locator('.macro-line-empty')).toHaveCount(0);
    const before = quoteCalls;
    await page.clock.fastForward(3100);
    await expect.poll(() => quoteCalls).toBeGreaterThan(before);
    await expect(cards.locator('polyline')).toHaveCount(4);
    for (const card of await cards.all()) await expect(card).toContainText('+2.34%');
    if (prepared) {
      // First paint reuses the snapshot without a redundant network request.
      expect(requested.size).toBe(0);
      await page.clock.fastForward(300_001);
      await expect.poll(() => requested.size).toBe(4);
      await expect(cards.locator('polyline')).toHaveCount(4);
    }
  } finally { release(); }
});
}
