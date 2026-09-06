import { test, expect } from '@playwright/test';
import { readFile, mkdir } from 'node:fs/promises';

const samples = JSON.parse(await readFile('tests/ibkr/fixtures/snapshots.json', 'utf8'));

test('empty account can search a broker contract and view delayed quotes without inventing holdings', async ({page}) => {
  await page.route('**/api/ibkr-terminal/snapshot?*',route=>route.fulfill({json:samples.empty}));
  await page.route('**/api/ibkr-terminal/market/contracts?*',route=>route.fulfill({json:{accountKey:'paper:engineering-fixture',mode:'paper',sessionRevision:1,
    contracts:[{conId:12,symbol:'TEST',currency:'USD',exchange:'NASDAQ',name:'工程行情合约'}]}}));
  await page.route('**/api/ibkr-terminal/market/quote?*',route=>route.fulfill({json:{accountKey:'paper:engineering-fixture',mode:'paper',sessionRevision:1,
    conId:12,state:'delayed',last:'100',bid:'99',ask:'101',close:'98',observedAt:new Date().toISOString(),brokerAsOf:null,source:'fixture.reqMktData',testData:true}}));
  await page.goto('http://127.0.0.1:5187/ibkr');
  await page.getByRole('searchbox',{name:'搜索合约或新闻'}).fill('TEST');
  await page.getByRole('button',{name:'TEST · NASDAQ · 查看行情'}).click();
  await expect(page.getByTestId('chart-symbol')).toHaveText('TEST');
  await expect(page.getByTestId('market-quote')).toContainText('延迟');
  await expect(page.getByTestId('market-quote')).toContainText('100');
  await expect(page.getByTestId('market-quote')).toContainText('成交时间未提供');
  await page.screenshot({path:'docs/design/ibkr/screenshots/market-watch-engineering.png'});
  await expect(page.getByRole('complementary',{name:'账户概览与持仓'})).toContainText('0 个标的');
  await page.getByRole('button',{name:'实盘 LIVE',exact:true}).click();
  await expect(page.getByTestId('chart-symbol')).toHaveText('选择合约');
  await expect(page.getByTestId('market-quote')).toHaveCount(0);
});

test('paper ticket has explicit risk setup and preserves Gateway diagnostic', async ({ page }) => {
  await page.route('**/api/ibkr-terminal/paper/status', route => route.fulfill({ json: {
    enabled: false, account: 'DU***TEST', accountKey: 'paper:unbound', policy: null, orders: [],
    connection: 'connected', state: 'permission-required', detail: 'IBKR_321：请核对 IB API 模式',
  } }));
  await page.goto('http://127.0.0.1:5187/ibkr');
  await page.getByRole('button', { name: '订单', exact: true }).click();
  await expect(page.getByTestId('paper-order-ticket')).toBeVisible();
  await expect(page.getByTestId('paper-order-ticket')).toContainText('IBKR_321');
  await expect(page.getByLabel('股票 / ETF 代码')).toBeVisible();
  await expect(page.getByRole('button', { name: '生成模拟盘订单预览', exact: true })).toBeDisabled();
  await expect(page.getByText('确认后发送至 IBKR 模拟盘', { exact: true })).toHaveCount(0);
});

