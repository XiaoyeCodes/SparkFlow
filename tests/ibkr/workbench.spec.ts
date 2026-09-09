import { test, expect } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import { emptySnapshot } from '../../src/lib/ibkr/store';
import type { AnalysisReport, WorkbenchState } from '../../src/lib/ibkr/workbenchTypes';
import { paginateAccountPositions, sortAccountPositionsByWeight } from '../../src/lib/ibkr/exportAccountPdf';

const state = (connected = false): WorkbenchState => ({ source: 'mcp', gatewayMode: 'live', connection: { state: connected ? 'connected' : 'unconfigured', detail: connected ? '离线界面测试数据' : '连接 IBKR 后读取真实持仓。', tools: [], accounts: [] },
  snapshot: { ...emptySnapshot('live'), ...(connected ? { snapshotId: 'test-snapshot', accountKey: 'live:ui-test', connection: 'connected' as const, state: 'ready' as const, baseCurrency: 'USD', asOf: new Date().toISOString(), testData: true, source: 'fixture' as const, metrics: { netLiquidation: '125000', unrealizedPnl: '8500', buyingPower: '40000', maintenanceMargin: '12000' }, cash: [{ currency: 'USD', amount: '18000' }], positions: [{ accountKey: 'live:ui-test', conId: 1, symbol: 'AAPL', currency: 'USD', quantity: '100', averageCost: '180', marketValue: '21000', unrealizedPnl: '3000', assetType: 'STK', exchange: 'NASDAQ', name: 'Apple · 工程测试', sector: 'Technology', industry: 'Consumer Electronics', instrumentType: 'STK' }] } : {}) },
  quotes: connected ? [{ conId: 1, symbol: 'AAPL', price: 212, changePercent: 1.2, asOf: '2026-09-04T20:00:00Z', fetchedAt: new Date().toISOString(), source: '东方财富', status: 'delayed', currency: 'USD', sourceUrl: 'https://example.com' }] : [], evidence: [], alerts: [], reports: [], jobs: [], preferences: { horizon: 'both', targetWeight: null, cashFloor: null, maxDrawdown: null, daily: true, eventAnalysis: true, maxAutomatic: 4, cooldownMinutes: 60, maxAiCalls: 12 }, ai: { provider: 'fixture', model: 'test-model', fingerprint: 'test-only', configured: true, enabled: false, fields: ['脱敏持仓', '现金', '风险指标'], usedToday: 0 }, nextSyncAt: null, calendarSupported: true });

test('account PDF pagination preserves every holding', () => {
  const fixture = state(true).snapshot.positions[0];
  const positions = Array.from({ length: 30 }, (_, index) => ({ ...fixture, conId: index + 1, symbol: `TEST${index + 1}` }));
  const pages = paginateAccountPositions(positions);
  expect(pages.map(page => page.length)).toEqual([12, 14, 4]);
  expect(pages.flat().map(position => position.symbol)).toEqual(positions.map(position => position.symbol));
});

test('account PDF sorts weights across pages without changing the account snapshot', () => {
  const fixture = state(true).snapshot.positions[0];
  const positions = ['10', '90', '30', '80', '50', '70', '20', '60', '40', '0', '-5', ''].map((marketValue, index) => ({ ...fixture, conId: index, marketValue }));
  positions.push({ ...fixture, conId: 12, currency: 'HKD', marketValue: '9999' });
  const original = positions.map(position => position.conId);
  const pages = paginateAccountPositions(sortAccountPositionsByWeight(positions, 1000, 'USD'));
  expect(pages.map(page => page.map(position => position.conId))).toEqual([[1, 3, 5, 7, 4, 8, 2, 6, 0, 9, 10, 11], [12]]);
  expect(positions.map(position => position.conId)).toEqual(original);
  expect(sortAccountPositionsByWeight(positions, null, 'USD').map(position => position.conId)).toEqual(original);
});

test('holdings JSON export contains an AI prompt and excludes account identity and unrelated account data', async ({ page }) => {
  const data = state(true);
  data.snapshot.accountKey = 'live:private-account-key';
  data.snapshot.positions.push({
    ...data.snapshot.positions[0], conId: 2, accountKey: 'live:private-account-key', symbol: 'HKTEST', name: '香港测试持仓',
    currency: 'HKD', quantity: '2.5', averageCost: null, marketValue: null, unrealizedPnl: null, dailyPnl: null,
  });
  await page.route('**/api/ibkr-workbench/state', route => route.fulfill({ json: data }));
  await page.route('**/api/ibkr-workbench/quotes', route => route.fulfill({ json: [] }));
  await page.goto('http://127.0.0.1:5187/ibkr?tab=holdings');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 JSON', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^SparkFlow-持仓-AI分析-\d{4}-\d{2}-\d{2}\.json$/);
  const path = await download.path();
  expect(path).not.toBeNull();
  const raw = await readFile(path!, 'utf8');
  const payload = JSON.parse(raw);
  expect(payload.format).toBe('sparkflow-ai-holdings-v1');
  expect(payload.holding_count).toBe(2);
  expect(payload.prompt).toContain('按 currency 分组');
  expect(payload.prompt).toContain('不要虚构实时行情');
  expect(payload.holdings[0]).toMatchObject({ symbol: 'AAPL', currency: 'USD', quantity: 100, average_cost: 180, market_value: 21000, unrealized_pnl: 3000 });
  expect(payload.holdings[1]).toMatchObject({ symbol: 'HKTEST', currency: 'HKD', quantity: 2.5, average_cost: null, market_value: null, unrealized_pnl: null });
  expect(raw).not.toContain('private-account-key');
  expect(raw).not.toContain('buyingPower');
  expect(raw).not.toContain('netLiquidation');
  expect(payload).not.toHaveProperty('cash');
  expect(payload).not.toHaveProperty('quotes');
});

test('holding logos load automatically when a new holding arrives', async ({ page }) => {
  const data = state(true);
  const lookups: string[] = [];
  await page.route('**/api/ibkr-workbench/state', r => r.fulfill({ json: data }));
  await page.route('**/api/ibkr-workbench/quotes', r => r.fulfill({ json: data.quotes }));
  await page.route('**/api/ibkr-workbench/logo?*', r => {
    const url = new URL(r.request().url());
    if (url.searchParams.get('image') === '1') return r.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="12" fill="green"/></svg>' });
    expect([...url.searchParams.keys()].sort()).toEqual(['assetType', 'currency', 'exchange', 'symbol']);
    const symbol = url.searchParams.get('symbol')!; lookups.push(symbol);
    return r.fulfill({ json: { src: symbol === 'AAPL' ? '/stock-logos/us-AAPL.svg' : `${url.pathname}${url.search}&image=1` } });
  });
  await page.goto('http://127.0.0.1:5187/ibkr');
  await expect(page.locator('.awb-company-icon.has-logo img')).toHaveCount(1);
  data.snapshot.positions.push({ ...data.snapshot.positions[0], conId: 2, symbol: 'NEWCO' });
  await expect(page.locator('.awb-company-icon.has-logo img')).toHaveCount(2, { timeout: 10000 });
  expect(lookups).toEqual(['AAPL', 'NEWCO']);
  await page.screenshot({ path: 'tmp/workbench-qa/holding-logos.png', fullPage: true });
});

test('broken holding logo keeps initials and does not retry on every account poll', async ({ page }) => {
  const data = state(true); let lookups = 0; let polls = 0;
  await page.route('**/api/ibkr-workbench/state', r => { polls++; return r.fulfill({ json: data }); });
  await page.route('**/api/ibkr-workbench/quotes', r => r.fulfill({ json: data.quotes }));
  await page.route('**/api/ibkr-workbench/logo?*', r => { lookups++; return r.fulfill({ json: { src: '/stock-logos/missing.svg' } }); });
  await page.route('**/stock-logos/missing.svg', r => r.fulfill({ status: 404 }));
  await page.goto('http://127.0.0.1:5187/ibkr');
  await expect.poll(() => lookups).toBe(1);
  await expect(page.locator('.awb-company-icon img')).toHaveCount(0);
  await expect(page.locator('.awb-company-icon')).toHaveText('AA');
  await expect.poll(() => polls, { timeout: 10000 }).toBeGreaterThan(1);
  expect(lookups).toBe(1);
});

test('new account workbench starts empty, exposes model consent and removes legacy terminal access', async ({ page }) => {
  await page.route('**/api/ibkr-workbench/state', route => route.fulfill({ json: state() }));
  await page.goto('http://127.0.0.1:5187/ibkr');
  await expect(page.getByTestId('ibkr-workbench')).toBeVisible();
  await expect(page.getByRole('button', { name: '导出 PDF' })).toBeDisabled();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(page.getByRole('button', { name: '连接 IBKR', exact: true })).toBeVisible();
  await expect(page.getByText('test-model', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '同意发送上述字段并开启 AI' })).toBeDisabled();
  await expect(page.getByRole('button', { name: '原交易终端' })).toHaveCount(0);
  await page.goto('http://127.0.0.1:5187/ibkr?terminal=legacy');
  await expect(page.getByTestId('ibkr-workbench')).toBeVisible();
  await expect(page.getByTestId('ibkr-terminal')).toHaveCount(0);
});

