import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { applyAccountEvent } from '../../src/lib/ibkr/events.ts';

const snapshot = JSON.parse(await readFile(new URL('./fixtures/snapshots.json', import.meta.url))).multiCurrency;
const event = { kind: 'snapshot.patch', mode: snapshot.mode, accountKey: snapshot.accountKey, sessionRevision: 1, sequence: 2, previousSequence: 1, payload: { metrics: { ...snapshot.metrics, netLiquidation: '1250.25' } } };
test('contiguous event updates exactly one account; duplicates and foreign scopes do not', () => {
  const next = applyAccountEvent(snapshot, event);
  assert.equal(next.action, 'apply');
  assert.equal(next.snapshot.metrics.netLiquidation, '1250.25');
  assert.equal(snapshot.metrics.netLiquidation, null);
  assert.equal(applyAccountEvent(next.snapshot, event).action, 'ignore');
  assert.equal(applyAccountEvent(snapshot, { ...event, mode: 'live' }).action, 'ignore');
  assert.equal(applyAccountEvent(snapshot, { ...event, accountKey: 'paper:other' }).action, 'ignore');
});
test('gaps, changed session, invalid money and identity injection demand an HTTP snapshot', () => {
  for (const changed of [
    { ...event, previousSequence: 3, sequence: 4 },
    { ...event, sessionRevision: 2 },
    { ...event, payload: { accountKey: 'live:other' } },
    { ...event, payload: { metrics: { netLiquidation: 'NaN' } } },
    { ...event, kind: 'resync-required' },
    { ...event, kind: 'heartbeat', sequence: 5 },
  ]) assert.equal(applyAccountEvent(snapshot, changed).action, 'resync');
  assert.equal(applyAccountEvent(snapshot, { ...event, kind: 'heartbeat', sequence: 1 }).action, 'ignore');
});

test('read-only orders, fills and source stamps survive patches without inventing missing quantities', () => {
  const order = { accountKey: snapshot.accountKey, clientIntentId: 'external:91:7:123', conId: 12, quantity: '5', filled: null, remaining: null, submission: 'ACKNOWLEDGED', execution: 'CANCEL_PENDING', managed: false };
  const fill = { accountKey: snapshot.accountKey, execId: 'EXEC-1', conId: 12, symbol: 'TEST', currency: 'USD', orderId: 7, clientId: 91, permId: 123, side: 'BOT', quantity: '2', price: '99', executedAt: null, commission: null, commissionCurrency: null };
  const provenance = { orders: { source: 'ibkr.orders', observedAt: null, brokerAsOf: null, requestCompletedAt: '2026-09-04T14:00:00Z' } };
  const patch = { ...event, payload: { orders: [order], executions: [fill], provenance } };
  const next = applyAccountEvent(snapshot, patch);
  assert.equal(next.action, 'apply');
  assert.equal(next.snapshot.orders[0].filled, null);
  assert.equal(next.snapshot.executions[0].commission, null);
  assert.deepEqual(next.snapshot.provenance, provenance);
  for (const payload of [
    { executions: [{ ...fill, accountKey: 'paper:other' }] },
    { executions: [{ ...fill, price: 99 }] },
    { executions: [{ ...fill, commission: 'NaN' }] },
    { provenance: { orders: { ...provenance.orders, brokerAsOf: 'invented-date' } } },
  ]) assert.equal(applyAccountEvent(snapshot, { ...event, payload }).action, 'resync');
});