test('manual paper UI requires risk scope and exact confirmation before sending', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  // Entire HTTP transport is intercepted below; no broker or account is contacted.
  let configured = false; let sends = 0; let previewed = false;
  const hash = 'a'.repeat(64);
  const expiry = new Date(Date.now() + 600000).toISOString();
  await page.route('**/api/ibkr-terminal/paper/**', async route => {
    const action = new URL(route.request().url()).pathname.split('/').at(-1);
    const state = { enabled: configured, account: 'ENGINEERING-ONLY', accountKey: 'paper:unbound',
      policy: configured ? { expiresAt: expiry, conIds: [12] } : null, orders: [],
      connection: 'connected', state: 'empty', detail: '离线交互测试，不是真实券商账户' };
    if (action === 'status') return route.fulfill({ json: state });
    if (action === 'contract') return route.fulfill({ json: [{ conId: 12, symbol: 'TEST', currency: 'USD', exchange: 'NASDAQ', name: '工程合约' }] });
    if (action === 'configure') {
      const body = route.request().postDataJSON();
      expect(body.explicit).toBe(true); expect(body.mode).toBe('paper'); expect(body.limits.maxOrderNotional).toBe('1000');
      configured = true; return route.fulfill({ json: { ...state, enabled: true, policy: { expiresAt: expiry, conIds: [12] } } });
    }
    if (action === 'preview') {
      previewed = true; const body = route.request().postDataJSON();
      return route.fulfill({ json: { ...body, previewId: 'preview:test', bodyHash: hash, expiresAt: expiry,
        symbol: 'TEST', currency: 'USD', snapshotId: 'engineering-only', reservedCash: '101', reservedNotional: '100', reservedQuantity: '0', testData: true,
        warnings: ['工程测试数据；此测试拦截所有发送。'] } });
    }
    if (action === 'confirm') {
      expect(route.request().postDataJSON()).toEqual({ previewId: 'preview:test', bodyHash: hash, explicit: true }); sends++;
      return route.fulfill({ json: { bodyHash: hash, intent: { accountKey: 'paper:unbound' }, submission: 'SUBMITTING', execution: 'PENDING' } });
    }
    return route.fulfill({ status: 403, json: { detail: 'TEST_DENIED' } });
  });
  await page.goto('http://127.0.0.1:5187/ibkr');
  await page.getByRole('button', { name: '订单', exact: true }).click();
  await page.getByLabel('股票 / ETF 代码').fill('TEST');
  await page.getByRole('button', { name: '查询 IBKR 合约' }).click();
  await page.getByText('设置本次模拟盘风险范围', { exact: true }).click();
  for (const [label,value] of [['单笔金额上限（USD）','1000'],['账户总敞口上限（USD）','1000'],['单标的权重上限（0～1）','1'],['日亏损停止线（USD）','50'],['每日订单数上限','10'],['每分钟订单数上限','10'],['限价偏离报价上限（0～1）','0.05'],['每笔手续费预留（USD）','1']]) await page.getByLabel(label,{exact:true}).fill(value);
  await expect(page.getByRole('button', { name: '保存模拟盘风险范围' })).toBeDisabled();
  await mkdir('docs/design/ibkr/screenshots', { recursive: true });
  await page.screenshot({ path: 'docs/design/ibkr/screenshots/paper-risk-setup-engineering.png' });
  await page.getByLabel(/我确认以上范围仅用于当前模拟账户/).check();
  await page.getByRole('button', { name: '保存模拟盘风险范围' }).click();
  await page.getByLabel('整股数量').fill('1'); await page.getByLabel('限价（USD）', {exact:true}).fill('100');
  await page.getByRole('button', { name: '生成模拟盘订单预览' }).click();
  const send = page.getByRole('button', { name: '确认后发送至 IBKR 模拟盘' });
  await expect(send).toBeDisabled(); expect(previewed).toBe(true); expect(sends).toBe(0);
  await page.getByLabel('我确认将以上精确订单发送到 IBKR 模拟账户').check();
  await send.click();
  await expect(page.getByTestId('paper-order-ticket')).toContainText('SUBMITTING / PENDING');
  expect(sends).toBe(1);
});
const contrast = (foreground: string, background: string) => {
  const luminance = (hex: string) => {
    const channels = hex.match(/[0-9a-f]{2}/gi)!.map(value => Number.parseInt(value, 16) / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  };
  const [bright, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (bright + 0.05) / (dark + 0.05);
};

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/api/**', route => route.fulfill({ status: 503, json: { detail: '离线测试：服务未连接' } }));
  await page.route(/^https?:\/\/(?!127\.0\.0\.1:5187)/, route => route.abort());
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 1440, height: 1000 }, { width: 1920, height: 1080 }, { width: 1024, height: 768 }, { width: 390, height: 844 }]) {
  test(`production empty layout ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('http://127.0.0.1:5187/ibkr');
    const terminal = page.getByTestId('ibkr-terminal');
    await expect(terminal).toBeVisible();
    await expect(page.getByTestId('connection-status')).toContainText('未连接');
    await expect(page.getByTestId('account-workspace')).toBeVisible();
    await expect(page.getByRole('tab', { name: '新闻', exact: true })).toBeVisible();
    await expect(terminal).not.toContainText('284,650');
    await expect(terminal).not.toContainText('75 分');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (viewport.width >= 1440) {
      const left = await page.getByTestId('account-sidebar').boundingBox();
      const right = await page.getByTestId('account-ai').boundingBox();
      expect(left?.width).toBe(268);
      expect(right?.width).toBe(352);
    }
    await mkdir('docs/design/ibkr/screenshots', { recursive: true });
    await page.screenshot({ path: `docs/design/ibkr/screenshots/terminal-empty-${viewport.width}x${viewport.height}.png` });
  });
}

test('collapse, keyboard search, bottom resize and live view do not grant permissions', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('http://127.0.0.1:5187/ibkr');
  await page.getByRole('button', { name: '折叠账户栏' }).click();
  await expect(page.getByTestId('account-sidebar')).toBeHidden();
  await page.getByRole('button', { name: '展开账户栏' }).click();
  await expect(page.getByTestId('account-sidebar')).toBeVisible();
  await page.getByRole('button', { name: '折叠 AI 栏' }).click();
  await expect(page.getByTestId('account-ai')).toBeHidden();
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('searchbox')).toBeFocused();
  const resize = page.getByRole('separator', { name: '调整资讯区域高度' });
  await resize.focus();
  const before = Number(await resize.getAttribute('aria-valuenow'));
  await page.keyboard.press('ArrowUp');
  await expect(resize).toHaveAttribute('aria-valuenow', String(before + 20));
  const box = (await resize.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y - 40);
  await page.mouse.up();
  expect(Number(await resize.getAttribute('aria-valuenow'))).toBeGreaterThan(before + 20);
  await page.getByRole('button', { name: '实盘 LIVE', exact: true }).click();
  await expect(page.getByTestId('ibkr-terminal')).toContainText('实盘只读 · 交易未授权');
  await page.getByRole('tab', { name: '宏观', exact: true }).click();
  await expect(page.getByTestId('intelligence-body')).toContainText('宏观');
});

test('explicit fixture is labelled and selection links chart and intelligence', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.route('**/api/ibkr-terminal/snapshot?**', route => route.fulfill({ json: samples.multiCurrency }));
  await page.goto('http://127.0.0.1:5187/ibkr');
  await expect(page.getByText('工程测试数据 · 非真实券商账户', { exact: true })).toBeVisible();
  await page.getByTestId('account-sidebar').getByRole('button', { name: /TEST-ETF/ }).click();
  await expect(page.getByTestId('chart-symbol')).toContainText('TEST-ETF');
  await expect(page.getByTestId('intelligence-body')).toContainText('TEST-ETF');
  await page.getByRole('button', { name: '实盘 LIVE', exact: true }).click();
  await expect(page.getByTestId('chart-symbol')).not.toContainText('TEST-ETF');
  await expect(page.getByTestId('account-sidebar')).not.toContainText('TEST-ETF');
});

test('late paper response cannot populate live view', async ({ page }) => {
  let release!: () => void;
  let requested!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { requested = resolve; });
  await page.route('**/api/ibkr-terminal/snapshot?mode=paper', async route => {
    requested();
    await pending;
    await route.fulfill({ json: samples.multiCurrency });
  });
  await page.goto('http://127.0.0.1:5187/ibkr');
  await started;
  await page.getByRole('button', { name: '实盘 LIVE', exact: true }).click();
  release();
  await expect(page.getByTestId('connection-status')).toContainText('未连接');
  await expect(page.getByTestId('ibkr-terminal')).not.toContainText('TEST-ETF');
  await expect(page.getByTestId('ibkr-terminal')).not.toContainText('工程测试数据');
});

