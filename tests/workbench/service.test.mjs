import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { IbkrWorkbenchService, oauthCallbackPage } from '../../server/ibkrWorkbench.ts';
import { normalizeMcpSnapshot } from '../../server/ibkrMcp.ts';
import { defaults } from '../../server/ibkrWorkbenchCore.ts';

const model = { provider: 'test-only', model: 'offline-fixture', fingerprint: 'fixture-model', configured: true };
const legacy = JSON.stringify({ brief: '工程测试报告，非真实投资建议', accountSummary: '摘要', portfolioRisk: '风险', marketContext: '背景', holdings: [], opportunities: [], risks: [], actions: [], gaps: [] });
const raw=JSON.stringify({headline:'今日整体风险关注度：低——空仓账户仅需关注现金机会成本。',briefPoints:['空仓等待。','没有核实新事件。','先观察，出现证据再考虑。'],accountSummary:'空仓',portfolioRisk:'未触发',benchmarkComparison:'没有足够历史进行基准比较。',marketContext:'没有原文证据',valuationReview:[],opportunities:[],risks:[],calendar:[],frameworks:{buffett:{analysis:'等待安全边际。',commentary:'公开价值投资原则下保持耐心。',evidenceIds:[]},peterLynch:{analysis:'当前没有成长持仓可评估。',commentary:'公开成长投资原则下等待可验证机会。',evidenceIds:[]},rayDalio:{analysis:'账户为现金状态。',commentary:'公开宏观对冲原则下保留流动性。',evidenceIds:[]}},fullSummary:'账户保持现金，等待有证据的配置窗口。',scenarios:[{name:'base',assumptions:'维持现金',accountImpact:'波动较低',response:'观察'},{name:'upside',assumptions:'机会出现',accountImpact:'现金可配置',response:'分批'},{name:'downside',assumptions:'风险上升',accountImpact:'现金缓冲',response:'保持纪律'}],targetAllocation:'保持现金并等待证据。',monitoring:[{indicator:'现金机会成本',warningLine:'出现有证据机会',action:'重新分析'}],limitations:['没有持仓'],disclaimer:'不构成投资建议。',evidenceIds:[],gaps:['无外部证据'],reviewedSymbols:[],holdings:[],actions:[]});
test('OAuth landing distinguishes authorization from data sync and never reflects untrusted error HTML', () => {
  assert.match(oauthCallbackPage(true, false), /持仓待同步/);
  assert.match(oauthCallbackPage(true, true), /账户已同步/);
  assert.match(oauthCallbackPage(true, false, 'MCP_ACCOUNTS_TOOL_UNSUPPORTED'), /返回账户工作台/);
  assert.ok(!oauthCallbackPage(false, false, '<script>secret-token</script>').includes('secret-token'));
});
test('gateway performance stays on its own local history and never calls MCP', async () => {
  const f=await fixture();
  try{
    f.service.saved.source='gateway';f.service.saved.gatewayMode='live';f.record.preferences.benchmark='none';
    f.record.history=[{date:'2026-09-08',nav:1000,cumulativeReturn:null},{date:'2026-09-09',nav:1002,cumulativeReturn:null}];
    f.record.performance={source:'IBKR PortfolioAnalyst',fetchedAt:new Date().toISOString(),currency:'USD',returnMethod:'TWR',benchmark:'SPY',note:'stale cross-source cache',points:[]};
    let mcpCalls=0;f.service.mcp.performance=async()=>{mcpCalls++;throw new Error('must not run');};
    const result=await f.service.performance();
    assert.equal(mcpCalls,0);assert.equal(result.source,'IB Gateway 实盘 · 本地净值快照');assert.equal(result.returnMethod,null);assert.equal(result.points.length,2);
    const current=await f.service.state();assert.equal(current.performance.source,'IB Gateway 实盘 · 本地净值快照');
  }finally{await f.service.close();}
});
test('MCP performance uses PortfolioAnalyst for the currently selected MCP account', async () => {
  const f=await fixture();
  try{
    f.service.saved.source='mcp';f.record.preferences.benchmark='none';
    let performanceKey='';
    f.service.mcp.performance=async key=>{performanceKey=key;return {description:'cumulative returns expressed as fractions',data:{portfolio_measure:'TWR',accounts:{verified:{base_currency:'USD',start:'20260908',end:'20260909',periods:{'1Y':{start_date:'20260101',start_nav:100,dates:['20260908','20260909'],nav:[1000,1002],cps:[0,.002]}}}}}};};
    const result=await f.service.performance();
    assert.equal(performanceKey,f.record.snapshot.accountKey);assert.equal(result.source,'IBKR PortfolioAnalyst');assert.equal(result.returnMethod,'TWR');
  }finally{await f.service.close();}
});
test('paper Gateway selection is immediate and reads the account only after an explicit sync', async () => {
  await mkdir('tmp/workbench-paper-mode', { recursive: true });
  const root = await mkdtemp(path.resolve('tmp/workbench-paper-mode/root-'));
  const dir = path.join(root, 'state');
  await mkdir(path.join(root, '.sparkflow/ibkr-terminal'), { recursive: true });
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(root, '.sparkflow/ibkr-terminal/session.token'), 'test-session-token');
  await writeFile(path.join(root, '.sparkflow/ibkr-terminal/bridge.port'), '18765');
  const snapshot = {
    ...normalizeMcpSnapshot('PAPER_ACCOUNT', [], { baseCurrency: 'USD', netLiquidation: 100000, cash: [{ currency: 'USD', amount: 100000 }] }),
    accountKey: 'paper:paper-account', mode: 'paper', detail: '模拟盘只读快照',
  };
  const originalFetch = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (url, init) => {
    urls.push(String(url));
    assert.equal(init.headers.Authorization, 'Bearer test-session-token');
    return new Response(JSON.stringify(snapshot), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  let localCalls = 0;
  const service = new IbkrWorkbenchService(root, dir, async () => ({ data: { diff: [] } }), async () => { localCalls++; return {}; });
  try {
    await service.start(); clearTimeout(service.timer);
    await service.select('gateway', undefined, 'paper');
    assert.deepEqual(urls, []);
    assert.equal(service.saved.gatewayMode, 'paper');
    assert.equal(service.saved.selectedKey, undefined);
    const current = await service.state();
    assert.equal(current.gatewayMode, 'paper');
    assert.equal(current.snapshot.mode, 'paper');
    await service.sync(false);
    assert.deepEqual(urls, ['http://127.0.0.1:18765/api/ibkr-terminal/snapshot?mode=paper']);
    assert.equal(service.saved.selectedKey, 'paper:paper-account');
    assert.equal(localCalls, 0);
    const stored = JSON.parse(await readFile(path.join(dir, 'state.json'), 'utf8'));
    assert.equal(stored.gatewayMode, 'paper');
    await service.select('mcp');
    assert.equal(service.saved.gatewayMode, 'paper');
    await service.select('gateway');
    assert.equal(service.saved.gatewayMode, 'paper');
    assert.equal(service.saved.selectedKey, undefined);
    await service.sync(false);
    assert.equal(service.saved.selectedKey, 'paper:paper-account');
    assert.equal(urls.at(-1), 'http://127.0.0.1:18765/api/ibkr-terminal/snapshot?mode=paper');
  } finally {
    globalThis.fetch = originalFetch;
    await service.close();
  }
});
test('paper order proxy injects the selected paper scope and never exposes the bridge token', async () => {
  await mkdir('tmp/workbench-paper-orders', { recursive: true });
  const root = await mkdtemp(path.resolve('tmp/workbench-paper-orders/root-'));
  const dir = path.join(root, 'state');
  await mkdir(path.join(root, '.sparkflow/ibkr-terminal'), { recursive: true }); await mkdir(dir, { recursive: true });
  await writeFile(path.join(root, '.sparkflow/ibkr-terminal/session.token'), 'private-bridge-token');
  await writeFile(path.join(root, '.sparkflow/ibkr-terminal/bridge.port'), '18765');
  const service = new IbkrWorkbenchService(root, dir, async () => ({}), async () => ({}));
  const snapshot = { ...normalizeMcpSnapshot('PAPER_ACCOUNT', [], { baseCurrency: 'USD', netLiquidation: 1000, cash: [{ currency: 'USD', amount: 1000 }] }), accountKey: 'paper:selected', mode: 'paper' };
  service.saved = { version: 1, source: 'gateway', gatewayMode: 'paper', selectedKey: 'paper:selected', records: { 'paper:selected': { snapshot, preferences: { ...defaults }, alerts: [], reports: [], jobs: [], usage: [] } } };
  const originalFetch = globalThis.fetch; let sent;
  globalThis.fetch = async (url, init) => {
    sent = { url: String(url), init };
    const result = sent.url.includes('/paper/quote?')
      ? { conId:265598,symbol:'AAPL',currency:'USD',exchange:'NASDAQ',name:'Apple',bid:'101',ask:'102',last:'101.5',close:'100',high:'103',low:'99',minTick:'0.01',state:'realtime',regularHours:true,nextOpen:null,fetchedAt:new Date().toISOString(),source:'IBKR Gateway',detail:'' }
      : { previewId: 'preview:test' };
    return new Response(JSON.stringify(result), { headers: { 'content-type': 'application/json' } });
  };
  try {
    const result = await service.paperRequest('preview', { conId: 12, side: 'BUY', quantity: '2', limitPrice: '100.50' });
    assert.equal(result.previewId, 'preview:test');
    assert.equal(sent.url, 'http://127.0.0.1:18765/api/ibkr-terminal/paper/preview');
    assert.equal(sent.init.headers.Authorization, 'Bearer private-bridge-token');
    assert.deepEqual(JSON.parse(sent.init.body), { conId: 12, side: 'BUY', quantity: '2', limitPrice: '100.50', accountKey: 'paper:selected', mode: 'paper', orderType: 'LMT', tif: 'DAY', tradingSession: 'EXTENDED' });
    await service.paperRequest('preview', { conId: 12, side: 'BUY', quantity: '10', orderType: 'MKT' });
    assert.deepEqual(JSON.parse(sent.init.body), { conId: 12, side: 'BUY', quantity: '10', accountKey: 'paper:selected', mode: 'paper', orderType: 'MKT', limitPrice: null, tif: 'DAY', tradingSession: 'EXTENDED' });
    await service.paperRequest('preview', { conId: 12, side: 'BUY', quantity: '2', limitPrice: '100.50', tradingSession: 'OVERNIGHT' });
    assert.equal(JSON.parse(sent.init.body).tradingSession, 'OVERNIGHT');
    await assert.rejects(() => service.paperRequest('preview', { conId: 12, side: 'BUY', quantity: '10', orderType: 'MKT', tradingSession: 'OVERNIGHT' }));
    await assert.rejects(() => service.paperRequest('preview', { conId: 12, side: 'BUY', quantity: '10', orderType: 'MKT', limitPrice: '100' }));
    await assert.rejects(() => service.paperRequest('preview', { accountKey: 'live:other', conId: 12, side: 'BUY', quantity: '2', limitPrice: '100.50' }), /请先|无效|结构|unrecognized/i);
    await service.paperRequest('transport', { explicit: true });
    assert.equal(sent.url, 'http://127.0.0.1:18765/api/ibkr-terminal/gateway/paper-orders');
    assert.deepEqual(JSON.parse(sent.init.body), { explicit: true });
    await assert.rejects(() => service.paperRequest('transport', { explicit: false }));
    await service.paperRequest('quote', { conId: 265598 });
    assert.equal(sent.url, 'http://127.0.0.1:18765/api/ibkr-terminal/paper/quote?conId=265598');
    assert.equal(sent.init.method, 'GET');
    assert.equal(sent.init.body, undefined);
    let selectedSource;
    service.ticketQuotes = { quote: async (contract,dataSource) => {selectedSource=dataSource;return {...contract,name:'Apple',bid:'99',ask:'100',last:'99.5',close:'98',high:'101',low:'97',open:'98',volume:'1000',amount:'99000',peDynamic:'30',peStatic:'32',minTick:null,state:'reference',regularHours:null,nextOpen:null,fetchedAt:new Date().toISOString(),source:dataSource==='tencent'?'腾讯财经':'东方财富',detail:'',bids:[],asks:[]};} };
    const merged = await service.paperMarketQuote({ conId:265598,symbol:'AAPL',currency:'USD',exchange:'NASDAQ' });
    assert.equal(merged.bid,'101'); assert.equal(merged.ask,'102'); assert.equal(merged.open,'98');
    assert.equal(selectedSource,'tencent');
    assert.equal(merged.source,'腾讯财经');
    assert.equal(merged.last,'99.5');
    await service.paperMarketQuote({conId:265598,symbol:'AAPL',currency:'USD',exchange:'NASDAQ',dataSource:'eastmoney'});
    assert.equal(selectedSource,'eastmoney');
    await assert.rejects(service.paperMarketQuote({conId:265598,symbol:'AAPL',currency:'USD',dataSource:'unknown'}));
    service.ticketHistories={history:async(contract,period,dataSource)=>({symbol:contract.symbol,period,source:dataSource})};
    assert.equal((await service.paperHistory({conId:265598,symbol:'AAPL',currency:'USD',period:'day'})).source,'tencent');
    assert.equal((await service.paperHistory({conId:265598,symbol:'AAPL',currency:'USD',period:'day',dataSource:'eastmoney'})).source,'eastmoney');
    await service.paperRequest('contract', { conId: 265598 });
    assert.equal(sent.url, 'http://127.0.0.1:18765/api/ibkr-terminal/paper/contract?conId=265598');
    await assert.rejects(() => service.paperRequest('quote', { conId: -1 }));
    await assert.rejects(() => service.paperRequest('contract', { conId: 265598, symbol: 'AAPL' }));
    service.saved.gatewayMode = 'live';
    await assert.rejects(() => service.paperRequest('quote', { conId: 265598 }), /模拟盘/);
  } finally { globalThis.fetch = originalFetch; }
});
test('paper preview upgrades a stale bridge once and retries the side-effect-free request', async () => {
  const root = await mkdtemp(path.resolve('tmp/workbench-paper-orders/upgrade-'));
  const dir = path.join(root, 'state');
  await mkdir(path.join(root, '.sparkflow/ibkr-terminal'), { recursive: true }); await mkdir(dir, { recursive: true });
  await writeFile(path.join(root, '.sparkflow/ibkr-terminal/session.token'), 'private-bridge-token');
  await writeFile(path.join(root, '.sparkflow/ibkr-terminal/bridge.port'), '18765');
  let starts=0,previews=0,restored;
  const service = new IbkrWorkbenchService(root, dir, async () => ({}), async () => ({}), undefined,
    async (_root,port,refreshCode)=>{starts++;assert.equal(port,18765);assert.equal(refreshCode,true);return {port,reused:false};},
    async ()=>({phase:'ready',detail:'ready'}));
  const snapshot = { ...normalizeMcpSnapshot('PAPER_ACCOUNT', [], { baseCurrency: 'USD', netLiquidation: 1000, cash: [{ currency: 'USD', amount: 1000 }] }), accountKey: 'paper:selected', mode: 'paper' };
  service.saved = { version: 1, source: 'gateway', gatewayMode: 'paper', selectedKey: 'paper:selected', records: { 'paper:selected': { snapshot, preferences: { ...defaults }, alerts: [], reports: [], jobs: [], usage: [] } } };
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async(url,init)=>{
    const target=String(url);
    if(target.endsWith('/paper/status'))return new Response(JSON.stringify({policy:{conIds:[12],expiresAt:new Date(Date.now()+3600000).toISOString(),limits:{maxOrderNotional:'1000',maxTotalExposure:'1000',maxSymbolWeight:'1',maxDailyLoss:'50',maxDailyOrders:10,maxOrdersPerMinute:10,maxQuoteAgeSeconds:10,maxAccountAgeSeconds:30,maxPriceDeviation:'0.05',feeReserve:'1'}}}),{headers:{'content-type':'application/json'}});
    if(target.endsWith('/paper/configure')){restored=JSON.parse(init.body);return new Response(JSON.stringify({enabled:true}),{headers:{'content-type':'application/json'}});}
    previews++;return previews===1
      ?new Response(JSON.stringify({detail:'OUTSIDE_RTH'}),{status:409,headers:{'content-type':'application/json'}})
      :new Response(JSON.stringify({previewId:'preview:upgraded'}),{headers:{'content-type':'application/json'}});
  };
  try {
    const result=await service.paperRequest('preview',{conId:12,side:'BUY',quantity:'2',limitPrice:'100.50'});
    assert.equal(result.previewId,'preview:upgraded');assert.equal(starts,1);assert.equal(previews,2);
    assert.equal(restored.accountKey,'paper:selected');assert.equal(restored.mode,'paper');assert.deepEqual(restored.conIds,[12]);
  } finally {globalThis.fetch=originalFetch;await service.close();}
});
test('backtest proxy accepts only structured user strategies and stamps data inside the Python service', async () => {
  await mkdir('tmp/workbench-backtests', { recursive: true });
  const root = await mkdtemp(path.resolve('tmp/workbench-backtests/root-'));
  const dir = path.join(root, 'state');
  await mkdir(path.join(root, '.sparkflow/ibkr-terminal'), { recursive: true }); await mkdir(dir, { recursive: true });
  await writeFile(path.join(root, '.sparkflow/ibkr-terminal/session.token'), 'private-backtest-token');
  await writeFile(path.join(root, '.sparkflow/ibkr-terminal/bridge.port'), '18765');
  const service = new IbkrWorkbenchService(root, dir, async () => ({}), async () => ({}), async () => ({ data: [] }), async () => ({ port: 18765, reused: true }));
  const strategy = { strategyId: 'user:test-sma', version: '1.0.0', origin: 'user', name: '测试 SMA', universe: [12], barInterval: '1D',
    entryRule: '快均线上穿慢均线后，在下一根 bar 开盘建立目标仓位。', exitRule: '快均线不高于慢均线后，在下一根 bar 开盘退出。', parameters: { fastWindow: '2', slowWindow: '5' },
    signal: { kind: 'sma_cross', priceField: 'close', fastWindow: 2, slowWindow: 5, entryWhen: 'FAST_ABOVE_SLOW', exitWhen: 'FAST_AT_OR_BELOW_SLOW' },
    positionSizing: { kind: 'fixed_quantity', targetQuantity: '10' }, costs: { commissionPerOrder: '1', commissionPerShare: '0.01', slippageBps: '5' },
    risk: { allowShort: false, maxPositionQuantity: '10' }, versionNotes: '用户明确录入的结构化回测规则；不构成交易授权。' };
  const run = { strategyId: strategy.strategyId, strategyVersion: strategy.version, initialCash: '10000', corporateActionsComplete: true,
    bars: [{ timestamp: '2026-01-02T14:30:00Z', open: '10', high: '11', low: '9', close: '10', volume: '1000', splitRatio: null, dividendPerShare: '0' },
      { timestamp: '2026-01-03T14:30:00Z', open: '11', high: '12', low: '10', close: '11', volume: '1000', splitRatio: null, dividendPerShare: '0' }] };
  const originalFetch = globalThis.fetch; const sent = [];
  globalThis.fetch = async (url, init) => { sent.push({ url: String(url), init }); return new Response(JSON.stringify({ ok: true, jobId: 'backtest:1234567890abcdef1234567890abcdef' }), { headers: { 'content-type': 'application/json' } }); };
  try {
    await service.backtestRequest('save-strategy', strategy);
    await service.backtestRequest('run', run);
    assert.equal(sent[0].url, 'http://127.0.0.1:18765/api/ibkr-terminal/strategies');
    assert.equal(sent[1].url, 'http://127.0.0.1:18765/api/ibkr-terminal/backtests/jobs');
    assert.equal(sent[0].init.headers.Authorization, 'Bearer private-backtest-token');
    assert.deepEqual(JSON.parse(sent[0].init.body), strategy);
    assert.deepEqual(JSON.parse(sent[1].init.body), run);
    await assert.rejects(() => service.backtestRequest('run', { ...run, bars: [{ ...run.bars[0], source: 'ibkr.historicalData' }, run.bars[1]] }));
    await assert.rejects(() => service.backtestRequest('save-strategy', { ...strategy, origin: 'fixture', strategyId: 'example:test' }));
    assert.equal(sent.length, 2);
  } finally { globalThis.fetch = originalFetch; }
});
test('switching to Gateway waits for intelligent connect before starting a missing bridge', async () => {
  await mkdir('tmp/workbench-auto-connect', { recursive: true });
  const root = await mkdtemp(path.resolve('tmp/workbench-auto-connect/root-'));
  const dir = path.join(root, 'state');
  await mkdir(path.join(root, '.sparkflow/ibkr-terminal'), { recursive: true });
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(root, '.sparkflow/ibkr-terminal/session.token'), 'test-session-token');
  await writeFile(path.join(root, '.sparkflow/ibkr-terminal/bridge.port'), '18765');
  const snapshot = {
    ...normalizeMcpSnapshot('PAPER_ACCOUNT', [], { baseCurrency: 'USD', netLiquidation: 100000, cash: [{ currency: 'USD', amount: 100000 }] }),
    accountKey: 'paper:auto-connect', mode: 'paper', detail: '模拟盘只读快照',
  };
  let bridgeStarted = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    if (!bridgeStarted) throw new Error('bridge offline');
    if (String(url).endsWith('/session')) return new Response(JSON.stringify({ readonly: true, accounts: [] }));
    return new Response(JSON.stringify(snapshot), { headers: { 'content-type': 'application/json' } });
  };
  const service = new IbkrWorkbenchService(root, dir, async () => ({ data: { diff: [] } }), async () => ({}), undefined, async () => { bridgeStarted = true; return { port: 18765, reused: false }; }, async (_root, port, mode) => { assert.equal(port, 18765); assert.equal(mode, 'paper'); return { phase: 'ready', detail: 'API verified', apiPort: 45122 }; });
  try {
    await service.start(); clearTimeout(service.timer);
    await service.select('gateway', undefined, 'paper');
    assert.equal(bridgeStarted, false);
    assert.equal(service.saved.selectedKey, undefined);
    await service.connectGateway();
    assert.equal(bridgeStarted, true);
    assert.equal(service.saved.selectedKey, 'paper:auto-connect');
    assert.equal((await service.state()).connection.state, 'connected');
  } finally {
    globalThis.fetch = originalFetch;
    await service.close();
  }
});
async function fixture() {
  await mkdir('tmp/workbench-service', { recursive: true }); const dir = await mkdtemp(path.resolve('tmp/workbench-service/run-'));
  const service = new IbkrWorkbenchService(process.cwd(), dir, async () => ({ data: { diff: [] } }), async () => ({}));
  await service.start(); clearTimeout(service.timer);
  let calls = 0;
  service.ai = { tool:async()=>({results:[]}), status: async () => model, analyze: async () => { calls++; return { text: raw }; }, close: () => {} };
  const snapshot = normalizeMcpSnapshot('TEST_ACCOUNT', [], { baseCurrency: 'USD', netLiquidation: 10000, cash: [{ currency: 'USD', amount: 10000 }] });
  const record = { snapshot, preferences: { ...defaults }, alerts: [], reports: [], jobs: [], usage: [], grant: { fingerprint: model.fingerprint, at: new Date().toISOString() } };
  service.saved.selectedKey = snapshot.accountKey; service.saved.records[snapshot.accountKey] = record;
  return { service, record, dir, calls: () => calls };
}
test('disconnect releases only the active connection source', async () => {
  const f = await fixture(); let mcpDisconnects = 0;
  f.service.mcp.disconnect = async () => { mcpDisconnects++; };
  try {
    f.service.saved.source = 'gateway';
    f.record.snapshot = { ...f.record.snapshot, mode: 'live', connection: 'connected', state: 'ready' };
    await f.service.disconnect();
    assert.equal(mcpDisconnects, 0);
    assert.equal(f.service.saved.selectedKey, undefined);

    f.service.saved.source = 'mcp'; f.service.saved.selectedKey = f.record.snapshot.accountKey;
    f.record.snapshot = { ...f.record.snapshot, connection: 'connected', state: 'ready' };
    await f.service.disconnect();
    assert.equal(mcpDisconnects, 1);
    assert.equal(f.service.saved.selectedKey, undefined);
  } finally { await f.service.close(); }
});
test('report generation persists frozen evidence and duplicate concurrent requests invoke only one model', async () => {
  const f = await fixture();
  try {
    const results = await Promise.allSettled([f.service.analyze('manual'), f.service.analyze('manual')]);
    assert.equal(results.filter(x => x.status === 'fulfilled').length, 1); await f.service.activeAnalysis;
    assert.equal(f.calls(), 1); assert.equal(f.record.reports.length, 1);
    const r = f.record.reports[0]; assert.equal((await f.service.report(r.id)).snapshotHash, r.snapshotHash);
    f.service.saved.selectedKey = 'live:another'; await assert.rejects(() => f.service.report(r.id), /当前账户/);
  } finally { await f.service.close(); }
});
test('stale snapshots, revoked grants and exhausted budgets block model calls', async () => {
  const f = await fixture();
  try {
    f.record.snapshot.asOf = '2020-01-01T00:00:00Z'; await assert.rejects(() => f.service.analyze('manual'), /最新真实账户/);
    f.record.snapshot.asOf = new Date().toISOString(); f.record.grant = undefined; await assert.rejects(() => f.service.analyze('manual'), /设置/);
    f.record.grant = { fingerprint: model.fingerprint }; f.record.preferences.maxAiCalls = 1; f.record.usage = [{ at: new Date().toISOString(), kind: 'manual' }];
    await assert.rejects(() => f.service.analyze('manual'), /上限/); assert.equal(f.calls(), 0);
    f.service.ai.status = async () => { throw new Error('provider down'); }; await f.service.grant(false); assert.equal(f.record.grant, undefined);
  } finally { await f.service.close(); }
});
test('rules deduplicate and user-resolved alert does not reappear every sync', async () => {
  const f = await fixture();
  try {
    f.record.snapshot.cash[0].amount = '10'; f.service.rules(f.record); f.service.rules(f.record); assert.equal(f.record.alerts.length, 1);
    await f.service.alert(f.record.alerts[0].id, 'resolve'); f.service.rules(f.record); assert.equal(f.record.alerts.length, 1); assert.equal(f.record.alerts[0].resolved, true);
    f.record.snapshot.cash[0].amount = '5000'; f.service.rules(f.record); f.record.snapshot.cash[0].amount = '10'; f.service.rules(f.record); assert.equal(f.record.alerts.length, 2);
  } finally { await f.service.close(); }
});

