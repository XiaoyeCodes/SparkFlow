import test from 'node:test';
import assert from 'node:assert/strict';
import { paperFilledQuantity, paperOrderErrorMessage, paperOrderNeedsStatusCheck, paperReceiptStatus } from '../../src/lib/ibkr/paperReceipt.ts';

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
  assert.equal(paperReceiptStatus({ ...record, submission: 'UNKNOWN', lastError: 'IBKR_201' }).kind, 'error');
  assert.equal(paperReceiptStatus({ ...record, submission: 'UNKNOWN', execution: 'INACTIVE' }).kind, 'error');
  assert.equal(paperReceiptStatus({ ...record, submission: 'ACKNOWLEDGED', execution: 'OPEN', lastError: 'IBKR_201' }).kind, 'accepted');
});

test('generic paper failures explain that no broker order id was obtained', () => {
  const message = paperOrderErrorMessage('PAPER_OPERATION_FAILED');
  assert.match(message, /未取得券商订单号/);
  assert.doesNotMatch(message, /PAPER_OPERATION_FAILED/);
});
test('late accounting or commission reconciliation does not hide a confirmed full execution', () => {
  const status = paperReceiptStatus({ ...record, submission: 'ACKNOWLEDGED', execution: 'FILLED', filledQuantity: '10', reconciliationRequired: true });
  assert.equal(status.kind, 'filled');
  assert.match(status.detail, /资金、费用与持仓正在自动核对/);
});
test('a broker-confirmed resting order remains accepted while account proof retries separately', () => {
  const row = { ...record, submission: 'ACKNOWLEDGED', execution: 'OPEN', brokerFilled: '0.0', brokerRemaining: '1.0', reconciliationRequired: true };
  assert.equal(paperReceiptStatus(row).kind, 'accepted');
  assert.equal(paperOrderNeedsStatusCheck(row), false);
});
test('broker terminal counters are visible before detailed executions arrive', () => {
  const row = { ...record, execution: 'FILLED', brokerFilled: '10.0', brokerRemaining: '0.0' };
  assert.equal(paperFilledQuantity(row), '10.0');
});
test('cancellation acknowledgements and pending cancellations are distinct from fills', () => {
  assert.equal(paperReceiptStatus({ ...record, execution: 'CANCELLED', filledQuantity: '4' }).kind, 'neutral');
  assert.equal(paperReceiptStatus({ ...record, execution: 'OPEN', cancelState: 'REQUESTED' }).kind, 'pending');
  assert.equal(paperReceiptStatus({ ...record, execution: 'FILLED', cancelState: 'TOO_LATE' }).kind, 'filled');
});
