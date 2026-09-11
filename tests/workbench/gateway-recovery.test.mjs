import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { IbkrWorkbenchService } from '../../server/ibkrWorkbench.ts';
import { normalizeMcpSnapshot } from '../../server/ibkrMcp.ts';
import { discoverSparkFlowGateway } from '../../server/ibkrGatewayBridge.ts';

async function fixture(mode = 'paper') {
  await mkdir('tmp/gateway-recovery', { recursive: true });
  const root = await mkdtemp(path.resolve('tmp/gateway-recovery/run-'));
  const runtime = path.join(root, '.sparkflow/ibkr-terminal'), directory = path.join(root, 'state');
  await mkdir(runtime, { recursive: true }); await mkdir(directory);
  await writeFile(path.join(runtime, 'session.token'), 'private-local-token');
  const snapshot = { ...normalizeMcpSnapshot('TEST_ACCOUNT', [], { baseCurrency: 'USD', netLiquidation: 1000 }), mode, accountKey: `${mode}:gateway-test` };
  let online = false, starts = 0, discoveries = 0, disconnects = 0;
  const service = new IbkrWorkbenchService(root, directory, async () => ({ data: { diff: [] } }), async () => ({}), undefined,
    async () => { starts++; return { port: 18765, reused: true }; },
    async (_root, port, selectedMode) => { discoveries++; assert.equal(port, 18765); assert.equal(selectedMode, mode); online = true; return { phase: 'ready', apiPort: 45122, detail: 'verified API' }; },
    async (_root, port, selectedMode) => { disconnects++; assert.equal(port, 18765); assert.equal(selectedMode, mode); });
  await service.start(); clearTimeout(service.timer);
  service.saved.source = 'gateway'; service.saved.gatewayMode = mode;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    if (!online) throw new Error('bridge offline');
    return new Response(JSON.stringify(snapshot));
  };
  return { service, root, runtime, snapshot, starts: () => starts, discoveries: () => discoveries, disconnects: () => disconnects,
    close: async () => { globalThis.fetch = originalFetch; await service.close(); } };
}

for (const mode of ['paper', 'live']) test(`${mode} gateway waits for an explicit intelligent-connect request before discovery`, async () => {
  const f = await fixture(mode);
  try {
    await f.service.tick();
    assert.equal(f.starts(), 0); assert.equal(f.discoveries(), 0);
    assert.equal((await f.service.state()).connection.state, 'unconfigured');
    await f.service.connectGateway();
    assert.equal(f.starts(), 1); assert.equal(f.discoveries(), 1);
    assert.equal((await f.service.state()).snapshot.mode, mode);
    assert.equal((await f.service.state()).connection.state, 'connected');
  } finally { await f.close(); }
});

test('concurrent intelligent connect requests share discovery and verify a fresh snapshot', async () => {
  const f = await fixture();
  try {
    await Promise.all([f.service.connectGateway(), f.service.connectGateway(), f.service.sync()]);
    assert.equal(f.starts(), 1); assert.equal(f.discoveries(), 1);
    assert.equal((await f.service.state()).connection.state, 'connected');
  } finally { await f.close(); }
});

test('discovery failures remain actionable and retry within 15 seconds instead of backing off for minutes', async () => {
  const f = await fixture();
  try {
    let attempts = 0;
    f.service.gatewayDiscoverer = async () => { attempts++; return { phase: 'retrying', detail: 'API 45122 未返回当前绑定的实盘账户' }; };
    await f.service.sync();
    assert.match((await f.service.state()).connection.detail, /45122.*实盘账户/);
    assert.ok(f.service.nextSync <= Date.now() + 15000);
    await f.service.sync();
    assert.equal(attempts, 1);
    await assert.rejects(() => f.service.connectGateway(), /45122.*实盘账户/);
    assert.equal(attempts, 2);
  } finally { await f.close(); }
});

test('an in-flight discovery cannot apply an old account mode after selection changes', async () => {
  const f = await fixture();
  try {
    let release, entered;
    const waiting = new Promise(resolve => { entered = resolve; });
    f.service.gatewayDiscoverer = async () => { entered(); await new Promise(resolve => { release = resolve; }); return { phase: 'retrying', detail: 'old paper failure' }; };
    const pending = f.service.connectGateway();
    await waiting;
    const selection = f.service.select('mcp');
    release();
    await Promise.all([pending, selection]);
    assert.equal(f.service.saved.source, 'mcp');
    assert.doesNotMatch((await f.service.state()).connection.detail, /old paper failure/);
  } finally { await f.close(); }
});

