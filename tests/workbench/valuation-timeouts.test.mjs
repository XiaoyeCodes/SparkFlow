import test from 'node:test';
import assert from 'node:assert/strict';
import { valuationDeadline } from '../../server/ibkrValuationData.ts';

test('stalled source work times out and cancels its loading task', async () => {
  let cancelled = 0;
  await assert.rejects(valuationDeadline(new Promise(() => {}), 10, () => { cancelled++; }), /VALUATION_SOURCE_TIMEOUT/);
  assert.equal(cancelled, 1);
});

test('a stalled or throwing cancellation cannot leave a source request pending', async () => {
  await assert.rejects(valuationDeadline(new Promise(() => {}), 10, () => { throw new Error('worker unavailable'); }), /VALUATION_SOURCE_TIMEOUT/);
});

test('completed work clears the timer without destroying its successful result', async () => {
  let cancelled = false;
  assert.equal(await valuationDeadline(Promise.resolve(19.5), 10, () => { cancelled = true; }), 19.5);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(cancelled, false);
});
