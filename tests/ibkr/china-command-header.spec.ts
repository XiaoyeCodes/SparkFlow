import { expect, test } from '@playwright/test';

const dashboard = {
  generatedAt: '2026-09-14T08:00:00Z',
  indices: [
    { id: 'sh', code: '000001', name: '上证指数', price: 3885.33, changePercent: -0.17, sourceUrl: 'https://quote.eastmoney.com/zs000001.html' },
    { id: 'sz', code: '399001', name: '深证成指', price: 13385, changePercent: -0.64, sourceUrl: 'https://quote.eastmoney.com/zs399001.html' },
    { id: 'cy', code: '399006', name: '创业板指', price: 3285.58, changePercent: -1.10, sourceUrl: 'https://quote.eastmoney.com/zs399006.html' },
  ],
  metrics: [],
  quadrant: { current: '测试', growthDirection: 0, inflationDirection: 0, explanation: '测试' },
  policy: { stage: '测试', direction: '测试', creditState: '--', nextData: '测试', nextDataUrl: 'https://www.gov.cn/', policies: [] },
  news: [],
  methodology: '测试',
};

test('中国宏观顶部指数与中间区域对齐，右侧显示每秒更新的北京时间', async ({ page }) => {
  await page.setViewportSize({ width: 1720, height: 900 });
  await page.route('**/api/china-macro-dashboard?*', route => route.fulfill({ json: dashboard }));
  await page.goto('http://127.0.0.1:5187/market#china-macro');

  const clock = page.getByLabel('北京时间电子时钟');
  await expect(clock).toBeVisible();
  await expect(clock.locator('time')).toHaveAttribute('aria-label', /^北京时间 /);
  await expect(clock.getByText('BEIJING // UTC+8')).toBeVisible();
  await expect(clock.getByText(/CST ONLINE|SYNCING/)).toBeVisible();
  await expect(clock.locator('time')).toContainText(/^\d{2}:\d{2}:\d{2}$/);

  const first = await clock.locator('time').textContent();
  await expect.poll(async () => clock.locator('time').textContent(), { timeout: 2500 }).not.toBe(first);

  const aligned = await page.evaluate(() => {
    const tape = document.querySelector('.china-index-tape')!.getBoundingClientRect();
    const map = document.querySelector('.china-map-stage')!.getBoundingClientRect();
    const clock = document.querySelector('.china-command-clock')!.getBoundingClientRect();
    const right = document.querySelector('.china-command-right')!.getBoundingClientRect();
    return { tapeLeft: tape.left, tapeRight: tape.right, mapLeft: map.left, mapRight: map.right, clockLeft: clock.left, clockRight: clock.right, rightLeft: right.left, rightRight: right.right };
  });
  expect(Math.abs(aligned.tapeLeft - aligned.mapLeft)).toBeLessThanOrEqual(1);
  expect(Math.abs(aligned.tapeRight - aligned.mapRight)).toBeLessThanOrEqual(1);
  expect(Math.abs(aligned.clockLeft - aligned.rightLeft)).toBeLessThanOrEqual(1);
  expect(Math.abs(aligned.clockRight - aligned.rightRight)).toBeLessThanOrEqual(1);

  const clockCentering = await clock.evaluate(element => {
    const time = element.querySelector('time')!.getBoundingClientRect();
    const refresh = element.querySelector('button')!.getBoundingClientRect();
    const bounds = element.getBoundingClientRect();
    return {
      timeCenter: time.left + time.width / 2,
      usableCenter: bounds.left + (refresh.left - bounds.left) / 2,
    };
  });
  expect(Math.abs(clockCentering.timeCenter - clockCentering.usableCenter)).toBeLessThanOrEqual(4);

  await page.screenshot({ path: 'output/china-command-beijing-clock.png' });
});
