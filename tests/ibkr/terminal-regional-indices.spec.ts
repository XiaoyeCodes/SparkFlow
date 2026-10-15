import { expect, test } from '@playwright/test';

test('globe and tape use the same direct quotes, refresh automatically and survive slow/failed aggregate frames', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.clock.install();
  await page.addInitScript(() => { Reflect.deleteProperty(window, 'EventSource'); });
  await page.route(/^https:\/\/fonts\./, route => route.abort());
  const now = Date.now(); let calls = 0, failed = false, recovered = false;
  const quotes = (fresh: boolean) => ['china', 'hongkong'].map((id, index) => ({
    id, name: id === 'china' ? (fresh ? '上证指数' : '上证综指') : '恒生指数', symbol: id === 'china' ? '000001.SS' : '^HSI',
    price: fresh ? index ? 24106.52 : 3713.74 : index ? 24119.14 : 3710.7,
    changePercent: fresh ? recovered ? -0.75 : index ? -0.85 : -1.42 : -0.13,
    updatedAt: new Date(now + (fresh ? calls * 1000 : -60_000)).toISOString(),
    sourceUrl: fresh ? 'https://finance.sina.com.cn/index' : 'https://finance.yahoo.com/quote/index',
    market: id, region: 'apac', latitude: index ? 22.28 : 31.24, longitude: index ? 114.16 : 121.51,
    session: { label: '交易中', tone: 'live' }, history: [],
  }));
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/global-macro-regional-indices') {
      calls++;
      return failed ? route.fulfill({ status: 503, json: {} })
        : route.fulfill({ json: { generatedAt: new Date(now + calls * 1000).toISOString(), markets: quotes(true), ticker: quotes(true) } });
    }
    if (url.pathname === '/api/global-macro-quotes' || (url.pathname === '/api/global-macro-dashboard' && url.searchParams.get('section') === 'markets')) {
      return route.fulfill({ json: { generatedAt: new Date(now).toISOString(), markets: quotes(false), ticker: quotes(false) } });
    }
    return route.fulfill({ status: 503, json: {} });
  });
  await page.goto('http://127.0.0.1:5187/terminal');
  const globe = (id: string) => page.locator(`.macro-holo-label[data-index-id="${id}"]`);
  const tape = (id: string) => page.locator(`.macro-index-quote[data-index-id="${id}"]`).first();
  await page.clock.runFor(300);
  await expect(globe('china')).toContainText('上证指数');
  await expect(globe('china')).toContainText('-1.42%');
  await expect(globe('hongkong')).toContainText('-0.85%');
  await expect(tape('hongkong')).toContainText('-0.85%');
  await expect(tape('china')).toHaveAttribute('title', /sina\.com/);
  const first = calls; failed = true;
  await page.clock.runFor(3100);
  await expect.poll(() => calls).toBeGreaterThan(first);
  await expect(globe('hongkong')).toContainText('-0.85%');
  await expect(tape('hongkong')).toContainText('-0.85%');
  failed = false; recovered = true;
  await page.clock.runFor(3100);
  await expect(globe('china')).toContainText('-0.75%');
  await expect(globe('hongkong')).toContainText('-0.75%');
  await expect(tape('china')).toContainText('-0.75%');
  await expect(tape('hongkong')).toContainText('-0.75%');
});
