import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { emptySnapshot } from '../../src/lib/ibkr/store';
import type { AnalysisReport, WorkbenchState } from '../../src/lib/ibkr/workbenchTypes';

const state = (connected = false): WorkbenchState => ({ source: 'mcp', connection: { state: connected ? 'connected' : 'unconfigured', detail: connected ? '离线界面测试数据' : '连接 IBKR 后读取真实持仓。', tools: [], accounts: [] },
  snapshot: { ...emptySnapshot('live'), ...(connected ? { snapshotId: 'test-snapshot', accountKey: 'live:ui-test', connection: 'connected' as const, state: 'ready' as const, baseCurrency: 'USD', asOf: new Date().toISOString(), testData: true, source: 'fixture' as const, metrics: { netLiquidation: '125000', unrealizedPnl: '8500', buyingPower: '40000', maintenanceMargin: '12000' }, cash: [{ currency: 'USD', amount: '18000' }], positions: [{ accountKey: 'live:ui-test', conId: 1, symbol: 'AAPL', currency: 'USD', quantity: '100', averageCost: '180', marketValue: '21000', unrealizedPnl: '3000', assetType: 'STK', exchange: 'NASDAQ', name: 'Apple · 工程测试' }] } : {}) },
  quotes: connected ? [{ conId: 1, symbol: 'AAPL', price: 212, changePercent: 1.2, asOf: '2026-09-04T20:00:00Z', fetchedAt: new Date().toISOString(), source: '东方财富', status: 'delayed', currency: 'USD', sourceUrl: 'https://example.com' }] : [], evidence: [], alerts: [], reports: [], jobs: [], preferences: { horizon: 'both', targetWeight: null, cashFloor: null, maxDrawdown: null, daily: true, eventAnalysis: true, maxAutomatic: 4, cooldownMinutes: 60, maxAiCalls: 12 }, ai: { provider: 'fixture', model: 'test-model', fingerprint: 'test-only', configured: true, enabled: false, fields: ['脱敏持仓', '现金', '风险指标'], usedToday: 0 }, nextSyncAt: null, calendarSupported: true });

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
  await expect(page.getByRole('button', { name: '连接 / 重新授权 IBKR' })).toBeVisible();
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
  await expect(page.locator('.awb-chat, .awb-footer')).toHaveCount(0);
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 PDF', exact: true }).click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toMatch(/\.pdf$/);
  expect(await download.failure()).toBe(null);
  await expect(page.getByRole('cell', { name: '21,000.00 USD' })).toBeVisible();
  await expect(page.getByRole('cell', { name: /212.00/ })).toBeVisible();
  await page.getByRole('button', { name: /AAPL/ }).click();
  await expect(page.getByRole('dialog', { name: 'AAPL 持仓详情' })).toBeVisible();
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
  await page.getByRole('button', { name: '连接 / 重新授权 IBKR', exact: true }).click();
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
  if(file==='analysis'){await expect(page.getByRole('heading',{name:'基准比较',exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'机会与风险',exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'目标配置框架',exact:true})).toBeVisible();await expect(page.getByText('基准情景',{exact:true})).toBeVisible();}
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
  for (const name of ['持仓分布', '持仓盈亏排行', '资金概况', '月度收益率']) await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  await expect(page.getByRole('img', { name: '月度收益率柱状图' })).toBeVisible();
  await expect(page.locator('.awb-month-chart')).toContainText('+10.00%');
  await expect(page.locator('.awb-month-chart')).toContainText('-2.00%');
  await expect(page.locator('.awb-allocation-panel')).toContainText('整体集中度暂不计算');
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
  await expect(tooltip).toContainText('收益盈亏');
  await expect(tooltip).toContainText('未提供');
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
  await page.locator('.awb-distribution-bars').getByRole('button', { name: /AAPL/ }).click();
  await expect(page.getByRole('dialog', { name: 'AAPL 持仓详情' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '查看研究状态' }).click();
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
  await expect(page.locator('.awb-return-summary b')).toHaveText(['—', '—', '—']);
  await expect(page.getByRole('img', { name: '月度收益率柱状图' })).toHaveCount(0);
  await expect(page.locator('.awb-brief-redesign')).toContainText('尚无已发布的市场研究');
  await expect(page.locator('.awb-brief-redesign')).not.toContainText('71/100');
  await expect(page.locator('.awb-brief-redesign')).not.toContainText('本周 3 家');
  const chart = page.getByRole('img', { name: '账户资产表现曲线' });
  await chart.focus();
  await page.keyboard.press('ArrowRight');
  const tooltip = page.getByRole('tooltip', { name: '资产表现详情' });
  await expect(tooltip).toContainText('+990.00');
  await expect(tooltip).not.toContainText('9900');
  await expect(tooltip).toContainText('收益盈亏');
  await expect(tooltip).toContainText('未提供');
});

