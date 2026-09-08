import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { IbkrWorkbenchService, oauthCallbackPage } from '../../server/ibkrWorkbench.ts';
import { normalizeMcpSnapshot } from '../../server/ibkrMcp.ts';
import { defaults } from '../../server/ibkrWorkbenchCore.ts';

const model = { provider: 'test-only', model: 'offline-fixture', fingerprint: 'fixture-model', configured: true };
const legacy = JSON.stringify({ brief: '工程测试报告，非真实投资建议', accountSummary: '摘要', portfolioRisk: '风险', marketContext: '背景', holdings: [], opportunities: [], risks: [], actions: [], gaps: [] });
const raw=JSON.stringify({headline:'现金等待有依据的配置窗口',briefPoints:['空仓等待。','没有核实新事件。','先观察，出现证据再考虑。'],accountSummary:'空仓',portfolioRisk:'未触发',benchmarkComparison:'没有足够历史进行基准比较。',marketContext:'没有原文证据',opportunities:[],risks:[],scenarios:[{name:'base',assumptions:'维持现金',accountImpact:'波动较低',response:'观察'},{name:'upside',assumptions:'机会出现',accountImpact:'现金可配置',response:'分批'},{name:'downside',assumptions:'风险上升',accountImpact:'现金缓冲',response:'保持纪律'}],targetAllocation:'保持现金并等待证据。',monitoring:[{indicator:'现金机会成本',warningLine:'出现有证据机会',action:'重新分析'}],limitations:['没有持仓'],disclaimer:'不构成投资建议。',evidenceIds:[],gaps:['无外部证据'],reviewedSymbols:[],holdings:[],actions:[]});
test('OAuth landing distinguishes authorization from data sync and never reflects untrusted error HTML', () => {
  assert.match(oauthCallbackPage(true, false), /持仓待同步/);
  assert.match(oauthCallbackPage(true, true), /账户已同步/);
  assert.match(oauthCallbackPage(true, false, 'MCP_ACCOUNTS_TOOL_UNSUPPORTED'), /返回账户工作台/);
  assert.ok(!oauthCallbackPage(false, false, '<script>secret-token</script>').includes('secret-token'));
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
