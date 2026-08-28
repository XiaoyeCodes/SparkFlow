import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fork } from 'node:child_process';
import { request } from 'node:http';
import path from 'node:path';
import ts from 'typescript';

const { outputText } = ts.transpileModule(readFileSync(new URL('../server/dailyhotService.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } });
const { createDailyHotService } = await import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'));
const root = process.cwd();
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function until(test, timeout = 8000) {
  const start = Date.now();
  while (!test()) { if (Date.now() - start > timeout) throw new Error('Timed out waiting for lifecycle state'); await delay(50); }
}
const options = { root, log: () => {} };
const exitListeners = process.listenerCount('exit');
const service = createDailyHotService(options);
try {
  const starts = await Promise.all(Array.from({ length: 8 }, () => service.start()));
  const first = starts[0];
  assert.equal(new Set(starts.map((entry) => entry.pid)).size, 1, 'Concurrent callers share one process');
  assert.equal(first.state, 'ready');
  const health = await (await fetch(first.frontendUrl + 'health')).json();
  assert.equal(health.pid, first.pid);
  const html = await (await fetch(first.frontendUrl)).text();
  assert.match(html, /今日热榜/);
  assert.equal(html.includes('hot.imsyy.top'), false);
  const routes = await (await fetch(first.frontendUrl + 'api/all')).json();
  assert.equal(routes.code, 200);
  assert.ok(routes.routes.some((entry) => entry.name === 'bilibili'));
  assert.equal((await fetch(first.frontendUrl + 'api/all', { method: 'POST' })).status, 405);
  assert.equal((await fetch(first.frontendUrl + 'api/all', { headers: { Origin: 'https://unrelated.example' } })).status, 403);
  const badHostStatus = await new Promise((resolve, reject) => {
    const req = request(first.frontendUrl + 'health', { headers: { Host: 'unrelated.example' } }, (response) => { response.resume(); resolve(response.statusCode); });
    req.on('error', reject); req.end();
  });
  assert.equal(badHostStatus, 403);
  assert.equal((await fetch(first.frontendUrl + '.build-hash')).status, 403);
  assert.equal((await fetch(first.frontendUrl + 'missing-file')).status, 404);
  assert.equal((await fetch(first.frontendUrl + 'api/all')).headers.get('access-control-allow-origin'), null);
  // This PID belongs to the test's own fork, never the user's running service.
  process.kill(first.pid);
  await until(() => service.getStatus().state === 'ready' && service.getStatus().pid !== first.pid);
  const restarted = service.getStatus();
  assert.equal(alive(first.pid), false);
  await service.stop();
  await until(() => !alive(restarted.pid));
  assert.equal(service.getStatus().state, 'stopped');
  await assert.rejects(service.start(), /已停止/);
} finally { await service.stop(); }

const hanging = createDailyHotService({ ...options, runner: path.join(root, 'scripts/fixtures/dailyhot-no-ready.mjs'), startupTimeoutMs: 400 });
try {
  const startup = hanging.start();
  const rejection = assert.rejects(startup, /启动超时/);
  await until(() => Boolean(hanging.getStatus().pid));
  const pid = hanging.getStatus().pid;
  await rejection;
  await until(() => !alive(pid));
  assert.equal(hanging.getStatus().state, 'error');
} finally { await hanging.stop(); }

// Killing a test owner simulates a Vite crash: IPC disconnect must also remove
// its managed service, even when no graceful server-close event runs.
const owner = fork(path.join(root, 'scripts/fixtures/dailyhot-owner.mjs'), [], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
let ownedPid;
try {
  const info = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Owner readiness timeout')), 15000);
    owner.once('message', (message) => { clearTimeout(timer); resolve(message); });
    owner.once('error', reject);
    owner.once('exit', () => { clearTimeout(timer); reject(new Error('Owner exited early')); });
  });
  ownedPid = info.pid;
  owner.kill('SIGKILL');
  await until(() => !alive(ownedPid));
} finally { if (owner.exitCode === null && owner.signalCode === null) owner.kill(); if (ownedPid && alive(ownedPid)) process.kill(ownedPid); }
assert.equal(process.listenerCount('exit'), exitListeners, 'No leaked process-exit hooks');
const cache = await import('../services/dailyhot/cache-adapter.mjs');
await cache.setCache('test-key', { value: 1 }, 10);
assert.deepEqual(await cache.getCache('test-key'), { value: 1 });
await cache.delCache('test-key');
assert.equal(await cache.getCache('test-key'), undefined);
console.log('DailyHot checks passed: shared startup, local frontend/API, read-only isolation, crash restart, startup timeout, graceful shutdown, parent-crash cleanup and memory cache.');
