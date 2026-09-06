import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReportEvidence } from '../../src/lib/ibkr/reportEvidence.ts';

const snapshot = { accountKey: 'paper:engineering', mode: 'paper', testData: true,
  positions: [{ conId: 12, symbol: 'TEST', currency: 'USD' }, { conId: 13, symbol: 'ABC', currency: 'USD' }] };
const news = { generatedAt: '2026-09-05T12:00:00Z', sources: [], categories: [], proxy: '', items: [
  { id: 'n1', title: 'TEST announces update', summary: 'Evidence only.', source: 'Fixture News', url: 'https://example.test/n1', category: 'finance', publishedAt: '2026-09-05T11:00:00Z', observedAt: '2026-09-05T12:00:00Z' },
  { id: 'n2', title: 'unsafe', source: 'Fixture News', url: 'javascript:alert(1)', category: 'finance' },
] };
const macro = { generatedAt: '2026-09-05T12:00:00Z', items: [
  { id: 'm1', label: 'US 10Y', display: '4.25%', status: 'delayed', updatedAt: '2026-09-05T10:00:00Z', sourceUrl: 'https://example.test/m1' },
] };

test('report evidence links exact symbol mentions and labels macro as non-causal context', () => {
  const value = buildReportEvidence(snapshot, news, macro, '2026-09-05T12:01:00Z');
  assert.deepEqual(value.items.map(row => [row.kind, row.linkedConIds, row.relation]), [
    ['news', [12], 'SYMBOL_MENTION'], ['macro', [], 'ACCOUNT_CONTEXT_NOT_CAUSAL'],
  ]);
  assert.deepEqual(value.gaps, ['MICRO_PERMISSION_REQUIRED']);
  assert.equal(value.items.every(row => row.testData), true);
});

test('missing sources become explicit gaps instead of fabricated evidence', () => {
  const value = buildReportEvidence(snapshot, null, null, '2026-09-05T12:01:00Z');
  assert.deepEqual(value.items, []);
  assert.deepEqual(value.gaps, ['NEWS_UNAVAILABLE', 'MACRO_UNAVAILABLE', 'MICRO_PERMISSION_REQUIRED']);
});
