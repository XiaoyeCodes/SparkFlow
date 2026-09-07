import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { emptySnapshot } from '../../src/lib/ibkr/store';
import type { AnalysisReport, WorkbenchState } from '../../src/lib/ibkr/workbenchTypes';

const state = (connected = false): WorkbenchState => ({ source: 'mcp', connection: { state: connected ? 'connected' : 'unconfigured', detail: connected ? '离线界面测试数据' : '连接 IBKR 后读取真实持仓。', tools: [], accounts: [] },
  snapshot: { ...emptySnapshot('live'), ...(connected ? { snapshotId: 'test-snapshot', accountKey: 'live:ui-test', connection: 'connected' as const, state: 'ready' as const, baseCurrency: 'USD', asOf: new Date().toISOString(), testData: true, source: 'fixture' as const, metrics: { netLiquidation: '125000', unrealizedPnl: '8500', buyingPower: '40000', maintenanceMargin: '12000' }, cash: [{ currency: 'USD', amount: '18000' }], positions: [{ accountKey: 'live:ui-test', conId: 1, symbol: 'AAPL', currency: 'USD', quantity: '100', averageCost: '180', marketValue: '21000', unrealizedPnl: '3000', assetType: 'STK', exchange: 'NASDAQ', name: 'Apple · 工程测试' }] } : {}) },
  quotes: connected ? [{ conId: 1, symbol: 'AAPL', price: 212, changePercent: 1.2, asOf: '2026-09-04T20:00:00Z', fetchedAt: new Date().toISOString(), source: '东方财富', status: 'delayed', currency: 'USD', sourceUrl: 'https://example.com' }] : [], evidence: [], alerts: [], reports: [], jobs: [], preferences: { horizon: 'both', targetWeight: null, cashFloor: null, maxDrawdown: null, daily: true, eventAnalysis: true, maxAutomatic: 4, cooldownMinutes: 60, maxAiCalls: 12 }, ai: { provider: 'fixture', model: 'test-model', fingerprint: 'test-only', configured: true, enabled: false, fields: ['脱敏持仓', '现金', '风险指标'], usedToday: 0 }, nextSyncAt: null, calendarSupported: true });

test('new account workbench starts empty, exposes model consent and removes legacy terminal access', async ({ page }) => {
  await page.route('**/api/ibkr-workbench/state', route => route.fulfill({ json: state() }));
  await page.goto('http://127.0.0.1:5187/ibkr');
  await expect(page.getByTestId('ibkr-workbench')).toBeVisible();
  await expect(page.getByRole('button', { name: '生成深度分析' })).toBeDisabled();
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
  await expect(page.getByRole('cell', { name: '21,000.00 USD' })).toBeVisible();
  await expect(page.getByRole('cell', { name: /212.00/ })).toBeVisible();
  await page.getByRole('button', { name: /AAPL/ }).click();
  await expect(page.getByRole('dialog', { name: 'AAPL 持仓详情' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'AAPL 历史收盘价曲线' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
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
 const id='12345678-1234-4234-8234-123456789abc';data.reports=[{id,version:2,accountKey:data.snapshot.accountKey,snapshotId:data.snapshot.snapshotId,snapshotHash:'fixture',generatedAt:'2026-09-04T20:00:00Z',provider:'fixture',model:'offline',kind:'manual',snapshot:data.snapshot,quotes:data.quotes,evidence:[{id:'source',title:'工程测试公告',url:'https://example.com/announcement',source:'example.com',publishedAt:'2026-09-04',fetchedAt:'2026-09-04',symbols:['AAPL'],kind:'news',read:true,content:'This is an offline source fixture.'}],metrics:data.metrics,content:{headline:'先核验利润兑现，再评估集中仓位',briefPoints:['配置集中使组合对单一公司事件敏感。','公告提供观察线索，销量与利润率仍需核实。','维持观察；若后续利润率恶化，重新评估仓位。'],brief:'测试简报',accountSummary:'组合特征',portfolioRisk:'集中度超过观察线',marketContext:'原文证据支持的市场背景。',holdings:[{symbol:'AAPL',background:'公司背景',fact:'固定证据中的公告事实',impact:'可能影响收入预期',shortTerm:'观察订单兑现',longTerm:'关注利润率',counterEvidence:'订单数据缺失',invalidation:'利润率下滑',evidenceIds:['source']}],actions:[{symbol:'AAPL',action:'watch',horizon:'short',rationale:'等待更多证据',counterEvidence:'公告没有实际订单',trigger:'订单数据更新',invalidation:'利润率恶化',targetWeight:null,evidenceIds:['source']}],opportunities:['等待经营数据确认'],risks:['单一仓位集中'],gaps:['工程测试，不是真实建议'],evidenceIds:['source']}}];
 data.alerts=[{id:'12345678-1234-4234-8234-123456789abd',key:'test',kind:'risk',title:'单一仓位需要复核',detail:'集中度较高可能放大组合波动，需要考虑现金与风险约束。',symbols:['AAPL'],createdAt:'2026-09-04',read:false,resolved:false,reportId:id,evidenceIds:['source']}];
 await page.setViewportSize({width,height:1000});await page.route('**/api/ibkr-workbench/state',r=>r.fulfill({json:data}));await page.route('**/api/ibkr-workbench/quotes',r=>r.fulfill({json:data.quotes}));await page.route('**/api/ibkr-workbench/performance',r=>r.fulfill({json:data.performance}));await page.goto('http://127.0.0.1:5187/ibkr');
 for(const [label,file] of [['账户总览','overview'],['AI 分析','analysis'],['机会与风险','risk'],['持仓','holdings']]){
  if(width<600)await page.getByRole('button',{name:'展开导航'}).click();await page.getByRole('navigation').getByRole('button',{name:label,exact:true}).click();
  await expect(page.getByRole('heading',{name:file==='analysis'?'投资组合分析报告':file==='risk'?'机会与风险中心':file==='holdings'?'我的持仓':'账户总览',exact:true}).first()).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:`tmp/workbench-qa/${file}-${width}.png`,fullPage:true});
 }
 await expect(page.getByRole('cell',{name:/0.00300456/})).toBeVisible();
});


test('resumed older research remains the visible active task and cancellation targets its id',async({page})=>{
 const data=state(true);let cancelled='';data.jobs=[{id:'new-cancelled',kind:'manual',state:'cancelled',startedAt:'2026-09-07'},{id:'older-running',kind:'manual',state:'running',startedAt:'2026-09-06',progress:{stage:'形成逐仓判断与反证',covered:['AAPL'],total:2,sources:3,searches:2,reads:1,modelCalls:1,maxCalls:12,startedAt:'2026-09-06',updatedAt:'2026-09-07',complete:false,gaps:[],trace:[]}}];
 await page.route('**/api/ibkr-workbench/state',r=>r.fulfill({json:data}));await page.route('**/api/ibkr-workbench/quotes',r=>r.fulfill({json:data.quotes}));await page.route('**/api/ibkr-workbench/cancel',r=>{cancelled=r.request().postDataJSON().id;return r.fulfill({json:{ok:true}});});
 await page.goto('http://127.0.0.1:5187/ibkr');await expect(page.getByText(/持仓覆盖 1\/2/)).toBeVisible();await page.getByRole('button',{name:'取消研究',exact:true}).click();await expect.poll(()=>cancelled).toBe('older-running');
});
