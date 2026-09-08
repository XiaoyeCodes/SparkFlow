import test from 'node:test';
import assert from 'node:assert/strict';
import { briefSchedule, briefInput, briefPrompt, validateBrief } from '../../server/ibkrBrief.ts';
import { normalizeMcpSnapshot } from '../../server/ibkrMcp.ts';
const snapshot = () => normalizeMcpSnapshot('U12345', [{conid:1,ticker:'AAPL',currency:'USD',position:10,mktValue:2000,unrealizedPnl:1000}], {baseCurrency:'USD',netLiquidation:10000,cash:[{currency:'USD',amount:8000}]});
import { defaults } from '../../server/ibkrWorkbenchCore.ts';
import { aiFailureCode, ibkrAiEnvironmentFromIntegrationSettings } from '../../server/ibkrAi.ts';

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
  assert.deepEqual(ibkrAiEnvironmentFromIntegrationSettings({ ai: { provider: 'unknown', apiKey: 'test-key', model: 'model', baseUrl: 'https://example.com' } }), {});
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
  assert.equal(input.facts.twr.display, '未提供');
  assert.match(prompt, /未实现盈亏不等于当日收益/);
  assert.match(prompt, /持仓快照由系统自动读取/);
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

const researchedInput = () => briefInput(snapshot(), defaults, '2026-09-04', {
  analysisAsOf: '2026-09-08T04:00:00Z',
  evidence: [{ id: 'E1', title: 'Apple earnings release', symbols: ['AAPL'], url: 'https://www.apple.com/newsroom/earnings/', source: 'Apple', publishedAt: '2026-09-07T12:00:00Z', fetchedAt: '2026-09-08T03:59:00Z', kind: 'filing', read: true, summary: 'Revenue grew.', content: 'Apple reported revenue growth of 8 percent. Cash flow improved compared with the prior period.' }],
  coverage: [{ symbol: 'AAPL', status: 'partial', areas: ['filing'], gaps: ['估值尚未取得'] }], gaps: ['估值尚未取得'],
});
const intelligence = () => ({ headline: '财报改善仍需估值验证', summary: 'AAPL 占净资产 {{holding0Weight}}，本期重点验证经营改善是否延续。', insights: [{ id: 'aapl-earnings', title: '营收增长有待持续验证', kind: 'mixed', priority: 'high', status: 'new', symbols: ['AAPL'], fact: '公司披露营收增长 8 percent。', impact: '经营改善可能支持盈利，但尚缺估值依据。', watch: '下一期关注现金流能否继续改善。', invalidation: '若经营增长无法持续，当前判断减弱。', horizon: '未来数月', confidence: 'medium', confidenceReason: '公司财报可核实，估值未取得。', evidenceIds: ['E1'], support: [{ evidenceId: 'E1', quote: 'Apple reported revenue growth of 8 percent.' }] }], calendar: [], changes: ['建立持仓研究基线。'], gaps: ['估值尚未取得。'] });

test('intelligence brief resolves account facts and verifies external numbers against original support', () => {
  const result = validateBrief(JSON.stringify(intelligence()), researchedInput());
  assert.match(result.summary, /20.0%/);
  assert.equal(result.insights[0].evidenceIds[0], 'E1');
  assert.equal(result.watch[0], result.insights[0].watch);
  const bad = intelligence(); bad.insights[0].fact = '营收增长 99 percent。';
  const redacted = validateBrief(JSON.stringify(bad), researchedInput());
  assert.doesNotMatch(redacted.insights[0].fact, /99/);
  assert.ok(redacted.gaps.some(item => item.includes('数值已隐藏')));
  const input = researchedInput();
  input.facts.externalE1Value = { label: '外部已核验值', display: '8.00%', source: 'Apple', asOf: '2026-09-07', evidenceId: 'E1', rawValue: 8 };
  const formatted = intelligence(); formatted.insights[0].fact = '公司披露营收增长 {{externalE1Value}}。';
  assert.match(validateBrief(JSON.stringify(formatted), input).insights[0].fact, /8.00%/);
  input.facts.externalE1Value.evidenceId = 'E2';
  assert.equal(validateBrief(JSON.stringify(formatted), input).insights.length, 0);
});

