import test from 'node:test';
import assert from 'node:assert/strict';
import { bridgePortCandidates, findAvailableBridgePort } from '../../server/ibkrGatewayBridge.ts';

test('bridge port selection keeps the configured port first and falls back deterministically', async () => {
  const candidates = bridgePortCandidates(8765);
  assert.equal(candidates[0], 8765);
  assert.equal(new Set(candidates).size, candidates.length);
  const checked = [];
  const selected = await findAvailableBridgePort(8765, async port => {
    checked.push(port);
    return port === 18767;
  });
  assert.equal(selected, 18767);
  assert.deepEqual(checked.slice(0, 4), [8765, 18765, 18766, 18767]);
});

test('bridge port selection reports a clear error when all candidates are occupied', async () => {
  await assert.rejects(() => findAvailableBridgePort(18765, async () => false), /没有可用的本机桥接端口/);
});
