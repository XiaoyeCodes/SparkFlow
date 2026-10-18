// Exercise the actual bundled Python agent and LiteLLM routing against a local
// OpenAI-compatible fixture. No real credentials, external model calls or fees.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { pythonStrategyRunner } from '../server/stockStrategy.ts';

const directory = await mkdtemp(path.join(tmpdir(), 'sparkflow-strategy-engine-'));
const requests = [];
const key = 'test-engine-key-private';
let phase = 'chat'; let heldRequest; let heldClosed = false;
const reportFixture = { stock_name: '测试公司', sentiment_score: 62, trend_prediction: '震荡', operation_advice: '观望',
  analysis_summary: '本地报告验证成功，等待量能确认。', technical_analysis: '价格在均线上方。', fundamental_analysis: '测试基本面。',
  news_summary: '测试新闻资料。', risk_warning: '测试风险提示。', dashboard: { battle_plan: { sniper_points: { ideal_buy: '190', secondary_buy: '185', stop_loss: '180', take_profit: '220' } } },
};
const api = createServer(async (req, res) => {
  const buffers = []; for await (const chunk of req) buffers.push(chunk);
  const body = JSON.parse(Buffer.concat(buffers).toString());
  requests.push({ url: req.url, authorization: req.headers.authorization, body });
  if (phase === 'cancel') { res.on('close', () => { heldClosed = true; }); heldRequest?.(); return; }
  const content = phase === 'report' ? JSON.stringify(reportFixture) : '本地引擎连通验证成功。请结合量价与风险信息判断。';
  if (body.stream) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.write(`data: ${JSON.stringify({ id: 'local-stream', object: 'chat.completion.chunk', created: 1700000000, model: body.model, choices: [{ index: 0, delta: { role: 'assistant', content }, finish_reason: null }] })}\n\n`);
    res.end(`data: ${JSON.stringify({ id: 'local-stream', object: 'chat.completion.chunk', created: 1700000000, model: body.model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
    return;
  }
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ id: 'chatcmpl-local', object: 'chat.completion', created: 1700000000, model: body.model,
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
  }));
});
await new Promise(resolve => api.listen(0, '127.0.0.1', resolve));
const baseUrl = `http://127.0.0.1:${api.address().port}/v1`;
const runner = pythonStrategyRunner(process.cwd());
const run = async (sessionId, question, previousReport) => {
  const events = [];
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 90_000);
  try {
    await runner({ id: randomUUID(), symbol: 'AAPL', mode: 'chat', question, strategies: ['bull_trend'], sessionId,
      dataDir: directory, previousReport, ai: { apiKey: key, baseUrl, model: 'vendor/model-for-test', useProxy: false } }, event => events.push(event), controller.signal);
    assert.ok(events.some(event => event.type === 'result' && event.result.content.includes('验证成功')));
    assert.ok(!JSON.stringify(events).includes(key));
  } finally { clearTimeout(timer); }
};
try {
  const session = randomUUID();
  await run(session, '请说明测试报告的风险。', { summary: { analysis_summary: '回踩确认，切勿追高。' }, strategy: { stop_loss: '180' } });
  await run(session, '延续刚才的问题，补充一句。');
  assert.ok(requests.length >= 2);
  for (const request of requests) {
    assert.equal(request.url, '/v1/chat/completions');
    assert.equal(request.authorization, `Bearer ${key}`);
    assert.equal(request.body.model, 'vendor/model-for-test');
    assert.ok(Array.isArray(request.body.tools) && request.body.tools.length > 0);
  }
  assert.ok(JSON.stringify(requests[0].body.messages).includes('切勿追高'));
  assert.ok(JSON.stringify(requests.at(-1).body.messages).includes('测试报告的风险'));
  phase = 'report';
  const python = process.env.SPARKFLOW_STRATEGY_PYTHON || path.join(process.cwd(), 'services/daily-stock-analysis/.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const report = await new Promise((resolve, reject) => {
    const child = execFile(python, ['-u', 'scripts/verify-stock-strategy-report.py'], { windowsHide: true, timeout: 90_000,
      maxBuffer: 8 * 1024 * 1024, env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' } }, (error, stdout, stderr) => {
      if (error) return reject(new Error(stderr || error.message));
      try { resolve(JSON.parse(stdout)); } catch (error) { reject(error); }
    });
    child.stdin.end(JSON.stringify({ dataDir: directory, ai: { apiKey: key, baseUrl, model: 'vendor/model-for-test', useProxy: false } }));
  });
  assert.equal(report.stock_code, 'AAPL');
  assert.match(report.report.summary.analysis_summary, /本地报告验证成功/);
  assert.equal(report.report.strategy.stop_loss, '180');
  assert.equal(report.report.details.risk_warning, '测试风险提示。');
  assert.ok(!JSON.stringify(report).includes(key));
  phase = 'cancel';
  const arrived = new Promise(resolve => { heldRequest = resolve; });
  const controller = new AbortController(); const deadline = setTimeout(() => controller.abort(), 90_000);
  const cancelled = runner({ id: randomUUID(), symbol: 'AAPL', mode: 'chat', question: '停止测试', strategies: [], sessionId: randomUUID(),
    dataDir: directory, ai: { apiKey: key, baseUrl, model: 'vendor/model-for-test', useProxy: false } }, () => {}, controller.signal);
  // Attach the rejection handler immediately, including while waiting for startup.
  const stopped = assert.rejects(cancelled, /停止/);
  try {
    await Promise.race([arrived, cancelled]);
    controller.abort();
    await stopped;
    for (let i = 0; i < 50 && !heldClosed; i++) await new Promise(resolve => setTimeout(resolve, 20));
    assert.ok(heldClosed, 'Cancelling must terminate the Python process holding the model connection');
  } finally { clearTimeout(deadline); controller.abort(); }
  console.log(`PASS: real Python agent and report analyzer, custom URL/model/key routing, streaming report mapping, durable multi-turn history and process-tree cancellation (${requests.length} local LLM requests).`);
} finally {
  api.closeAllConnections(); await new Promise(resolve => api.close(resolve));
  if (path.dirname(directory) === path.resolve(tmpdir()) && path.basename(directory).startsWith('sparkflow-strategy-engine-')) await rm(directory, { recursive: true, force: true, maxRetries: 3 });
}
