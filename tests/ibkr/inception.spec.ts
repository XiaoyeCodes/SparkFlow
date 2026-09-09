import { test, expect } from '@playwright/test';
import { emptySnapshot } from '../../src/lib/ibkr/store';
import type { PortfolioPerformance } from '../../src/lib/ibkr/workbenchTypes';

for (const width of [1440, 390]) test(`inception return remains independent of chart period at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 });
  const performance: PortfolioPerformance = { source: 'IBKR PortfolioAnalyst', currency: 'USD', returnMethod: 'TWR', benchmark: 'none', fetchedAt: '2026-09-09T00:00:00Z', note: '测试业绩',
    inception: { value: -.08149961, start: '2026-07-03', end: '2026-09-08', note: 'IBKR 时间加权累计回报 · 保留首日收益，非年化' },
    points: [{ date: '2026-07-03', nav: 100, cumulativeReturn: -.05 }, { date: '2026-08-07', nav: 200, cumulativeReturn: -.07 }, { date: '2026-09-01', nav: 200, cumulativeReturn: -.075 }, { date: '2026-09-08', nav: 500, cumulativeReturn: -.08149961 }] };
  const state = { source: 'mcp', snapshot: { ...emptySnapshot('live'), accountKey: 'live:fixture', state: 'ready', connection: 'connected', baseCurrency: 'USD', asOf: '2026-09-09T00:00:00Z' }, connection: { state: 'connected', detail: '离线测试', tools: [], accounts: [] }, quotes: [], evidence: [], reports: [], alerts: [], jobs: [], preferences: { benchmark: 'none' }, ai: { fields: [], configured: false, enabled: false, usedToday: 0 }, performance };
  await page.route('https://**/*', route => route.abort());
  await page.route('**/api/ibkr-workbench/**', route => route.fulfill({ json: route.request().url().endsWith('/state') ? state : route.request().url().endsWith('/performance') ? performance : [] }));
  await page.goto('http://127.0.0.1:5187/ibkr?tab=overview', { waitUntil: 'domcontentloaded' });
  const total = page.locator('.awb-inception-return');
  await expect(total).toContainText('自始以来总回报');
  await expect(total).toContainText('-8.15%');
  await expect(total).toContainText('2026-07-03 至 2026-09-08 · TWR');
  await page.getByRole('button', { name: '1周', exact: true }).click();
  await expect(total).toContainText('-8.15%');
  await expect(page.getByLabel('收益摘要').locator(':scope > div')).toHaveCount(4);
  const overflow = await total.evaluate(el => el.scrollWidth > el.clientWidth);
  expect(overflow).toBe(false);
  await total.scrollIntoViewIfNeeded();
  await page.getByLabel('收益摘要').screenshot({ path: `tmp/workbench-qa/inception-${width}.png` });
  performance.inception = { value: null, start: null, end: null, note: '完整历史未提供' };
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(total).toContainText('完整历史待核实');
  await expect(total.locator('b')).toHaveText('—');
});