test('websocket delta updates account, gap fetches snapshot, mode switch closes old stream', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  let baseline = samples.multiCurrency;
  let reads = 0;
  let stream: import('@playwright/test').WebSocketRoute | undefined;
  let closed = 0;
  await page.route('**/api/ibkr-terminal/snapshot?**', route => { reads++; return route.fulfill({ json: baseline }); });
  await page.routeWebSocket('**/api/ibkr-terminal/events?**', ws => {
    stream = ws;
    ws.onClose(() => { closed++; });
    ws.send(JSON.stringify({ kind: 'heartbeat', mode: baseline.mode, accountKey: baseline.accountKey, sessionRevision: 1, sequence: baseline.sequence }));
  });
  await page.goto('http://127.0.0.1:5187/ibkr');
  await expect.poll(() => Boolean(stream)).toBe(true);
  const scope = { mode: baseline.mode, accountKey: baseline.accountKey, sessionRevision: 1 };
  stream!.send(JSON.stringify({ ...scope, kind: 'snapshot.patch', previousSequence: 1, sequence: 2, payload: { metrics: { ...baseline.metrics, netLiquidation: '1250.25' } } }));
  await expect(page.locator('.ibkr-header-metric').first()).toContainText('1,250.25');
  baseline = { ...baseline, sequence: 4, metrics: { ...baseline.metrics, netLiquidation: '2220.00' } };
  stream!.send(JSON.stringify({ ...scope, kind: 'snapshot.patch', previousSequence: 3, sequence: 4, payload: {} }));
  await expect.poll(() => reads).toBe(2);
  await expect(page.locator('.ibkr-header-metric').first()).toContainText('2,220.00');
  await page.getByRole('button', { name: '实盘 LIVE', exact: true }).click();
  await expect.poll(() => closed).toBe(2);
  await expect(page.getByTestId('ibkr-terminal')).not.toContainText('2,220.00');
});

test('missed stream heartbeat marks retained account data stale', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-09-04T12:00:00Z') });
  await page.route('**/api/ibkr-terminal/snapshot?**', route => route.fulfill({ json: samples.multiCurrency }));
  let connected = false;
  await page.routeWebSocket('**/api/ibkr-terminal/events?**', () => { connected = true; });
  await page.goto('http://127.0.0.1:5187/ibkr');
  await expect.poll(() => connected).toBe(true);
  await page.clock.runFor(20000);
  await expect(page.getByTestId('ibkr-terminal')).toContainText('数据已过期');
  await expect(page.getByTestId('connection-status')).toContainText('未连接');
});

test('account, order and AI regions explain stale data independently', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const stale = { ...samples.multiCurrency, state: 'stale', connection: 'disconnected', positions: [], orders: [], quotes: [] };
  await page.route('**/api/ibkr-terminal/snapshot?**', route => route.fulfill({ json: stale }));
  await page.routeWebSocket('**/api/ibkr-terminal/events?**', () => {});
  await page.goto('http://127.0.0.1:5187/ibkr');
  await expect(page.getByTestId('account-sidebar')).toContainText('保留数据已过期，等待重新对账');
  await expect(page.getByTestId('account-ai')).toContainText('账户快照已过期，已暂停分析');
  await page.getByRole('button', { name: '订单', exact: true }).click();
  await expect(page.getByTestId('order-ticket')).toContainText('账户快照已过期，拒绝新增风险');
});

test('read-only fills show broker identifiers, missing commission and source timing', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const snapshot = { ...samples.multiCurrency, executions: [{ accountKey: samples.multiCurrency.accountKey, execId: 'OFFLINE-EXEC-1', conId: 9000001, symbol: 'TEST-ETF', currency: 'USD', orderId: 7, clientId: 91, permId: 123, side: 'BOT', quantity: '2', price: '99.00', executedAt: '2026-09-04T14:00:00+00:00', commission: null, commissionCurrency: null }],
    provenance: { 'metrics.netLiquidation': { source: 'fixture.accountSummary', observedAt: '2026-09-04T14:00:00Z', brokerAsOf: null, requestCompletedAt: null } } };
  await page.route('**/api/ibkr-terminal/snapshot?**', route => route.fulfill({ json: snapshot }));
  await page.routeWebSocket('**/api/ibkr-terminal/events?**', () => {});
  await page.goto('http://127.0.0.1:5187/ibkr');
  await page.getByRole('tab', { name: '成交', exact: true }).click();
  await expect(page.getByTestId('account-workspace')).toContainText('OFFLINE-EXEC-1');
  await expect(page.getByTestId('account-workspace')).toContainText('手续费待回报');
  await page.getByText('数据来源与时间', { exact: true }).click();
  await expect(page.getByTestId('account-sidebar')).toContainText('券商原始时间未提供');
});

test('order workspace stays blocked when the account service is unavailable or live is selected', async ({ page }) => {
  await page.goto('http://127.0.0.1:5187/ibkr');
  await page.getByRole('button', { name: '订单', exact: true }).click();
  await expect(page.getByTestId('paper-order-ticket')).toContainText('本地账户服务未连接');
  await expect(page.getByRole('button', { name: '生成模拟盘订单预览' })).toBeDisabled();
  await expect(page.getByRole('button', { name: '确认后发送至 IBKR 模拟盘' })).toHaveCount(0);
  await page.getByRole('button', { name: '实盘 LIVE', exact: true }).click();
  await expect(page.getByTestId('order-ticket')).toContainText('实盘写入保持关闭');
});

test('settings separates read-only, manual, automatic and AI authorization scopes', async ({ page }) => {
  await page.goto('http://127.0.0.1:5187/ibkr');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  const matrix = page.getByRole('region', { name: '交易与数据授权矩阵' });
  await expect(matrix).toContainText('账户查看');
  await expect(matrix).toContainText('人工订单');
  await expect(matrix).toContainText('自动策略');
  await expect(matrix).toContainText('账户 AI 分享');
  await expect(matrix.getByRole('row').filter({ hasText: '人工订单' })).toContainText('在订单工作区查看状态');
  await expect(matrix.getByRole('row').filter({ hasText: '自动策略' })).toContainText('未授权');
  await expect(matrix.getByRole('row').filter({ hasText: '账户 AI 分享' })).toContainText('关闭');
  await page.getByRole('button', { name: '实盘 LIVE', exact: true }).click();
  await expect(matrix).toContainText('LIVE 写入保持关闭');
  await expect(matrix.getByRole('row').filter({ hasText: '人工订单' })).toContainText('未授权');
});

