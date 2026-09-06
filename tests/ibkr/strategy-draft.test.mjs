import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStrategyDraft } from '../../src/lib/ibkr/strategyDraft.ts';

const input = {
  strategyId: 'user:my-sma', version: '1.0.0', name: '我的 SMA 规则草稿', conId: '12', barInterval: '1D',
  fastWindow: '2', slowWindow: '5', targetQuantity: '10', maxPositionQuantity: '10',
  commissionPerOrder: '1', commissionPerShare: '0.005', slippageBps: '5', versionNotes: '等待用户复核。',
};

test('structured editor builds the exact whitelist definition without granting authority', () => {
  const result = buildStrategyDraft(input);
  assert.equal(result.ok, true);
  assert.equal(result.definition.signal.kind, 'sma_cross');
  assert.equal(result.definition.positionSizing.targetQuantity, '10');
  assert.equal(result.definition.risk.allowShort, false);
  assert.equal(result.definition.authorization, undefined);
});

test('structured editor rejects invalid windows, fractional targets and fixture namespace', () => {
  assert.deepEqual(buildStrategyDraft({ ...input, fastWindow: '5', slowWindow: '2' }).errors, ['快速窗口必须小于慢速窗口']);
  assert.deepEqual(buildStrategyDraft({ ...input, targetQuantity: '1.5' }).errors, ['目标数量必须是正整股']);
  assert.deepEqual(buildStrategyDraft({ ...input, strategyId: 'example:not-user' }).errors, ['用户策略 ID 必须以 user: 开头']);
});