test('a failed single analysis cannot resume into a second model invocation', async () => {
  const f=await fixture();
  try {
    f.record.preferences.maxAiCalls=3;
    f.service.ai.analyze=async()=>({text:'broken json',finishReason:'stop'});
    const job=await f.service.analyze('manual');await f.service.activeAnalysis;
    assert.equal(f.record.usage.length,1);assert.equal(job.state,'failed');
    let calls=0;f.service.ai.analyze=async()=>{calls++;return {text:raw};};
    await assert.rejects(()=>f.service.analyze('manual',undefined,undefined,job.id),/单次分析已经调用过模型/);
    assert.equal(calls,0);assert.equal(f.record.usage.length,1);
  } finally {await f.service.close();}
});

test('an explicit retry creates a new one-call report instead of repairing the failed task', async () => {
  const f=await fixture();
  try {
    f.record.preferences.maxAiCalls=2;
    f.service.ai.analyze=async()=>({text:'broken json',finishReason:'stop'});
    const failed=await f.service.analyze('manual');await f.service.activeAnalysis;
    let calls=0;f.service.ai.analyze=async()=>{calls++;return {text:raw};};
    const prior=f.record.research[failed.id];prior.evidence=[{id:'saved',read:false,title:'Saved source',fetchedAt:new Date().toISOString(),symbols:[],url:'https://example.com'}];
    let tools=0;f.service.ai.tool=async()=>{tools++;throw new Error('must reuse saved materials');};
    const retry=await f.service.analyze('manual',undefined,undefined,undefined,failed.id);await f.service.activeAnalysis;
    assert.equal(tools,0);assert.equal(f.record.research[retry.id].reusedFrom,failed.id);assert.equal(f.record.research[retry.id].evidence[0].id,'saved');
    assert.notEqual(retry.id,failed.id);assert.equal(calls,1);assert.equal(failed.state,'failed');assert.equal(retry.state,'completed');assert.equal(f.record.usage.length,2);assert.equal(f.record.reports.length,1);
  } finally {await f.service.close();}
});

