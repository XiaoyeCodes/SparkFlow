import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createAssistantResearch } from '../../server/ibkrAssistantResearch.ts';
import { portfolioRiskAssessment, assistantReportContent } from '../../src/lib/ibkr/portfolioRisk.ts';
import { reportMarkdown } from '../../src/lib/ibkr/workbenchReport.ts';
import { IbkrWorkbenchService } from '../../server/ibkrWorkbench.ts';
import { normalizeMcpSnapshot } from '../../server/ibkrMcp.ts';
import { defaults } from '../../server/ibkrWorkbenchCore.ts';

const conclusion = '今日整体风险关注度：高（风险指数 78/100）——仓位集中，现金缓冲不足，需关注利率事件。';
const markdown = `# 持仓研究\n\n## 主要依据\n\n这是离线测试，不是真实账户建议。\n\n${conclusion}`;
const prepared = { baseUrl: 'http://fixture.invalid', sessionId: 'fixture-session', provider: 'fixture', model: 'offline' };

test('extracts only a valid final risk conclusion; no guessed or contradictory scores', () => {
  assert.deepEqual(portfolioRiskAssessment(markdown), { score: 78, level: '高', summary: conclusion });
  assert.equal(portfolioRiskAssessment(`**${conclusion}**`).score, 78);
  assert.equal(portfolioRiskAssessment(conclusion.replace('高', '低').replace('78', '0')).score, 0);
  for (const text of [conclusion.replace('78', '101'), conclusion.replace('高', '低'), conclusion.replace('78', '-1'), conclusion.replace('78', '78.3'), `${markdown}\n\n仍需说明`, '风险为高，现金78美元。', '今日整体风险关注度：暂无法评估——缺少资料']) assert.equal(portfolioRiskAssessment(text), undefined);
  assert.equal(assistantReportContent('无评分报告').riskSummary, undefined);
  assert.equal(reportMarkdown({ content: assistantReportContent(markdown) }), markdown);
});

test('one assistant dispatch; transient read errors and previous attempts never trigger regeneration', async () => {
  let posts = 0, polls = 0;
  const runner = createAssistantResearch(async () => prepared, async (_base, route, init) => {
    if (init?.method === 'POST') { posts++; return { attempt_id: 'new' }; }
    if (route.includes('/messages?')) {
      if (++polls === 1) throw Error('temporary read failure');
      return [{ role: 'assistant', content: 'old report', linked_attempt_id: 'old' }, ...(polls >= 3 ? [{ role: 'assistant', content: markdown, linked_attempt_id: 'new' }] : [])];
    }
    return { last_attempt_id: 'new', last_attempt_status: polls >= 3 ? 'completed' : 'running' };
  }, 1);
  const signal = new AbortController().signal;
  const run = await runner.start('snapshot'.repeat(1000), signal, actual => assert.equal(actual.model, 'offline'));
  assert.equal(await runner.wait(run, signal), markdown);
  assert.equal(posts, 1); assert.equal(polls, 3);
});

test('cancellation cancels the upstream session and a failed run never publishes an older report', async () => {
  let cancels = 0;
  const runner = createAssistantResearch(async () => prepared, async (_base, route, init) => {
    if (route.includes('/cancel')) { assert.ok(route.includes('expected_attempt_id=new')); cancels++; return {}; }
    if (init?.method === 'POST') return { attempt_id: 'new' };
    if (route.includes('/messages?')) return [{ role: 'assistant', linked_attempt_id: 'old', content: markdown }];
    return { last_attempt_id: 'new', last_attempt_status: 'failed' };
  }, 1);
  const controller = new AbortController();
  const run = await runner.start('snapshot', controller.signal, () => {});
  await assert.rejects(runner.wait(run, controller.signal), /未返回完整报告/);
  const next = new AbortController(); const running = await runner.start('snapshot', next.signal, () => {});
  next.abort();
  await assert.rejects(runner.wait(running, next.signal));
  assert.equal(cancels, 1);
});

test('model authorization and oversized input prevent dispatch', async () => {
  let calls = 0;
  const runner = createAssistantResearch(async () => prepared, async () => { calls++; return {}; });
  await assert.rejects(runner.start('snapshot', new AbortController().signal, () => { throw Error('revoked'); }), /revoked/);
  await assert.rejects(runner.start('x'.repeat(64001), new AbortController().signal, () => {}), /64000/);
  assert.equal(calls, 0);
});

