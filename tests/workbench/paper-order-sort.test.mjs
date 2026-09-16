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

import { sortPaperTable, paperSortNumber, paperOrderTime } from '../../src/lib/ibkr/paperTableSort';

test('numeric sorting handles decimals and missing prices in both directions without mutation', () => {
  const rows = ['100', null, '9.5', '', 'invalid', '-2'];
  const value = row => paperSortNumber(row);
  assert.deepEqual(sortPaperTable(rows, { key: 'price', direction: 'asc' }, value), ['-2', '9.5', '100', null, '', 'invalid']);
  assert.deepEqual(sortPaperTable(rows, { key: 'price', direction: 'desc' }, value), ['100', '9.5', '-2', null, '', 'invalid']);
  assert.deepEqual(rows, ['100', null, '9.5', '', 'invalid', '-2']);
});

test('order time uses Beijing time including date rollover and never invents missing times', () => {
  assert.equal(paperOrderTime('2026-09-15T20:01:02Z'), '2026/09/16 04:01:02');
  assert.equal(paperOrderTime(null), '—');
  assert.equal(paperOrderTime('invalid'), '—');
});

test('default sort restores original order without evaluating sort keys', () => {
  const rows = [3, 1, 2];
  const result = sortPaperTable(rows, { key: 'quantity', direction: 'default' }, () => { throw new Error('should not compare'); });
  assert.deepEqual(result, rows);
  assert.notEqual(result, rows);
});

import { paperHoldingValues } from '../../src/lib/ibkr/paperTableSort';

test('holding price and unrealized profit use the same valuation with broker profit preferred', () => {
  assert.deepEqual(paperHoldingValues({ quantity: '10', averageCost: '90', marketValue: '1000' }), { currentPrice: 100, unrealizedPnl: 100 });
  assert.deepEqual(paperHoldingValues({ quantity: '10', averageCost: '110', marketValue: '1000' }), { currentPrice: 100, unrealizedPnl: -100 });
  assert.deepEqual(paperHoldingValues({ quantity: '10', averageCost: '90', marketValue: '1000', unrealizedPnl: '95.5' }), { currentPrice: 100, unrealizedPnl: 95.5 });
  assert.deepEqual(paperHoldingValues({ quantity: '-10', averageCost: '110', marketValue: '-1000' }), { currentPrice: 100, unrealizedPnl: 100 });
});

test('holding valuation does not invent zero prices or ignore contract multipliers', () => {
  assert.deepEqual(paperHoldingValues({ quantity: '10', averageCost: '90', marketValue: null }), { currentPrice: null, unrealizedPnl: null });
  assert.deepEqual(paperHoldingValues({ quantity: '0', averageCost: '90', marketValue: '0' }), { currentPrice: null, unrealizedPnl: null });
  assert.deepEqual(paperHoldingValues({ assetType: 'OPT', quantity: '10', averageCost: '90', marketValue: '1000', unrealizedPnl: '50' }), { currentPrice: null, unrealizedPnl: 50 });
  assert.deepEqual(paperHoldingValues({ quantity: '10', averageCost: null, marketValue: '1000' }), { currentPrice: 100, unrealizedPnl: null });
});