test('daily brief permits a sourced portfolio-wide reminder without assigning a made-up holding', () => {
  const output = intelligence();
  output.insights[0].symbols = [];
  const result = validateBrief(JSON.stringify(output), researchedInput());
  assert.deepEqual(result.insights[0].symbols, []);
  output.insights[0].symbols = ['MSFT'];
  assert.equal(validateBrief(JSON.stringify(output), researchedInput()).insights.length, 0);
});

test('daily brief omits fabricated or unrelated event reminders, while retaining uncited account-risk drafts', () => {
  const quote = intelligence(); quote.insights[0].support[0].quote = 'Apple has raised its guidance substantially.';
  assert.equal(validateBrief(JSON.stringify(quote), researchedInput()).insights.length, 0);
  const holding = intelligence(); holding.insights[0].symbols = ['MSFT'];
  assert.equal(validateBrief(JSON.stringify(holding), researchedInput()).insights.length, 0);
  const source = intelligence(); source.insights[0].evidenceIds = ['E999'];
  assert.equal(validateBrief(JSON.stringify(source), researchedInput()).insights.length, 0);
  const missing = intelligence(); missing.insights[0].support = [];
  const omitted = validateBrief(JSON.stringify(missing), researchedInput());
  assert.equal(omitted.insights.length, 0);
  assert.ok(omitted.gaps.some(item => item.includes('未展示')));
  missing.insights[0].evidenceIds = [];
  const draft = validateBrief(JSON.stringify(missing), researchedInput());
  assert.equal(draft.insights.length, 1);
  assert.ok(draft.gaps.some(item => item.includes('IBKR 快照核对')));
});

test('BLS cited month translation is accepted without allowing the same numeral as an unsourced percentage', () => {
  const input = researchedInput(), output = intelligence();
  const quote = '{"year":"2026","period":"M08","value":"4.1"}';
  Object.assign(input.research.evidence[0], { kind: 'macro', symbols: [], url: 'https://api.bls.gov/publicAPI/v2/timeseries/data/LNS14000000', content: quote });
  output.insights[0].support[0].quote = quote;
  output.insights[0].fact = '2026年8月失业率为4.1%。';
  assert.match(validateBrief(JSON.stringify(output), input).insights[0].fact, /未核验数值月/);
  output.insights[0].fact = '失业率为8%。';
  assert.doesNotMatch(validateBrief(JSON.stringify(output), input).insights[0].fact, /8%/);
  output.insights[0].fact = '2026年9月失业率为4.1%。';
  assert.doesNotMatch(validateBrief(JSON.stringify(output), input).insights[0].fact, /9月/);
});

test('a cross-factor insight can cite company earnings, inflation and policy with an original quote for each', () => {
  const input = researchedInput(), output = intelligence();
  const originals = ['Inflation remains elevated relative to the policy objective.', 'The Committee decided to maintain the target range for the federal funds rate.'];
  originals.forEach((content, index) => {
    const id = `E${index + 2}`;
    input.research.evidence.push({ ...input.research.evidence[0], id, kind: 'macro', symbols: [], content });
    output.insights[0].evidenceIds.push(id);
    output.insights[0].support.push({ evidenceId: id, quote: content });
  });
  assert.equal(validateBrief(JSON.stringify(output), input).insights[0].support.length, 3);
  output.insights[0].support.pop();
  assert.equal(validateBrief(JSON.stringify(output), input).insights.length, 0);
});

