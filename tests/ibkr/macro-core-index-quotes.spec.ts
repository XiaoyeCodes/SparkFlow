import { expect, test } from '@playwright/test';
import { SINA_CORE_INDEX_CONFIGS } from '../../server/macroCoreIndexQuotes';

test('previous trading day returns remain until valid opening quotes including true zero arrive', async ({ page }) => {
  await page.route('**/api/**', route => route.fulfill({ status: 503, json: { error: 'not_in_fixture' } }));
  await page.route(/^https:\/\/fonts\./, route => route.abort());
  const names = ['纳斯达克100', '标普500', '上证指数', '费城半导体指数'];
  const previous = [.91, .86, -.07, 1.81];
  const opening = [0, -.12, -.07, .34];
  let opened = false;
  const base = Date.now();
  await page.route('**/api/global-macro-core-index?*', route => {
    const id = new URL(route.request().url()).searchParams.get('id');
    const i = SINA_CORE_INDEX_CONFIGS.findIndex(c => c.id === id);
    const c = SINA_CORE_INDEX_CONFIGS[i];
    return route.fulfill({ json: { index: { id, name: names[i], symbol: c.symbol, price: 100,
      changePercent: opened ? opening[i] : previous[i],
      updatedAt: new Date(opened ? base : base - 3 * 86400_000).toISOString(),
      sourceUrl: opened ? c.sourceUrl : `https://finance.yahoo.com/quote/${encodeURIComponent(c.symbol)}`,
      history: [{ time: '2026-09-10', value: 99 }, { time: '2026-09-11', value: 100 }], status: 'delayed',
    } } });
  });
  await page.goto('http://127.0.0.1:5187/terminal');
  const cards = page.locator('.macro-core-index-card');
  await expect(cards.nth(0)).toContainText('+0.91%');
  await expect(cards.nth(1)).toContainText('+0.86%');
  await expect(cards.nth(3)).toContainText('+1.81%');
  opened = true;
  await expect(cards.nth(0)).toContainText('0.00%', { timeout: 5000 });
  await expect(cards.nth(1)).toContainText('-0.12%');
  await expect(cards.nth(3)).toContainText('+0.34%');
  for (let i = 0; i < 4; i++) {
    await expect(cards.nth(i)).toHaveAttribute('href', SINA_CORE_INDEX_CONFIGS[i].sourceUrl);
    await expect(cards.nth(i).locator('.macro-core-index-period')).toHaveText('1M');
    await expect(cards.nth(i).locator('svg')).toBeVisible();
  }
});

test('core cards retain original layout/history, refresh, and open index detail pages', async ({ page, context }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.route('**/api/**', route => route.fulfill({ status: 503, json: { error: 'not_in_fixture' } }));
  await page.route(/^https:\/\/fonts\./, route => route.abort());
  const now = Date.now();
  const names = ['纳斯达克100', '标普500', '上证指数', '费城半导体指数'];
  const polls = new Map<string, number>();
  let fail = false;
  const indices = SINA_CORE_INDEX_CONFIGS.map((c, i) => ({
    id: c.id, name: names[i], symbol: c.symbol, price: 100, changePercent: 0.91,
    sourceUrl: c.sourceUrl, updatedAt: new Date(now - 60_000).toISOString(), status: 'delayed',
    history: Array.from({ length: 22 }, (_, j) => ({ time: `2026-08-${String(j + 1).padStart(2, '0')}`, value: 100 + (j % 5) })),
  }));
  await page.route('**/api/global-macro-dashboard?*', route => {
    const section = new URL(route.request().url()).searchParams.get('section');
    return section === 'markets' ? route.fulfill({ json: { generatedAt: new Date(now).toISOString(), coreIndices: indices } })
      : route.fulfill({ status: 503, json: { error: 'not_in_fixture' } });
  });
  await page.route('**/api/global-macro-core-index?*', route => {
    const id = new URL(route.request().url()).searchParams.get('id')!;
    const count = (polls.get(id) || 0) + 1;
    polls.set(id, count);
    if (fail) return route.fulfill({ status: 503, json: { error: 'offline' } });
    return route.fulfill({ json: { index: { ...indices.find(c => c.id === id),
      changePercent: count === 1 ? 0.91 : 1.23, updatedAt: new Date(now + count * 3000).toISOString(), history: [] } } });
  });
  // Intercept target pages so clicking verifies navigation without relying on ads/networks.
  for (const c of SINA_CORE_INDEX_CONFIGS) {
    await context.route(c.sourceUrl, route => route.fulfill({ contentType: 'text/html', body: '<title>指数行情详情</title>' }));
  }
  await page.goto('http://127.0.0.1:5187/terminal');
  const cards = page.locator('.macro-core-index-card');
  await expect(cards).toHaveCount(4);
  for (let i = 0; i < 4; i++) {
    await expect(cards.nth(i)).toContainText(names[i]);
    await expect(cards.nth(i)).toContainText(SINA_CORE_INDEX_CONFIGS[i].symbol);
    await expect(cards.nth(i).locator('.macro-core-index-period')).toHaveText('1M');
    await expect(cards.nth(i)).toHaveAttribute('href', SINA_CORE_INDEX_CONFIGS[i].sourceUrl);
    await expect(cards.nth(i).locator('svg')).toBeVisible();
  }
  await expect(cards.first()).toContainText('+1.23%', { timeout: 5000 });
  for (const c of SINA_CORE_INDEX_CONFIGS) expect(polls.get(c.id)).toBeGreaterThanOrEqual(2);
  fail = true;
  for (let i = 0; i < 4; i++) {
    const opened = context.waitForEvent('page');
    await cards.nth(i).click();
    const detail = await opened;
    await expect(detail).toHaveURL(SINA_CORE_INDEX_CONFIGS[i].sourceUrl);
    await detail.close();
  }
  await expect(cards.first()).toContainText('+1.23%');
  await expect(cards.first().locator('svg')).toBeVisible();
  await page.screenshot({ path: 'output/macro-core-index-quotes-desktop.png' });
  expect(errors).toEqual([]);
});
