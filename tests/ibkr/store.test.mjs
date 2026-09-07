import test from 'node:test';
import assert from 'node:assert/strict';
import { emptySnapshot } from '../../src/lib/ibkr/store.ts';

test('production defaults have no synthetic account metrics or permissions', () => {
  const state = emptySnapshot('live');
  assert.equal(state.connection, 'unconfigured');
  assert.equal(state.metrics.netLiquidation, null);
  assert.equal(state.testData, false);
  assert.equal(state.capabilities.placeOrders, false);
});
