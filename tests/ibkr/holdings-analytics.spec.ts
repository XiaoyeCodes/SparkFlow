import { test, expect } from '@playwright/test';
import { emptySnapshot } from '../../src/lib/ibkr/store';
import type { AccountSnapshot, PortfolioPerformance } from '../../src/lib/ibkr/workbenchTypes';
import { holdingsAllocation, holdingsReturnSeries, returnGeometry } from '../../src/lib/ibkr/holdingsAnalytics';

const snapshot = (): AccountSnapshot => ({ ...emptySnapshot('live'), snapshotId: 'charts-test', accountKey: 'live:charts-test', connection: 'connected', state: 'ready', baseCurrency: 'USD', asOf: '2026-09-08T05:00:00Z', metrics: { netLiquidation: '1000', unrealizedPnl: '20', buyingPower: '100', maintenanceMargin: '0' }, cash: [{ currency: 'USD', amount: '100' }], positions: [{ accountKey: 'live:charts-test', conId: 1, symbol: 'AAPL', currency: 'USD', quantity: '3', averageCost: '190', marketValue: '600' }, { accountKey: 'live:charts-test', conId: 2, symbol: 'MSFT', currency: 'USD', quantity: '1', averageCost: '280', marketValue: '300' }] });
const history = (): PortfolioPerformance => ({ source: 'IBKR PortfolioAnalyst', fetchedAt: '2026-09-08T05:00:00Z', currency: 'USD', returnMethod: 'TWR', benchmark: 'none', note: '', points: [{ date: '2026-07-01', nav: 100, cumulativeReturn: 0 }, { date: '2026-08-11', nav: 1100, cumulativeReturn: .1 }, { date: '2026-09-08', nav: 1200, cumulativeReturn: .2 }] });

test('holdings allocation separates held weights from NAV and reconciles cash', () => {
  const model = holdingsAllocation(snapshot());
  expect(model.gross).toBe(900);
  expect(model.slices[0].value / model.gross).toBeCloseTo(2 / 3);
  expect(model.assets.map(slice => [slice.label, slice.value])).toEqual([['持仓市值', 900], ['现金余额', 100]]);
  const data = snapshot(); data.metrics.netLiquidation = '1050';
  expect(holdingsAllocation(data).assets[2]).toMatchObject({ label: '其他净资产', value: 50 });
});

test('missing and foreign-currency values cannot become a complete allocation', () => {
  for (const patch of [{ marketValue: null }, { marketValue: '' }, { currency: 'HKD' }]) {
    const data = snapshot(); Object.assign(data.positions[0], patch);
    const model = holdingsAllocation(data);
    expect(model.assets).toEqual([]); expect(model.excluded).toBe(1); expect(model.invested).toBeNull();
  }
  const data = snapshot(); data.cash = [];
  expect(holdingsAllocation(data).assets).toEqual([]);
  expect(holdingsAllocation(data).cash).toBeNull();
});

test('short positions and negative cash are not normalized into an asset pie', () => {
  const data = snapshot(); data.positions[1].marketValue = '-300';
  const model = holdingsAllocation(data);
  expect(model.short).toBe(true); expect(model.gross).toBe(900); expect(model.invested).toBe(300);
  expect(model.slices[1].label).toContain('空头'); expect(model.assets).toEqual([]);
  data.positions[1].marketValue = '300'; data.cash[0].amount = '-100';
  expect(holdingsAllocation(data).assets).toEqual([]);
});

test('large portfolios keep all value while limiting printable legend rows', () => {
  const data = snapshot(); data.positions = Array.from({ length: 40 }, (_, index) => ({ ...data.positions[0], conId: index, symbol: `STOCK${index}`, marketValue: String(index + 1) }));
  const model = holdingsAllocation(data);
  expect(model.slices).toHaveLength(12);
  expect(model.slices.reduce((sum, slice) => sum + slice.value, 0)).toBe(820);
  expect(model.slices[11].label).toBe('其他 29 项');
});

