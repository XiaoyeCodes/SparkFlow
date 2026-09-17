import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { emptySnapshot } from '../../src/lib/ibkr/store';
import type { AccountSnapshot, PortfolioPerformance } from '../../src/lib/ibkr/workbenchTypes';
import { donutArcPath, holdingsAllocation, holdingsReturnSeries, returnGeometry } from '../../src/lib/ibkr/holdingsAnalytics';

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

test('large portfolios keep all value while fitting the legend without scrolling', () => {
  const data = snapshot(); data.positions = Array.from({ length: 40 }, (_, index) => ({ ...data.positions[0], conId: index, symbol: `STOCK${index}`, marketValue: String(index + 1) }));
  const model = holdingsAllocation(data);
  expect(model.slices).toHaveLength(10);
  expect(model.slices.reduce((sum, slice) => sum + slice.value, 0)).toBe(820);
  expect(model.slices[9].label).toBe('其他 31 项');
});

test('TWR compounds selected dates and does not infer profit from cash-inflated NAV', () => {
  const model = holdingsReturnSeries(history(), 30);
  expect(model.start).toBe('2026-08-11'); expect(model.end).toBe('2026-09-08');
  expect(model.value).toBeCloseTo(1.2 / 1.1 - 1);
  expect(model.points.map(point => point.nav)).toEqual([1100, 1200]);
  expect(holdingsReturnSeries(history(), 0).value).toBeCloseTo(.2);
  const data = history(); data.returnMethod = null;
  const local = holdingsReturnSeries(data, 30);
  expect(local.kind).toBe('nav');
  expect(local.points.map(point => point.nav)).toEqual([1100, 1200]);
  expect(local.value).toBeCloseTo(1200 / 1100 - 1);
  expect(local.amount).toBe(100);
  expect(local.note).toContain('含出入金');
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

test('Gateway holdings show a labeled local NAV trajectory instead of an empty return chart', async ({ page }) => {
  const data = snapshot();
  const performance: PortfolioPerformance = { source: 'IB Gateway 实盘 · 本地净值快照', fetchedAt: '2026-09-08T05:00:00Z', currency: 'USD', returnMethod: null, benchmark: 'SPY', note: '含出入金', points: [{ date: '2026-09-07', nav: 1000, cumulativeReturn: null }, { date: '2026-09-08', nav: 1020, cumulativeReturn: null }] };
  const state = { source: 'gateway', gatewayMode: 'live', snapshot: data, performance, connection: { state: 'connected', detail: 'fixture', tools: [], accounts: [] }, quotes: [], evidence: [], alerts: [], reports: [], jobs: [], preferences: { horizon: 'both', targetWeight: null, cashFloor: null, maxDrawdown: null, daily: false, eventAnalysis: false, maxAutomatic: 0, cooldownMinutes: 60, maxAiCalls: 12 }, ai: { configured: false, enabled: false, fields: [], usedToday: 0 }, nextSyncAt: null, calendarSupported: true };
  await page.route('**/api/ibkr-workbench/state', route => route.fulfill({ json: state }));
  await page.route('**/api/ibkr-workbench/quotes', route => route.fulfill({ json: [] }));
  await page.route('**/api/ibkr-workbench/logo?*', route => route.fulfill({ json: {} }));
  await page.goto('http://127.0.0.1:5187/ibkr?tab=holdings');
  await expect(page.getByRole('article', { name: '账户净值轨迹' })).toBeVisible();
  await expect(page.locator('.ha-return strong')).toHaveText('+2.00%');
  await expect(page.locator('.ha-return-change b')).toContainText('+20.00USD');
  await expect(page.locator('.ha-performance')).toContainText('含出入金');
  await expect(page.getByRole('img', { name: /账户净值变动曲线/ })).toBeVisible();
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
  await expect(page.locator('.ha-return-amount')).toContainText('期末账户净值');
  await expect(page.locator('.ha-return-amount')).toContainText('1,200.00USD');
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
      const holdingsPage = document.querySelector('[data-account-pdf-page="2"]');
      const holdingRow = holdingsPage?.querySelector('.holding-row');
      const holdingFooter = holdingsPage?.querySelector('.disclosure');
      if (holdingRow && holdingFooter) {
        const style = getComputedStyle(holdingRow);
        const finalRow = holdingsPage!.querySelector('.holding-row:last-child')!.getBoundingClientRect();
        (window as any).__printHoldings = { radius: style.borderRadius, border: style.borderTopWidth, overflow: style.overflow, gap: getComputedStyle(holdingsPage!.querySelector('.portfolio-grid')!).gap, fits: finalRow.bottom < holdingFooter.getBoundingClientRect().top };
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  });
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 PDF', exact: true }).click();
  const download = await downloaded;
  expect(await download.failure()).toBeNull();
  await mkdir('output/pdf', { recursive: true });
  await download.saveAs('output/pdf/SparkFlow-Portfolio-Statement-rounded.pdf');
  const printed = await page.evaluate(() => (window as any).__printCharts);
  expect(printed.text).toContain('+9.09%'); expect(printed.text).toContain('最近 30 天');
  expect(printed.count).toBe(3); expect(printed.fits).toBe(true);
  const printedHoldings = await page.evaluate(() => (window as any).__printHoldings);
  expect(printedHoldings).toEqual({ radius: '9px', border: '1px', overflow: 'hidden', gap: '6px', fits: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const mobile = await page.locator('.ha-card').evaluateAll(cards => cards.map(card => card.getBoundingClientRect().top));
  expect(mobile[0]).toBeLessThan(mobile[1]); expect(mobile[1]).toBeLessThan(mobile[2]);
});

test('full holdings use card rows and keep reference quotes free of source metadata', async ({ page }) => {
  const quote = { conId: 1, symbol: 'AAPL', price: 212, changePercent: 1.2, asOf: '2026-09-04T20:00:00Z', fetchedAt: '2026-09-08T05:00:00Z', source: '东方财富', status: 'delayed', currency: 'USD', sourceUrl: 'https://example.com' } as const;
  const state = { source: 'mcp', snapshot: snapshot(), performance: history(), connection: { state: 'connected', detail: 'fixture', tools: [], accounts: [] }, quotes: [quote], evidence: [], alerts: [], reports: [], jobs: [], preferences: { horizon: 'both', targetWeight: null, cashFloor: null, maxDrawdown: null, daily: false, eventAnalysis: false, maxAutomatic: 0, cooldownMinutes: 60, maxAiCalls: 12 }, ai: { configured: false, enabled: false, fields: [], usedToday: 0 }, nextSyncAt: null, calendarSupported: true };
  await page.route('**/api/ibkr-workbench/state', route => route.fulfill({ json: state }));
  await page.route('**/api/ibkr-workbench/quotes', route => route.fulfill({ json: [quote] }));
  await page.route('**/api/ibkr-workbench/logo?*', route => route.fulfill({ json: {} }));
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('http://127.0.0.1:5187/ibkr?tab=holdings');

  const holdings = page.locator('.awb-holdings:not(.awb-holdings-summary)');
  const table = holdings.locator('.awb-table-scroll table');
  const firstRow = holdings.locator('tbody tr').first();
  await expect(table).toHaveCSS('border-collapse', 'separate');
  await expect(table).toHaveCSS('border-spacing', '0px 10px');
  await expect(firstRow.locator('td').first()).toHaveCSS('border-radius', '12px 0px 0px 12px');
  await expect(firstRow.locator('td').last()).toHaveCSS('border-radius', '0px 12px 12px 0px');
  await expect(firstRow.locator('.awb-company-icon')).toHaveCSS('width', '38px');
  await expect(firstRow.locator('.awb-company-icon')).toHaveCSS('border-radius', '10px');

  const referenceQuote = firstRow.locator('td').last();
  await expect(referenceQuote).toHaveText('212.00');
  await expect(referenceQuote).not.toContainText('延迟');
  await expect(referenceQuote).not.toContainText('东方财富');
  await expect(referenceQuote.locator('small')).toHaveCount(0);
  await holdings.screenshot({ path: 'output/ibkr/holdings-card-rows.png' });
});


test('financed accounts render signed cash and preserve the NAV reconciliation', async ({ page }) => {
  const data = snapshot();
  data.metrics.netLiquidation = '1000808.03';
  data.positions = [{ ...data.positions[0], marketValue: '1231592.48' }];
  data.cash[0].amount = '-231897.09';
  const model = holdingsAllocation(data);
  expect(model.assets).toEqual([]);
  expect(model.signedAssets.find(row => row.label === '现金余额（负债）')?.value).toBe(-231897.09);
  expect(model.signedAssets.reduce((sum, row) => sum + row.value, 0)).toBeCloseTo(1000808.03, 2);
  expect(model.signedAssets.find(row => row.label === '其他净额（待核对）')?.value).toBeCloseTo(1112.64, 2);
  const state = { source: 'mcp', snapshot: data, performance: history(), connection: { state: 'connected', detail: 'fixture', tools: [], accounts: [] }, quotes: [], evidence: [], alerts: [], reports: [], jobs: [], preferences: { maxAiCalls: 12 }, ai: { configured: false, enabled: false, fields: [] } };
  await page.route('**/api/ibkr-workbench/state', route => route.fulfill({ json: state }));
  await page.route('**/api/ibkr-workbench/quotes', route => route.fulfill({ json: [] }));
  await page.route('**/api/ibkr-workbench/logo?*', route => route.fulfill({ json: {} }));
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('http://127.0.0.1:5187/ibkr?tab=holdings');
  const card = page.getByRole('article', { name: '资产构成', exact: true });
  await expect(card.getByRole('img', { name: '账户资产金额构成' })).toBeVisible();
  await expect(card).toContainText('融资欠额');
  await expect(card).toContainText('总持有价值');
  await expect(card).toContainText('可融资额度');
  expect(model.heldValue).toBeCloseTo(1231592.48, 2);
  expect(model.financingDebt).toBeCloseTo(231897.09, 2);
  expect(model.heldValue - model.financingDebt + model.residual).toBeCloseTo(model.total, 2);
  await expect(card).toContainText('-231,897.09');
  expect(model.fundingTotal).toBeCloseTo(1232705.12, 2);
  expect(model.fundingSlices.map(row => row.label)).toEqual(['自有净值', '融资负债']);
  await expect(card).not.toContainText('暂无可绘制数据');
  await expect(card.getByRole('button', { name: /^现金余额/ })).toHaveCount(0);
  await expect(card.getByRole('button', { name: /^可融资额度/ })).toContainText('100.00');
  await card.getByRole('button', { name: /融资欠额/ }).focus();
  await expect(card.getByRole('img', { name: '账户资产金额构成' })).toContainText('231,897.09');
  await expect(card.getByRole('img', { name: '账户资产金额构成' })).toContainText('融资欠额');
  await card.screenshot({ path: 'output/ibkr/financed-assets.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(card.getByRole('img', { name: '账户资产金额构成' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('signed allocation supports zero or negative equity and still excludes incomplete data', () => {
  for (const total of ['0', '-100']) {
    const data = snapshot(); data.metrics.netLiquidation = total; data.cash[0].amount = String(Number(total) - 900);
    const model = holdingsAllocation(data);
    expect(model.signedAssets.reduce((sum, row) => sum + row.value, 0)).toBe(Number(total));
    expect(model.signedAssets.every(row => Number.isFinite(row.value))).toBe(true);
    data.positions[0].marketValue = null;
    expect(holdingsAllocation(data).signedAssets).toEqual([]);
  }
});


test('custom financing availability switches at negative cash without inventing missing values', () => {
  const data = snapshot(); data.metrics.buyingPower = '3000';
  expect(holdingsAllocation(data).financingAvailable).toBe(2000);
  data.cash[0].amount = '0';
  expect(holdingsAllocation(data).financingAvailable).toBe(2000);
  data.cash[0].amount = '-0.01';
  expect(holdingsAllocation(data).financingAvailable).toBe(3000);
  data.metrics.buyingPower = null;
  expect(holdingsAllocation(data).financingAvailable).toBeNull();
  data.metrics.buyingPower = '3000'; data.cash = [];
  expect(holdingsAllocation(data).financingAvailable).toBeNull();
});


test('donut arcs close once without wrapped dash fragments', () => {
  expect(donutArcPath(0, 1, 76).match(/ A/g)).toHaveLength(2);
  expect(donutArcPath(.9, .1, 76).match(/ A/g)).toHaveLength(1);
  expect(donutArcPath(.9, .1000000000001, 76)).toBe(donutArcPath(.9, .1, 76));
  expect(donutArcPath(1, 0, 76)).toBe('');
});