test('full HD overview fits all summary modules while research is pending', async ({ page }) => {
  const data = state(true);
  data.snapshot.positions = ['AAPL', 'QQQ', 'MSFT', 'NVDA', 'AMZN', 'KO', 'TSLA', 'MCD', 'VTI', 'AMD', 'GOOG', 'META'].map((symbol, i) => ({ ...data.snapshot.positions[0], conId: i + 1, symbol, unrealizedPnl: String(i % 2 ? -100 : 100) }));
  data.metrics = { investedWeight: .978, cashWeight: .022, topWeight: .33, riskLevel: '偏高', reasons: ['现金比例低于观察线', '单标的仓位超过观察线'], sectors: [{ name: '行业待核实', weight: .978 }], sectorCoverage: 0 };
  data.jobs = [{ id: 'pending-fixture', kind: 'manual', state: 'partial', startedAt: '2026-09-07', error: '研究服务暂不可用；已保存阶段结果，可继续研究', progress: { strategy: 'portfolio', stage: '待研究', covered: [], total: 12, sources: 4, searches: 4, reads: 4, modelCalls: 2, maxCalls: 2, startedAt: '2026-09-07', updatedAt: '2026-09-07', complete: false, gaps: [], trace: [] } }];
  data.alerts = ['现金缓冲偏低', '单标的仓位集中'].map((title, i) => ({ id: String(i), key: String(i), kind: 'risk', title, detail: '工程测试观察规则', symbols: [], createdAt: '2026-09-07', read: false, resolved: false, evidenceIds: [] }));
  data.performance = { source: 'IBKR PortfolioAnalyst', fetchedAt: '2026-09-07', currency: 'USD', returnMethod: 'TWR', benchmark: 'none', note: '工程测试历史', points: [{ date: '2026-07-31', nav: 100000, cumulativeReturn: 0 }, { date: '2026-08-31', nav: 101000, cumulativeReturn: .01 }, { date: '2026-09-07', nav: 102000, cumulativeReturn: .02 }] };
  await page.route('**/api/ibkr-workbench/state', r => r.fulfill({ json: data }));
  await page.route('**/api/ibkr-workbench/quotes', r => r.fulfill({ json: data.quotes }));
  await page.route('**/api/ibkr-workbench/performance', r => r.fulfill({ json: data.performance }));
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('http://127.0.0.1:5187/ibkr');
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
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight <= innerHeight && document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'tmp/workbench-qa/dense-overview-1600.png', fullPage: true });
  const compactCount = await page.locator('.awb-holdings tbody tr').count();
  for (let resize = 0; resize < 2; resize++) {
    await page.setViewportSize({ width: 2560, height: 1440 });
    await expect(page.locator('.awb-holdings tbody tr')).toHaveCount(12);
    await expect(page.locator('.awb-distribution-bars button')).toHaveCount(12);
    await expect(page.locator('.awb-pnl-row')).toHaveCount(12);
    await expect(page.locator('.awb-allocation-panel')).toContainText('展示前 12 大持仓');
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true);
    await page.setViewportSize({ width: 1600, height: 900 });
    await expect(page.locator('.awb-holdings tbody tr')).toHaveCount(compactCount);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true);
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
    await expect(page.locator('.awb-distribution-bars button')).toHaveCount(count);
    await expect(page.locator('.awb-pnl-row')).toHaveCount(count);
  }
  await expect(page.locator('.awb-holdings')).toContainText('当前没有匹配持仓');
});

