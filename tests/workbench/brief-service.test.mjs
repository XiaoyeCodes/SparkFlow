import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { IbkrWorkbenchService } from '../../server/ibkrWorkbench.ts';
import { normalizeMcpSnapshot } from '../../server/ibkrMcp.ts';
import { defaults } from '../../server/ibkrWorkbenchCore.ts';

const model = { provider: 'test-only', model: 'offline-brief', fingerprint: 'brief-fixture', configured: true };
const raw = JSON.stringify({ headline: '现金充足，保持观察', summary: '账户净值 {{nav}}。', risk: '账户空仓，仍需核对资金需求。', watch: ['核对资金安排。'], gaps: ['未检索新闻。'] });
async function fixture() {
  await mkdir('tmp/workbench-service', { recursive: true });
  const dir = await mkdtemp(path.resolve('tmp/workbench-service/brief-'));
  const service = new IbkrWorkbenchService(process.cwd(), dir, async () => ({}), async () => ({}));
  await service.start(); clearTimeout(service.timer);
  const snapshot = normalizeMcpSnapshot('BRIEF_TEST_ACCOUNT', [], { baseCurrency: 'USD', netLiquidation: 10000, cash: [{ currency: 'USD', amount: 10000 }] });
  const record = { snapshot, preferences: { ...defaults }, alerts: [], reports: [], jobs: [], usage: [], grant: { fingerprint: model.fingerprint } };
  service.saved.selectedKey = snapshot.accountKey; service.saved.records[snapshot.accountKey] = record;
  let calls = 0;
  service.ai = { status: async () => model, analyze: async () => { calls++; return { text: raw }; }, close: () => {} };
  service.nextSync = Date.now() + 86400000;
  return { service, record, dir, calls: () => calls };
}
test('brief is one model call, account scoped, archived, and deduplicated for the session', async () => {
  const f = await fixture();
  try {
    const results = await Promise.allSettled([f.service.generateBrief(true), f.service.generateBrief(true)]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    await f.service.activeAnalysis;
    assert.equal(f.calls(), 1); assert.equal(f.record.briefs.length, 1); assert.equal(f.record.reports.length, 0);
    const b = f.record.briefs[0]; assert.match(b.content.summary, /10,000.00 USD/);
    assert.equal(JSON.parse(await readFile(path.join(f.dir, `${b.id}.brief.json`), 'utf8')).snapshotHash, b.snapshotHash);
    await f.service.tick(); await f.service.activeAnalysis; assert.equal(f.calls(), 1);
    f.service.saved.selectedKey = 'live:another'; assert.equal((await f.service.state()).dailyBrief.latest, undefined);
  } finally { await f.service.close(); }
});
test('failed daily brief keeps previous success and never automatically repeats its model call', async () => {
  const f = await fixture();
  try {
    f.record.briefs = [{ id: 'previous', content: { headline: '上一期' } }];
    f.service.ai.analyze = async () => ({ text: '{"invented":"invalid"}' });
    await f.service.generateBrief(true); await f.service.activeAnalysis;
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
    await f.service.generateBrief(true); await f.service.activeAnalysis;
    f.record.briefAttempt.sessionDate = '2026-01-01';
    await f.service.tick();
    assert.equal(f.record.usage.length, 1);
    assert.equal((await f.service.state()).dailyBrief.state, 'blocked');
    assert.equal((await f.service.state()).dailyBrief.nextRunAt, null);
    f.service.ai.analyze = async () => ({ text: raw });
    await f.service.generateBrief(); await f.service.activeAnalysis;
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
    await f.service.grant(false); finish({ text: raw }); await f.service.activeAnalysis;
    assert.equal(f.record.briefs?.length ?? 0, 0); assert.equal(f.record.briefAttempt.state, 'failed');
    f.record.briefAttempt.state = 'running'; await f.service.persist(); await f.service.close();
    const restarted = new IbkrWorkbenchService(process.cwd(), f.dir, async () => ({}), async () => ({}));
    try { await restarted.start(); clearTimeout(restarted.timer); assert.equal(restarted.saved.records[f.record.snapshot.accountKey].briefAttempt.state, 'failed'); }
    finally { await restarted.close(); }
  } finally { await f.service.close(); }
});