test('holding details keep independent quote and book value; drawer closes with Escape', async ({ page }) => {
  const data = state(true);
  await page.route('**/api/ibkr-workbench/state', route => route.fulfill({ json: data }));
  await page.route('**/api/ibkr-workbench/quotes', route => route.fulfill({ json: data.quotes }));
  await page.route('**/api/ibkr-workbench/history?*', route => route.fulfill({ json: { bars: [{ time: '2026-09-03', close: 200 }, { time: '2026-09-04', close: 212 }] } }));
  await page.goto('http://127.0.0.1:5187/ibkr');
  await page.getByRole('button',{name:'持仓',exact:true}).click();
  await expect(page.getByText('Apple · 工程测试 · 消费电子', { exact: true })).toBeVisible();
  await expect(page.locator('.awb-chat, .awb-footer')).toHaveCount(0);
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 PDF', exact: true }).click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toMatch(/\.pdf$/);
  expect(await download.failure()).toBe(null);
  await expect(page.getByRole('cell', { name: '21,000.00 USD' })).toBeVisible();
  await expect(page.getByRole('cell', { name: /212.00/ })).toBeVisible();
  await page.locator('.awb-holdings').getByRole('button', { name: /AAPL/ }).click();
  await expect(page.getByRole('dialog', { name: 'AAPL 持仓详情' })).toBeVisible();
  await expect(page.getByText('Apple · 工程测试 · 科技 · 消费电子', { exact: true })).toBeVisible();
  await expect(page.getByRole('img', { name: 'AAPL 历史收盘价曲线' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('holdings support ascending and descending numeric column sorting', async ({ page }) => {
  const data = state(true);
  data.snapshot.positions = [
    { ...data.snapshot.positions[0], conId: 1, symbol: 'AAPL', quantity: '100', marketValue: '21000', unrealizedPnl: '3000' },
    { ...data.snapshot.positions[0], conId: 2, symbol: 'AMD', quantity: '20', marketValue: '4000', unrealizedPnl: '-200' },
    { ...data.snapshot.positions[0], conId: 3, symbol: 'GOOG', quantity: '50', marketValue: '10000', unrealizedPnl: '750' },
  ];
  await page.route('**/api/ibkr-workbench/state', route => route.fulfill({ json: data }));
  await page.route('**/api/ibkr-workbench/quotes', route => route.fulfill({ json: [] }));
  await page.goto('http://127.0.0.1:5187/ibkr');
  await page.getByRole('button', { name: '持仓', exact: true }).click();
  const rows = page.locator('.awb-holdings tbody tr');
  await page.getByRole('button', { name: '按市值升序排序' }).click();
  await expect(rows.first()).toContainText('AMD');
  await expect(page.locator('th[aria-sort="ascending"]')).toContainText('市值');
  await page.getByRole('button', { name: '按市值降序排序' }).click();
  await expect(rows.first()).toContainText('AAPL');
  await expect(page.locator('th[aria-sort="descending"]')).toContainText('市值');
});

test('authorized connection failure is distinct from logged out and an existing session can retry without another login', async ({ page }) => {
  const data = state(); data.connection.authorized = true; data.connection.state = 'error';
  data.connection.detail = 'IBKR 已授权，持仓工具正在适配。';
  await page.route('**/api/ibkr-workbench/state', route => route.fulfill({ json: data }));
  await page.route('**/api/ibkr-workbench/connect', route => route.fulfill({ json: { state: 'connected', detail: '现有授权有效' } }));
  let synced = false;
  await page.route('**/api/ibkr-workbench/sync', route => { synced = true; return route.fulfill({ json: state(true) }); });
  await page.goto('http://127.0.0.1:5187/ibkr');
  await expect(page.getByText('已授权 · 持仓待同步', { exact: true })).toBeVisible();
  await expect(page.getByText('IBKR 已授权，持仓尚未同步', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '重新连接 IBKR', exact: true }).click();
  await expect.poll(() => synced).toBe(true);
  await expect(page.getByText('无法获取授权地址', { exact: true })).toHaveCount(0);
});

test('account settings submit only chosen preferences and consent fingerprint', async ({ page }) => {
  const data = state(true); let sent: unknown;
  await page.route('**/api/ibkr-workbench/state', route => route.fulfill({ json: data }));
  await page.route('**/api/ibkr-workbench/quotes', route => route.fulfill({ json: data.quotes }));
  await page.route('**/api/ibkr-workbench/preferences', route => { sent = route.request().postDataJSON(); return route.fulfill({ json: { ok: true } }); });
  await page.goto('http://127.0.0.1:5187/ibkr');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByLabel('单标的目标仓位上限').fill('25');
  await page.getByRole('button', { name: '保存偏好' }).click();
  await expect.poll(() => (sent as any)?.targetWeight).toBe(0.25);
  expect((sent as any)?.cashFloor).toBe(null);
});

for (const scenario of [
  { state: 'unconfigured', connected: false, phase: 'disconnected', title: '尚未连接 IBKR', badge: '未连接' },
  { state: 'connecting', connected: false, phase: 'connecting', title: '正在建立安全连接', badge: '连接中' },
  { state: 'connected', connected: true, phase: 'connected', title: 'IBKR 已连接', badge: '已连接' },
]) {
  test(`connection console clearly renders the ${scenario.phase} state`, async ({ page }) => {
    const data = state(scenario.connected);
    data.connection.state = scenario.state;
    await page.setViewportSize({ width: 1100, height: 800 });
    await page.route('**/api/ibkr-workbench/state', route => route.fulfill({ json: data }));
    await page.route('**/api/ibkr-workbench/quotes', route => route.fulfill({ json: data.quotes }));
    await page.goto('http://127.0.0.1:5187/ibkr?tab=settings');
    const console = page.locator('.awb-connection-console');
    await expect(console).toHaveAttribute('data-connection-state', scenario.phase);
    await expect(console.getByText(scenario.title, { exact: true })).toBeVisible();
    await expect(console.locator('.awb-connection-badge')).toHaveText(scenario.badge);
    if (scenario.phase === 'connecting') await expect(console.getByRole('button', { name: '正在连接 IBKR…' })).toBeDisabled();
    await mkdir('tmp/workbench-qa', { recursive: true });
    await console.screenshot({ path: `tmp/workbench-qa/connection-${scenario.phase}.png` });
  });
}

test('gateway settings quietly auto-detect until connected and then stop polling', async ({ page }) => {
  const data = state();
  data.source = 'gateway';
  data.connection.state = 'unconfigured';
  data.connection.detail = '未检测到 SparkFlow 本地桥接服务。';
  const probes: number[] = [];
  await page.route('**/api/ibkr-workbench/state', route => route.fulfill({ json: data }));
  await page.route('**/api/ibkr-workbench/quotes', route => route.fulfill({ json: [] }));
  await page.route('**/api/ibkr-workbench/sync', async route => {
    probes.push(Date.now());
    await new Promise(resolve => setTimeout(resolve, 800));
    if (probes.length >= 2) {
      const connected = state(true);
      Object.assign(data, connected, { source: 'gateway' });
      data.connection.port = 18765;
      data.connection.detail = '本机只读账户通道工作正常。';
    }
    await route.fulfill({ json: data });
  });
  await page.goto('http://127.0.0.1:5187/ibkr?tab=settings');
  const console = page.locator('.awb-connection-console');
  await expect.poll(() => probes.length, { timeout: 5000 }).toBeGreaterThanOrEqual(2);
  expect(probes[1] - probes[0]).toBeGreaterThanOrEqual(1900);
  await expect(console).toHaveAttribute('data-connection-state', 'connected');
  await expect(console.getByText('实盘 Gateway 已连接', { exact: true })).toBeVisible();
  await expect(console.locator('.awb-connection-badge')).toHaveText('已连接');
  await expect(console.getByText('连接成功，自动检测已停止', { exact: true })).toBeVisible();
  await expect(console.getByText('BRIDGE · 127.0.0.1:18765', { exact: true })).toBeVisible();
  const count = probes.length;
  await page.waitForTimeout(2300);
  expect(probes).toHaveLength(count);
  await page.getByRole('button', { name: '账户总览', exact: true }).click();
  await page.waitForTimeout(2300);
  expect(probes).toHaveLength(count);
});

test('gateway scanning keeps the actual API mismatch visible', async ({ page }) => {
  const data = state(); data.source = 'gateway'; data.gatewayMode = 'live'; data.connection.state = 'disconnected';
  data.connection.detail = '已发现 IBKR API（端口 45122），但未返回当前绑定的实盘账户。';
  await page.route('**/api/ibkr-workbench/state', route => route.fulfill({ json: data }));
  await page.route('**/api/ibkr-workbench/sync', route => route.fulfill({ json: data }));
  await page.route('**/api/ibkr-workbench/quotes', route => route.fulfill({ json: [] }));
  await page.goto('http://127.0.0.1:5187/ibkr?tab=settings');
  const console = page.locator('.awb-connection-console');
  await expect(console).toHaveAttribute('data-connection-state', 'connecting');
  await expect(console.getByText(data.connection.detail, { exact: true })).toBeVisible();
  await expect(console.getByRole('button', { name: '智能连接', exact: true })).toBeEnabled();
});

test('gateway actions place smart connect on the left and manual sync on the right', async ({ page }) => {
  const data = state(); data.source = 'gateway'; data.connection.state = 'unconfigured'; data.connection.port = 18765;
  let smartConnects = 0;
  await page.route('**/api/ibkr-workbench/state', route => route.fulfill({ json: data }));
  await page.route('**/api/ibkr-workbench/quotes', route => route.fulfill({ json: [] }));
  await page.route('**/api/ibkr-workbench/sync', route => route.fulfill({ json: data }));
  await page.route('**/api/ibkr-workbench/gateway-connect', route => { smartConnects += 1; return route.fulfill({ json: data }); });
  await page.goto('http://127.0.0.1:5187/ibkr?tab=settings');
  const smart = page.getByRole('button', { name: '智能连接', exact: true });
  const manual = page.getByRole('button', { name: '立即检测并同步', exact: true });
  const [smartBox, manualBox] = await Promise.all([smart.boundingBox(), manual.boundingBox()]);
  expect(smartBox!.x).toBeLessThan(manualBox!.x);
  await smart.click();
  await expect.poll(() => smartConnects).toBe(1);
});

test('paper trading page is honest while Gateway API remains readonly', async ({ page }) => {
  const data = state(true); data.source = 'gateway'; data.gatewayMode = 'paper'; data.snapshot.mode = 'paper'; data.snapshot.accountKey = 'paper:ui-test';
  await page.route('**/api/ibkr-workbench/state', route => route.fulfill({ json: data }));
  await page.route('**/api/ibkr-workbench/quotes', route => route.fulfill({ json: [] }));
  await page.route('**/api/ibkr-workbench/paper/status', route => route.fulfill({ json: { enabled: false, available: false, account: 'DU***EST', accountKey: 'paper:ui-test', policy: null, orders: [], connection: 'connected', state: 'ready', detail: 'paper snapshot' } }));
  await page.goto('http://127.0.0.1:5187/ibkr?tab=orders');
  await expect(page.getByRole('heading', { name: '模拟盘当前仍是只读连接' })).toBeVisible();
  await expect(page.locator('.awb-paper-setup')).toContainText('取消勾选“只读 API”');
  await expect(page.getByRole('button', { name: '开启本次模拟盘交易' })).toHaveCount(0);
});

test('paper policy form requires user limits and sends an explicit bounded scope', async ({ page }) => {
  const data = state(true); data.source = 'gateway'; data.gatewayMode = 'paper'; data.snapshot.mode = 'paper'; data.snapshot.accountKey = 'paper:ui-test';
  const baseStatus = { enabled: false, available: true, account: 'DU***EST', accountKey: 'paper:ui-test', policy: null, orders: [], connection: 'connected', state: 'ready', detail: 'paper snapshot' };
  let configured: any;
  await page.route('**/api/ibkr-workbench/state', route => route.fulfill({ json: data }));
  await page.route('**/api/ibkr-workbench/quotes', route => route.fulfill({ json: [] }));
  await page.route('**/api/ibkr-workbench/paper/status', route => route.fulfill({ json: baseStatus }));
  await page.route('**/api/ibkr-workbench/paper/contract', route => route.fulfill({ json: [{ conId: 265598, symbol: 'AAPL', currency: 'USD', exchange: 'NASDAQ', name: 'Apple Inc.' }] }));
  await page.route('**/api/ibkr-workbench/paper/configure', route => { configured = route.request().postDataJSON(); return route.fulfill({ json: { ...baseStatus, enabled: true, policy: { conIds: [265598], expiresAt: configured.expiresAt } } }); });
  await page.goto('http://127.0.0.1:5187/ibkr?tab=orders');
  await expect(page.getByRole('button', { name: '开启本次模拟盘交易' })).toBeDisabled();
  await page.getByLabel('搜索模拟盘合约').fill('AAPL'); await page.getByRole('button', { name: '查询 IBKR 合约' }).click(); await page.getByRole('button', { name: /AAPL.*Apple/ }).click();
  for (const [label,value] of [['单笔最大名义金额','500'],['账户最大总敞口','5000'],['单一标的最大权重','30'],['当日最大亏损','200'],['每日最大订单数','5'],['每分钟最大订单数','1'],['限价偏离行情上限','2'],['手续费预留','2']] as const) await page.getByLabel(label).fill(value);
  await page.getByRole('button', { name: '开启本次模拟盘交易' }).click();
  await expect.poll(()=>configured?.conIds).toEqual([265598]);
  expect(configured.explicit).toBe(true); expect(configured.limits.maxSymbolWeight).toBe('0.3'); expect(configured.limits.maxPriceDeviation).toBe('0.02');
  await expect(page.getByRole('heading', { name: '1. 新订单' })).toBeVisible();
});

test('strategy backtest saves an immutable user rule and runs only after complete data acknowledgement', async ({ page }) => {
  const data = state(true); let saved: any; let run: any; let strategies: any[] = [];
  const record = (definition: any) => ({ definition, strategyHash: 'a'.repeat(64), createdAt: '2026-09-09T12:00:00Z' });
  await page.route('**/api/ibkr-workbench/state', route => route.fulfill({ json: data }));
  await page.route('**/api/ibkr-workbench/quotes', route => route.fulfill({ json: data.quotes }));
  await page.route('**/api/ibkr-workbench/backtests/strategies', route => {
    if (route.request().method() === 'POST') { saved = route.request().postDataJSON(); strategies = [record(saved)]; return route.fulfill({ json: strategies[0] }); }
    return route.fulfill({ json: strategies });
  });
  await page.route('**/api/ibkr-workbench/backtests/jobs', route => route.fulfill({ json: [] }));
  await page.route('**/api/ibkr-workbench/backtests/runs', route => route.fulfill({ json: [] }));
  await page.route('**/api/ibkr-workbench/backtests/run', route => { run = route.request().postDataJSON(); return route.fulfill({ status: 202, json: { jobId: 'backtest:1234567890abcdef1234567890abcdef', state: 'PENDING', createdAt: '2026-09-09T12:00:00Z', updatedAt: '2026-09-09T12:00:00Z', testData: false } }); });
  await page.goto('http://127.0.0.1:5187/ibkr?tab=backtests');
  await expect(page.getByTestId('backtest-workspace')).toBeVisible();
  await expect(page.getByText('结构化回测不会发送订单')).toBeVisible();
  await page.getByRole('button', { name: '保存不可变版本' }).click();
  expect(saved).toMatchObject({ strategyId: 'user:my-sma', version: '1.0.0', origin: 'user', universe: [1], signal: { kind: 'sma_cross', fastWindow: 5, slowWindow: 20 }, risk: { allowShort: false } });
  expect(saved).not.toHaveProperty('code');
  const bars = Array.from({ length: 21 }, (_, index) => ({ timestamp: `2026-01-${String(index + 1).padStart(2, '0')}T14:30:00Z`, open: String(100 + index), high: String(101 + index), low: String(99 + index), close: String(100 + index), volume: '1000', splitRatio: null, dividendPerShare: '0' }));
  await page.getByLabel('上传回测数据').setInputFiles({ name: 'bars.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bars)) });
  const start = page.getByRole('button', { name: '启动可复现回测' });
  await expect(start).toBeDisabled();
  await page.getByText('我确认数据中的拆分比例和每股分红完整').click();
  await expect(start).toBeEnabled();
  await start.click();
  expect(run).toMatchObject({ strategyId: 'user:my-sma', strategyVersion: '1.0.0', initialCash: '100000', corporateActionsComplete: true });
  expect(run.bars).toHaveLength(21);
  expect(run.bars[0]).toEqual(bars[0]);
  expect(run).not.toHaveProperty('signals');
  expect(JSON.stringify(run)).not.toContain('ibkr.historicalData');
});

test('connection settings select an explicit paper Gateway without presenting it as live', async ({ page }) => {
  const data = state();
  let selected: unknown;
  await page.route('**/api/ibkr-workbench/state', route => route.fulfill({ json: data }));
  await page.route('**/api/ibkr-workbench/quotes', route => route.fulfill({ json: [] }));
  await page.route('**/api/ibkr-workbench/source', route => {
    selected = route.request().postDataJSON();
    data.source = 'gateway';
    data.gatewayMode = 'paper';
    data.connection.state = 'connected';
    data.snapshot = { ...data.snapshot, mode: 'paper', accountKey: 'paper:ui-test', connection: 'connected', state: 'empty', snapshotId: 'paper-snapshot', asOf: new Date().toISOString() };
    return route.fulfill({ json: { ok: true } });
  });
  await page.route('**/api/ibkr-workbench/sync', route => route.fulfill({ json: data }));
  await page.goto('http://127.0.0.1:5187/ibkr?tab=settings');

  await expect(page.getByRole('button', { name: /IB Gateway 模拟盘/ })).toBeVisible();
  await page.getByRole('button', { name: /IB Gateway 模拟盘/ }).click();
  await expect.poll(() => selected).toEqual({ source: 'gateway', gatewayMode: 'paper' });
  await expect(page.getByRole('button', { name: /IB Gateway 模拟盘/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('模拟盘 Gateway 已连接', { exact: true })).toBeVisible();
  await expect(page.getByText('PAPER GATEWAY', { exact: true })).toBeVisible();
  const paperConsole = page.locator('.awb-connection-console');
  await expect(paperConsole).toHaveClass(/is-paper/);
  await expect.poll(() => paperConsole.evaluate(element => getComputedStyle(element).getPropertyValue('--connection-accent').trim())).toBe('#e2b55e');
});

for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
  test(`authorized account selector uses the rounded terminal treatment at ${viewport.width}px`, async ({ page }) => {
    const data = state(true);
    let selectedAccount = '';
    data.connection.accounts = [
      { key: data.snapshot.accountKey, label: 'IBKR 当前授权账户（账号未提供）' },
      { key: 'live:secondary', label: 'IBKR 备用账户' },
    ];
    await page.setViewportSize(viewport);
    await page.route('**/api/ibkr-workbench/state', route => route.fulfill({ json: data }));
    await page.route('**/api/ibkr-workbench/quotes', route => route.fulfill({ json: data.quotes }));
    await page.route('**/api/ibkr-workbench/source', route => { selectedAccount = route.request().postDataJSON().accountKey; return route.fulfill({ json: { ok: true } }); });
    await page.goto('http://127.0.0.1:5187/ibkr');
    if (viewport.width < 600) await page.getByRole('button', { name: '展开导航' }).click();
    await page.getByRole('button', { name: '设置', exact: true }).click();
    const picker = page.getByRole('combobox', { name: '已授权账户' });
    const menu = page.getByRole('listbox', { name: '已授权账户' });
    await expect(picker).toBeVisible();
    await expect(picker).toHaveAttribute('data-value', data.snapshot.accountKey);
    await expect(picker).toHaveCSS('border-radius', '13px');
    await expect(page.locator('.awb-account-picker select')).toHaveCount(0);
    await picker.click();
    await expect(menu).toBeVisible();
    await expect(menu).toHaveCSS('border-radius', '12px');
    await expect(menu.getByRole('option', { name: /IBKR 当前授权账户/ })).toHaveAttribute('aria-selected', 'true');
    await menu.getByRole('option', { name: /IBKR 备用账户/ }).hover();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await mkdir('tmp/workbench-qa', { recursive: true });
    await page.screenshot({ path: `tmp/workbench-qa/account-picker-${viewport.width}.png`, fullPage: true });
    await menu.getByRole('option', { name: /IBKR 备用账户/ }).click();
    await expect.poll(() => selectedAccount).toBe('live:secondary');
    await expect(menu).toHaveCount(0);
  });
}

test('risk evidence opens archived report and PDF export produces a download', async ({ page }) => {
  const data = state(true); const id = '12345678-1234-4234-8234-123456789abc';
  const report: AnalysisReport = { id, accountKey: data.snapshot.accountKey, snapshotId: data.snapshot.snapshotId, snapshotHash: 'a'.repeat(64), generatedAt: '2026-09-04T21:00:00Z', provider: 'fixture', model: 'offline-test', kind: 'manual', snapshot: data.snapshot, evidence: [], quotes: data.quotes, content: { brief: '工程测试报告，非真实投资建议。', accountSummary: '账户数据摘要', portfolioRisk: '测试持仓风险', marketContext: '外部证据缺失', holdings: [], opportunities: [], risks: ['需要核对现金缓冲'], actions: [], gaps: ['缺少真实市场证据'] } };
  data.reports = [report]; data.alerts = [{ id: 'alert', key: 'ai:risk:test', kind: 'risk', title: '测试风险提醒', detail: '阅读报告核对依据', symbols: [], createdAt: report.generatedAt, read: false, resolved: false, reportId: id, evidenceIds: [] }];
  await page.route('**/api/ibkr-workbench/state', route => route.fulfill({ json: data }));
  await page.route('**/api/ibkr-workbench/quotes', route => route.fulfill({ json: data.quotes }));
  await page.goto('http://127.0.0.1:5187/ibkr');
  await page.getByRole('button', { name: '机会与风险', exact: true }).click();
  await page.getByRole('button', { name: '查看证据与报告' }).click();
  await expect(page.getByRole('heading',{name:'投资组合分析报告'})).toBeVisible();
  await expect(page.getByText('外部证据缺失',{exact:true})).toBeVisible();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'PDF', exact: true }).click();
  const download = await downloaded; expect(download.suggestedFilename()).toMatch(/\.pdf$/);
  expect(await download.failure()).toBe(null);
  await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('risk and holdings keep active analysis controls out of their pages', async ({ page }) => {
  const data = state(true);
  data.jobs = [{ id: 'active-analysis', kind: 'manual', state: 'running', startedAt: '2026-09-08T08:00:00Z', progress: { strategy: 'portfolio', stage: '正在汇总账户和市场资料', covered: [], total: 2, sources: 0, searches: 0, reads: 0, modelCalls: 0, maxCalls: 1, startedAt: '2026-09-08T08:00:00Z', updatedAt: '2026-09-08T08:00:00Z', complete: false, gaps: [], trace: [] } }];
  await page.route('**/api/ibkr-workbench/state', route => route.fulfill({ json: data }));
  await page.route('**/api/ibkr-workbench/quotes', route => route.fulfill({ json: data.quotes }));
  await page.goto('http://127.0.0.1:5187/ibkr?tab=alerts');
  await expect(page.locator('.awb-research-strip')).toHaveCount(0);
  await expect(page.getByLabel('账户分析问题')).toHaveCount(0);
  await expect(page.getByText('已有分析正在运行', { exact: true })).toHaveCount(0);
  await page.getByRole('navigation').getByRole('button', { name: '持仓', exact: true }).click();
  await expect(page.locator('.awb-research-strip')).toHaveCount(0);
  await expect(page.getByLabel('账户分析问题')).toHaveCount(0);
});

for (const viewport of [{width:1920,height:1080},{ width: 1440, height: 1000 },{width:808,height:986}, { width: 390, height: 844 }]) {
  test(`workbench empty layout ${viewport.width}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.route('**/api/ibkr-workbench/state', route => route.fulfill({ json: state() }));
    await page.goto('http://127.0.0.1:5187/ibkr');
    await expect(page.getByTestId('ibkr-workbench')).toBeVisible();
    await expect(page.getByText('真实持仓将在授权并同步成功后显示')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await mkdir('tmp/workbench-qa', { recursive: true });
    await page.screenshot({ path: `tmp/workbench-qa/empty-${viewport.width}.png`, fullPage: true });
  });
}

for(const width of [1920,1440,808,390])test(`populated report and risk layouts ${width}`,async({page})=>{
 const data=state(true);data.connection.authorized=true;data.snapshot.positions[0].quantity='0.00300456';data.metrics={investedWeight:.8,cashWeight:.2,topWeight:.3,riskLevel:'需关注',reasons:['集中度超过观察线'],sectors:[{name:'Technology',weight:.5},{name:'ETF（不穿透）',weight:.3}],sectorCoverage:.8};
 data.performance={points:Array.from({length:30},(_,i)=>({date:new Date(Date.UTC(2026,7,i+1)).toISOString().slice(0,10),nav:100000+i*100,cumulativeReturn:i*.001,benchmarkReturn:i*.0007})),source:'IBKR PortfolioAnalyst',fetchedAt:new Date().toISOString(),currency:'USD',returnMethod:'TWR',benchmark:'SPY',note:'工程测试历史'};
 const id='12345678-1234-4234-8234-123456789abc';data.reports=[{id,version:2,accountKey:data.snapshot.accountKey,snapshotId:data.snapshot.snapshotId,snapshotHash:'fixture',generatedAt:'2026-09-04T20:00:00Z',provider:'fixture',model:'offline',kind:'manual',snapshot:data.snapshot,quotes:data.quotes,evidence:[{id:'source',title:'工程测试公告',url:'https://example.com/announcement',source:'example.com',publishedAt:'2026-09-04',fetchedAt:'2026-09-04',symbols:['AAPL'],kind:'news',read:true,content:'This is an offline source fixture.'}],metrics:data.metrics,content:{headline:'先核验利润兑现，再评估集中仓位',briefPoints:['配置集中使组合对单一公司事件敏感。','公告提供观察线索，销量与利润率仍需核实。','维持观察；若后续利润率恶化，重新评估仓位。'],brief:'测试简报',accountSummary:'组合特征',portfolioRisk:'集中度超过观察线',benchmarkComparison:'工程测试基准比较。',marketContext:'原文证据支持的市场背景。',holdings:[{symbol:'AAPL',background:'公司背景',fact:'固定证据中的公告事实',impact:'可能影响收入预期',shortTerm:'观察订单兑现',longTerm:'关注利润率',counterEvidence:'订单数据缺失',invalidation:'利润率下滑',evidenceIds:['source']}],actions:[{symbol:'AAPL',action:'watch',horizon:'short',priority:'high',rationale:'等待更多证据',executionWindow:'下一次公告后',riskControl:'保持仓位上限',expectedImpact:'降低集中风险',counterEvidence:'公告没有实际订单',trigger:'订单数据更新',invalidation:'利润率恶化',targetWeight:null,evidenceIds:['source']}],opportunities:['等待经营数据确认'],risks:['单一仓位集中'],scenarios:[{name:'base',assumptions:'需求平稳',accountImpact:'组合震荡',response:'继续观察'},{name:'upside',assumptions:'订单改善',accountImpact:'权益仓受益',response:'分批再平衡'},{name:'downside',assumptions:'利润恶化',accountImpact:'集中风险放大',response:'复核减仓'}],targetAllocation:'保留现金缓冲并降低单一标的集中度。',monitoring:[{indicator:'利润率',warningLine:'连续恶化',action:'重新评估'}],limitations:['缺少更长历史'],disclaimer:'不构成投资建议。',gaps:['工程测试，不是真实建议'],evidenceIds:['source']}}];
 data.alerts=[{id:'12345678-1234-4234-8234-123456789abd',key:'test',kind:'risk',title:'单一仓位需要复核',detail:'集中度较高可能放大组合波动，需要考虑现金与风险约束。',symbols:['AAPL'],createdAt:'2026-09-04',read:false,resolved:false,reportId:id,evidenceIds:['source']}];
 await page.setViewportSize({width,height:1000});await page.route('**/api/ibkr-workbench/state',r=>r.fulfill({json:data}));await page.route('**/api/ibkr-workbench/quotes',r=>r.fulfill({json:data.quotes}));await page.route('**/api/ibkr-workbench/performance',r=>r.fulfill({json:data.performance}));await page.goto('http://127.0.0.1:5187/ibkr');
 for(const [label,file] of [['账户总览','overview'],['AI 分析','analysis'],['机会与风险','risk'],['持仓','holdings']]){
  if(width<600)await page.getByRole('button',{name:'展开导航'}).click();await page.getByRole('navigation').getByRole('button',{name:label,exact:true}).click();
  await expect(page.getByRole('heading',{name:file==='analysis'?'投资组合分析报告':file==='risk'?'机会与风险中心':file==='holdings'?'我的持仓':'账户总览',exact:true}).first()).toBeVisible();
  if(file==='analysis'){
    await expect(page.locator('.awb-analysis-report-grid')).toHaveCount(0);
    await expect(page.locator('.awb-analysis-dashboard .awb-analysis-hero')).toContainText('先核验利润兑现，再评估集中仓位');
    await expect(page.getByLabel('账户分析问题')).toBeVisible();
    const intro = (await page.locator('.awb-analysis-conclusion-slot').boundingBox())!;
    const composer = (await page.locator('.awb-analysis-composer').boundingBox())!;
    expect(composer.y).toBeGreaterThanOrEqual(intro.y + intro.height);
    await page.screenshot({path:`tmp/workbench-qa/analysis-home-${width}.png`,fullPage:true});
    await page.locator('.awb-analysis-history-rail .awb-analysis-section-head button').click();
    await expect(page.getByRole('region',{name:'历史研究列表'})).toBeVisible();
    await expect(page.locator('.awb-analysis-report-grid')).toHaveCount(0);
    await page.screenshot({path:`tmp/workbench-qa/analysis-history-${width}.png`,fullPage:true});
    await page.locator('.awb-analysis-history-item').click();
    await expect(page.locator('.awb-analysis-back')).toHaveCount(1);
    const reportPicker = page.getByRole('button', { name: '历史报告' });
    await expect(reportPicker).toHaveAttribute('aria-haspopup', 'listbox');
    await expect(reportPicker).toHaveCSS('border-radius', '12px');
    await reportPicker.click();
    await expect(page.getByRole('listbox', { name: '历史报告' })).toBeVisible();
    await expect(page.getByRole('option', { name: /主动研究/ })).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('listbox', { name: '历史报告' })).toHaveCount(0);
    await expect(page.getByRole('heading',{name:'基准比较',exact:true})).toBeVisible();
    await expect(page.locator('.awb-analysis-report-grid')).not.toContainText('机会与风险');
    await expect(page.locator('.awb-analysis-report-grid')).not.toContainText('目标配置框架');
    await expect(page.locator('.awb-analysis-report-grid')).not.toContainText('证据与数据缺口');
    await expect(page.locator('.awb-analysis-report-grid > main .awb-analysis-scenarios')).toHaveCount(1);
    await expect(page.locator('.awb-analysis-report-grid > aside .awb-analysis-scenarios')).toHaveCount(0);
    await expect(page.getByText('基准情景',{exact:true})).toBeVisible();
    if(width>1000){
      const heroBox=(await page.locator('.awb-analysis-report-grid .awb-analysis-hero').boundingBox())!;
      const priorityBox=(await page.locator('.awb-analysis-report-grid .awb-analysis-priorities').boundingBox())!;
      const actionsBox=(await page.locator('.awb-analysis-report-grid .awb-analysis-actions').boundingBox())!;
      const scenarioBox=(await page.locator('.awb-analysis-report-grid .awb-analysis-scenarios').boundingBox())!;
      const reportBox=(await page.locator('.awb-analysis-report-grid').boundingBox())!;
      const mainBox=(await page.locator('.awb-analysis-report-grid > main').boundingBox())!;
      const asideBox=(await page.locator('.awb-analysis-report-grid > aside').boundingBox())!;
      const composerBox=(await page.locator('.awb-analysis-report-grid + .awb-analysis-composer').boundingBox())!;
      expect(Math.abs(heroBox.y-priorityBox.y)).toBeLessThanOrEqual(2);
      expect(actionsBox.y-(priorityBox.y+priorityBox.height)).toBeLessThanOrEqual(18);
      expect(actionsBox.y).toBeLessThan(heroBox.y+heroBox.height);
      expect(scenarioBox.x).toBeLessThan(actionsBox.x);
      expect(Math.abs((mainBox.y+mainBox.height)-(asideBox.y+asideBox.height))).toBeLessThanOrEqual(2);
      expect(composerBox.y-(reportBox.y+reportBox.height)).toBeLessThanOrEqual(18);
      expect(Math.abs(composerBox.x-reportBox.x)).toBeLessThanOrEqual(2);
      expect(Math.abs(composerBox.width-reportBox.width)).toBeLessThanOrEqual(2);
    }
    await page.getByRole('button',{name:'返回历史研究'}).click();
    await expect(page.locator('.awb-analysis-report-grid')).toHaveCount(0);
    await page.getByRole('button',{name:'返回分析工作台',exact:true}).click();
    await expect(page.locator('.awb-analysis-dashboard')).toBeVisible();
    await page.getByRole('button',{name:'查看完整报告与依据',exact:true}).click();
    await expect(page.locator('.awb-analysis-back')).toHaveCount(1);
    await expect(page.getByRole('heading',{name:'基准比较',exact:true})).toBeVisible();
  }
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:`tmp/workbench-qa/${file}-${width}.png`,fullPage:true});
 }
 await expect(page.getByRole('cell',{name:/0.00300456/})).toBeVisible();
});


test('overview presents sourced returns, allocation, currency-separated PnL and working detail navigation', async ({ page }) => {
  const data = state(true);
  data.performance = { source: 'IBKR PortfolioAnalyst', fetchedAt: '2026-09-07T20:00:00Z', currency: 'USD', returnMethod: 'TWR', benchmark: 'none', note: '工程测试历史，非真实账户', points: [
    { date: '2026-06-30', nav: 100000, cumulativeReturn: 0 },
    { date: '2026-07-31', nav: 250000, cumulativeReturn: .1 },
    { date: '2026-08-31', nav: 245000, cumulativeReturn: .078 },
    { date: '2026-09-07', nav: 500000, cumulativeReturn: .1 },
  ] };
  data.snapshot.positions.push({ ...data.snapshot.positions[0], conId: 2, symbol: 'QQQ', unrealizedPnl: '-100', marketValue: '10000' }, { ...data.snapshot.positions[0], conId: 3, symbol: '00700', currency: 'HKD', unrealizedPnl: '9000', marketValue: '40000' });
  await page.route('**/api/ibkr-workbench/state', r => r.fulfill({ json: data }));
  await page.route('**/api/ibkr-workbench/quotes', r => r.fulfill({ json: data.quotes }));
  await page.route('**/api/ibkr-workbench/performance', r => r.fulfill({ json: data.performance }));
  await page.route('**/api/ibkr-workbench/history?*', r => r.fulfill({ json: { bars: [] } }));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('http://127.0.0.1:5187/ibkr');
  await expect(page.locator('.awb-metrics')).not.toContainText('今日盈亏');
  await expect(page.locator('.awb-metrics')).toContainText('未实现盈亏');
  for (const name of ['行业配置', '持仓盈亏分布', '资金概况', '月度收益率']) await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  await expect(page.getByRole('img', { name: '月度收益率柱状图' })).toBeVisible();
  await expect(page.locator('.awb-month-chart')).toContainText('+10.00%');
  await expect(page.locator('.awb-month-chart')).toContainText('-2.00%');
  await expect(page.locator('.awb-allocation-panel')).toContainText('行业资料尚未取得');
  await expect(page.locator('.awb-pnl-panel')).toContainText('+3,000.00');
  await expect(page.locator('.awb-pnl-panel')).not.toContainText('9,000.00');
  await page.getByLabel('盈亏排行币种').selectOption('HKD');
  await expect(page.locator('.awb-pnl-panel')).toContainText('+9,000.00');
  await expect(page.locator('.awb-pnl-panel')).not.toContainText('3,000.00');
  await page.getByRole('button', { name: '投资收益', exact: true }).click();
  await expect(page.locator('.awb-chart-reading')).toContainText('时间加权收益');
  await page.getByRole('img', { name: '账户资产表现曲线' }).focus();
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('.awb-chart-reading')).toContainText('2026-08-31');
  await page.getByRole('button', { name: '资产净值', exact: true }).click();
  const chart = page.getByRole('img', { name: '账户资产表现曲线' });
  const chartBox = (await chart.boundingBox())!;
  await page.mouse.move(chartBox.x + chartBox.width - 90, chartBox.y + 50);
  const tooltip = page.getByRole('tooltip', { name: '资产表现详情' });
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText('2026-09-07');
  await expect(tooltip).toContainText('500,000.00');
  await expect(tooltip).toContainText('+2.04%');
  await expect(tooltip).toContainText('+255,000.00');
  await expect(tooltip).not.toContainText('收益盈亏金额');
  const tooltipBox = (await tooltip.boundingBox())!;
  expect(tooltipBox.x).toBeGreaterThanOrEqual(chartBox.x);
  expect(tooltipBox.x + tooltipBox.width).toBeLessThanOrEqual(chartBox.x + chartBox.width);
  await chart.focus();
  await page.keyboard.press('Escape');
  await expect(tooltip).toHaveCount(0);
  await page.keyboard.press('ArrowLeft');
  await expect(tooltip).toContainText('2026-08-31');
  await page.getByRole('button', { name: '1周', exact: true }).focus();
  await expect(tooltip).toHaveCount(0);
  await page.screenshot({ path: 'tmp/workbench-qa/overview-redesign-monthly.png', fullPage: true });
  await page.locator('.awb-holdings-summary').getByRole('button', { name: 'AAPL', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'AAPL 持仓详情' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '前往 AI 分析' }).click();
  await expect(page.getByRole('heading', { name: '把账户快照，变成可执行的研究结论' })).toBeVisible();
});

test('overview never substitutes NAV changes or reference sample scores for missing research and returns', async ({ page }) => {
  const data = state(true);
  data.performance = { source: '本地账户快照', fetchedAt: '2026-09-07', currency: 'USD', returnMethod: null, benchmark: 'none', note: '净值含入金', points: [{ date: '2026-08-31', nav: 10, cumulativeReturn: null }, { date: '2026-09-07', nav: 1000, cumulativeReturn: null }] };
  await page.route('**/api/ibkr-workbench/state', r => r.fulfill({ json: data }));
  await page.route('**/api/ibkr-workbench/quotes', r => r.fulfill({ json: data.quotes }));
  await page.route('**/api/ibkr-workbench/performance', r => r.fulfill({ json: data.performance }));
  await page.goto('http://127.0.0.1:5187/ibkr');
  await expect(page.getByRole('button', { name: '投资收益', exact: true })).toBeDisabled();
  await expect(page.locator('.awb-return-summary b')).toHaveText(['—', '—', '—', '—']);
  await expect(page.getByRole('img', { name: '月度收益率柱状图' })).toHaveCount(0);
  await expect(page.locator('.awb-brief-redesign')).toContainText('今天还没有账户分析结论');
  await expect(page.locator('.awb-brief-redesign')).toContainText('启动服务不会自动补跑');
  await expect(page.locator('.awb-brief-redesign')).not.toContainText('71/100');
  await expect(page.locator('.awb-brief-redesign')).not.toContainText('本周 3 家');
  const chart = page.getByRole('img', { name: '账户资产表现曲线' });
  await chart.focus();
  await page.keyboard.press('ArrowRight');
  const tooltip = page.getByRole('tooltip', { name: '资产表现详情' });
  await expect(tooltip).toContainText('+990.00');
  await expect(tooltip).not.toContainText('9900');
  await expect(tooltip).not.toContainText('收益盈亏金额');
});

test('full HD overview fits all summary modules while research is pending', async ({ page }) => {
  const data = state(true);
  data.snapshot.positions = ['AAPL', 'QQQ', 'MSFT', 'NVDA', 'AMZN', 'KO', 'TSLA', 'MCD', 'VTI', 'AMD', 'GOOG', 'META'].map((symbol, i) => ({ ...data.snapshot.positions[0], conId: i + 1, symbol, unrealizedPnl: String(i % 2 ? -100 : 100) }));
  data.metrics = { investedWeight: .978, cashWeight: .022, topWeight: .33, riskLevel: '偏高', reasons: ['现金比例低于观察线', '单标的仓位超过观察线'], sectors: [{ name: 'Technology', weight: .426 }, { name: 'ETF', weight: .215 }, { name: 'Technology Services', weight: .091 }, { name: 'Consumer Defensive', weight: .087 }, { name: 'Retail', weight: .045 }, { name: 'Healthcare', weight: .039 }, { name: 'Consumer Services', weight: .038 }, { name: 'Consumer Durables', weight: .037 }], sectorCoverage: 1 };
  data.jobs = [{ id: 'pending-fixture', kind: 'manual', state: 'partial', startedAt: '2026-09-07', error: '研究服务暂不可用；已保存阶段结果，可继续研究', progress: { strategy: 'portfolio', stage: '待研究', covered: [], total: 12, sources: 4, searches: 4, reads: 4, modelCalls: 2, maxCalls: 2, startedAt: '2026-09-07', updatedAt: '2026-09-07', complete: false, gaps: [], trace: [] } }];
  data.alerts = ['现金缓冲偏低', '单标的仓位集中'].map((title, i) => ({ id: String(i), key: String(i), kind: 'risk', title, detail: '工程测试观察规则', symbols: [], createdAt: '2026-09-07', read: false, resolved: false, evidenceIds: [] }));
  data.performance = { source: 'IBKR PortfolioAnalyst', fetchedAt: '2026-09-07', currency: 'USD', returnMethod: 'TWR', benchmark: 'none', note: '工程测试历史', points: [{ date: '2026-07-31', nav: 100000, cumulativeReturn: 0 }, { date: '2026-08-31', nav: 101000, cumulativeReturn: .01 }, { date: '2026-09-07', nav: 102000, cumulativeReturn: .02 }] };
  await page.route('**/api/ibkr-workbench/state', r => r.fulfill({ json: data }));
  await page.route('**/api/ibkr-workbench/quotes', r => r.fulfill({ json: data.quotes }));
  await page.route('**/api/ibkr-workbench/performance', r => r.fulfill({ json: data.performance }));
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('http://127.0.0.1:5187/ibkr');
  await expect(page.locator('.awb-brand > span')).toHaveCSS('background-image', /sparkflow-signal-mark\.svg/);
  await expect(page.getByRole('img', { name: '月度收益率柱状图' })).toBeVisible();
  await expect(page.locator('.awb-research-strip')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true);
  for (const selector of ['.awb-metrics', '.awb-performance-redesign', '.awb-brief-redesign', '.awb-holdings', '.awb-allocation-panel', '.awb-pnl-panel', '.awb-funds-panel']) {
    const box = await page.locator(selector).boundingBox();
    expect(box, selector).not.toBeNull();
    expect(box!.y + box!.height, selector).toBeLessThanOrEqual(1080);
  }
  expect(await page.locator('.awb-holdings tbody tr').count()).toBeGreaterThanOrEqual(5);
  await expect(page.locator('.awb-chat, .awb-footer')).toHaveCount(0);
  const funds = await page.locator('.awb-funds-panel').boundingBox();
  expect(Math.abs(funds!.y + funds!.height - 1072)).toBeLessThanOrEqual(2);
  const performance = await page.locator('.awb-performance-redesign').boundingBox();
  const brief = await page.locator('.awb-brief-redesign').boundingBox();
  const holdings = await page.locator('.awb-holdings').boundingBox();
  const allocation = await page.locator('.awb-allocation-panel').boundingBox();
  const pnl = await page.locator('.awb-pnl-panel').boundingBox();
  expect(Math.abs(brief!.y - performance!.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(brief!.y + brief!.height - funds!.y - funds!.height)).toBeLessThanOrEqual(1);
  expect(holdings!.y).toBeGreaterThanOrEqual(performance!.y + performance!.height);
  expect(Math.abs(performance!.x + performance!.width - funds!.x - funds!.width)).toBeLessThanOrEqual(1);
  for (const [left, right] of [[holdings!, allocation!], [allocation!, pnl!], [pnl!, funds!], [funds!, brief!]]) {
    expect(left.x + left.width).toBeLessThanOrEqual(right.x);
  }
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'tmp/workbench-qa/dense-overview-1920.png', fullPage: true });
  await page.setViewportSize({ width: 1600, height: 900 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect.poll(() => page.locator('.awb-funds-panel').evaluate(panel => panel.getBoundingClientRect().height >= 420)).toBe(true);
  await page.screenshot({ path: 'tmp/workbench-qa/dense-overview-1600.png', fullPage: true });
  const compactCount = await page.locator('.awb-holdings tbody tr').count();
  for (let resize = 0; resize < 2; resize++) {
    await page.setViewportSize({ width: 2560, height: 1440 });
    await expect.poll(() => page.locator('.awb-holdings tbody tr').count()).toBeGreaterThanOrEqual(compactCount);
    await expect(page.locator('.awb-pnl-row')).toHaveCount(12);
    await expect(page.getByRole('img', { name: '行业配置扇形图' })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true);
    await page.setViewportSize({ width: 1600, height: 900 });
    await expect(page.locator('.awb-holdings tbody tr')).toHaveCount(compactCount);
    for (const selector of ['.awb-allocation-panel', '.awb-pnl-panel', '.awb-funds-panel']) {
      await expect.poll(() => page.locator(selector).evaluate(element => element.scrollHeight <= element.clientHeight + 1)).toBe(true);
    }
    await expect.poll(() => page.locator('.awb-pnl-bars').evaluate(element => getComputedStyle(element).scrollbarWidth === 'none')).toBe(true);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.locator('.awb-holdings').getByRole('button', { name: '查看全部' }).click();
  await expect(page.locator('.awb-holdings tbody tr')).toHaveCount(12);
  await expect(page.locator('.awb-research-strip')).toHaveCount(0);
  await page.getByRole('navigation').getByRole('button', { name: 'AI 分析', exact: true }).click();
  await expect(page.getByRole('button', { name: '基于已保存资料重新分析' })).toBeVisible();
  await expect(page.getByRole('button', { name: '基于已保存资料重新分析' })).toHaveCount(1);
  await expect(page.getByLabel('账户分析问题')).toBeVisible();
});

test('adaptive overview shows only available holdings and follows account updates', async ({ page }) => {
  const data = state(true);
  const holding = data.snapshot.positions[0];
  const setPositions = (count: number) => {
    data.snapshot.positions = Array.from({ length: count }, (_, i) => ({ ...holding, conId: i + 1, symbol: `TEST${i}`, unrealizedPnl: String(i % 2 ? -10 : 10) }));
  };
  setPositions(2);
  await page.route('**/api/ibkr-workbench/state', r => r.fulfill({ json: data }));
  await page.route('**/api/ibkr-workbench/quotes', r => r.fulfill({ json: [] }));
  await page.route('**/api/ibkr-workbench/performance', r => r.fulfill({ json: { points: [] } }));
  await page.setViewportSize({ width: 2560, height: 1440 });
  await page.goto('http://127.0.0.1:5187/ibkr');
  for (const count of [2, 8, 0]) {
    setPositions(count);
    await expect(page.locator('.awb-holdings tbody tr')).toHaveCount(count, { timeout: 10000 });
    await expect(page.locator('.awb-pnl-row')).toHaveCount(count);
  }
  await expect(page.locator('.awb-holdings')).toContainText('当前没有匹配持仓');
});

test('overview uses today analysis conclusion and ignores the retired brief', async ({ page }) => {
  const data = state(true);
  data.ai.enabled = true;
  data.dailyBrief = { enabled: true, state: 'ready', detail: '旧简报不应展示', nextRunAt: null, dueSession: null, calendarSupported: true, latest: { id: 'brief-fixture', accountKey: data.snapshot.accountKey, snapshotId: data.snapshot.snapshotId, snapshotHash: 'old', snapshotAsOf: data.snapshot.asOf, sessionDate: '2026-09-08', generatedAt: new Date().toISOString(), provider: 'fixture', model: 'old-model', promptVersion: 'old', content: { headline: '旧账户简报', summary: '旧简报摘要', risk: '旧简报风险', watch: [], gaps: [] }, facts: {} } };
  const report: AnalysisReport = { id: 'today-report', version: 2, accountKey: data.snapshot.accountKey, snapshotId: data.snapshot.snapshotId, snapshotHash: 'today', generatedAt: new Date().toISOString(), provider: 'fixture', model: 'analysis-model', kind: 'daily', evidence: [], quotes: [], snapshot: structuredClone(data.snapshot), content: { headline: '集中度仍高，今天先控制仓位风险', briefPoints: ['AAPL 与 QQQ 合计权重偏高。', '现金缓冲不足，优先保留流动性。', '等待价格触发条件后再调整。'], brief: '先降集中度，再讨论进攻。', accountSummary: '账户摘要', portfolioRisk: '集中度风险', marketContext: '市场背景', holdings: [], opportunities: [], risks: ['集中度'], actions: [], gaps: [] } };
  data.reports = [report];
  await page.route('**/api/ibkr-workbench/state', r => r.fulfill({ json: data }));
  await page.route('**/api/ibkr-workbench/quotes', r => r.fulfill({ json: data.quotes }));
  await page.goto('http://127.0.0.1:5187/ibkr');
  const panel = page.getByRole('region', { name: '今日分析结论' });
  await expect(panel).toContainText('集中度仍高，今天先控制仓位风险');
  await expect(panel).toContainText('AAPL 与 QQQ 合计权重偏高');
  await expect(panel).toContainText('定时分析 · analysis-model');
  await expect(panel).not.toContainText('旧账户简报');
  await expect(panel).not.toContainText('重新生成简报');
  await panel.getByRole('button', { name: '查看完整分析' }).click();
  await expect(page.getByText('集中度仍高，今天先控制仓位风险', { exact: true }).first()).toBeVisible();
});

test('resumed older research remains the visible active task and cancellation targets its id',async({page})=>{
 const data=state(true);let cancelled='';data.jobs=[{id:'new-cancelled',kind:'manual',state:'cancelled',startedAt:'2026-09-07'},{id:'older-running',kind:'manual',state:'running',startedAt:'2026-09-06',progress:{stage:'形成逐仓判断与反证',covered:['AAPL'],total:2,sources:3,searches:2,reads:1,modelCalls:1,maxCalls:12,startedAt:'2026-09-06',updatedAt:'2026-09-07',complete:false,gaps:[],trace:[]}}];
 await page.route('**/api/ibkr-workbench/state',r=>r.fulfill({json:data}));await page.route('**/api/ibkr-workbench/quotes',r=>r.fulfill({json:data.quotes}));await page.route('**/api/ibkr-workbench/cancel',r=>{cancelled=r.request().postDataJSON().id;return r.fulfill({json:{ok:true}});});
  await page.goto('http://127.0.0.1:5187/ibkr');await page.getByRole('navigation').getByRole('button',{name:'AI 分析',exact:true}).click();await expect(page.locator('.awb-analysis-task-metrics')).toContainText('1/2');await page.screenshot({path:'tmp/workbench-qa/analysis-running.png',fullPage:true});await page.getByRole('button',{name:'取消分析',exact:true}).click();await expect.poll(()=>cancelled).toBe('older-running');
});

test('analysis workspace keeps the five-panel layout and one action before the first report', async ({ page }) => {
  const data = state(true); data.ai.enabled = true;
  let started = 0;
  await page.route('**/api/ibkr-workbench/state', route => route.fulfill({ json: data }));
  await page.route('**/api/ibkr-workbench/quotes', route => route.fulfill({ json: data.quotes }));
  await page.route('**/api/ibkr-workbench/analyze', route => { started++; return route.fulfill({ status: 202, json: { ok: true } }); });
  await page.setViewportSize({ width: 2560, height: 1440 });
  await page.goto('http://127.0.0.1:5187/ibkr');
  await page.getByRole('navigation').getByRole('button', { name: 'AI 分析', exact: true }).click();
  await expect(page.getByRole('heading', { name: '把账户快照，变成可执行的研究结论' })).toBeVisible();
  await expect(page.getByRole('button', { name: '开始账户分析' })).toHaveCount(1);
  await expect(page.locator('.awb-analysis-steps')).toContainText('账户快照');
  await expect(page.locator('.awb-analysis-steps')).toContainText('发布报告');
  const workspace = (await page.locator('.awb-analysis-workspace').boundingBox())!;
  expect(workspace.width).toBeGreaterThan(2000);
  await expect(page.locator('.awb-analysis-dashboard>.awb-analysis-coverage')).toBeVisible();
  await expect(page.locator('.awb-analysis-history-rail')).toContainText('还没有历史研究');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: '开始账户分析' }).click();
  await expect.poll(() => started).toBe(1);
  await page.screenshot({ path: 'tmp/workbench-qa/analysis-empty-redesign-2560.png', fullPage: true });
});

test('research activity effects track running state and respect reduced motion', async ({ page }) => {
  const data = state(true); data.ai.enabled = true;
  data.jobs = [{ id: 'animation-test', kind: 'manual', state: 'running', startedAt: '2026-09-08T08:00:00Z', progress: { strategy: 'portfolio', stage: '获取公司资料、基本面与历史行情', covered: [], total: 12, sources: 0, searches: 0, reads: 0, modelCalls: 0, maxCalls: 1, startedAt: '2026-09-08T08:00:00Z', updatedAt: '2026-09-08T08:00:00Z', complete: false, gaps: [], trace: [] } }];
  await page.route('**/api/ibkr-workbench/state', r => r.fulfill({ json: data }));
  await page.route('**/api/ibkr-workbench/quotes', r => r.fulfill({ json: data.quotes }));
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('http://127.0.0.1:5187/ibkr?tab=reports');
  const card = page.getByRole('region', { name: '分析进展', exact: true });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await card.scrollIntoViewIfNeeded();
  await expect(card).toHaveAttribute('aria-busy', 'true');
  await expect(card.locator('.awb-analysis-processing-fx')).toHaveCount(1);
  await expect(page.getByRole('button', { name: '分析中', exact: true })).toBeDisabled();
  expect(await card.locator('.awb-analysis-scan').evaluate(n => getComputedStyle(n).animationName)).toBe('awb-research-scan');
  expect(await card.locator('.is-active>span').evaluate(n => getComputedStyle(n, '::after').animationName)).toBe('awb-research-orbit');
  const transform = await card.locator('.awb-analysis-scan').evaluate(n => getComputedStyle(n).transform);
  await expect.poll(() => card.locator('.awb-analysis-scan').evaluate(n => getComputedStyle(n).transform)).not.toBe(transform);
  await card.screenshot({ path: 'tmp/analysis-activity-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await card.scrollIntoViewIfNeeded();
  expect(await card.evaluate(n => n.scrollWidth > n.clientWidth)).toBe(false);
  await card.screenshot({ path: 'tmp/analysis-activity-mobile.png' });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(card.locator('.awb-analysis-processing-fx')).toBeHidden();
  expect(await card.locator('.is-active>span').evaluate(n => getComputedStyle(n, '::after').animationName)).toBe('none');
  expect(await page.locator('.awb-analysis-spinner').evaluate(n => getComputedStyle(n).animationName)).toBe('none');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  for (const status of ['cancelled', 'failed', 'completed'] as const) {
    data.jobs[0].state = status;
    await page.reload();
    await expect(page.getByLabel('账户分析问题')).toBeVisible();
    await expect(page.locator('.awb-analysis-processing-fx, .awb-analysis-submit-running, .awb-analysis-steps.is-processing')).toHaveCount(0);
  }
});

test('question examples complete with Tab without replacing drafts or submitting analysis', async ({ page }) => {
  const data = state(true); data.ai.enabled = true;
  let submissions = 0;
  await page.route('**/api/ibkr-workbench/state', r => r.fulfill({ json: data }));
  await page.route('**/api/ibkr-workbench/quotes', r => r.fulfill({ json: data.quotes }));
  await page.route('**/api/ibkr-workbench/analyze', r => { submissions++; return r.fulfill({ status: 202, json: { ok: true } }); });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('http://127.0.0.1:5187/ibkr?tab=reports');
  const input = page.getByLabel('账户分析问题');
  const examples = page.getByRole('group', { name: '示例话题' }).getByRole('button');
  await expect(examples).toHaveCount(8);
  const initial = (await input.getAttribute('placeholder'))!.replace(/^例如：/, '');
  await input.focus(); await input.press('Tab');
  await expect(input).toHaveValue(initial); await expect(input).toBeFocused();
  await input.press('Tab'); await expect(input).not.toBeFocused();
  await input.fill('这是我正在编辑的草稿'); await input.press('Tab');
  await expect(input).toHaveValue('这是我正在编辑的草稿');
  await input.fill(''); await input.press('Shift+Tab');
  await expect(input).toHaveValue(''); await expect(input).not.toBeFocused();
  await page.getByRole('button', { name: '换一题' }).click();
  const next = (await input.getAttribute('placeholder'))!.replace(/^例如：/, '');
  expect(next).not.toBe(initial);
  await expect(input).toBeFocused(); await input.press('Tab'); await expect(input).toHaveValue(next);
  for (let index = 0; index < 8; index++) {
    const example = examples.nth(index), text = await example.getAttribute('title');
    await example.click(); await expect(input).toHaveValue(text!); await expect(input).toBeFocused();
  }
  expect(submissions).toBe(0);
  await input.fill('');
  await page.locator('.awb-analysis-question').screenshot({ path: 'tmp/question-examples-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.awb-analysis-question').scrollIntoViewIfNeeded();
  expect(await page.locator('.awb-analysis-question').evaluate(n => n.scrollWidth > n.clientWidth)).toBe(false);
  await page.locator('.awb-analysis-question').screenshot({ path: 'tmp/question-examples-mobile.png' });
});

test('analysis dashboard keeps the latest portfolio conclusion above progress and routes chat replies to history', async ({ page }) => {
  const data = state(true); data.ai.enabled = true;
  const makeReport = (id: string, generatedAt: string, headline: string, kind: AnalysisReport['kind'] = 'manual'): AnalysisReport => ({ id, accountKey: data.snapshot.accountKey, snapshotId: data.snapshot.snapshotId, snapshotHash: 'fixture', generatedAt, provider: 'fixture', model: 'test-model', kind, snapshot: { ...data.snapshot, positions: [] }, evidence: [], quotes: [], content: { headline, brief: '保存的真实研究内容', briefPoints: ['结论要点一', '结论要点二', '结论要点三'], accountSummary: '', portfolioRisk: '', marketContext: '', holdings: [], opportunities: [], risks: [], actions: [], gaps: [] } });
  data.reports = [makeReport('older', '2026-09-06T03:00:00Z', '较早的组合判断'), makeReport('latest', '2026-09-08T03:00:00Z', '最新组合判断'), makeReport('chat', '2026-09-08T04:00:00Z', '单次问答回复', 'chat')];
  data.jobs = [{ id: 'cancelled', kind: 'manual', state: 'cancelled', startedAt: '2026-09-08T05:00:00Z', progress: { strategy: 'portfolio', stage: '资料已保存', covered: [], total: 1, sources: 4, searches: 4, reads: 3, modelCalls: 0, maxCalls: 1, startedAt: '2026-09-08T05:00:00Z', updatedAt: '2026-09-08T05:00:00Z', complete: false, gaps: [], trace: [] } }];
  let requestBody: unknown;
  await page.route('**/api/ibkr-workbench/state', r => r.fulfill({ json: data }));
  await page.route('**/api/ibkr-workbench/quotes', r => r.fulfill({ json: data.quotes }));
  await page.route('**/api/ibkr-workbench/analyze', r => { requestBody = r.request().postDataJSON(); return r.fulfill({ status: 202, json: { ok: true } }); });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('http://127.0.0.1:5187/ibkr?tab=reports');
  const hero = page.locator('.awb-analysis-dashboard .awb-analysis-hero');
  await expect(hero).toContainText('最新组合判断'); await expect(hero).not.toContainText('单次问答回复');
  await expect(hero).toContainText('结论要点三');
  // Coverage follows the report snapshot (zero positions), not the newer live account (one).
  await expect(page.locator('.awb-analysis-coverage')).toContainText('0 个持仓');
  await expect(page.locator('.awb-analysis-progress-slot')).toContainText('已取消');
  const box = async (selector: string) => (await page.locator(selector).boundingBox())!;
  const conclusion = await box('.awb-analysis-conclusion-slot'), scope = await box('.awb-analysis-coverage'), interaction = await box('.awb-analysis-interaction'), progress = await box('.awb-analysis-progress-slot'), history = await box('.awb-analysis-history-rail'), composer = await box('.awb-analysis-composer');
  expect(scope.y).toBeCloseTo(conclusion.y); expect(scope.x).toBeGreaterThan(conclusion.x + conclusion.width);
  expect(progress.y).toBeGreaterThanOrEqual(conclusion.y + conclusion.height);
  expect(history.y).toBeCloseTo(interaction.y); expect(history.x).toBeCloseTo(scope.x);
  expect(interaction.x).toBeCloseTo(conclusion.x); expect(interaction.width).toBeCloseTo(conclusion.width);
  expect(composer.x).toBeCloseTo(progress.x); expect(composer.width).toBeCloseTo(progress.width);
  expect(composer.y).toBeGreaterThanOrEqual(progress.y + progress.height);
  expect(composer.y + composer.height).toBeLessThanOrEqual(interaction.y + interaction.height);
  await page.locator('.awb-analysis-interaction').screenshot({ path: 'tmp/workbench-qa/analysis-combined-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('.awb-analysis-interaction').screenshot({ path: 'tmp/workbench-qa/analysis-combined-mobile.png' });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.getByLabel('账户分析问题').fill('如果市场回调，哪些持仓最值得关注？');
  await page.getByRole('button', { name: '提交问题', exact: true }).click();
  await expect.poll(() => requestBody).toEqual({ question: '如果市场回调，哪些持仓最值得关注？' });
  await expect(page.getByLabel('账户分析问题')).toHaveValue('');
  await page.locator('.awb-analysis-rail-item').first().click();
  await expect(page.getByRole('heading', { name: '单次问答回复', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '返回分析工作台', exact: true }).click();
  await expect(hero).toContainText('最新组合判断');
});

test('settings save the only daily analysis schedule without later preference edits losing it', async ({ page }) => {
  const data = state(true); let submissions: any[] = [];
  await page.route('**/api/ibkr-workbench/state', route => route.fulfill({ json: data }));
  await page.route('**/api/ibkr-workbench/quotes', route => route.fulfill({ json: data.quotes }));
  await page.route('**/api/ibkr-workbench/preferences', route => { const value = route.request().postDataJSON(); submissions.push(value); data.preferences = value; return route.fulfill({ json: { ok: true } }); });
  await page.setViewportSize({ width: 1440, height: 1080 });
  await page.goto('http://127.0.0.1:5187/ibkr?tab=settings');
  await expect(page.getByRole('switch', { name: '启用每日 AI 分析定时' })).not.toBeChecked();
  await expect(page.getByRole('switch', { name: '启用账户简报定时' })).toHaveCount(0);
  await page.getByRole('switch', { name: '启用每日 AI 分析定时' }).check();
  await page.getByLabel('每日 AI 分析每天次数').selectOption('2');
  await page.getByLabel('每日 AI 分析第 1 次时间').fill('09:00');
  await page.getByLabel('每日 AI 分析第 2 次时间').fill('09:00');
  await expect(page.getByRole('button', { name: '保存定时设置', exact: true })).toBeDisabled();
  await page.getByLabel('每日 AI 分析第 2 次时间').fill('20:00');
  await page.getByRole('button', { name: '保存定时设置', exact: true }).click();
  await expect.poll(() => submissions.length).toBe(1);
  expect(submissions[0].schedules).toEqual({ brief: { enabled: false, mode: 'clock', timeZone: 'Asia/Shanghai', times: ['09:00'] }, analysis: { enabled: true, mode: 'clock', timeZone: 'Asia/Shanghai', times: ['09:00', '20:00'] } });
  expect(submissions[0].daily).toBe(false); expect(submissions[0].eventAnalysis).toBe(false); expect(submissions[0].maxAutomatic).toBe(0);
  await page.getByRole('button', { name: '保存偏好', exact: true }).click();
  await expect.poll(() => submissions.length).toBe(2); expect(submissions[1].schedules).toEqual(submissions[0].schedules);
  await page.reload();
  await expect(page.getByLabel('每日 AI 分析第 2 次时间')).toHaveValue('20:00');
  await page.locator('.awb-schedules').screenshot({ path: 'tmp/workbench-qa/schedules-desktop.png' });
  await page.getByRole('switch', { name: '启用每日 AI 分析定时' }).uncheck();
  await page.getByRole('button', { name: '保存定时设置', exact: true }).click();
  await expect.poll(() => submissions.length).toBe(3);
  expect(submissions[2].daily).toBe(false); expect(submissions[2].schedules.analysis.enabled).toBe(false);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('.awb-schedules').screenshot({ path: 'tmp/workbench-qa/schedules-mobile.png' });
});

test('analysis workspace resumes a checkpoint before the model call', async ({ page }) => {
  const data = state(true); data.ai.enabled = true;
  data.jobs = [{ id: '12345678-1234-4234-8234-123456789abc', kind: 'manual', state: 'partial', startedAt: '2026-09-07T12:00:00Z', error: '资料已经保存，可以继续分析。', progress: { strategy: 'portfolio', stage: '资料已保存', covered: ['AAPL'], total: 1, sources: 4, searches: 4, reads: 3, modelCalls: 0, maxCalls: 1, startedAt: '2026-09-07T12:00:00Z', updatedAt: '2026-09-07T12:05:00Z', complete: false, gaps: [], trace: [] } }];
  let resumed = '';
  await page.route('**/api/ibkr-workbench/state', route => route.fulfill({ json: data }));
  await page.route('**/api/ibkr-workbench/quotes', route => route.fulfill({ json: data.quotes }));
  await page.route('**/api/ibkr-workbench/resume', route => { resumed = route.request().postDataJSON().id; return route.fulfill({ status: 202, json: { ok: true } }); });
  await page.goto('http://127.0.0.1:5187/ibkr');
  await page.getByRole('navigation').getByRole('button', { name: 'AI 分析', exact: true }).click();
  await expect(page.getByRole('heading', { name: '已有阶段结果，可以继续' })).toBeVisible();
  await page.screenshot({ path: 'tmp/workbench-qa/analysis-recoverable.png', fullPage: true });
  await page.getByRole('button', { name: '继续完成分析' }).click();
  await expect.poll(() => resumed).toBe(data.jobs[0].id);
});

test('analysis workspace truthfully starts a new analysis after a consumed model call', async ({ page }) => {
  const data = state(true); data.ai.enabled = true;
  data.jobs = [{ id: '12345678-1234-4234-8234-123456789abd', kind: 'manual', state: 'failed', startedAt: '2026-09-07T12:00:00Z', error: '模型输出未能形成完整报告。', progress: { strategy: 'portfolio', stage: '报告未完成', covered: ['AAPL'], total: 1, sources: 5, searches: 4, reads: 4, modelCalls: 1, maxCalls: 1, startedAt: '2026-09-07T12:00:00Z', updatedAt: '2026-09-07T12:05:00Z', complete: false, gaps: [], trace: [] } }];
  let restarted: unknown;
  await page.route('**/api/ibkr-workbench/state', route => route.fulfill({ json: data }));
  await page.route('**/api/ibkr-workbench/quotes', route => route.fulfill({ json: data.quotes }));
  await page.route('**/api/ibkr-workbench/retry', route => { restarted = route.request().postDataJSON(); return route.fulfill({ status: 202, json: { ok: true } }); });
  await page.goto('http://127.0.0.1:5187/ibkr');
  await page.getByRole('navigation').getByRole('button', { name: 'AI 分析', exact: true }).click();
  await expect(page.getByRole('heading', { name: '这次分析未能完成' })).toBeVisible();
  await expect(page.getByText('使用最新账户快照和一天内已保存资料，新建一次分析；原始资料时间保持可查。')).toBeVisible();
  await expect(page.getByRole('button', { name: '新建账户分析', exact: true })).toHaveCount(0);
  const retryButton = page.getByRole('button', { name: '基于已保存资料重新分析', exact: true });
  await expect(retryButton).toHaveCount(1);
  await expect(page.locator('.awb-analysis-start-row')).toContainText('基于已保存资料重新分析');
  await page.screenshot({ path: 'tmp/workbench-qa/analysis-retry.png', fullPage: true });
  await retryButton.click();
  await expect.poll(() => restarted).toEqual({id:data.jobs[0].id});
});