test('daily brief replaces placeholder research and preserves the last success on failure', async ({ page }) => {
  const data = state(true);
  data.ai.enabled = true;
  data.dailyBrief = { enabled: true, state: 'failed', detail: '本期生成失败，保留上期简报。', nextRunAt: '2026-09-08T20:30:00Z', dueSession: '2026-09-04', calendarSupported: true, latest: { id: 'brief-fixture', sessionDate: '2026-09-04', generatedAt: '2026-09-05T00:00:00Z', snapshotAsOf: '2026-09-05T00:00:00Z', model: 'offline-test', content: { headline: '账户现金充足，关注集中度', summary: '工程测试净资产与现金均已核对。', risk: '持仓集中，需要关注单一标的波动。', watch: ['核对资金需求。'], gaps: ['未检索实时新闻。'] }, facts: {} } };
  let generated = 0;
  await page.route('**/api/ibkr-workbench/state', r => r.fulfill({ json: data }));
  await page.route('**/api/ibkr-workbench/quotes', r => r.fulfill({ json: data.quotes }));
  await page.route('**/api/ibkr-workbench/brief', r => { generated++; data.dailyBrief.state = 'running'; data.dailyBrief.detail = '正在生成账户简报…'; return r.fulfill({ json: { state: 'running' } }); });
  await page.goto('http://127.0.0.1:5187/ibkr');
  const panel = page.getByRole('region', { name: 'AI 账户简报' });
  await expect(panel).toContainText('账户现金充足，关注集中度');
  await expect(panel).toContainText('工程测试净资产与现金均已核对');
  await expect(panel).not.toContainText('让持仓与市场背景连起来');
  await expect(panel).toContainText('本期生成失败，保留上期简报');
  await expect(panel).toContainText('下次自动生成');
  await panel.getByRole('button', { name: '重新生成简报' }).click();
  await expect.poll(() => generated).toBe(1);
  await expect(panel.getByRole('button', { name: '正在生成简报' })).toBeDisabled();
  await expect(panel).toContainText('工程测试净资产与现金均已核对');
});

test('resumed older research remains the visible active task and cancellation targets its id',async({page})=>{
 const data=state(true);let cancelled='';data.jobs=[{id:'new-cancelled',kind:'manual',state:'cancelled',startedAt:'2026-09-07'},{id:'older-running',kind:'manual',state:'running',startedAt:'2026-09-06',progress:{stage:'形成逐仓判断与反证',covered:['AAPL'],total:2,sources:3,searches:2,reads:1,modelCalls:1,maxCalls:12,startedAt:'2026-09-06',updatedAt:'2026-09-07',complete:false,gaps:[],trace:[]}}];
 await page.route('**/api/ibkr-workbench/state',r=>r.fulfill({json:data}));await page.route('**/api/ibkr-workbench/quotes',r=>r.fulfill({json:data.quotes}));await page.route('**/api/ibkr-workbench/cancel',r=>{cancelled=r.request().postDataJSON().id;return r.fulfill({json:{ok:true}});});
  await page.goto('http://127.0.0.1:5187/ibkr');await page.getByRole('navigation').getByRole('button',{name:'AI 分析',exact:true}).click();await expect(page.locator('.awb-analysis-task-metrics')).toContainText('1/2');await page.screenshot({path:'tmp/workbench-qa/analysis-running.png',fullPage:true});await page.getByRole('button',{name:'取消分析',exact:true}).click();await expect.poll(()=>cancelled).toBe('older-running');
});

test('analysis workspace replaces the oversized empty state with one centered research action', async ({ page }) => {
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
  expect(workspace.width).toBeLessThanOrEqual(1480);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: '开始账户分析' }).click();
  await expect.poll(() => started).toBe(1);
  await page.screenshot({ path: 'tmp/workbench-qa/analysis-empty-redesign-2560.png', fullPage: true });
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
  await page.route('**/api/ibkr-workbench/analyze', route => { restarted = route.request().postDataJSON(); return route.fulfill({ status: 202, json: { ok: true } }); });
  await page.goto('http://127.0.0.1:5187/ibkr');
  await page.getByRole('navigation').getByRole('button', { name: 'AI 分析', exact: true }).click();
  await expect(page.getByRole('heading', { name: '这次分析未能完成' })).toBeVisible();
  await expect(page.getByText('模型已调用过，系统会新建一次分析；已保存资料仍可查看。')).toBeVisible();
  await page.screenshot({ path: 'tmp/workbench-qa/analysis-retry.png', fullPage: true });
  await page.getByRole('button', { name: '基于已保存资料重新分析' }).click();
  await expect.poll(() => restarted).toEqual({});
});