test('paper order preview sends only draft fields and confirmation remains local', async ({ page }) => {
  const position = samples.multiCurrency.positions[0];
  const quote = { conId: position.conId, state: 'realtime', price: '100', asOf: '2026-09-05T09:59:59Z', source: 'fixture.quote' };
  const snapshot = { ...samples.multiCurrency, state: 'ready', connection: 'connected', quotes: [quote] };
  let draftBody: Record<string, unknown> | undefined;
  let confirmationBody: Record<string, unknown> | undefined;
  await page.route('**/api/ibkr-terminal/snapshot?**', route => route.fulfill({ json: snapshot }));
  await page.routeWebSocket('**/api/ibkr-terminal/events?**', () => {});
  await page.route('**/api/ibkr-terminal/orders/preview', async route => {
    draftBody = route.request().postDataJSON();
    await route.fulfill({ json: { ...draftBody, previewId: 'preview:test', bodyHash: 'a'.repeat(64), expiresAt: '2026-09-05T10:00:00Z',
      symbol: position.symbol, currency: position.currency, snapshotId: snapshot.snapshotId,
      reservedCash: '201', reservedNotional: '200', reservedQuantity: '0', testData: true,
      warnings: ['工程测试数据；不得视为 IBKR 账户事实。', '确认仅在本地持久化；券商提交仍保持禁用。'] } });
  });
  await page.route('**/api/ibkr-terminal/orders/previews/*/confirm', async route => {
    confirmationBody = route.request().postDataJSON();
    await route.fulfill({ json: { submission: 'PERSISTED', orderId: null, permId: null,
      intent: { accountKey: snapshot.accountKey, clientIntentId: 'manual:test', quantity: '2', limitPrice: quote.price } } });
  });
  await page.goto('http://127.0.0.1:5187/ibkr');
  await page.getByRole('button', { name: '订单', exact: true }).click();
  await page.getByLabel('数量（股）').fill('2');
  await page.getByRole('button', { name: '生成风险预览' }).click();
  await expect(page.getByRole('region', { name: '订单风险预览' })).toContainText('工程测试数据');
  expect(Object.keys(draftBody!).sort()).toEqual(['accountKey', 'conId', 'limitPrice', 'mode', 'orderType', 'quantity', 'side', 'tif']);
  await page.getByLabel('我确认以上精确条款，仅保存本地意图').check();
  await page.getByRole('button', { name: '确认并本地保存' }).click();
  await expect(page.getByTestId('order-ticket')).toContainText('尚未提交至 IBKR');
  expect(confirmationBody).toEqual({ bodyHash: 'a'.repeat(64), explicit: true });
});

test('right panel shows deterministic risk, closed AI sharing and scoped local report exports', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const snapshot = { ...samples.multiCurrency, state: 'ready', connection: 'connected' };
  const reportHash = 'c'.repeat(64);
  const reportJobId = `report-job:${'6'.repeat(32)}`;
  let reportReady = false;
  await page.route('**/api/ibkr-terminal/snapshot?**', route => route.fulfill({ json: snapshot }));
  await page.routeWebSocket('**/api/ibkr-terminal/events?**', () => {});
  await page.route('**/api/ibkr-terminal/analysis/risk?**', route => route.fulfill({ json: {
    accountKey: snapshot.accountKey, mode: 'paper', snapshotId: snapshot.snapshotId, source: 'fixture', testData: true,
    generatedAt: '2026-09-05T12:00:00Z', asOf: snapshot.asOf, ageSeconds: 0, status: 'partial',
    metrics: {
      grossExposure: { value: '800', unit: 'USD', state: 'ready', evidence: [] },
      netExposure: { value: '800', unit: 'USD', state: 'ready', evidence: [] },
      largestPositionWeight: { value: '0.6', unit: 'ratio', state: 'ready', evidence: [] },
      marginUsage: { value: '0.2', unit: 'ratio', state: 'ready', evidence: [] },
    }, cashByCurrency: { USD: '200' }, cashEvidence: [], totalCashBase: '200', positionCount: 2,
    openOrderCount: 0, openOrderEvidence: [], findings: [{ code: 'TEST_DATA', severity: 'info', explanation: '工程测试数据，不代表账户事实。' }],
  } }));
  await page.route('**/api/ibkr-terminal/ai/status?**', route => route.fulfill({ json: { sharingEnabled: false, activeGrant: null, modelCalls: false } }));
  await page.route('**/api/ibkr-terminal/reports?**', route => route.fulfill({ json: reportReady ? [{
    reportHash, snapshotHash: 'd'.repeat(64), snapshotId: snapshot.snapshotId, accountKey: snapshot.accountKey,
    mode: 'paper', generatedAt: '2026-09-05T12:00:00Z', status: 'partial', testData: true,
    formats: ['json', 'markdown', 'html', 'pdf'],
  }] : [] }));
  await page.route('**/api/ibkr-terminal/reports/jobs', route => { reportReady = true; return route.fulfill({ json: {
    jobId: reportJobId, accountKey: snapshot.accountKey, mode: 'paper', snapshotId: snapshot.snapshotId, state: 'COMPLETED',
    createdAt: '2026-09-05T12:00:00Z', updatedAt: '2026-09-05T12:00:01Z', testData: true, reportHash, errorCode: null, workerThreadId: 7,
  } }); });
  await page.route('**/api/ibkr-terminal/reports', route => route.fulfill({ json: {
    reportHash, snapshotHash: 'd'.repeat(64), snapshotId: snapshot.snapshotId, accountKey: snapshot.accountKey,
    mode: 'paper', generatedAt: '2026-09-05T12:00:00Z', status: 'partial', testData: true,
    formats: ['json', 'markdown', 'html', 'pdf'],
  } }));
  await page.goto('http://127.0.0.1:5187/ibkr');
  const panel = page.getByTestId('account-ai');
  await expect(panel).toContainText(/总敞口\s*800 USD/);
  await expect(panel).toContainText(/最大仓位\s*60.00%/);
  await expect(panel).toContainText('账户数据分享已关闭');
  await panel.getByRole('button', { name: '生成本地报告' }).click();
  await expect(panel.getByRole('link', { name: 'PDF' })).toHaveAttribute('href', new RegExp(`${reportHash}/pdf`));
  await expect(panel).toContainText('工程测试报告');
});

