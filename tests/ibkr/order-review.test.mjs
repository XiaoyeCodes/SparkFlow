import test from 'node:test';
import assert from 'node:assert/strict';
import { validOrderPreview } from '../../src/lib/ibkr/orderClient.ts';

const preview = {
  previewId: 'preview:1', bodyHash: 'a'.repeat(64), expiresAt: '2026-09-05T10:00:00Z',
  accountKey: 'paper:engineering', mode: 'paper', conId: 12, symbol: 'TEST', currency: 'USD',
  side: 'BUY', quantity: '6', orderType: 'LMT', limitPrice: '100', tif: 'DAY', snapshotId: 'snapshot-1',
  reservedCash: '601', reservedNotional: '600', reservedQuantity: '0', testData: true,
  warnings: ['工程测试数据；不得视为 IBKR 账户事实。'],
};

test('preview contract retains identity, exact strings and test-data provenance', () => {
  assert.equal(validOrderPreview(preview), true);
  assert.equal(validOrderPreview({ ...preview, bodyHash: 'short' }), false);
  assert.equal(validOrderPreview({ ...preview, reservedCash: 601 }), false);
  assert.equal(validOrderPreview({ ...preview, accountKey: 'live:engineering' }), false);
  assert.equal(validOrderPreview({ ...preview, testData: undefined }), false);
});
