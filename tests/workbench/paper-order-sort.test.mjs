import test from 'node:test';
import assert from 'node:assert/strict';
import { sortPaperOrdersNewestFirst } from '../../src/components/ibkr/PaperTradingWorkspace.tsx';

const order = (id, createdAt, orderId) => ({
  bodyHash: 'a'.repeat(64), createdAt, orderId, submission: 'ACKNOWLEDGED', execution: 'FILLED',
  intent: { clientIntentId: id, conId: 1, side: 'BUY', quantity: '1', limitPrice: null, orderType: 'MKT', tif: 'DAY' },
});

test('paper orders sort by submitted time newest first without mutating API state', () => {
  const rows = [
    order('older', '2026-09-11T01:00:00Z', 300),
    order('newest', '2026-09-11T03:00:00Z', 100),
    order('middle', '2026-09-11T02:00:00Z', 200),
  ];
  assert.deepEqual(sortPaperOrdersNewestFirst(rows).map(row => row.intent.clientIntentId), ['newest', 'middle', 'older']);
  assert.deepEqual(rows.map(row => row.intent.clientIntentId), ['older', 'newest', 'middle']);
});

test('legacy orders without a timestamp use the latest broker order id as a stable fallback', () => {
  const rows = [order('legacy-1', null, 10), order('legacy-2', undefined, 12), order('timed', '2026-09-11T01:00:00Z', 1)];
  assert.deepEqual(sortPaperOrdersNewestFirst(rows).map(row => row.intent.clientIntentId), ['timed', 'legacy-2', 'legacy-1']);
});