test('right panel creates a durable report job and polls it without blocking account data', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const snapshot = { ...samples.multiCurrency, state: 'ready', connection: 'connected' };
  const reportHash = '9'.repeat(64);
  const jobId = `report-job:${'8'.repeat(32)}`;
  let submitted = 0;
  let jobReads = 0;
  let reportBody: any;
  await page.route('**/api/ibkr-terminal/snapshot?**', route => route.fulfill({ json: snapshot }));
  await page.routeWebSocket('**/api/ibkr-terminal/events?**', () => {});
  await page.route('**/api/ibkr-terminal/analysis/risk?**', route => route.fulfill({ json: {
    accountKey: snapshot.accountKey, mode: 'paper', snapshotId: snapshot.snapshotId, source: 'fixture', testData: true,
    generatedAt: '2026-09-05T12:00:00Z', asOf: snapshot.asOf, ageSeconds: 0, status: 'partial',
    metrics: { grossExposure: { value: '800', unit: 'USD', state: 'ready', evidence: [] }, netExposure: { value: '800', unit: 'USD', state: 'ready', evidence: [] }, largestPositionWeight: { value: '0.6', unit: 'ratio', state: 'ready', evidence: [] }, marginUsage: { value: '0.2', unit: 'ratio', state: 'ready', evidence: [] } },
    cashByCurrency: { USD: '200' }, cashEvidence: [], totalCashBase: '200', positionCount: 2, openOrderCount: 0, openOrderEvidence: [], findings: [],
  } }));
  await page.route('**/api/ibkr-terminal/ai/status?**', route => route.fulfill({ json: { sharingEnabled: false, activeGrant: null, modelCalls: false } }));
  await page.route('**/api/news-feed', route => route.fulfill({ json: { generatedAt: '2026-09-05T12:00:00Z', proxy: 'fixture', categories: [], sources: [], items: [
    { id: 'report-news', title: 'TEST-ETF verified catalyst', summary: 'Evidence for export.', source: 'Fixture News', url: 'https://example.test/report-news', category: 'finance', publishedAt: '2026-09-05T11:00:00Z', observedAt: '2026-09-05T12:00:00Z' },
  ] } }));
  await page.route('**/api/global-macro-dashboard?region=global&section=macro', route => route.fulfill({ json: { generatedAt: '2026-09-05T12:00:00Z', macro: [
    { id: 'rates', label: 'US 10Y', display: '4.25%', status: 'delayed', updatedAt: '2026-09-05T10:00:00Z', sourceUrl: 'https://example.test/rates' },
  ] } }));
  await page.route('**/api/ibkr-terminal/reports?**', route => route.fulfill({ json: jobReads ? [{ reportHash, snapshotHash: '7'.repeat(64), snapshotId: snapshot.snapshotId, accountKey: snapshot.accountKey, mode: 'paper', generatedAt: '2026-09-05T12:00:00Z', status: 'partial', testData: true, formats: ['json', 'markdown', 'html', 'pdf'] }] : [] }));
  await page.route('**/api/ibkr-terminal/reports/jobs', route => { submitted++; reportBody = route.request().postDataJSON(); return route.fulfill({ json: { jobId, mode: 'paper', accountKey: snapshot.accountKey, snapshotId: snapshot.snapshotId, state: 'RUNNING', createdAt: '2026-09-05T12:00:00Z', updatedAt: '2026-09-05T12:00:00Z', testData: true, reportHash: null, errorCode: null, workerThreadId: 10 } }); });
  await page.route('**/api/ibkr-terminal/reports/jobs/*?**', route => { jobReads++; return route.fulfill({ json: { jobId, mode: 'paper', accountKey: snapshot.accountKey, snapshotId: snapshot.snapshotId, state: 'COMPLETED', createdAt: '2026-09-05T12:00:00Z', updatedAt: '2026-09-05T12:00:01Z', testData: true, reportHash, errorCode: null, workerThreadId: 10 } }); });
  await page.goto('http://127.0.0.1:5187/ibkr');
  const panel = page.getByTestId('account-ai');
  await panel.getByRole('button', { name: '生成本地报告' }).click();
  await expect(panel).toContainText('COMPLETED');
  await expect(panel.getByRole('link', { name: 'PDF' })).toHaveAttribute('href', new RegExp(reportHash));
  expect(submitted).toBe(1);
  expect(jobReads).toBeGreaterThanOrEqual(1);
  expect(reportBody.evidence.items.map((row: any) => [row.kind, row.relation, row.linkedConIds])).toEqual([
    ['news', 'SYMBOL_MENTION', [snapshot.positions[0].conId]], ['macro', 'ACCOUNT_CONTEXT_NOT_CAUSAL', []],
  ]);
  expect(reportBody.evidence.gaps).toEqual(['MICRO_PERMISSION_REQUIRED']);
});

