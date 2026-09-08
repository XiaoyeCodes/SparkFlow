import { test, expect } from '@playwright/test';
import { emptySnapshot } from '../../src/lib/ibkr/store';
import type { WorkbenchState } from '../../src/lib/ibkr/workbenchTypes';

function fixture(values: Array<string | null>): WorkbenchState {
  return {
    source: 'mcp', connection: { state: 'connected', detail: '图表测试', tools: [], accounts: [] },
    snapshot: { ...emptySnapshot('live'), snapshotId: 'pnl-chart-test', accountKey: 'live:test', connection: 'connected', state: 'ready', baseCurrency: 'USD', source: 'fixture', testData: true,
      positions: values.map((pnl, index) => ({ accountKey: 'live:test', conId: index + 1, symbol: ['MSFT', 'NVDA', 'AMZN', 'TSLA', 'MCD', 'AAPL'][index] ?? `TEST${index}`, currency: 'USD', quantity: '1', averageCost: '10', marketValue: '10', unrealizedPnl: pnl, assetType: 'STK', exchange: 'NASDAQ', name: '测试持仓' })),
      metrics: { netLiquidation: '1000' }, cash: [] },
    quotes: [], evidence: [], alerts: [], reports: [], jobs: [],
    preferences: { horizon: 'both', targetWeight: null, cashFloor: null, maxDrawdown: null, daily: true, eventAnalysis: true, maxAutomatic: 4, cooldownMinutes: 60, maxAiCalls: 12 },
    ai: { provider: 'fixture', model: 'test', fingerprint: 'test', configured: true, enabled: false, fields: [], usedToday: 0 }, nextSyncAt: null, calendarSupported: true,
  };
}

test('PnL proportions include zero and missing holdings; signed bars share one scale and preserve detail navigation', async ({ page }) => {
  const data = fixture(['0.27', '0.18', '0.05', '-0.14', '-0.11', '-0.10', '0', null]);
  data.snapshot.positions.push({ ...data.snapshot.positions[0], conId: 99, symbol: 'HKTEST', currency: 'HKD', unrealizedPnl: '-10' });
  await page.route('**/api/ibkr-workbench/state', r => r.fulfill({ json: data }));
  await page.route('**/api/ibkr-workbench/quotes', r => r.fulfill({ json: [] }));
  await page.route('**/api/ibkr-workbench/history?*', r => r.fulfill({ json: { bars: [] } }));
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('http://127.0.0.1:5187/ibkr?tab=overview');
  const panel = page.locator('.awb-pnl-chart-panel');
  await expect(panel.getByRole('img')).toHaveAttribute('aria-label', '盈利 3 个，占 37.5%；亏损 3 个，占 37.5%；持平 1 个，占 12.5%；缺失 1 个，占 12.5%');
  await expect(panel.locator('.awb-pnl-bar-row')).toHaveCount(8);
  const bars = await panel.locator('.awb-pnl-track i').evaluateAll(nodes => nodes.map(n => ({ width: (n as HTMLElement).style.width, left: (n as HTMLElement).style.left })));
  expect(parseFloat(bars[0].width)).toBe(50);
  expect(parseFloat(bars[1].width)).toBeCloseTo(0.18 / 0.27 * 50);
  expect(parseFloat(bars[6].width)).toBeCloseTo(0.14 / 0.27 * 50);
  expect(parseFloat(bars[6].left) + parseFloat(bars[6].width)).toBeCloseTo(50);
  await expect(panel.locator('.awb-pnl-bar-row').last().locator('b')).toHaveText('缺失');
  await panel.screenshot({ path: 'tmp/pnl-chart-qa/fixture-desktop.png' });
  await panel.getByRole('button', { name: /^MSFT，/ }).click();
  await expect(page.getByRole('dialog', { name: 'MSFT 持仓详情' })).toBeVisible();
  await page.keyboard.press('Escape');
  await panel.getByRole('combobox').selectOption('HKD');
  await expect(panel.locator('.awb-pnl-ratios .awb-pnl-loss strong')).toHaveText('100.0%');
  await expect(panel.locator('.awb-pnl-bar-row')).toHaveCount(1);
  await panel.getByRole('combobox').selectOption('USD');
  for (const width of [1600, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await panel.scrollIntoViewIfNeeded();
    const clipped = await panel.locator('.awb-pnl-bar-row').evaluateAll(nodes => nodes.some(n => n.scrollWidth > n.clientWidth));
    expect(clipped).toBe(false);
    await panel.screenshot({ path: `tmp/pnl-chart-qa/fixture-${width}.png` });
  }
});

test('PnL empty, flat, missing, tiny and long lists retain honest labels and all rows', async ({ page }) => {
  let data = fixture([]);
  await page.route('**/api/ibkr-workbench/state', r => r.fulfill({ json: data }));
  await page.route('**/api/ibkr-workbench/quotes', r => r.fulfill({ json: [] }));
  const panel = page.locator('.awb-pnl-chart-panel');
  for (const values of [[], ['0', '0'], [null, null], ['-0.001', '0.002'], Array.from({ length: 30 }, (_, i) => String(i - 15))]) {
    data = fixture(values);
    await page.goto('http://127.0.0.1:5187/ibkr?tab=overview');
    await expect(panel.locator('.awb-pnl-bar-row')).toHaveCount(values.length);
    if (!values.length) await expect(panel.getByText('暂无持仓，盈亏比例待生成。')).toBeVisible();
    if (values[0] === '0') await expect(panel.getByRole('img')).toHaveAttribute('aria-label', /持平 2 个，占 100.0%/);
    if (values[0] === null) await expect(panel.getByRole('img')).toHaveAttribute('aria-label', /缺失 2 个，占 100.0%/);
    if (values[0] === '-0.001') await expect(panel.locator('.awb-pnl-bar-row b')).toHaveText(['+0.002', '-0.001']);
    expect(await panel.locator('[style*="NaN"], [style*="Infinity"]').count()).toBe(0);
  }
});