test('API discovery sends the selected mode to the authenticated bridge and not to the IB socket', async () => {
  const f = await fixture();
  try {
    globalThis.fetch = async (url, init) => {
      assert.equal(url, 'http://127.0.0.1:18765/api/ibkr-terminal/gateway/connect');
      assert.equal(init.method, 'POST');
      assert.equal(init.headers.Authorization, 'Bearer private-local-token');
      assert.deepEqual(JSON.parse(init.body), { mode: 'paper' });
      return new Response(JSON.stringify({ phase: 'ready', apiPort: 45122, detail: 'verified API' }));
    };
    assert.equal((await discoverSparkFlowGateway(f.root, 18765, 'paper')).apiPort, 45122);
  } finally { await f.close(); }
});

test('expired snapshots are not advertised as connected', async () => {
  const f = await fixture();
  try {
    await f.service.sync();
    f.service.saved.records[f.snapshot.accountKey].snapshot.asOf = '2020-01-01T00:00:00Z';
    assert.equal((await f.service.state()).connection.state, 'disconnected');
  } finally { await f.close(); }
});

for (const mode of ['paper', 'live']) test(`${mode} status observes a closed broker and the supervisor reconnects without clearing holdings`, async () => {
  const f = await fixture(mode);
  try {
    await f.service.connectGateway();
    const before = (await f.service.state()).snapshot;
    let probes = 0;
    globalThis.fetch = async (url, init) => {
      probes++;
      assert.match(String(url), new RegExp(`snapshot\\?mode=${mode}$`));
      assert.equal(init.headers.Authorization, 'Bearer private-local-token');
      return new Response(JSON.stringify({ ...f.snapshot, connection: 'disconnected', state: 'stale' }));
    };
    f.service.nextGatewayHealth = 0;
    const [a, b] = await Promise.all([f.service.state(), f.service.state()]);
    assert.equal(probes, 1);
    for (const current of [a, b]) {
      assert.equal(current.connection.state, 'disconnected');
      assert.equal(current.snapshot.snapshotId, before.snapshotId);
      assert.deepEqual(current.snapshot.positions, before.positions);
      assert.match(current.connection.detail, /自动重连/);
    }
    globalThis.fetch = async () => new Response(JSON.stringify(f.snapshot));
    f.service.nextGatewayAttempt = 0;
    await f.service.tick();
    assert.equal((await f.service.state()).connection.state, 'connected');
    assert.equal(f.discoveries(), 1);
  } finally { await f.close(); }
});

test('a single local bridge timeout keeps the last live state during the grace window', async () => {
  const f = await fixture();
  try {
    await f.service.connectGateway();
    globalThis.fetch = async () => { throw new Error('connection refused'); };
    const current = await f.service.state();
    assert.equal(current.connection.state, 'connected');
    assert.equal(f.discoveries(), 1);
  } finally { await f.close(); }
});

test('three consecutive bridge timeouts mark the snapshot stale and schedule automatic recovery', async () => {
  const f = await fixture();
  try {
    await f.service.connectGateway();
    globalThis.fetch = async () => { throw new Error('connection refused'); };
    for (let attempt = 0; attempt < 3; attempt++) {
      f.service.nextGatewayHealth = 0;
      await f.service.state();
    }
    const current = await f.service.state();
    assert.equal(current.connection.state, 'disconnected');
    assert.match(current.connection.detail, /自动恢复/);
    assert.equal(f.service.nextSync, 0);
  } finally { await f.close(); }
});

test('a previously connected gateway recovers in the background without another user action', async () => {
  const f = await fixture();
  try {
    await f.service.connectGateway();
    let recovered = false, recoveryAttempts = 0;
    globalThis.fetch = async () => {
      if (!recovered) throw new Error('connection refused');
      return new Response(JSON.stringify(f.snapshot));
    };
    f.service.gatewayDiscoverer = async () => {
      recoveryAttempts++;
      recovered = true;
      return { phase: 'ready', apiPort: 45122, detail: 'reconnected' };
    };
    for (let attempt = 0; attempt < 3; attempt++) {
      f.service.nextGatewayHealth = 0;
      await f.service.state();
    }
    f.service.nextGatewayAttempt = 0;
    await f.service.tick();
    assert.equal(recoveryAttempts, 1);
    assert.equal((await f.service.state()).connection.state, 'connected');
  } finally { await f.close(); }
});

test('explicit gateway disconnect clears durable reconnect intent and stops the bridge supervisor', async () => {
  const f = await fixture();
  try {
    await f.service.connectGateway();
    await f.service.disconnect();
    assert.equal(f.disconnects(), 1);
    assert.equal(f.service.saved.selectedKey, undefined);
    await f.service.tick();
    assert.equal(f.discoveries(), 1);
  } finally { await f.close(); }
});