test('retry cannot reuse another account or expired materials',async()=>{
 const f=await fixture();try{
  await assert.rejects(()=>f.service.analyze('manual',undefined,undefined,undefined,'unknown'),/没有可复用/);
  const job=await f.service.analyze('manual');await f.service.activeAnalysis;
  const c=f.record.research[job.id];c.progress.startedAt='2020-01-01T00:00:00Z';
  await assert.rejects(()=>f.service.analyze('manual',undefined,undefined,undefined,job.id),/超过一天/);
  c.progress.startedAt=new Date().toISOString();c.snapshot.accountKey='live:other';
  await assert.rejects(()=>f.service.analyze('manual',undefined,undefined,undefined,job.id),/没有可复用/);
 }finally{await f.service.close();}
});

test('manual retry after empty JSON mode response changes transport while retaining one-call validation',async()=>{
 const f=await fixture();try{
  f.service.ai.analyze=async()=>({text:'',finishReason:'stop'});
  const failed=await f.service.analyze('manual');await f.service.activeAnalysis;
  assert.equal(failed.failureCategory,'OUTPUT_EMPTY');
  let mode,calls=0;f.service.ai.analyze=async(_prompt,_model,_signal,outputMode)=>{mode=outputMode;calls++;return {text:raw};};
  const retried=await f.service.analyze('manual',undefined,undefined,undefined,failed.id);await f.service.activeAnalysis;
  assert.equal(mode,'text');assert.equal(calls,1);assert.equal(retried.state,'completed');assert.equal(f.record.usage.length,2);
 }finally{await f.service.close();}
});

