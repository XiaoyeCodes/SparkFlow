import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { emptySnapshot } from '../../src/lib/ibkr/store';

const stock = { conId: 265598, symbol: 'AAPL', currency: 'USD', exchange: 'NASDAQ', name: 'Apple · 工程测试' };
const order = (changes: Record<string, unknown> = {}) => ({
  bodyHash: 'a'.repeat(64), submission: 'ACKNOWLEDGED', execution: 'OPEN', orderId: 123,
  filledQuantity: '0', averageFillPrice: null, dispatchState: 'SENT',
  intent: { accountKey: 'paper:receipt-test', clientIntentId: 'order:receipt-test', conId: stock.conId, side: 'BUY', quantity: '10', limitPrice: '323', orderType: 'LMT', tif: 'DAY' }, ...changes,
});

async function setup(page: Page, initial = order()) {
  const snapshot = { ...emptySnapshot('paper'), accountKey: 'paper:receipt-test', state: 'empty', connection: 'connected', snapshotId: 'fixture', testData: true, asOf: new Date().toISOString(), baseCurrency: 'USD', cash: [{ currency: 'USD', amount: '100000' }], metrics: { netLiquidation: '100000' } };
  const data = { source: 'gateway', gatewayMode: 'paper', snapshot, connection: { state: 'connected', detail: '工程测试数据', tools: [], accounts: [] }, quotes: [], evidence: [], alerts: [], reports: [], jobs: [], preferences: { maxAiCalls: 12 }, ai: { configured: false, enabled: false, fields: [] } };
  let current: any = { supportedOrderTypes: ['LMT', 'MKT'], enabled: true, available: true, account: 'DU***EST', accountKey: snapshot.accountKey, connection: 'connected', state: 'empty', detail: '工程测试', orders: [], policy: { conIds: [stock.conId], expiresAt: new Date(Date.now() + 3600000).toISOString(), limits: { feeReserve: '5', maxOrderNotional: '10000' } } };
  let row = initial, confirmations = 0, failStatus = false, failConfirm = false, release: (() => void) | undefined;
  let waitForConfirm: Promise<void> | undefined;
  await page.route('**/api/ibkr-workbench/state', route => route.fulfill({ json: data }));
  await page.route('**/api/ibkr-workbench/quotes', route => route.fulfill({ json: [] }));
  await page.route('**/api/ibkr-workbench/paper/**', async route => {
    const endpoint = new URL(route.request().url()).pathname.split('/').pop();
    if (endpoint === 'status') return failStatus ? route.fulfill({ status: 503, json: { error: 'status offline' } }) : route.fulfill({ json: current });
    if (endpoint === 'contract') return route.fulfill({ json: [stock] });
    if (endpoint === 'market-quote') return route.fulfill({ json: { ...stock, bid: '322.99', ask: '323', last: '323', state: 'reference', source: '工程测试', fetchedAt: new Date().toISOString(), bids: [], asks: [] } });
    if (endpoint === 'history') return route.fulfill({ json: { bars: [], source: '工程测试', note: '离线样本' } });
    if (endpoint === 'preview') return route.fulfill({ json: { ...stock, ...route.request().postDataJSON(), previewId: 'preview:receipt', bodyHash: row.bodyHash, expiresAt: new Date(Date.now() + 30000).toISOString(), accountKey: snapshot.accountKey, mode: 'paper', reservedCash: '3235', reservedNotional: '3230', warnings: [] } });
    if (endpoint === 'confirm') {
      confirmations++;
      expect(route.request().postDataJSON()).toEqual({ previewId: 'preview:receipt', bodyHash: row.bodyHash, explicit: true });
      if (waitForConfirm) await waitForConfirm;
      if (failConfirm) return route.abort('connectionreset');
      current = { ...current, orders: [row] };
      return route.fulfill({ json: row });
    }
    return route.fulfill({ status: 400, json: { error: `Unexpected ${endpoint}` } });
  });
  await page.goto('http://127.0.0.1:5187/ibkr?tab=orders');
  await expect(page.locator('.pt-stock-heading')).toContainText('AAPL');
  await page.getByLabel('限价（USD）').fill('323');
  return { count: () => confirmations, setRow: (changes: Record<string, unknown>) => { row = order(changes); current = { ...current, orders: [row] }; },
    failStatus: () => { failStatus = true; }, failConfirm: () => { failConfirm = true; },
    hold: () => { waitForConfirm = new Promise(resolve => { release = resolve; }); }, release: () => release?.(),
    switchAccount: () => { data.snapshot = { ...snapshot, accountKey: 'paper:other-test' }; current = { ...current, accountKey: 'paper:other-test', account: 'DU***NEW', orders: [] }; } };
}
async function preview(page: Page) {
  await page.getByRole('button', { name: '预览买入订单', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '确认模拟订单', exact: true })).toBeVisible();
}
async function submit(page: Page) {
  await preview(page);
  await page.getByRole('button', { name: '确认发送模拟订单', exact: true }).click();
  return page.getByRole('dialog', { name: '模拟订单回执', exact: true });
}

