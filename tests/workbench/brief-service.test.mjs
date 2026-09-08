import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { IbkrWorkbenchService } from '../../server/ibkrWorkbench.ts';
import { normalizeMcpSnapshot } from '../../server/ibkrMcp.ts';
import { defaults } from '../../server/ibkrWorkbenchCore.ts';
import { briefInput } from '../../server/ibkrBrief.ts';

const model = { provider: 'test-only', model: 'offline-brief', fingerprint: 'brief-fixture', configured: true };
const raw = JSON.stringify({ headline: '账户空仓，建立观察基线', summary: '账户净值 {{nav}}，本期结合可取得资料建立观察基线。', insights: [], calendar: [], changes: ['首次建立观察基线。'], gaps: ['当前没有股票持仓。'] });
async function fixture() {
  await mkdir('tmp/workbench-service', { recursive: true });
  const dir = await mkdtemp(path.resolve('tmp/workbench-service/brief-'));
  const service = new IbkrWorkbenchService(process.cwd(), dir, async () => ({}), async () => ({}));
  await service.start(); clearTimeout(service.timer);
  const snapshot = normalizeMcpSnapshot('BRIEF_TEST_ACCOUNT', [], { baseCurrency: 'USD', netLiquidation: 10000, cash: [{ currency: 'USD', amount: 10000 }] });
  const record = { snapshot, preferences: { ...defaults }, alerts: [], reports: [], jobs: [], usage: [], grant: { fingerprint: model.fingerprint } };
  service.saved.selectedKey = snapshot.accountKey; service.saved.records[snapshot.accountKey] = record;
  let calls = 0;
  service.ai = { status: async () => model, tool: async () => { throw new Error('OFFLINE_SOURCE'); }, analyze: async () => { calls++; return { text: raw }; }, close: () => {} };
  service.nextSync = Date.now() + 86400000;
  return { service, record, dir, calls: () => calls };
}
test('brief is one model call, account scoped, archived, and deduplicated for the session', async () => {
  const f = await fixture();
  try {
    const results = await Promise.allSettled([f.service.generateBrief(true), f.service.generateBrief(true)]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    await f.service.activeBrief;
    assert.equal(f.calls(), 1); assert.equal(f.record.briefs.length, 1); assert.equal(f.record.reports.length, 0);
    const b = f.record.briefs[0]; assert.match(b.content.summary, /10,000.00 USD/);
    assert.equal(JSON.parse(await readFile(path.join(f.dir, `${b.id}.brief.json`), 'utf8')).snapshotHash, b.snapshotHash);
    await f.service.tick(); await f.service.activeBrief; assert.equal(f.calls(), 1);
    f.service.saved.selectedKey = 'live:another'; assert.equal((await f.service.state()).dailyBrief.latest, undefined);
  } finally { await f.service.close(); }
});
test('a failed v4 brief can recover the locally saved result without another model call', async () => {
  const f = await fixture();
  try {
    const id = '00000000-0000-4000-8000-000000000001';
    const input = briefInput(f.record.snapshot, f.record.preferences, '2026-09-04', { analysisAsOf: '2026-09-08T04:00:00Z', evidence: [{ id: 'E1', title: 'Apple', symbols: ['AAPL'], url: 'https://example.com/aapl', source: 'Example', publishedAt: '2026-09-07T00:00:00Z', fetchedAt: '2026-09-08T00:00:00Z', kind: 'news', read: true, summary: 'summary', content: 'Apple announcement.' }], coverage: [], gaps: [] });
    const output = { headline: '组合变化', summary: '账户净值 {{nav}}。', insights: [{ id: 'unsupported', title: '未核实提醒', kind: 'watch', priority: 'low', status: 'new', symbols: ['AAPL'], fact: '待核实。', impact: '暂不作为判断依据。', watch: '等待原文。', invalidation: '原文不支持。', horizon: '近期', confidence: 'low', confidenceReason: '来源未通过核验。', evidenceIds: ['E1'], support: [{ evidenceId: 'E1', quote: 'not in source' }] }], calendar: [], changes: ['建立基线。'], gaps: [] };
    f.record.briefAttempt = { id, sessionDate: '2026-09-04', state: 'failed', startedAt: new Date().toISOString(), error: '旧规则失败' };
    await writeFile(path.join(f.dir, `${id}.brief-attempt.json`), JSON.stringify({ id, promptVersion: 'portfolio-daily-brief-v4', snapshot: f.record.snapshot, snapshotHash: 'fixture', input, raw: JSON.stringify(output), model }), 'utf8');
    const result = await f.service.recoverBrief();
    assert.equal(result.recovered, true); assert.equal(f.calls(), 0); assert.equal(f.record.briefs.length, 1);
    assert.equal(f.record.briefs[0].content.insights.length, 0);
    assert.equal(f.record.briefAttempt.state, 'completed');
  } finally { await f.service.close(); }
});

test('brief starts independently while an account analysis is active and remains out of report history', async () => {
  const f = await fixture();
  let releaseAnalysis;
  f.service.activeAnalysis = new Promise(resolve => { releaseAnalysis = resolve; });
  try {
    await f.service.generateBrief();
    await f.service.activeBrief;
    assert.equal(f.calls(), 1);
    assert.equal(f.record.briefs.length, 1);
    assert.equal(f.record.reports.length, 0);
  } finally {
    releaseAnalysis();
    f.service.activeAnalysis = undefined;
    await f.service.close();
  }
});
test('two scheduled clock slots in one session each generate one brief and archive both', async () => {
  const f = await fixture();
  try {
    f.record.preferences.schedules = { brief: { enabled: true, mode: 'clock', timeZone: 'UTC', times: ['09:00', '18:00'] }, analysis: { enabled: false, mode: 'clock', timeZone: 'UTC', times: ['09:00'] } };
    f.record.scheduleRuns = { 'brief:slot-one': { at: new Date().toISOString() }, 'brief:slot-two': { at: new Date().toISOString() } };
    await f.service.generateBrief(true, 'brief:slot-one'); await f.service.activeBrief;
    await f.service.generateBrief(true, 'brief:slot-two'); await f.service.activeBrief;
    assert.equal(f.calls(), 2); assert.equal(f.record.briefs.length, 2);
    assert.equal(f.record.briefs[0].sessionDate, f.record.briefs[1].sessionDate);
    assert.notEqual(f.record.briefs[0].id, f.record.briefs[1].id);
    assert.equal(f.record.usage.length, 2);
  } finally { await f.service.close(); }
});

test('failed daily brief keeps previous success and never automatically repeats its model call', async () => {
  const f = await fixture();
  try {
    f.record.briefs = [{ id: 'previous', content: { headline: '上一期' } }];
    f.service.ai.analyze = async () => ({ text: '{"invented":"invalid"}' });
    await f.service.generateBrief(true); await f.service.activeBrief;
    assert.equal(f.record.briefAttempt.state, 'failed'); assert.equal(f.record.briefs[0].id, 'previous');
    await f.service.tick(); assert.equal(f.record.usage.length, 1);
    assert.equal((await f.service.state()).dailyBrief.state, 'failed');
  } finally { await f.service.close(); }
});
test('brief blocks stale identity, revoked model consent and exhausted budget', async () => {
  const f = await fixture();
  try {
    f.record.snapshot.asOf = '2020-01-01'; await assert.rejects(() => f.service.generateBrief(), /同步/);
    f.record.snapshot.asOf = new Date().toISOString(); f.record.grant = undefined;
    await assert.rejects(() => f.service.generateBrief(), /账户分析/);
    f.record.grant = { fingerprint: 'changed-model' }; await assert.rejects(() => f.service.generateBrief(), /账户分析/);
    f.record.grant.fingerprint = model.fingerprint;
    f.record.preferences.maxAiCalls = 1; f.record.usage = [{ at: new Date().toISOString(), kind: 'manual' }];
    await assert.rejects(() => f.service.generateBrief(), /上限/); assert.equal(f.calls(), 0);
  } finally { await f.service.close(); }
});
test('provider authentication failure pauses future sessions until a successful manual generation', async () => {
  const f = await fixture();
  try {
    f.service.ai.analyze = async () => { throw new Error('AI_HTTP_401'); };
    await f.service.generateBrief(true); await f.service.activeBrief;
    f.record.briefAttempt.sessionDate = '2026-01-01';
    await f.service.tick();
    assert.equal(f.record.usage.length, 1);
    assert.equal((await f.service.state()).dailyBrief.state, 'blocked');
    assert.equal((await f.service.state()).dailyBrief.nextRunAt, null);
    f.service.ai.analyze = async () => ({ text: raw });
    await f.service.generateBrief(); await f.service.activeBrief;
    assert.equal((await f.service.state()).dailyBrief.state, 'ready');
  } finally { await f.service.close(); }
});
test('revocation during a brief discards the pending output and restart does not repeat it', async () => {
  const f = await fixture();
  try {
    let finish; let entered;
    const ready = new Promise(r => { entered = r; });
    f.service.ai.analyze = () => { entered(); return new Promise(r => { finish = r; }); };
    await f.service.generateBrief(true); await ready;
    await f.service.grant(false); finish({ text: raw }); await f.service.activeBrief;
    assert.equal(f.record.briefs?.length ?? 0, 0); assert.equal(f.record.briefAttempt.state, 'failed');
    f.record.briefAttempt.state = 'running'; await f.service.persist(); await f.service.close();
    const restarted = new IbkrWorkbenchService(process.cwd(), f.dir, async () => ({}), async () => ({}));
    try { await restarted.start(); clearTimeout(restarted.timer); assert.equal(restarted.saved.records[f.record.snapshot.accountKey].briefAttempt.state, 'failed'); }
    finally { await restarted.close(); }
  } finally { await f.service.close(); }
});

test('cancelling public brief research stops the request before consuming a model call', async () => {
  const f = await fixture();
  try {
    let entered;
    const ready = new Promise(resolve => { entered = resolve; });
    f.service.ai.tool = (_name, _args, signal) => new Promise((_resolve, reject) => {
      entered();
      signal.addEventListener('abort', () => reject(new Error('CANCELLED')), { once: true });
      if (signal.aborted) reject(new Error('CANCELLED'));
    });
    const attempt = await f.service.generateBrief();
    await ready;
    await f.service.cancel(attempt.id);
    assert.equal(f.calls(), 0); assert.equal(f.record.usage.length, 0);
    assert.equal(f.record.briefAttempt.state, 'failed');
    assert.equal(f.record.briefs?.length ?? 0, 0);
  } finally { await f.service.close(); }
});
