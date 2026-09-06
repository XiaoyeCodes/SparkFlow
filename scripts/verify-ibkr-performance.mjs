import { spawn, spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const argument = process.argv.find(value => value.startsWith('--soak-minutes='));
const soakMinutes = argument ? Number(argument.split('=')[1]) : 0.1;
if (!Number.isFinite(soakMinutes) || soakMinutes <= 0 || soakMinutes > 180) throw new Error('soak minutes must be within (0, 180]');
const port = 5190;
const base = `http://127.0.0.1:${port}`;
const build = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], { cwd: process.cwd(), stdio: 'inherit', windowsHide: true });
if (build.status !== 0) process.exit(build.status ?? 1);
const preview = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
  { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
let previewOutput = '';
preview.stdout.on('data', chunk => { previewOutput += String(chunk); });
preview.stderr.on('data', chunk => { previewOutput += String(chunk); });

const percentile = (values, ratio) => [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * ratio) - 1)] ?? null;
const waitForPreview = async () => {
  for (let attempt = 0; attempt < 100; attempt++) {
    try { const response = await fetch(base); if (response.ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`production preview did not start: ${previewOutput.slice(-1000)}`);
};

const now = new Date().toISOString();
const accountKey = 'paper:performance-fixture';
const positions = Array.from({ length: 50 }, (_, index) => ({ accountKey, conId: 7000000 + index, symbol: `PERF${String(index).padStart(2, '0')}`,
  currency: 'USD', quantity: '10', averageCost: '100', marketValue: '1000' }));
const orders = Array.from({ length: 500 }, (_, index) => ({ accountKey, clientIntentId: `performance:${String(index).padStart(4, '0')}`,
  conId: positions[index % positions.length].conId, quantity: '1', filled: '0', remaining: '1', submission: 'ACKNOWLEDGED', execution: 'OPEN',
  managed: false, orderId: index + 1, clientId: 91, permId: 10000 + index, symbol: positions[index % positions.length].symbol,
  currency: 'USD', side: 'BUY', limitPrice: '100' }));
const snapshot = { schemaVersion: 1, snapshotId: 'fixture-performance-v1', accountKey, mode: 'paper', sessionRevision: 1, sequence: 1,
  source: 'fixture', testData: true, asOf: now, connection: 'connected', state: 'ready', baseCurrency: 'USD',
  metrics: { netLiquidation: '100000', unrealizedPnl: '0', buyingPower: '50000', maintenanceMargin: '10000' },
  cash: [{ currency: 'USD', amount: '50000' }], positions, orders, quotes: [{ conId: positions[0].conId, state: 'realtime', price: '100', asOf: now, source: 'fixture.quote' }],
  capabilities: { placeOrders: false, shareWithAi: false }, missing: [], detail: '工程性能样本，不是 IBKR 账户事实。', executions: [], provenance: {} };
const start = Date.parse('2026-01-01T00:00:00Z');
const bars = Array.from({ length: 10_000 }, (_, index) => ({ time: new Date(start + index * 60_000).toISOString(),
  open: String(100 + index % 3), high: String(102 + index % 3), low: String(99 + index % 3), close: String(101 + index % 3), volume: '1000' }));

let browser;
let heartbeat;
let streamLoad;
let streamSocket;
let eventSequence = 1;
let streamPatchesSent = 0;
let lastLoadExpected = '';
try {
  await waitForPreview();
  browser = await chromium.launch({ channel: process.env.IBKR_TEST_BROWSER_CHANNEL || 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' });
  const errors = [];
  const failedResponses = [];
  let requestCount = 0;
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => {
    if (response.url().startsWith(base) && response.status() >= 400) failedResponses.push({ status: response.status(), url: response.url() });
  });
  page.on('request', request => { if (request.url().startsWith(base)) requestCount++; });
  await page.addInitScript(() => {
    window.__sparkflowLcp = [];
    window.__sparkflowDiagnostics = { streamMessages: 0, streamPatchesApplied: 0, streamResyncs: 0,
      activeSockets: 0, maxActiveSockets: 0, pendingMessages: 0, maxPendingMessages: 0 };
    new PerformanceObserver(list => { for (const entry of list.getEntries()) window.__sparkflowLcp.push(entry.startTime); }).observe({ type: 'largest-contentful-paint', buffered: true });
  });
  await page.route('**/api/**', route => route.fulfill({ status: 503, json: { detail: '工程性能隔离源未配置此接口' } }));
  await page.route('**/api/ibkr-terminal/snapshot?**', route => route.fulfill({ json: snapshot }));
  await page.route('**/api/ibkr-terminal/market-data?**', route => {
    const url = new URL(route.request().url());
    return route.fulfill({ json: { schemaVersion: 1, accountKey, mode: 'paper', snapshotId: snapshot.snapshotId,
      conId: Number(url.searchParams.get('conId')), period: url.searchParams.get('period'), barSize: '1 min', timezone: 'UTC',
      source: 'fixture.performance.historical', testData: true, asOf: now, state: 'ready', missing: [], bars, dataHash: 'f'.repeat(64) } });
  });
  await page.route('**/api/ibkr-terminal/analysis/risk?**', route => route.fulfill({ json: { accountKey, mode: 'paper', snapshotId: snapshot.snapshotId,
    source: 'fixture', testData: true, generatedAt: now, asOf: now, ageSeconds: 0, status: 'partial', metrics: {
      grossExposure: { value: '50000', unit: 'USD', state: 'ready', evidence: [] }, netExposure: { value: '50000', unit: 'USD', state: 'ready', evidence: [] },
      largestPositionWeight: { value: '0.01', unit: 'ratio', state: 'ready', evidence: [] }, marginUsage: { value: '0.1', unit: 'ratio', state: 'ready', evidence: [] } },
    cashByCurrency: { USD: '50000' }, cashEvidence: [], totalCashBase: '50000', positionCount: 50, openOrderCount: 500, openOrderEvidence: [], findings: [] } }));
  await page.route('**/api/ibkr-terminal/ai/status?**', route => route.fulfill({ json: { sharingEnabled: false, activeGrant: null, modelCalls: false } }));
  await page.route('**/api/ibkr-terminal/reports?**', route => route.fulfill({ json: [] }));
  await page.route('**/api/news-feed', route => route.fulfill({ json: {
    generatedAt: now, proxy: 'performance-fixture', categories: [], sources: [], items: [],
  } }));
  await page.route('**/api/global-macro-dashboard?region=global&section=macro', route => route.fulfill({ json: {
    generatedAt: now, macro: [],
  } }));
  await page.routeWebSocket('**/api/ibkr-terminal/events?**', socket => {
    streamSocket = socket;
    const send = () => socket.send(JSON.stringify({ kind: 'heartbeat', mode: 'paper', accountKey, sessionRevision: 1, sequence: eventSequence }));
    send(); heartbeat = setInterval(send, 4000);
  });

  const navigationStart = performance.now();
  await page.goto(`${base}/ibkr`, { waitUntil: 'networkidle' });
  await page.getByTestId('account-sidebar').getByRole('button', { name: /PERF00/ }).click();
  await page.getByTestId('historical-chart').waitFor({ state: 'visible' });
  const chartReadyMs = performance.now() - navigationStart;
  await page.waitForTimeout(250);
  const lcpMs = await page.evaluate(() => Math.max(0, ...(window.__sparkflowLcp || [])));
  const eventLatencies = [];
  for (let index = 0; index < 30; index++) {
    const previousSequence = eventSequence;
    eventSequence++;
    const expected = String(100001 + index);
    const before = performance.now();
    streamSocket.send(JSON.stringify({ kind: 'snapshot.patch', mode: 'paper', accountKey, sessionRevision: 1,
      previousSequence, sequence: eventSequence, payload: { metrics: { ...snapshot.metrics, netLiquidation: expected } } }));
    streamPatchesSent++;
    await page.waitForFunction(value => document.querySelector('.ibkr-header-metric')?.textContent?.replaceAll(',', '').includes(value), expected);
    eventLatencies.push(performance.now() - before);
  }
  streamLoad = setInterval(() => {
    if (!streamSocket) return;
    const previousSequence = eventSequence; eventSequence++;
    lastLoadExpected = String(200000 + eventSequence);
    streamPatchesSent++;
    streamSocket.send(JSON.stringify({ kind: 'snapshot.patch', mode: 'paper', accountKey, sessionRevision: 1,
      previousSequence, sequence: eventSequence, payload: { metrics: { ...snapshot.metrics, netLiquidation: lastLoadExpected } } }));
  }, 1000);
  const clickLatencies = [];
  for (let index = 0; index < 30; index++) {
    const label = index % 2 ? '1D' : '5D';
    const button = page.getByLabel('行情图表').getByRole('button', { name: label, exact: true });
    const before = performance.now();
    await button.click();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    clickLatencies.push(performance.now() - before);
  }
  await page.getByRole('tab', { name: '挂单', exact: true }).click();
  const scrollFps = await page.evaluate(async () => {
    const target = document.querySelector('.ibkr-table-scroll');
    if (!target) return 0;
    let frames = 0; const start = performance.now();
    await new Promise(resolve => { const step = now => { frames++; target.scrollTop = (frames * 9) % Math.max(1, target.scrollHeight); if (now - start < 1500) requestAnimationFrame(step); else resolve(); }; requestAnimationFrame(step); });
    return frames / ((performance.now() - start) / 1000);
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const samples = [];
  const soakStarted = Date.now();
  const durationMs = soakMinutes * 60_000;
  do {
    const metrics = await cdp.send('Performance.getMetrics');
    const values = Object.fromEntries(metrics.metrics.map(item => [item.name, item.value]));
    const stream = await page.evaluate(() => window.__sparkflowDiagnostics);
    samples.push({ elapsedSeconds: (Date.now() - soakStarted) / 1000, jsHeapUsedBytes: values.JSHeapUsedSize ?? null,
      nodes: values.Nodes ?? null, documents: values.Documents ?? null, requestCount, stream });
    await page.getByRole('tab', { name: samples.length % 2 ? '持仓' : '挂单', exact: true }).click();
    if (Date.now() - soakStarted < durationMs) await page.waitForTimeout(Math.min(30_000, durationMs - (Date.now() - soakStarted)));
  } while (Date.now() - soakStarted < durationMs);
  clearInterval(streamLoad); streamLoad = undefined;
  if (lastLoadExpected) await page.waitForFunction(value => document.querySelector('.ibkr-header-metric')?.textContent?.replaceAll(',', '').includes(value), lastLoadExpected);
  const streamDiagnostics = await page.evaluate(() => window.__sparkflowDiagnostics);
  const heaps = samples.map(item => item.jsHeapUsedBytes).filter(Number.isFinite);
  const heapGrowthBytes = heaps.length > 1 ? heaps.at(-1) - heaps[0] : 0;
  const result = {
    schemaVersion: 1, generatedAt: new Date().toISOString(), environment: { browser: await browser.version(), viewport: '1440x1000', productionBuild: true },
    workload: { positions: 50, orders: 500, bars: 10_000, fixture: true },
    measurements: { lcpMs, chartReadyMs, eventToPageP95Ms: percentile(eventLatencies, 0.95), clickFeedbackP95Ms: percentile(clickLatencies, 0.95), scrollFps, soakMinutes,
      heapGrowthBytes, maxHeapUsedBytes: Math.max(0, ...heaps), requestCount, streamPatchesSent, streamDiagnostics,
      consoleErrors: errors, failedResponses, samples },
    thresholds: { lcpMs: 2500, eventToPageP95Ms: 250, clickFeedbackP95Ms: 100, scrollFpsMinimum: 45,
      maxActiveSockets: 1, maxPendingMessages: 1 },
  };
  result.passed = lcpMs > 0 && lcpMs <= result.thresholds.lcpMs && result.measurements.eventToPageP95Ms <= result.thresholds.eventToPageP95Ms && result.measurements.clickFeedbackP95Ms <= result.thresholds.clickFeedbackP95Ms
    && scrollFps >= result.thresholds.scrollFpsMinimum && errors.length === 0 && failedResponses.length === 0
    && streamDiagnostics.activeSockets === 1 && streamDiagnostics.maxActiveSockets <= result.thresholds.maxActiveSockets
    && streamDiagnostics.pendingMessages === 0 && streamDiagnostics.maxPendingMessages <= result.thresholds.maxPendingMessages
    && streamDiagnostics.streamResyncs === 0 && streamDiagnostics.streamPatchesApplied === streamPatchesSent;
  await mkdir('docs/design/ibkr/performance', { recursive: true });
  await writeFile('docs/design/ibkr/performance/latest.json', `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(result, null, 2));
  if (!result.passed) process.exitCode = 1;
} finally {
  if (heartbeat) clearInterval(heartbeat);
  if (streamLoad) clearInterval(streamLoad);
  await browser?.close();
  preview.kill('SIGTERM');
  await new Promise(resolve => { if (preview.exitCode !== null) resolve(); else { preview.once('exit', resolve); setTimeout(resolve, 3000); } });
}