test('historical chart renders a source-labelled 10000 bar dataset independently', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const position = samples.multiCurrency.positions[0];
  const snapshot = { ...samples.multiCurrency, state: 'ready', connection: 'connected' };
  const start = Date.parse('2026-08-01T00:00:00Z');
  const bars = Array.from({ length: 10_000 }, (_, index) => ({
    time: new Date(start + index * 60_000).toISOString(), open: '100', high: '101', low: '99', close: String(100 + index % 2), volume: '1000',
  }));
  await page.route('**/api/ibkr-terminal/snapshot?**', route => route.fulfill({ json: snapshot }));
  await page.routeWebSocket('**/api/ibkr-terminal/events?**', () => {});
  await page.route('**/api/ibkr-terminal/market-data?**', route => route.fulfill({ json: {
    schemaVersion: 1, accountKey: snapshot.accountKey, mode: 'paper', snapshotId: snapshot.snapshotId,
    conId: position.conId, period: '1D', barSize: '1 min', timezone: 'UTC', source: 'fixture.historical',
    testData: true, asOf: '2026-09-05T12:00:00Z', state: 'ready', missing: [], bars, dataHash: 'e'.repeat(64),
  } }));
  await page.goto('http://127.0.0.1:5187/ibkr');
  await page.getByTestId('account-sidebar').getByRole('button', { name: /TEST-ETF/ }).click();
  await expect(page.getByTestId('historical-chart')).toBeVisible();
  await expect(page.getByLabel('行情图表')).toContainText('fixture.historical · 10,000 根');
  await expect(page.getByLabel('行情图表')).toContainText('工程行情');
});

test('historical chart preserves a permission-required empty state', async ({ page }) => {
  const snapshot = { ...samples.multiCurrency, state: 'ready', connection: 'connected' };
  const position = snapshot.positions[0];
  await page.route('**/api/ibkr-terminal/snapshot?**', route => route.fulfill({ json: snapshot }));
  await page.routeWebSocket('**/api/ibkr-terminal/events?**', () => {});
  await page.route('**/api/ibkr-terminal/market-data?**', route => route.fulfill({ json: {
    schemaVersion: 1, accountKey: snapshot.accountKey, mode: 'paper', snapshotId: snapshot.snapshotId,
    conId: position.conId, period: '1D', barSize: '1 min', timezone: 'UTC', source: 'ibkr.historical',
    testData: false, asOf: null, state: 'permission-required', missing: ['MARKET_DATA_PERMISSION'], bars: [], dataHash: 'f'.repeat(64),
  } }));
  await page.goto('http://127.0.0.1:5187/ibkr');
  await page.getByTestId('account-sidebar').getByRole('button', { name: /TEST-ETF/ }).click();
  await expect(page.getByLabel('行情图表')).toContainText('历史行情权限未配置');
  await expect(page.getByLabel('行情图表')).toContainText('MARKET_DATA_PERMISSION');
});

test('analysis workspace keeps missing strategy and data source explicit', async ({ page }) => {
  await page.goto('http://127.0.0.1:5187/ibkr');
  await page.getByRole('button', { name: '分析', exact: true }).click();
  await expect(page.getByTestId('strategy-workspace')).toContainText('用户策略');
  await expect(page.getByTestId('strategy-workspace')).toContainText('尚未配置生产数据集');
  await expect(page.getByRole('button', { name: /运行回测/ })).toBeDisabled();
  await expect(page.getByTestId('strategy-workspace')).toContainText('回测服务不可用');
});

test('structured strategy editor creates a local whitelist draft without saving or activation', async ({ page }) => {
  await page.route('**/api/ibkr-terminal/snapshot?**', route => route.fulfill({ json: { ...samples.multiCurrency, state: 'ready', connection: 'connected' } }));
  await page.goto('http://127.0.0.1:5187/ibkr');
  await page.getByRole('button', { name: '分析', exact: true }).click();
  await page.getByText('结构化策略草稿', { exact: true }).click();
  const editor = page.getByTestId('strategy-draft-editor');
  await editor.getByLabel('用户策略 ID').fill('user:verified-draft');
  await editor.getByLabel('快速窗口').fill('2');
  await editor.getByLabel('慢速窗口').fill('5');
  await editor.getByLabel('目标整股数量').fill('4');
  await editor.getByLabel('最大持仓数量').fill('4');
  await editor.getByRole('button', { name: '生成本地草稿' }).click();
  await expect(editor.getByTestId('strategy-draft-json')).toContainText('"kind": "sma_cross"');
  await expect(editor).toContainText('未保存、未回测、未授权、未激活');
  await expect(editor).not.toContainText('authorizationId');
});