test('receipt automatically advances from a sent order through partial to full execution and can be reopened', async ({ page }) => {
  const fixture = await setup(page, order({ submission: 'SUBMITTING', execution: 'NONE' }));
  const receipt = await submit(page);
  await expect(receipt.getByRole('heading', { name: '订单发送成功' })).toBeVisible();
  await expect(receipt).toContainText('等待券商确认');
  await expect(receipt).toContainText('#123');
  await expect(receipt).toContainText('323.00 USD');
  await expect(receipt.getByRole('heading', { name: '交易成功' })).toHaveCount(0);
  fixture.setRow({ execution: 'PARTIAL', filledQuantity: '4', averageFillPrice: '322.5' });
  await expect(receipt.getByRole('heading', { name: '订单部分成交' })).toBeVisible({ timeout: 10000 });
  await expect(receipt).toContainText('4 / 10 股');
  fixture.setRow({ execution: 'FILLED', filledQuantity: '10', averageFillPrice: '322.6' });
  await expect(receipt.getByRole('heading', { name: '交易成功' })).toBeVisible({ timeout: 10000 });
  await expect(receipt).toContainText('322.60 USD');
  await expect(receipt).toContainText('10 / 10 股');
  await receipt.getByRole('button', { name: '关闭订单回执' }).click({ trial: true });
  await mkdir('output/ibkr', { recursive: true });
  await receipt.screenshot({ path: 'output/ibkr/order-receipt-filled.png' });
  await receipt.getByRole('button', { name: '查看订单记录' }).click();
  await expect(receipt).toHaveCount(0);
  await page.getByRole('button', { name: '查看回执', exact: true }).click();
  await expect(receipt.getByRole('heading', { name: '交易成功' })).toBeVisible();
  expect(fixture.count()).toBe(1);
  await page.keyboard.press('Escape');
  await expect(receipt).toHaveCount(0);
});

test('receipt replaces confirmation while sending and blocks duplicate submission', async ({ page }) => {
  const fixture = await setup(page);
  fixture.hold();
  await preview(page);
  await page.getByRole('button', { name: '确认发送模拟订单' }).evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
  const receipt = page.getByRole('dialog', { name: '模拟订单回执' });
  await expect(receipt.getByRole('heading', { name: '正在发送订单' })).toBeVisible();
  await expect(page.getByRole('dialog', { name: '确认模拟订单' })).toHaveCount(0);
  await expect(receipt.getByRole('button', { name: '查看订单记录' })).toBeDisabled();
  fixture.release();
  await expect(receipt.getByRole('heading', { name: '订单发送成功' })).toBeVisible();
  await expect(receipt).toContainText('券商已受理');
  expect(fixture.count()).toBe(1);
});

for (const scenario of [
  { name: 'rejected', row: { execution: 'REJECTED', lastError: 'IBKR 拒绝订单：资金不足' }, title: '订单未获受理' },
  { name: 'unknown', row: { execution: 'NONE', submission: 'UNKNOWN', dispatchState: 'UNKNOWN' }, title: '发送结果待核对' },
]) test(`${scenario.name} receipt does not claim a successful send or trade`, async ({ page }) => {
  await setup(page, order(scenario.row));
  const receipt = await submit(page);
  await expect(receipt.getByRole('heading', { name: scenario.title })).toBeVisible();
  await expect(receipt.getByRole('heading', { name: '交易成功' })).toHaveCount(0);
  await expect(receipt.getByRole('heading', { name: '订单发送成功' })).toHaveCount(0);
  if (scenario.name === 'rejected') await expect(receipt).toContainText('资金不足');
});

test('a refresh error preserves the sent order receipt and never repeats confirmation', async ({ page }) => {
  const fixture = await setup(page);
  const receipt = await submit(page);
  await expect(receipt.getByRole('heading', { name: '订单发送成功' })).toBeVisible();
  fixture.failStatus();
  await expect(receipt).toContainText('保留上次回执', { timeout: 10000 });
  await expect(receipt).toContainText('#123');
  await expect(receipt.getByRole('heading', { name: '订单发送成功' })).toBeVisible();
  expect(fixture.count()).toBe(1);
});

test('a lost confirmation response shows an uncertain receipt without retrying the order', async ({ page }) => {
  const fixture = await setup(page); fixture.failConfirm();
  const receipt = await submit(page);
  await expect(receipt.getByRole('heading', { name: '发送结果待核对' })).toBeVisible();
  await expect(receipt).toContainText('请勿重复发送');
  await receipt.getByRole('button', { name: '刷新回执', exact: true }).click();
  expect(fixture.count()).toBe(1);
});

test('receipt fits a narrow viewport and missing fill prices are not invented', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page, order({ execution: 'FILLED', filledQuantity: '10' }));
  const receipt = await submit(page);
  await expect(receipt.getByRole('heading', { name: '交易成功' })).toBeVisible();
  await expect(receipt.locator('.pt-receipt-details>div').filter({ hasText: '成交均价' })).toContainText('待回报');
  const bounds = await receipt.boundingBox();
  expect(bounds!.width).toBeLessThanOrEqual(390);
  expect(bounds!.height).toBeLessThanOrEqual(844);
  const detailLayout = await receipt.locator('.pt-receipt-details').evaluate(details => ({
    width: details.getBoundingClientRect().width,
    rows: Array.from(details.children, row => row.getBoundingClientRect().width),
  }));
  for (const width of detailLayout.rows) expect(width).toBeCloseTo(detailLayout.width, 0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await mkdir('output/ibkr', { recursive: true });
  await receipt.screenshot({ path: 'output/ibkr/order-receipt-mobile.png' });
});

test('switching accounts clears the receipt and prevents old account data from reappearing', async ({ page }) => {
  const fixture = await setup(page);
  const receipt = await submit(page);
  await expect(receipt.getByRole('heading', { name: '订单发送成功' })).toBeVisible();
  fixture.switchAccount();
  await expect(receipt).toHaveCount(0, { timeout: 10000 });
  await expect(page.locator('.pt-account-strip')).toContainText('DU***NEW');
  expect(fixture.count()).toBe(1);
});