test('a failed assistant reply is never published as a successful report', async () => {
  const runner = createAssistantResearch(async () => prepared, async (_base, route) => route.includes('/messages?')
    ? [{ role: 'assistant', linked_attempt_id: 'failed', content: 'Execution failed: upstream unavailable' }]
    : { last_attempt_id: 'failed', last_attempt_status: 'failed' }, 1);
  await assert.rejects(runner.wait({ ...prepared, attemptId: 'failed' }, new AbortController().signal), /未返回完整报告/);
});

async function fixture() {
  await mkdir('tmp/assistant-research-tests', { recursive: true });
  const dir = await mkdtemp(path.resolve('tmp/assistant-research-tests/run-'));
  const service = new IbkrWorkbenchService(process.cwd(), dir, async () => ({}), async () => ({}));
  await service.start(); clearTimeout(service.timer);
  const model = { ...prepared, fingerprint: 'fixture-model', configured: true };
  service.ai = { status: async () => model, close() {}, analyze() { throw Error('legacy AI must not run'); }, tool() { throw Error('legacy tools must not run'); } };
  const snapshot = normalizeMcpSnapshot('PRIVATE_TEST_ACCOUNT', [], { baseCurrency: 'USD', netLiquidation: 10000, cash: [{ currency: 'USD', amount: 10000 }] });
  const record = { snapshot, preferences: { ...defaults }, alerts: [], reports: [], jobs: [], usage: [], grant: { fingerprint: model.fingerprint } };
  service.saved.selectedKey = snapshot.accountKey; service.saved.records[snapshot.accountKey] = record;
  let complete, starts = 0; const dispatched = [];
  service.assistantResearch = {
    async start(prompt, signal, authorize, sessionId) { starts++; dispatched.push({ prompt, sessionId }); assert.doesNotMatch(prompt, /PRIVATE_TEST_ACCOUNT/); signal.throwIfAborted(); await authorize(prepared); return { ...prepared, attemptId: `attempt-${starts}` }; },
    wait(_run, signal) { return new Promise((resolve, reject) => { complete = resolve; signal.addEventListener('abort', () => reject(Error('cancelled')), { once: true }); }); },
  };
  return { service, record, dir, finish: (text = markdown) => complete(text), starts: () => starts, dispatched };
}

test('account and assistant share one job, keep snapshot frozen, and persist the original report without a browser', async () => {
  const f = await fixture();
  try {
    const job = await f.service.analyze('manual');
    assert.equal(job.assistantSessionId, 'fixture-session');
    await assert.rejects(f.service.analyze('manual'), /已有分析/);
    f.record.snapshot.metrics.netLiquidation = '20000';
    f.finish(); await f.service.activeAnalysis;
    assert.equal(job.state, 'completed'); assert.equal(f.starts(), 1); assert.equal(f.record.usage.length, 1);
    const report = f.record.reports[0];
    assert.equal(report.snapshot.metrics.netLiquidation, '10000');
    assert.equal(report.content.rawContent, markdown); assert.equal(report.content.riskSummary, conclusion);
    assert.equal(JSON.parse(await readFile(path.join(f.dir, `${report.id}.report.json`), 'utf8')).content.rawContent, markdown);
  } finally { await f.service.close(); }
});

test('revoked consent, stale account, budget and cancellation remain enforced', async () => {
  const f = await fixture();
  try {
    f.record.grant.fingerprint = 'revoked'; await assert.rejects(f.service.analyze('manual'), /开启当前模型/);
    f.record.grant.fingerprint = 'fixture-model'; f.record.snapshot.asOf = 'bad'; await assert.rejects(f.service.analyze('manual'), /最新真实账户/);
    f.record.snapshot.asOf = new Date().toISOString(); f.record.preferences.maxAiCalls = 0; await assert.rejects(f.service.analyze('manual'), /上限/);
    assert.equal(f.starts(), 0); f.record.preferences.maxAiCalls = 5;
    const job = await f.service.analyze('manual'); await f.service.cancel(job.id);
    assert.equal(job.state, 'cancelled'); assert.equal(f.record.reports.length, 0);
  } finally { await f.service.close(); }
});