test('analysis workspace labels engineering runs, exposes hashes and cancels only known jobs', async ({ page }) => {
  const hash = 'a'.repeat(64);
  const jobId = `backtest:${'b'.repeat(32)}`;
  const strategy = { definition: { strategyId: 'example:test', version: '1.0.0', origin: 'fixture', name: '工程均线示例',
    universe: [12], barInterval: '1D', entryRule: '信号后下一根 bar 买入', exitRule: '退出信号后下一根 bar 卖出', parameters: { targetQuantity: '2' },
    signal: { kind: 'sma_cross', priceField: 'close', fastWindow: 2, slowWindow: 5, entryWhen: 'FAST_ABOVE_SLOW', exitWhen: 'FAST_AT_OR_BELOW_SLOW' },
    positionSizing: { kind: 'fixed_quantity', targetQuantity: '2' }, costs: { commissionPerOrder: '0', commissionPerShare: '0', slippageBps: '0' },
    risk: { allowShort: false, maxPositionQuantity: '2' }, versionNotes: '工程示例。' },
    strategyHash: hash, createdAt: '2026-09-05T00:00:00Z' };
  const run = { strategyId: 'example:test', strategyVersion: '1.0.0', strategyHash: hash, datasetHash: hash,
    configHash: hash, runHash: hash, startedAt: '2026-09-05T00:00:00Z', barCount: 3, testData: true,
    executions: [], corporateActions: [], equityCurve: [
      { timestamp: '2026-09-03T00:00:00Z', cash: '1000', marketValue: '0', equity: '1000', drawdown: '0' },
      { timestamp: '2026-09-04T00:00:00Z', cash: '900', marketValue: '105', equity: '1005', drawdown: '0' },
      { timestamp: '2026-09-05T00:00:00Z', cash: '1010', marketValue: '0', equity: '1010', drawdown: '0' },
    ], logs: [], metrics: { initialCash: '1000', finalCash: '1010', finalMarketValue: '0',
      finalEquity: '1010', totalReturn: '0.01', totalFees: '0', slippageCost: '0', dividends: '0', maxDrawdown: '0', benchmarkReturn: '0.02', turnover: '0.2', returnVolatility: null, riskAdjustedReturn: null, riskFormulaVersion: 'period-return-v1', tradeCount: 2 } };
  const job = { jobId, state: 'RUNNING', createdAt: '2026-09-05T00:00:00Z', updatedAt: '2026-09-05T00:00:01Z',
    testData: true, runHash: null, errorCode: null, workerThreadId: 9 };
  let cancelCalls = 0;
  await page.route('**/api/ibkr-terminal/strategies', route => route.fulfill({ json: [strategy] }));
  await page.route('**/api/ibkr-terminal/backtests', route => route.fulfill({ json: [run] }));
  await page.route('**/api/ibkr-terminal/backtests/jobs', route => route.fulfill({ json: [job] }));
  await page.route('**/api/ibkr-terminal/backtests/jobs/*/cancel', async route => {
    cancelCalls++; await route.fulfill({ json: { ...job, state: 'CANCEL_REQUESTED', errorCode: 'JOB_CANCELLED' } });
  });
  await page.goto('http://127.0.0.1:5187/ibkr');
  await page.getByRole('button', { name: '分析', exact: true }).click();
  const workspace = page.getByTestId('strategy-workspace');
  await expect(workspace).toContainText('工程均线示例');
  await expect(workspace).toContainText('工程测试');
  await expect(workspace).toContainText('1010 USD');
  await expect(workspace.getByRole('img', { name: '权益曲线，共 3 个可复现数据点' })).toBeVisible();
  await expect(workspace).toContainText(/持有基准\s*0.02/);
  await expect(workspace).toContainText(/区间波动\s*样本不足/);
  await workspace.getByText('可复现证据', { exact: true }).click();
  await expect(workspace).toContainText(hash);
  await page.getByRole('button', { name: '取消任务' }).click();
  await expect(workspace).toContainText('CANCEL_REQUESTED');
  expect(cancelCalls).toBe(1);
});

test('strategy workspace shows scoped runtime decisions and stop only pauses new signals', async ({ page }) => {
  const snapshot = { ...samples.multiCurrency, state: 'ready', connection: 'connected' };
  const activationId = `activation:${'a'.repeat(32)}`;
  let stopBody: unknown;
  await page.route('**/api/ibkr-terminal/snapshot?**', route => route.fulfill({ json: snapshot }));
  await page.routeWebSocket('**/api/ibkr-terminal/events?**', () => {});
  await page.route('**/api/ibkr-terminal/strategy-runtime?**', route => route.fulfill({ json: [{
    activationId, accountKey: snapshot.accountKey, mode: 'paper', sessionRevision: 1,
    strategyId: 'example:runtime', strategyVersion: 'example:runtime@1.0.0:1234567890abcdef', strategyHash: '1'.repeat(64),
    authorizationId: 'fixture-auth', testData: true, state: 'RUNNING', activatedAt: '2026-09-05T12:00:00Z', expiresAt: '2026-09-05T13:00:00Z',
    updatedAt: '2026-09-05T12:00:00Z', lastSignalSequence: 1, lastSnapshotId: snapshot.snapshotId, reason: null,
  }] }));
  await page.route('**/api/ibkr-terminal/strategy-runtime/*/stop', async route => {
    stopBody = route.request().postDataJSON();
    const body = await route.request().postDataJSON();
    await route.fulfill({ json: { activationId, accountKey: snapshot.accountKey, mode: 'paper', sessionRevision: 1,
      strategyId: 'example:runtime', strategyVersion: 'example:runtime@1.0.0:1234567890abcdef', strategyHash: '1'.repeat(64),
      authorizationId: 'fixture-auth', testData: true, state: 'STOPPED', activatedAt: '2026-09-05T12:00:00Z', expiresAt: '2026-09-05T13:00:00Z',
      updatedAt: '2026-09-05T12:01:00Z', lastSignalSequence: 1, lastSnapshotId: snapshot.snapshotId, reason: 'USER_STOPPED_NEW_SIGNALS', ...body } });
  });
  await page.goto('http://127.0.0.1:5187/ibkr');
  await page.getByRole('button', { name: '分析', exact: true }).click();
  const workspace = page.getByTestId('strategy-workspace');
  await expect(workspace).toContainText('example:runtime');
  await expect(workspace).toContainText('RUNNING');
  await workspace.getByRole('button', { name: '停止新增信号' }).click();
  await expect(workspace).toContainText('STOPPED');
  expect(stopBody).toEqual({ mode: 'paper', accountKey: snapshot.accountKey });
  await expect(workspace).toContainText('不会自动撤单或平仓');
});