test('TWR compounds selected dates and does not infer profit from cash-inflated NAV', () => {
  const model = holdingsReturnSeries(history(), 30);
  expect(model.start).toBe('2026-08-11'); expect(model.end).toBe('2026-09-08');
  expect(model.value).toBeCloseTo(1.2 / 1.1 - 1);
  expect(holdingsReturnSeries(history(), 0).value).toBeCloseTo(.2);
  const data = history(); data.returnMethod = null;
  expect(holdingsReturnSeries(data, 30).points).toEqual([]);
  data.returnMethod = 'MWR';
  expect(holdingsReturnSeries(data, 30).value).toBe(.2);
});

test('missing returns preserve chart gaps and do not substitute earlier end values', () => {
  const data = history(); data.points[1].cumulativeReturn = null;
  const model = holdingsReturnSeries(data, 0);
  expect(returnGeometry(model.points).path.match(/M/g)).toHaveLength(2);
  data.points[2].cumulativeReturn = null;
  expect(holdingsReturnSeries(data, 0).value).toBeNull();
});

test('holdings charts respond to range changes and export the same range', async ({ page }) => {
  test.setTimeout(60000);
  const state = { source: 'mcp', snapshot: snapshot(), performance: history(), connection: { state: 'connected', detail: 'fixture', tools: [], accounts: [] }, quotes: [], evidence: [], alerts: [], reports: [], jobs: [], preferences: { horizon: 'both', targetWeight: null, cashFloor: null, maxDrawdown: null, daily: false, eventAnalysis: false, maxAutomatic: 0, cooldownMinutes: 60, maxAiCalls: 12 }, ai: { configured: false, enabled: false, fields: [], usedToday: 0 }, nextSyncAt: null, calendarSupported: true };
  await page.route('**/api/ibkr-workbench/state', route => route.fulfill({ json: state }));
  await page.route('**/api/ibkr-workbench/quotes', route => route.fulfill({ json: [] }));
  await page.route('**/api/ibkr-workbench/logo?*', route => route.fulfill({ json: {} }));
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('http://127.0.0.1:5187/ibkr?tab=holdings');
  await expect(page.locator('.ha-card')).toHaveCount(3);
  const boxes = await page.locator('.ha-card').evaluateAll(cards => cards.map(card => card.getBoundingClientRect().top));
  expect(new Set(boxes).size).toBe(1);
  await expect(page.locator('.ha-return strong')).toHaveText('+20.00%');
  await page.getByRole('button', { name: '30天', exact: true }).click();
  await expect(page.locator('.ha-return strong')).toHaveText('+9.09%');
  await page.locator('.ha-legend button').first().focus();
  await expect(page.locator('.ha-donut').first()).toContainText('66.7%');
  // Capture the generated print DOM before the exporter cleans up its offscreen pages.
  await page.evaluate(() => {
    const observer = new MutationObserver(() => {
      const card = document.querySelector('.ha-pdf-page');
      if (!card) return;
      const footer = card.querySelector('.ha-pdf-footer')!.getBoundingClientRect();
      const charts = card.querySelector('.holdings-analytics')!.getBoundingClientRect();
      (window as any).__printCharts = { text: card.textContent, count: card.querySelectorAll('svg,img[data-account-chart]').length, fits: charts.bottom < footer.top };
    });
    observer.observe(document.body, { childList: true, subtree: true });
  });
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 PDF', exact: true }).click();
  const download = await downloaded;
  expect(await download.failure()).toBeNull();
  const printed = await page.evaluate(() => (window as any).__printCharts);
  expect(printed.text).toContain('+9.09%'); expect(printed.text).toContain('最近 30 天');
  expect(printed.count).toBe(3); expect(printed.fits).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const mobile = await page.locator('.ha-card').evaluateAll(cards => cards.map(card => card.getBoundingClientRect().top));
  expect(mobile[0]).toBeLessThan(mobile[1]); expect(mobile[1]).toBeLessThan(mobile[2]);
});