test('stored output can be revalidated without a model call even at the daily limit',async()=>{
 const f=await fixture();try{
  f.record.preferences.maxAiCalls=1;
  f.service.ai.analyze=async()=>({text:'invalid',finishReason:'stop'});
  const job=await f.service.analyze('manual');await f.service.activeAnalysis;
  f.record.research[job.id].failures.portfolio={text:raw,code:'OUTPUT_EVIDENCE',finishReason:'stop'};
  f.service.ai.analyze=async()=>{throw new Error('revalidation must not invoke the model');};
  await f.service.analyze('manual',undefined,undefined,job.id,undefined,true);await f.service.activeAnalysis;
  assert.equal(job.state,'completed');assert.equal(f.record.usage.length,1);assert.equal(f.record.reports.length,1);
 }finally{await f.service.close();}
});
test('sync failure preserves prior snapshot and schedules exponential backoff', async () => {
  const f = await fixture(); const before = f.record.snapshot.asOf;
  try { f.service.mcp.snapshot = async () => { throw new Error('MCP_AUTHORIZATION_REQUIRED'); }; await f.service.sync(); assert.equal(f.record.snapshot.state, 'stale'); assert.equal(f.record.snapshot.asOf, before); assert.ok(f.service.nextSync > Date.now() + 90000); }
  finally { await f.service.close(); }
});
test('restart preserves history and marks in-flight jobs interrupted; duplicate worker stays inactive', async () => {
  const f = await fixture();
  f.record.jobs = [{ id: 'job', state: 'running', kind: 'manual', startedAt: new Date().toISOString() }]; await f.service.persist();
  const other = new IbkrWorkbenchService(process.cwd(), f.dir, async () => ({}), async () => ({}));
  try { await other.start(); assert.throws(() => other.assertAvailable()); } finally { await other.close(); }
  await f.service.close();
  const restarted = new IbkrWorkbenchService(process.cwd(), f.dir, async () => ({}), async () => ({}));
  try { await restarted.start(); clearTimeout(restarted.timer); const record = restarted.saved.records[f.record.snapshot.accountKey]; assert.equal(record.jobs[0].state, 'interrupted'); assert.equal(record.snapshot.state, 'stale'); }
  finally { await restarted.close(); }
});