test('daily intelligence brief accepts at most three concise sourced reminders and no event calendar', () => {
  const content = intelligence();
  content.calendar = [{ title: '业绩发布', at: '2026-09-10T12:30:00Z', dateStatus: 'confirmed', symbols: ['AAPL'], watch: '关注现金流', implication: '持续改善强化判断', evidenceIds: ['E1'], support: [{ evidenceId: 'E1', quote: 'Apple reported revenue growth of 8 percent.' }] }];
  assert.throws(() => validateBrief(JSON.stringify(content), researchedInput()));
  const three = intelligence();
  three.headline = '账户风险速览';
  three.summary = 'AAPL 占比 {{holding0Weight}}，集中度需盯。';
  three.changes = []; three.gaps = [];
  three.insights = [
    { ...three.insights[0], id: 'aapl-cash-flow', title: '【集中度】', fact: '权重 {{holding0Weight}}。', impact: '单标的波动放大。', watch: '盯权重。', invalidation: '权重下降。', horizon: '近期', confidenceReason: '原文已核验。' },
    { ...three.insights[0], id: 'aapl-guidance', title: '【财报】', fact: '营收增长 8 percent。', impact: '业绩待验证。', watch: '盯现金流。', invalidation: '增长中断。', horizon: '近期', confidenceReason: '原文已核验。' },
    { ...three.insights[0], id: 'aapl-margin', title: '【现金流】', fact: '现金流改善。', impact: '仍需持续。', watch: '盯下期。', invalidation: '现金流转弱。', horizon: '近期', confidenceReason: '原文已核验。' },
  ];
  assert.equal(validateBrief(JSON.stringify(three), researchedInput()).insights.length, 3);
  const four = { ...three, insights: [...three.insights, { ...three.insights[0], id: 'aapl-extra' }] };
  assert.throws(() => validateBrief(JSON.stringify(four), researchedInput()));
});

test('daily risk brief retains a snapshot-only risk without blocking it when the model omits fact placeholders', () => {
  const output = intelligence();
  output.insights = [{ ...output.insights[0], title: '【集中度】', symbols: ['AAPL'], fact: 'AAPL 权重 {{holding0Weight}}。', impact: '单标的波动会放大组合波动。', watch: '盯住该权重是否继续升高。', invalidation: '权重回落。', evidenceIds: [], support: [] }];
  const result = validateBrief(JSON.stringify(output), researchedInput());
  assert.equal(result.insights.length, 1);
  output.insights[0].fact = 'AAPL 权重偏高。';
  const unlinked = validateBrief(JSON.stringify(output), researchedInput());
  assert.equal(unlinked.insights.length, 1);
  assert.ok(unlinked.gaps.some(item => item.includes('IBKR 快照核对')));
});

test('research input excludes future evidence and carries only sanitized prior conclusions', () => {
  const input = researchedInput();
  const research = { ...input.research, analysisAsOf: input.analysisAsOf, evidence: [...input.research.evidence, { ...input.research.evidence[0], id: 'E2', publishedAt: '2026-09-09T00:00:00Z' }] };
  const prior = { accountKey: 'PRIVATE_ACCOUNT', snapshotId: 'PRIVATE_SNAPSHOT', generatedAt: '2026-09-07T04:00:00Z', content: { ...intelligence(), risk: '', watch: [] } };
  const next = briefInput(snapshot(), defaults, '2026-09-04', research, prior);
  const prompt = briefPrompt(next);
  assert.equal(next.research.evidence.length, 1);
  assert.ok(next.previous); assert.ok(!prompt.includes('PRIVATE_ACCOUNT')); assert.ok(!prompt.includes('PRIVATE_SNAPSHOT'));
  const instructions = prompt.split('<untrusted_input_data>')[0];
  assert.match(instructions, /组合变化/); assert.match(instructions, /最多三项/); assert.match(instructions, /calendar 必须为 \[\]/);
  assert.doesNotMatch(instructions, /当前估值在要求怎样的经营表现/);
  assert.doesNotMatch(instructions, /宏观周期怎样传导/);
});
test('brief without a fact placeholder remains publishable with a snapshot note', () => {
  const content = validateBrief(JSON.stringify({ headline: '账户速览', summary: '本期风险保持关注。', risk: '集中度待观察。', watch: ['留意波动。'], gaps: [] }), briefInput(snapshot(), defaults, '2026-09-08'));
  assert.ok(content.gaps.some(item => item.includes('IBKR 快照')));
});
