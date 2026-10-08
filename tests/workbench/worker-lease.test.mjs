import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { IbkrWorkerLease } from '../../server/ibkrWorkerLease.ts';
import { IbkrWorkbenchService } from '../../server/ibkrWorkbench.ts';

async function fixture() {
  await mkdir('tmp/worker-lease-tests', { recursive: true });
  const directory = await mkdtemp(path.resolve('tmp/worker-lease-tests/run-'));
  return { directory, lock: path.join(directory, 'worker.lock') };
}
const startedAt = Date.now() - 60_000;
const probe = async () => ({ alive: true, startedAt });

test('a legacy PID reused after the lock was written does not block the account worker', async () => {
  const f = await fixture();
  await writeFile(f.lock, '12840');
  await utimes(f.lock, new Date(startedAt - 86400_000), new Date(startedAt - 86400_000));
  const lease = new IbkrWorkerLease(f.directory, probe);
  try {
    assert.equal(await lease.acquire(), true);
    const owner = JSON.parse(await readFile(f.lock, 'utf8'));
    assert.equal(owner.pid, process.pid);
    assert.equal(owner.startedAt, startedAt);
    assert.ok(owner.token);
  } finally { await lease.release(); }
});

test('new leases identify PID reuse by process birth, and preserve a living owner', async () => {
  const f = await fixture();
  await writeFile(f.lock, JSON.stringify({ version: 1, pid: 12840, startedAt: startedAt - 86400_000, token: 'old' }));
  const first = new IbkrWorkerLease(f.directory, probe);
  const other = new IbkrWorkerLease(f.directory, probe);
  try {
    assert.equal(await first.acquire(), true);
    const original = await readFile(f.lock, 'utf8');
    assert.equal(await other.acquire(), false);
    await other.release();
    assert.equal(await readFile(f.lock, 'utf8'), original);
    await first.release();
    assert.equal(await other.acquire(), true);
  } finally { await first.release(); await other.release(); }
});

test('unknown process identity and living legacy owners remain protected', async () => {
  const f = await fixture();
  await writeFile(f.lock, '12840');
  assert.equal(await new IbkrWorkerLease(f.directory, probe).acquire(), false);
  assert.equal(await new IbkrWorkerLease(f.directory, async () => ({ alive: true })).acquire(), false);
  assert.equal(await readFile(f.lock, 'utf8'), '12840');
});

test('an interrupted lock write and an abandoned claim recover after their grace periods', async () => {
  const f = await fixture();
  await writeFile(f.lock, '');
  const lease = new IbkrWorkerLease(f.directory, probe);
  assert.equal(await lease.acquire(), false, 'a currently incomplete write is not stolen');
  const old = new Date(Date.now() - 60_000);
  await utimes(f.lock, old, old);
  await mkdir(`${f.lock}.claim`);
  await utimes(`${f.lock}.claim`, old, old);
  assert.equal(await lease.acquire(), false, 'clears the abandoned claim before retrying');
  try {
    assert.equal(await lease.acquire(), true);
    assert.ok((await readdir(f.directory)).some(file => file.startsWith('worker.lock.invalid-')));
  } finally { await lease.release(); }
});

test('concurrent stale-lock recovery creates exactly one owner', async () => {
  const f = await fixture();
  await writeFile(f.lock, '12840');
  const identity = async pid => ({ alive: pid === process.pid, startedAt });
  const leases = Array.from({ length: 8 }, () => new IbkrWorkerLease(f.directory, identity));
  try { assert.equal((await Promise.all(leases.map(lease => lease.acquire()))).filter(Boolean).length, 1); }
  finally { await Promise.all(leases.map(lease => lease.release())); }
});

test('delayed shutdown cannot remove a successor lock', async () => {
  const f = await fixture();
  const lease = new IbkrWorkerLease(f.directory, probe);
  assert.equal(await lease.acquire(), true);
  const successor = JSON.stringify({ version: 1, pid: process.pid, startedAt, token: 'successor' });
  await writeFile(f.lock, successor);
  await lease.release();
  await lease.release();
  assert.equal(await readFile(f.lock, 'utf8'), successor);
});

test('a blocked service automatically loads saved account state after the owner exits', async () => {
  const f = await fixture();
  const first = new IbkrWorkbenchService(process.cwd(), f.directory, async () => ({}), async () => ({}));
  const other = new IbkrWorkbenchService(process.cwd(), f.directory, async () => ({}), async () => ({}));
  first.ai.status = other.ai.status = async () => ({ configured: false });
  try {
    await Promise.all([first.start(), first.start()]);
    await first.select('gateway', undefined, 'paper');
    await other.start();
    assert.throws(() => other.assertAvailable(), /自动重试/);
    await Promise.all([first.close(), first.close()]);
    other.nextLeaseAttempt = 0;
    const current = await other.state();
    assert.doesNotThrow(() => other.assertAvailable());
    assert.equal(current.source, 'gateway');
    assert.equal(current.gatewayMode, 'paper');
    assert.doesNotMatch(current.connection.detail, /后台锁|自动重试/);
  } finally { await first.close(); await other.close(); }
});