test('follow-ups reuse the selected report session and persist its parent across multiple turns', async () => {
  const f = await fixture();
  try {
    await f.service.analyze('manual');
    const originalText = markdown + '\n\n原报告资料'.repeat(3000);
    f.finish(originalText); await f.service.activeAnalysis;
    const parent = f.record.reports[0];
    assert.equal(parent.assistantSessionId, prepared.sessionId);
    assert.equal(parent.assistantAttemptId, 'attempt-1');
    assert.equal(JSON.parse(await readFile(path.join(f.dir, `${parent.id}.report.json`), 'utf8')).assistantSessionId, prepared.sessionId);
    for (const question of ['现金风险如何？', '再解释集中度']) {
      const job = await f.service.analyze('chat', question, undefined, undefined, undefined, false, parent.id);
      assert.equal(job.parentReportId, parent.id);
      assert.equal(f.dispatched.at(-1).sessionId, prepared.sessionId);
      assert.ok(f.dispatched.at(-1).prompt.includes(JSON.stringify(originalText)));
      assert.ok(f.dispatched.at(-1).prompt.includes(question));
      f.finish(); await f.service.activeAnalysis;
      assert.equal(f.record.reports[0].parentReportId, parent.id);
      assert.equal(f.record.reports[0].assistantSessionId, parent.assistantSessionId);
    }
    assert.equal(f.record.reports.find(r => r.id === parent.id).content.rawContent, originalText);
    assert.equal(f.starts(), 3);
  } finally { await f.service.close(); }
});

test('legacy report links recover from their own job; missing links and foreign accounts fail closed', async () => {
  const f = await fixture();
  try {
    await f.service.analyze('manual'); f.finish(); await f.service.activeAnalysis;
    const parent = f.record.reports[0];
    delete parent.assistantSessionId; delete parent.assistantAttemptId;
    const job = await f.service.analyze('chat', '继续', undefined, undefined, undefined, false, parent.id);
    assert.equal(f.dispatched.at(-1).sessionId, prepared.sessionId);
    await f.service.cancel(job.id);
    // Explicit retry must retain the selected report and question, not create a new session.
    await f.service.analyze('manual', undefined, undefined, undefined, job.id);
    assert.equal(f.dispatched.at(-1).sessionId, prepared.sessionId);
    assert.ok(f.dispatched.at(-1).prompt.includes('继续'));
    f.finish(); await f.service.activeAnalysis;
    const count = f.starts(); const usage = f.record.usage.length;
    f.record.jobs = [];
    await assert.rejects(f.service.analyze('chat', '继续', undefined, undefined, undefined, false, parent.id), /未保存原 AI 会话/);
    parent.assistantSessionId = prepared.sessionId; parent.accountKey = 'foreign';
    await assert.rejects(f.service.analyze('chat', '继续', undefined, undefined, undefined, false, parent.id), /不属于当前账户/);
    await assert.rejects(f.service.analyze('chat', '继续', undefined, undefined, undefined, false, '../state'), /无效报告/);
    assert.equal(f.starts(), count); assert.equal(f.record.usage.length, usage);
  } finally { await f.service.close(); }
});

test('transport posts to the existing session exactly once and uses an atomic idle guard', async () => {
  let preparedId; const posts = [];
  const runner = createAssistantResearch(async id => { preparedId = id; return prepared; }, async (_base, route, init) => {
    if (init?.method === 'POST') { posts.push({ route, body: JSON.parse(init.body) }); return { attempt_id: 'follow-up' }; }
    return { last_attempt_status: 'completed' };
  });
  const signal = new AbortController().signal;
  const run = await runner.start('原报告追问', signal, () => {}, prepared.sessionId);
  assert.equal(preparedId, prepared.sessionId); assert.equal(run.sessionId, preparedId);
  assert.deepEqual(posts, [{ route: `/sessions/${prepared.sessionId}/messages`, body: { content: '原报告追问', require_idle: true } }]);
});

test('missing, replaced, busy or uncertain existing sessions never create or cancel another session', async () => {
  for (const scenario of ['missing', 'replaced', 'busy', 'uncertain']) {
    const calls = [];
    const runner = createAssistantResearch(async () => {
      if (scenario === 'missing') throw Error('ASSISTANT_SESSION_UNAVAILABLE');
      return { ...prepared, sessionId: scenario === 'replaced' ? 'different' : prepared.sessionId };
    }, async (_base, route, init) => {
      calls.push({ route, method: init?.method });
      if (init?.method === 'POST') throw Error('uncertain POST');
      return { last_attempt_status: scenario === 'busy' ? 'running' : 'completed' };
    });
    await assert.rejects(runner.start('追问', new AbortController().signal, () => {}, prepared.sessionId));
    assert.equal(calls.filter(c => c.method === 'POST').length, scenario === 'uncertain' ? 1 : 0);
    assert.ok(calls.every(c => c.route !== '/sessions' && !c.route.includes('/cancel')));
  }
});

test('changing the account while research is running never publishes the result to either account', async () => {
  const f = await fixture();
  try {
    const job = await f.service.analyze('manual'); f.service.saved.selectedKey = 'different-account';
    f.finish(); await f.service.activeAnalysis;
    assert.notEqual(job.state, 'completed'); assert.equal(f.record.reports.length, 0);
  } finally { await f.service.close(); }
});
