// Local integration only: a fresh unbound ASGI app, never an IBKR adapter.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { ibkrTerminalProxy } from '../server/ibkrTerminalProxy.ts';

const runtimeRoot = path.resolve('.sparkflow');
await mkdir(runtimeRoot, { recursive: true });
const runtime = await mkdtemp(path.join(runtimeRoot, 'ibkr-stream-test-'));
const token = randomBytes(32).toString('hex');
const tokenPath = path.join(runtime, 'session.token');
await writeFile(tokenPath, token);
const python = path.resolve('services/vibe-trading/.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const code = `import os, uvicorn
from pathlib import Path
from src.ibkr_terminal.app import create_app
from src.ibkr_terminal.store import SnapshotStore
store=SnapshotStore(Path(os.environ['IBKR_TEST_DB']))
app=create_app(store=store,session_token=os.environ['IBKR_TEST_TOKEN'],port=8767,heartbeat_seconds=0.1)
uvicorn.run(app,host='127.0.0.1',port=8767,access_log=False)
`;
const child = spawn(python, ['-c', code], { cwd: path.resolve('services/vibe-trading/agent'), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, IBKR_TEST_DB: path.join(runtime, 'db.sqlite'), IBKR_TEST_TOKEN: token } });
let output = '';
child.stdout.on('data', chunk => { output += chunk; });
child.stderr.on('data', chunk => { output += chunk; });
let server, browser;
try {
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    if (child.exitCode !== null) throw new Error(`Unbound test service exited: ${output}`);
    try {
      const response = await fetch('http://127.0.0.1:8767/api/ibkr-terminal/session', { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(300) });
      if (response.status === 200) { assert.deepEqual((await response.json()).accounts, []); ready = true; break; }
    } catch { /* Bounded readiness polling of the child spawned above. */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(ready, true, `Unbound test service not ready: ${output}`);
  server = await createServer({ configFile: false, optimizeDeps: { noDiscovery: true, include: [], entries: [] }, plugins: [
    { name: 'offline-probe-page', configureServer(vite) { vite.middlewares.use((req, res, next) => { if (req.url !== '/stream-probe') return next(); res.setHeader('Content-Type', 'text/html'); res.end('<title>Offline stream probe</title>'); }); } },
    ibkrTerminalProxy({ servicePort: 8767, tokenPath }),
  ], server: { host: '127.0.0.1', port: 5189, strictPort: true, watch: null } });
  await server.listen();
  browser = await chromium.launch({ channel: process.env.IBKR_TEST_BROWSER_CHANNEL || 'chrome', headless: true });
  const page = await browser.newPage();
  page.on('console', message => { if (message.type() === 'error') console.error(message.text()); });
  // A minimal same-origin page; no production app or unrelated APIs execute.
  await page.goto('http://127.0.0.1:5189/stream-probe');
  const result = await page.evaluate(async () => {
    const snapshot = await (await fetch('/api/ibkr-terminal/snapshot?mode=paper')).json();
    const messages = await new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://${location.host}/api/ibkr-terminal/events?mode=paper&accountKey=paper%3Aunbound`);
      const timer = setTimeout(() => { ws.close(); reject(new Error('stream timed out')); }, 5000);
      const received = [];
      ws.onerror = () => { clearTimeout(timer); reject(new Error('websocket failed')); };
      ws.onmessage = event => { received.push(JSON.parse(event.data)); if (received.length === 3) { clearTimeout(timer); ws.close(); resolve(received); } };
    });
    return { connection: snapshot.connection, messages };
  });
  assert.equal(result.connection, 'unconfigured');
  assert.equal(result.messages.length, 3);
  for (const message of result.messages) { assert.equal(message.kind, 'heartbeat'); assert.equal(message.accountKey, 'paper:unbound'); }
  const tokenResponse = await fetch(`http://127.0.0.1:5189/${path.relative(process.cwd(), tokenPath).split(path.sep).join('/')}`);
  assert.equal(tokenResponse.status, 403);
  console.log('VERIFIED: fresh unbound service → authenticated Vite WS proxy → browser: 3 heartbeats; token file denied; no broker constructed.');
} finally {
  if (browser) await browser.close();
  if (server) await server.close();
  const exited = new Promise(resolve => child.once('exit', resolve));
  if (child.exitCode === null) { child.kill(); await exited; }
  const resolved = path.resolve(runtime);
  if (!resolved.startsWith(runtimeRoot + path.sep) || !path.basename(resolved).startsWith('ibkr-stream-test-')) throw new Error('unsafe cleanup path');
  // Windows can release SQLite WAL handles shortly after the terminated child exits.
  await rm(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
