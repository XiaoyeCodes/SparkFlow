import { expect, test } from '@playwright/test';

test('currency cards keep original presentation while polling and retaining quotes through failures', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.clock.install();
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.route('**/api/**', route => route.fulfill({ status: 503, json: { error: 'unavailable' } }));
  await page.route(/^https:\/\/fonts\./, route => route.abort());
  const base = Date.now();
  let polls = 0, fail = false;
  await page.route('**/api/global-macro-asset?id=dxy', route => {
    polls++;
    if (fail) return route.fulfill({ status: 503, json: { error: 'offline' } });
    return route.fulfill({ json: { generatedAt: new Date().toISOString(), asset: {
      id: 'dxy', label: '美元指数', value: polls === 1 ? 99.5083 : 99.5184, display: polls === 1 ? '99.51' : '99.52', change: 0.42,
      updatedAt: new Date(base + (polls === 1 ? 0 : 1000)).toISOString(),
      sourceUrl: 'https://finance.sina.com.cn/money/forex/hq/DINIW.shtml', status: 'live', history: [],
    } } });
  });
  await page.route('**/api/global-macro-asset?id=us10y', route => route.fulfill({ json: { asset: {
    id: 'us10y', label: '美国10年期国债收益率', value: 4.971, display: '4.97%', change: .031,
    updatedAt: new Date(base - 3 * 86400_000).toISOString(), sourceUrl: 'https://finance.yahoo.com/quote/%5ETNX', status: 'delayed', history: [],
  } } }));
  await page.route('**/api/global-macro-fx-rate?id=usd-jpy', route => route.fulfill({ json: { rate: {
    id: 'usd-jpy', label: '美元兑日元', value: 154.595, display: '154.60', change: .06, updatedAt: new Date(base).toISOString(),
    sourceUrl: 'https://finance.sina.com.cn', status: 'live', history: [],
  } } }));
  await page.goto('http://127.0.0.1:5187/terminal');
  const dxy = page.locator('.asset-dxy');
  await expect(dxy).toContainText('99.51');
  await expect(dxy).toContainText('99.52', { timeout: 5000 });
  await expect(page.locator('.asset-us10y')).toContainText('4.97%');
  await expect(page.locator('.macro-fx-card').first()).toContainText('154.60');
  await expect(page.locator('.macro-fx-section .macro-section-title')).toHaveText('主要汇率 · 24H');
  await expect(page.locator('.macro-key-change-section .macro-section-title')).toHaveText('关键变化 · 24H');
  await expect(page.locator('.macro-fx-card').nth(1)).toContainText('人民币');
  await expect(page.locator('.macro-quote-stamp')).toHaveCount(0);
  fail = true;
  await page.clock.fastForward(40_000);
  await expect(dxy).toContainText('99.52');
  await expect(page.locator('.macro-quote-stamp')).toHaveCount(0);
  await page.screenshot({ path: 'output/macro-currency-quotes-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.macro-fx-card').first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'output/macro-currency-quotes-mobile.png' });
  expect(errors).toEqual([]);
});
