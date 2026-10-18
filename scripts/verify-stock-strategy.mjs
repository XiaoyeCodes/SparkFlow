import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createStockStrategyService, readStrategyCatalog } from '../server/stockStrategy.ts';
import { strategyReportDetails } from '../src/lib/stockStrategyReport.ts';

const nestedDetails = strategyReportDetails({ details: { technical_analysis: '', empty_news_disclosure: '此前未配置搜索', raw_result: {
  dashboard: { data_perspective: { trend_status: { ma_alignment: '测试均线结构' }, price_position: { ma5: 0, ma10: 11 } },
    intelligence: { earnings_outlook: '利润同比增长', latest_news: '历史新闻摘要', risk_alerts: ['量能不足', '波动风险'] },
    battle_plan: { position_strategy: { risk_control: '控制集中度' } } },
} } });
assert.match(nestedDetails.technical_analysis, /测试均线结构/);
assert.match(nestedDetails.technical_analysis, /MA5\*\*：0/);
assert.equal(nestedDetails.fundamental_analysis, '利润同比增长');
assert.equal(nestedDetails.news_summary, '历史新闻摘要');
assert.equal(nestedDetails.empty_news_disclosure, '此前未配置搜索');
assert.match(nestedDetails.risk_warning, /量能不足[\s\S]*控制集中度/);
assert.equal(strategyReportDetails({ details: { technical_analysis: '原版分析', raw_result: { technical_analysis: '备用' } } }).technical_analysis, '原版分析');
assert.equal(strategyReportDetails({ details: { raw_result: { dashboard: null } } }).risk_warning, '');

const directory = await mkdtemp(path.join(tmpdir(), 'sparkflow-strategy-test-'));
const root = process.cwd();
const credential = 'test-private-key-never-visible';
let model = 'first-model';
const getAi = async () => ({ apiKey: credential, model, baseUrl: 'http://localhost/v1', provider: 'custom', useProxy: false });
const waitUntil = async predicate => { for (let i = 0; i < 300; i++) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 10)); } throw new Error('Condition timed out'); };
let calls = 0; let release;
const runner = async (payload, emit, signal) => {
  calls++;
  assert.equal(payload.ai.apiKey, credential);
  assert.ok(payload.dataDir.startsWith(directory));
  emit({ type: 'progress', progress: 35, message: 'Collected data' });
  if (payload.symbol === 'ERROR') throw new Error(`Provider rejected ${credential}`);
  if (payload.symbol === 'WAIT') await new Promise((resolve, reject) => { release = resolve; signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }); });
  emit({ type: 'result', result: { stock_name: payload.symbol, report: { summary: { analysis_summary: 'Verified test report', sentiment_score: 60 } } } });
};
const make = (extra = {}) => createStockStrategyService({ root, directory, getAi, runner, runtimeReady: () => true, ...extra });
const service = make();
try {
  assert.equal((await readStrategyCatalog(root)).length, 15);
  assert.equal((await service.state()).configured, true);
  assert.ok(!JSON.stringify(await service.state()).includes(credential));
  await assert.rejects(service.start({ symbol: '../secret' }), /股票代码/);
  await assert.rejects(service.start({ symbol: 'AAPL', strategies: ['unknown'] }), /策略列表/);
  await assert.rejects(service.start({ symbol: 'AAPL', mode: 'chat', question: '' }), /研究问题/);
  const [job, duplicate] = await Promise.all([service.start({ symbol: 'WAIT' }), service.start({ symbol: 'WAIT' })]);
  assert.equal(job.id, duplicate.id);
  await waitUntil(() => release);
  const queued = await service.start({ symbol: 'AAPL' });
  assert.equal((await service.get(queued.id)).status, 'queued');
  model = 'updated-model'; release();
  await waitUntil(async () => (await service.get(queued.id)).status === 'completed');
  assert.equal((await service.get(queued.id)).model, 'updated-model');
  assert.equal(calls, 2);
  const restored = make();
  assert.equal((await restored.get(queued.id)).result.report.summary.analysis_summary, 'Verified test report');
  assert.equal(calls, 2, 'reading history must not call AI');
  const chat = await service.start({ symbol: 'AAPL', mode: 'chat', question: '风险是什么？', sessionId: queued.id });
  assert.equal(chat.sessionId, queued.sessionId);
  await assert.rejects(service.start({ symbol: 'TSLA', mode: 'chat', question: '风险？', sessionId: queued.id }), /不一致/);
  const failed = await service.start({ symbol: 'ERROR' });
  await waitUntil(async () => (await service.get(failed.id)).status === 'failed');
  assert.ok(!(await service.get(failed.id)).message.includes(credential));
  const stopped = await service.start({ symbol: 'WAIT' });
  await waitUntil(async () => (await service.get(stopped.id)).status === 'running');
  await service.cancel(stopped.id);
  assert.equal((await service.get(stopped.id)).status, 'cancelled');
  await new Promise(resolve => setTimeout(resolve, 30));
  const stoppedDisk = JSON.parse(await readFile(path.join(directory, 'jobs', `${stopped.id}.json`), 'utf8'));
  assert.equal(stoppedDisk.status, 'cancelled');
  const stale = { ...stoppedDisk, status: 'running', ownerPid: 2147483647 };
  await writeFile(path.join(directory, 'jobs', `${stopped.id}.json`), JSON.stringify(stale));
  const restarted = make();
  assert.equal((await restarted.get(stopped.id)).status, 'interrupted');
  const timeoutService = make({ directory: path.join(directory, 'timeout'), timeoutMs: 30 });
  const timeout = await timeoutService.start({ symbol: 'WAIT' });
  await waitUntil(async () => (await timeoutService.get(timeout.id)).status === 'failed');
  assert.match((await timeoutService.get(timeout.id)).message, /超时/);
  for (const file of await readdir(path.join(directory, 'jobs'))) {
    assert.ok(!(await readFile(path.join(directory, 'jobs', file), 'utf8')).includes(credential));
  }
  const missing = make({ directory: path.join(directory, 'missing'), getAi: async () => ({ ...await getAi(), apiKey: '' }) });
  await assert.rejects(missing.start({ symbol: 'AAPL' }), /设置/);
  service.dispose(); restored.dispose(); restarted.dispose(); timeoutService.dispose(); missing.dispose();
  console.log('PASS: 15 upstream strategies, validation, queue/dedup, settings refresh, persistence/restart, cancellation, timeout and secret redaction.');
} finally {
  service.dispose();
  if (path.dirname(directory) === path.resolve(tmpdir()) && path.basename(directory).startsWith('sparkflow-strategy-test-')) await rm(directory, { recursive: true, force: true, maxRetries: 3 });
}
