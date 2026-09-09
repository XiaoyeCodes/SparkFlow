import test from 'node:test';
import assert from 'node:assert/strict';
import { briefSchedule, briefInput, briefPrompt, validateBrief } from '../../server/ibkrBrief.ts';
import { normalizeMcpSnapshot } from '../../server/ibkrMcp.ts';
import { defaults } from '../../server/ibkrWorkbenchCore.ts';
import { aiFailureCode, ibkrAiEnvironmentFromIntegrationSettings } from '../../server/ibkrAi.ts';

const snapshot = () => normalizeMcpSnapshot('U12345', [
  { conid: 1, ticker: 'AAPL', currency: 'USD', position: 10, mktValue: 2000, unrealizedPnl: 1000 },
  { conid: 2, ticker: 'MSFT', currency: 'USD', position: 3, mktValue: 1500, unrealizedPnl: 200 },
  { conid: 3, ticker: 'NVDA', currency: 'USD', position: 5, mktValue: 1200, unrealizedPnl: -100 },
], { baseCurrency: 'USD', netLiquidation: 10000, cash: [{ currency: 'USD', amount: 5300 }] });

test('AI subprocess failures preserve safe status codes without leaking provider output', () => {
  assert.equal(aiFailureCode('{"error":"AI_HTTP_401"}'), 'AI_HTTP_401');
  assert.equal(aiFailureCode('{"error":"secret-key in provider message"}'), 'AI_INVOCATION_FAILED_CHECK_MODEL_SETTINGS');
  assert.equal(aiFailureCode('raw secret response'), 'AI_INVOCATION_FAILED_CHECK_MODEL_SETTINGS');
});

test('IBKR AI worker uses the saved local integration model instead of stale Vibe environment defaults', () => {
  const environment = ibkrAiEnvironmentFromIntegrationSettings({ ai: { provider: 'deepseek', apiKey: 'test-key', model: 'deepseek-v4-flash', baseUrl: 'https://api.deepseek.com/' } });
  assert.equal(environment.LANGCHAIN_PROVIDER, 'deepseek');
  assert.equal(environment.LANGCHAIN_MODEL_NAME, 'deepseek-v4-flash');
  assert.equal(environment.DEEPSEEK_BASE_URL, 'https://api.deepseek.com');
  assert.equal(environment.DEEPSEEK_API_KEY, 'test-key');
  assert.deepEqual(ibkrAiEnvironmentFromIntegrationSettings({ ai: { provider: 'deepseek', apiKey: '', model: 'deepseek-v4-flash', baseUrl: 'https://api.deepseek.com' } }), {});
});

test('brief schedule uses NYSE close plus thirty minutes across DST, holidays and early closes', () => {
  assert.equal(briefSchedule(new Date('2026-03-09T20:29:00Z')).nextRunAt, '2026-03-09T20:30:00.000Z');
  assert.equal(briefSchedule(new Date('2026-03-09T20:30:00Z')).dueSession, '2026-03-09');
  assert.equal(briefSchedule(new Date('2026-11-27T18:29:00Z')).nextRunAt, '2026-11-27T18:30:00.000Z');
  assert.equal(briefSchedule(new Date('2026-11-27T18:30:00Z')).dueSession, '2026-11-27');
  assert.equal(briefSchedule(new Date('2026-09-07T22:00:00Z')).dueSession, '2026-09-04');
  assert.equal(briefSchedule(new Date('2026-09-07T22:00:00Z')).nextRunAt, '2026-09-08T20:30:00.000Z');
  assert.equal(briefSchedule(new Date('2029-01-03T22:00:00Z')).calendarSupported, false);
});

test('brief prompt ranks the largest holdings and requests one concrete Markdown block', () => {
  const s = snapshot(); s.detail = 'secret-user-id'; s.orders = [{ accountKey: 'ORDER_SECRET' }];
  const input = briefInput(s, defaults, '2026-09-04');
  const prompt = briefPrompt(input);
  assert.deepEqual(input.focusHoldings.map(item => item.symbol), ['AAPL', 'MSFT', 'NVDA']);
  assert.match(prompt, /只输出 Markdown 正文/);
  assert.match(prompt, /操作建议：/);
  assert.match(prompt, /330–370/);
  assert.match(prompt, /SPY、QQQ、VIX/);
  assert.doesNotMatch(prompt, /仅返回一个完整 JSON 对象/);
  for (const secret of [s.accountKey, s.snapshotId, 'U12345', 'ORDER_SECRET', 'secret-user-id']) assert.ok(!prompt.includes(secret));
});

test('Markdown brief is preserved without number, source, or wording censorship', () => {
  const input = briefInput(snapshot(), defaults, '2026-09-04');
  const raw = '```markdown\n操作建议：\n\n- **市场情绪**：VIX 上涨 8.19% 至 15.72，先保留现金。\n- **AAPL**：现价 316.22 美元，跌破 310 美元止损。\n```';
  const content = validateBrief(raw, input);
  assert.equal(content.markdown, raw.replace(/^```markdown\n|\n```$/g, ''));
  assert.match(content.markdown, /8\.19%/);
  assert.match(content.markdown, /310 美元止损/);
  assert.deepEqual(content.gaps, []);
});

test('known fact placeholders are substituted while unknown text is not rejected', () => {
  const input = briefInput(snapshot(), defaults, '2026-09-04');
  const content = validateBrief('操作建议：\n- **仓位**：净资产 {{nav}}；模型自带值 123.45；未知 {{customFact}}。', input);
  assert.match(content.markdown, /10,000\.00 USD/);
  assert.match(content.markdown, /123\.45/);
  assert.match(content.markdown, /\{\{customFact\}\}/);
});

test('legacy JSON can still be recovered as Markdown without re-running the model', () => {
  const input = briefInput(snapshot(), defaults, '2026-09-04');
  const content = validateBrief(JSON.stringify({ summary: '净资产 {{nav}}，保持纪律。', insights: [{ title: '【风险点】AAPL', fact: '当日回落 1.17%。', impact: '组合波动上升。', watch: '跌破低点减仓。' }] }), input);
  assert.match(content.markdown, /^操作建议：/);
  assert.match(content.markdown, /\*\*AAPL\*\*/);
  assert.match(content.markdown, /1\.17%/);
});
