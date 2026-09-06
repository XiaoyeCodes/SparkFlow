import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { acceptsSnapshot, emptySnapshot, formatDecimal } from '../../src/lib/ibkr/store.ts';

const sample = JSON.parse(await readFile(new URL('./fixtures/snapshots.json', import.meta.url))).multiCurrency;

test('old request, wrong mode, wrong account, and backwards sequence cannot update account', () => {
  const scope = { mode: 'paper', accountKey: sample.accountKey, requestRevision: 2, sequence: 1 };
  assert.equal(acceptsSnapshot(sample, scope, 1), false);
  assert.equal(acceptsSnapshot({ ...sample, mode: 'live' }, scope, 2), false);
  assert.equal(acceptsSnapshot({ ...sample, accountKey: 'paper:other' }, scope, 2), false);
  assert.equal(acceptsSnapshot({ ...sample, sequence: 0 }, scope, 2), false);
  assert.equal(acceptsSnapshot(sample, scope, 2), true);
});

test('production defaults have no synthetic account metrics or permissions', () => {
  const state = emptySnapshot('live');
  assert.equal(state.connection, 'unconfigured');
  assert.equal(state.metrics.netLiquidation, null);
  assert.equal(state.testData, false);
  assert.equal(state.capabilities.placeOrders, false);
  assert.equal(formatDecimal(null), '—');
  assert.equal(formatDecimal('0'), '0');
  assert.equal(formatDecimal('100000000000000000.12'), '100,000,000,000,000,000.12');
});
