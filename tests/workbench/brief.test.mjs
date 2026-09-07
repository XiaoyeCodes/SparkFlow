import test from 'node:test';
import assert from 'node:assert/strict';
import { briefSchedule, briefInput, briefPrompt, validateBrief } from '../../server/ibkrBrief.ts';
import { normalizeMcpSnapshot } from '../../server/ibkrMcp.ts';
const snapshot = () => normalizeMcpSnapshot('U12345', [{conid:1,ticker:'AAPL',currency:'USD',position:10,mktValue:2000,unrealizedPnl:1000}], {baseCurrency:'USD',netLiquidation:10000,cash:[{currency:'USD',amount:8000}]});
import { defaults } from '../../server/ibkrWorkbenchCore.ts';
import { aiFailureCode } from '../../server/ibkrAi.ts';

test('AI subprocess failures preserve safe status codes without leaking provider output', () => {
  assert.equal(aiFailureCode('{"error":"AI_HTTP_401"}'), 'AI_HTTP_401');
  assert.equal(aiFailureCode('{"error":"secret-key in provider message"}'), 'AI_INVOCATION_FAILED_CHECK_MODEL_SETTINGS');
  assert.equal(aiFailureCode('raw secret response'), 'AI_INVOCATION_FAILED_CHECK_MODEL_SETTINGS');
});

test('brief schedule uses NYSE close plus thirty minutes across DST, holidays and early closes', () => {
  assert.equal(briefSchedule(new Date('2026-03-09T20:29:00Z')).nextRunAt, '2026-03-09T20:30:00.000Z');
  assert.equal(briefSchedule(new Date('2026-03-09T20:30:00Z')).dueSession, '2026-03-09');
  assert.equal(briefSchedule(new Date('2026-11-27T18:29:00Z')).nextRunAt, '2026-11-27T18:30:00.000Z');
  assert.equal(briefSchedule(new Date('2026-11-27T18:30:00Z')).dueSession, '2026-11-27');
  assert.equal(briefSchedule(new Date('2026-09-07T22:00:00Z')).dueSession, '2026-09-04');
  assert.equal(briefSchedule(new Date('2026-09-07T22:00:00Z')).nextRunAt, '2026-09-08T20:30:00.000Z');
  assert.equal(briefSchedule(new Date('2027-01-04T21:30:00Z')).dueSession, '2027-01-04');
  assert.equal(briefSchedule(new Date('2028-07-03T17:30:00Z')).dueSession, '2028-07-03');
  assert.equal(briefSchedule(new Date('2029-01-03T22:00:00Z')).calendarSupported, false);
});
test('brief prompt uses allowlisted facts without identities, orders or invented returns', () => {
  const s = snapshot(); s.detail = 'secret-user-id'; s.orders = [{ accountKey: 'ORDER_SECRET' }];
  const input = briefInput(s, defaults, '2026-09-04');
  const prompt = briefPrompt(input);
  for (const secret of [s.accountKey, s.snapshotId, 'U12345', 'ORDER_SECRET', 'secret-user-id']) assert.ok(!prompt.includes(secret));
  assert.equal(input.facts.nav.display, '10,000.00 USD');
  assert.match(prompt, /未实现盈亏不等于当日收益/);
  assert.ok(!('dailyReturn' in input.facts));
});
test('brief numbers require known fact references and valid concise structure', () => {
  const input = briefInput(snapshot(), defaults, '2026-09-04');
  const content = { headline: '保持现金缓冲', summary: '当前净值 {{nav}}。', risk: '关注单一标的集中度。', watch: ['核对现金需求。'], gaps: ['没有外部新闻证据。'] };
  const result = validateBrief(JSON.stringify(content), input);
  assert.match(result.summary, /10,000.00 USD/);
  assert.throws(() => validateBrief(JSON.stringify({ ...content, summary: '净值 10001 元。' }), input), /BRIEF_UNSOURCED_NUMBER/);
  assert.throws(() => validateBrief(JSON.stringify({ ...content, summary: '{{fabricated}}' }), input), /BRIEF_UNKNOWN_FACT/);
  assert.throws(() => validateBrief(JSON.stringify({ ...content, trade: 'BUY' }), input));
});
