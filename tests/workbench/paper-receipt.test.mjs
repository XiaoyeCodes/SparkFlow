import test from 'node:test';
import assert from 'node:assert/strict';
import { paperReceiptStatus } from '../../src/lib/ibkr/paperReceipt.ts';

const record = { submission: 'SUBMITTING', execution: 'NONE', filledQuantity: '0' };
test('local persistence and a successful API response alone do not claim a sent or filled order', () => {
  assert.equal(paperReceiptStatus(record).kind, 'pending');
  assert.equal(paperReceiptStatus({ ...record, submission: 'PERSISTED' }).kind, 'pending');
  assert.equal(paperReceiptStatus({ ...record, dispatchState: 'SENT' }).kind, 'sent');
  assert.equal(paperReceiptStatus({ ...record, submission: 'ACKNOWLEDGED' }).kind, 'accepted');
});
test('broker execution controls partial and completed receipts', () => {
  assert.equal(paperReceiptStatus({ ...record, execution: 'PARTIAL', filledQuantity: '4' }).kind, 'partial');
  assert.equal(paperReceiptStatus({ ...record, execution: 'FILLED', filledQuantity: '10' }).kind, 'filled');
  assert.equal(paperReceiptStatus({ ...record, submission: 'ACKNOWLEDGED', filledQuantity: '10' }).kind, 'accepted');
});
test('ambiguous and rejected responses never show a success receipt', () => {
  assert.equal(paperReceiptStatus(null).kind, 'warning');
  assert.equal(paperReceiptStatus({ ...record, dispatchState: 'SENT', submission: 'UNKNOWN' }).kind, 'warning');
  assert.equal(paperReceiptStatus({ ...record, execution: 'OPEN', reconciliationRequired: true }).kind, 'warning');
  assert.equal(paperReceiptStatus({ ...record, submission: 'DENIED' }).kind, 'error');
  assert.equal(paperReceiptStatus({ ...record, dispatchState: 'SENT', execution: 'REJECTED' }).kind, 'error');
});
test('late accounting or commission reconciliation does not hide a confirmed full execution', () => {
  const status = paperReceiptStatus({ ...record, submission: 'ACKNOWLEDGED', execution: 'FILLED', filledQuantity: '10', reconciliationRequired: true });
  assert.equal(status.kind, 'filled');
  assert.match(status.detail, /资金、费用与持仓正在自动核对/);
});
test('cancellation acknowledgements and pending cancellations are distinct from fills', () => {
  assert.equal(paperReceiptStatus({ ...record, execution: 'CANCELLED', filledQuantity: '4' }).kind, 'neutral');
  assert.equal(paperReceiptStatus({ ...record, execution: 'OPEN', cancelState: 'REQUESTED' }).kind, 'pending');
  assert.equal(paperReceiptStatus({ ...record, execution: 'FILLED', cancelState: 'TOO_LATE' }).kind, 'filled');
});