test('intelligence area renders source-timed news and keeps macro and micro gaps explicit', async ({ page }) => {
  const snapshot = { ...samples.multiCurrency, state: 'ready', connection: 'connected' };
  await page.route('**/api/ibkr-terminal/snapshot?**', route => route.fulfill({ json: snapshot }));
  await page.routeWebSocket('**/api/ibkr-terminal/events?**', () => {});
  await page.route('**/api/news-feed', route => route.fulfill({ json: {
    generatedAt: '2026-09-05T12:05:00Z', proxy: 'local-test',
    categories: [{ id: 'finance', label: '金融 / 商业', count: 2, topWeight: 90, averageWeight: 80 }],
    sources: [{ id: 'official-test', label: '测试官方源', category: 'finance', categoryLabel: '金融 / 商业', origin: 'foreign', route: 'direct', ok: true, count: 2, fetchedAt: '2026-09-05T12:04:00Z' }],
    items: [
      { id: 'holding-news', title: 'TEST-ETF publishes verified filing', url: 'https://example.test/filing', source: '测试官方源', category: 'finance', categoryLabel: '金融 / 商业', origin: 'foreign', route: 'direct', publishedAt: '2026-09-05T12:00:00Z', observedAt: '2026-09-05T12:04:00Z', heat: 5, importance: 90, recency: 99, weight: 90, weightLabel: '高' },
      { id: 'other-news', title: 'Unrelated market report', url: 'javascript:alert(1)', source: '测试官方源', category: 'finance', categoryLabel: '金融 / 商业', origin: 'foreign', route: 'direct', publishedAt: '2026-09-05T11:00:00Z', observedAt: '2026-09-05T12:04:00Z', stale: true, heat: 2, importance: 50, recency: 60, weight: 60, weightLabel: '中' },
      { id: 'html-news', title: '<img src=x onerror=alert(1)> external text', url: '', source: '测试官方源', category: 'finance', categoryLabel: '金融 / 商业', origin: 'foreign', route: 'direct', publishedAt: '2026-09-05T10:00:00Z', observedAt: '2026-09-05T12:04:00Z', heat: 1, importance: 30, recency: 40, weight: 40, weightLabel: '低' },
    ],
  } }));
  await page.route('**/api/global-macro-dashboard?region=global&section=macro', route => route.fulfill({ json: {
    generatedAt: '2026-09-05T12:06:00Z', macro: [{ id: 'us10y', label: '美国十年期国债收益率', value: 4.25, display: '4.25%', updatedAt: '2026-09-05T12:03:00Z', sourceUrl: 'https://fred.example.test/us10y', status: 'delayed', history: [] }],
  } }));
  await page.goto('http://127.0.0.1:5187/ibkr');
  const intelligence = page.getByTestId('intelligence-body');
  await expect(intelligence).toContainText('TEST-ETF publishes verified filing');
  await expect(intelligence).toContainText('测试官方源');
  await expect(intelligence).toContainText('抓取 09/05 20:04');
  await expect(intelligence.locator('a')).toHaveCount(1);
  await expect(intelligence).toContainText('<img src=x onerror=alert(1)> external text');
  await expect(intelligence.locator('img')).toHaveCount(0);
  await mkdir('docs/design/ibkr/screenshots', { recursive: true });
  await page.screenshot({ path: 'docs/design/ibkr/screenshots/intelligence-news-engineering.png' });
  await page.getByRole('button', { name: '我的持仓', exact: true }).click();
  await expect(intelligence).toContainText('TEST-ETF publishes verified filing');
  await expect(intelligence).not.toContainText('Unrelated market report');
  await page.getByRole('tab', { name: '宏观', exact: true }).click();
  await expect(intelligence).toContainText('美国十年期国债收益率');
  await expect(intelligence).toContainText('4.25%');
  await expect(intelligence.getByRole('link', { name: /美国十年期国债收益率/ })).toHaveAttribute('href', 'https://fred.example.test/us10y');
  await expect(intelligence).toContainText('统计期未单列');
  await expect(intelligence).toContainText('未映射账户结论');
  await page.getByRole('tab', { name: '微观', exact: true }).click();
  await expect(intelligence).toContainText('微观数据尚未接入');
});

test('keyboard search separates account contracts from source-linked news', async ({ page }) => {
  const snapshot = { ...samples.multiCurrency, state: 'ready', connection: 'connected' };
  await page.route('**/api/ibkr-terminal/snapshot?**', route => route.fulfill({ json: snapshot }));
  await page.routeWebSocket('**/api/ibkr-terminal/events?**', () => {});
  await page.route('**/api/news-feed', route => route.fulfill({ json: {
    generatedAt: '2026-09-05T12:05:00Z', proxy: 'local-test', categories: [], sources: [],
    items: [{ id: 'search-news', title: 'TEST-ETF source-linked catalyst', url: 'https://example.test/news', source: '测试新闻源', category: 'finance', categoryLabel: '金融 / 商业', origin: 'foreign', route: 'direct', publishedAt: '2026-09-05T12:00:00Z', observedAt: '2026-09-05T12:04:00Z', heat: 1, importance: 80, recency: 99, weight: 80, weightLabel: '高' }],
  } }));
  await page.goto('http://127.0.0.1:5187/ibkr');
  await page.keyboard.press('Control+k');
  await page.getByRole('searchbox').fill('TEST');
  const results = page.getByRole('region', { name: '搜索结果' });
  await expect(results.getByRole('button', { name: /TEST-ETF.*conId 9000001/ })).toBeVisible();
  await expect(results.getByRole('link', { name: /TEST-ETF source-linked catalyst/ })).toHaveAttribute('href', 'https://example.test/news');
  await expect(results).toContainText('测试新闻源');
});

test('terminal controls have names, visible keyboard focus and readable core colors', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('http://127.0.0.1:5187/ibkr');
  const unnamed = await page.locator('.ibkr-terminal button, .ibkr-terminal a, .ibkr-terminal input, .ibkr-terminal select, .ibkr-terminal textarea').evaluateAll(elements => elements.filter(element => {
    const node = element as HTMLElement;
    if (!node.offsetParent || (element as HTMLInputElement).type === 'hidden') return false;
    const labels = 'labels' in element ? Array.from((element as HTMLInputElement).labels || []).map(label => label.textContent).join(' ') : '';
    return !(node.getAttribute('aria-label') || node.getAttribute('title') || labels || node.innerText || (element as HTMLInputElement).placeholder)?.trim();
  }).map(element => element.outerHTML));
  expect(unnamed).toEqual([]);
  await page.getByRole('searchbox').focus();
  const focus = await page.getByRole('searchbox').evaluate(element => {
    const style = getComputedStyle(element.closest('.ibkr-search')!);
    return { borderColor: style.borderColor };
  });
  expect(focus.borderColor).toBe('rgb(103, 219, 193)');
  expect(contrast('#dbe7e4', '#020708')).toBeGreaterThanOrEqual(7);
  expect(contrast('#8ca8a3', '#050d0f')).toBeGreaterThanOrEqual(4.5);
  expect(contrast('#67dbc1', '#091718')).toBeGreaterThanOrEqual(4.5);
});
