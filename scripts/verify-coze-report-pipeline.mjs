import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {
  CozeReportTaskService,
  buildLosslessDisplayMarkdown,
  normalizeReportComparisonText,
} from '../server/cozeReportTasks.ts';

const fixture = `# 博通完整投资研究报告

Goldman Sachs

Global Investment Research

Confidential & Proprietary · 仅供测试

## 执行摘要

博通的核心业务涵盖半导体解决方案与基础设施软件。本段不得删减，数字 123.45 与 67.89% 必须保留。

| 指标 | 当前值 | 变化 |
| --- | ---: | ---: |
| 营收 | 515.74 亿美元 | +12.4% |
| 自由现金流 | 191.6 亿美元 | +8.2% |

## 风险矩阵与情景

- 上行情景：AI 网络需求继续扩张。
- 下行情景：客户集中度与估值压缩同时出现。

Page 1
`;

async function waitForTask(service, taskId) {
  for (let attempt = 0; attempt < 180; attempt += 1) {
    const task = await service.getTask(taskId);
    if (task.status === 'completed' || task.status === 'failed') return task;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('fixture task timed out');
}

function comparisonStats(sourceValue, markdownValue) {
  const source = normalizeReportComparisonText(sourceValue);
  const browser = normalizeReportComparisonText(markdownValue);
  const compactBrowser = browser.replace(/\s+/g, '');
  const sourceLines = source.split('\n')
    .map((line) => line.replace(/\s+/g, ''))
    .filter((line) => line.length >= 3);
  const missingLines = sourceLines.filter((line) => !compactBrowser.includes(line));
  const numericTokens = [...new Set(sourceLines.join(' ').match(/[-+]?\d[\d,.]*(?:%|亿美元|美元|万亿美元|倍|年|月|日)?/g) || [])];
  const missingNumbers = numericTokens.filter((token) => !compactBrowser.includes(token));
  return { sourceLines, missingLines, numericTokens, missingNumbers };
}

async function verifyTask(task, baseUrl) {
  assert.equal(task.status, 'completed', task.error || 'task must be completed');
  assert.ok(task.markdown, 'task has no Markdown');
  const rawArtifact = task.artifacts.find((artifact) => artifact.kind === 'raw-response');
  const answerArtifact = task.artifacts.find((artifact) => artifact.kind === 'answer-source');
  assert.ok(rawArtifact && answerArtifact, 'task must retain script output and complete answer');
  assert.ok(!task.artifacts.some((artifact) => artifact.kind.includes('pdf')), 'new pipeline must not generate PDF');

  const answerResponse = await fetch(`${baseUrl}${answerArtifact.url}`);
  assert.equal(answerResponse.status, 200, `answer HTTP ${answerResponse.status}`);
  const answerData = Buffer.from(await answerResponse.arrayBuffer());
  assert.equal(createHash('sha256').update(answerData).digest('hex'), answerArtifact.sha256, 'answer hash mismatch');
  const answer = answerData.toString('utf8');
  const stats = comparisonStats(answer, task.markdown);
  assert.deepEqual(stats.missingLines, [], `source lines missing in Markdown: ${stats.missingLines.join(' / ')}`);
  assert.deepEqual(stats.missingNumbers, [], `source numbers missing in Markdown: ${stats.missingNumbers.join(' / ')}`);
  return { rawArtifact, answerArtifact, stats };
}

if (process.argv[2] === '--task') {
  const taskId = process.argv[3];
  const baseUrl = String(process.argv[4] || 'http://127.0.0.1:5180').replace(/\/$/, '');
  assert.ok(taskId, 'usage: --task TASK_ID [BASE_URL]');
  const response = await fetch(`${baseUrl}/api/coze/equity-research/tasks/${encodeURIComponent(taskId)}`);
  assert.equal(response.status, 200, `task HTTP ${response.status}`);
  const task = await response.json();
  const { rawArtifact, answerArtifact, stats } = await verifyTask(task, baseUrl);
  console.log(JSON.stringify({
    ok: true,
    taskId,
    artifacts: task.artifacts.length,
    rawSha256: rawArtifact.sha256,
    answerSha256: answerArtifact.sha256,
    sourceLinesChecked: stats.sourceLines.length,
    numericTokensChecked: stats.numericTokens.length,
  }, null, 2));
} else {
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'sparkflow-report-script-'));
let receivedRequest;
const apiServer = createServer((request, response) => {
  const chunks = [];
  request.on('data', (chunk) => chunks.push(chunk));
  request.on('end', () => {
    receivedRequest = {
      url: request.url,
      authorization: request.headers.authorization,
      body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
    };
    response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ messages: [{ type: 'ai', content: fixture }] }));
  });
});
try {
  await new Promise((resolve, reject) => {
    apiServer.once('error', reject);
    apiServer.listen(0, '127.0.0.1', resolve);
  });
  const address = apiServer.address();
  assert.ok(address && typeof address !== 'string');
  const service = new CozeReportTaskService({
    rootDir: process.cwd(),
    stateDir: temporaryRoot,
    getConfig: () => ({ url: `http://127.0.0.1:${address.port}`, token: 'fixture-token', projectId: '1' }),
    timeoutMs: 20_000,
  });

  const preview = buildLosslessDisplayMarkdown(fixture, '博通');
  for (const required of ['Goldman Sachs', 'Global Investment Research', 'Confidential & Proprietary', '123.45', '67.89%', 'Page 1']) {
    assert.ok(preview.includes(required), `display conversion removed: ${required}`);
  }

  const created = await service.createTask('博通');
  assert.match(created.id, /^coze-[0-9]{13}-[a-f0-9]{12}$/);
  const completed = await waitForTask(service, created.id);
  assert.equal(completed.status, 'completed', completed.error || 'task should complete');
  const answerArtifact = completed.artifacts.find((artifact) => artifact.kind === 'answer-source');
  const rawArtifact = completed.artifacts.find((artifact) => artifact.kind === 'raw-response');
  assert.ok(answerArtifact && rawArtifact);
  assert.equal(completed.artifacts.length, 2, 'pipeline should only archive raw output and complete answer');
  assert.ok(!completed.artifacts.some((artifact) => artifact.kind.includes('pdf')));

  const answerFile = await service.readTaskFile(created.id, answerArtifact.path);
  const rawFile = await service.readTaskFile(created.id, rawArtifact.path);
  assert.equal(answerFile.data.toString('utf8'), fixture, 'answer source must be byte-for-byte complete');
  assert.equal(rawFile.data.toString('utf8'), fixture, 'raw script output must be byte-for-byte complete');
  assert.equal(receivedRequest?.url, '/run');
  assert.equal(receivedRequest?.authorization, 'Bearer fixture-token');
  assert.equal(receivedRequest?.body?.messages?.[0]?.content, '请为博通生成投资研报');
  assert.equal(answerArtifact.sha256, createHash('sha256').update(answerFile.data).digest('hex'));
  assert.equal(rawArtifact.sha256, createHash('sha256').update(rawFile.data).digest('hex'));

  const stats = comparisonStats(fixture, completed.markdown);
  assert.deepEqual(stats.missingLines, []);
  assert.deepEqual(stats.missingNumbers, []);
  await assert.rejects(() => service.readTaskFile(created.id, '../task.json'), /路径无效|路径越界/);
  console.log(JSON.stringify({
    ok: true,
    taskId: created.id,
    artifacts: completed.artifacts.length,
    sourceLinesChecked: stats.sourceLines.length,
    numericTokensChecked: stats.numericTokens.length,
    markdownChars: completed.markdown.length,
  }, null, 2));
} finally {
  await new Promise((resolve) => apiServer.close(resolve));
  await rm(temporaryRoot, { recursive: true, force: true });
}
}
