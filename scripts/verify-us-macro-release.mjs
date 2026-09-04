import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { parseEmploymentHeadline, parseMacroMarketCalendar, macroComparison, assertMacroPeriodNotRegressed, previousMacroPeriod, macroText } from '../server/usMacroRelease.ts';

// Public BLS wording variants; all other numerical fixtures below are synthetic.
for (const [headline, value] of [
  ['increased by 162,000 in August', 162], ['rose by 162,000 in August', 162],
  ['declined by 23,000 in July', -23], ['changed little in July (-23,000)', -23],
  ['changed little (+20,000) in June', 20], ['increased by 0 in August', 0],
]) {
  const result = parseEmploymentHeadline(`Total nonfarm payroll employment ${headline}, and the unemployment rate was unchanged at 4.1 percent.`);
  assert.equal(result.nonfarm, value, headline);
  assert.equal(result.unemployment, 4.1);
}
for (const wording of ['rate, at 4.1 percent', 'rate (4.1 percent)', 'rate rose to 4.1 percent', 'rate remained unchanged at 4.1 percent']) {
  assert.equal(parseEmploymentHeadline(`Total nonfarm payroll employment rose by 1,000 in July. The unemployment ${wording}.`).unemployment, 4.1);
}
assert.throws(() => parseEmploymentHeadline('Total nonfarm payroll employment changed little in July. The unemployment rate was unchanged at 4.1 percent.'));
assert.equal(previousMacroPeriod('2026-01'), '2025-12');

const row = (date, month, actual, prev, forecast) => `<tr data-category="Business Confidence"><td>${date}</td><td>14:00</td><td>ISM Manufacturing PMI</td><td>${month}</td><td>${actual}</td><td>${prev}</td><td>${forecast}</td></tr>`;
const calendar = parseMacroMarketCalendar(row('2026-09-01', 'Aug', '51', '50', '') + row('2026-08-03', 'Jul', '50', '49', '48'), 'Business Confidence', /ISM Manufacturing PMI/i, 'test');
assert.equal(calendar.period, '2026-08');
assert.equal(calendar.actual, 51, 'Missing forecast must not select the older completed row');
assert.equal(calendar.consensus, undefined);
assert.equal(parseMacroMarketCalendar(row('2026-03-31', 'Mar', '51', '', ''), 'Business Confidence', /ISM Manufacturing PMI/i, 'test').period, '2026-03', 'Use reference month; month-end date arithmetic must not overflow');
assert.equal(parseMacroMarketCalendar(row('2026-01-02', 'Dec', '51', '50', ''), 'Business Confidence', /ISM Manufacturing PMI/i, 'test').period, '2025-12');
const markdown = '| 2026-09-04 | 12:30 | Non Farm Payrolls | Aug | 162K | 21K | |';
assert.equal(parseMacroMarketCalendar(markdown, 'Non Farm Payrolls', /Non Farm Payrolls/, 'test').actual, 162);

assert.equal(macroComparison('2026-08', 162, 21, { period: '2026-07', actual: -23, previous: 20, consensus: 80, sourceUrl: 'test' }, []).consensus, undefined);
assert.equal(macroComparison('2026-08', 162, 21, undefined, []).change, 141);
assert.equal(macroComparison('2026-08', 162, undefined, undefined, [{time:'2026-06-01',value:20}]).change, null, 'Never compute monthly change against a two-month-old value');
assert.throws(() => assertMacroPeriodNotRegressed('2026-07-01', '2026-08-01'));
assert.doesNotThrow(() => assertMacroPeriodNotRegressed('2026-08-01', '2026-08-01'));

// Exercise the actual Vite card producers with injected sources, without starting services or using the network.
const source = readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('vite.config.ts', source, ts.ScriptTarget.Latest, true);
const names = ['parseBlsReleaseReport', 'parseBlsEmploymentPrevious', 'findBlsTableRow', 'parseBlsPpiPreviousYoy', 'signedReleaseValue', 'monthNameToNumber', 'signedCardValue', 'isolatedCardHistory', 'buildIsolatedUsMacroCard', 'refreshIsolatedUsMacroCard'];
const functions = ast.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text)).map(node => node.getText(ast)).join('\n');
assert.equal(functions.match(/(?:async )?function /g).length, names.length);
let period = '2026-08';
let fail = false;
const cache = new Map();
const context = vm.createContext({
  Date, Map, Promise, Error, console: { warn() {} },
  parseEmploymentHeadline, macroComparison, assertMacroPeriodNotRegressed,
  stripTags: macroText, asFiniteNumber: value => value === undefined || !Number.isFinite(Number(value)) ? undefined : Number(value),
  isolatedUsMacroCardCache: cache, isolatedUsMacroCardInFlight: new Map(), persistIsolatedUsMacroCards() {},
  getBlsReleaseReport: async () => { if (fail) throw new Error('test upstream failure'); return {period, nonfarm:162,nonfarmPrevious:21,unemployment:4.1,unemploymentPrevious:4.1,cpi:0.1,cpiYoy:3.4,ppi:0,ppiYoy:4.7,sourceUrl:'official'}; },
  optionalMacroContext: async () => undefined,
  getIsolatedMarketContext: async () => ({ period, actual:51, previous:50, sourceUrl:'market' }),
  getBeaPceMacroMetric: async () => ({updatedAt: `${period}-01T00:00:00Z`,value:0.2,sourceUrl:'bea'}),
});
vm.runInContext(ts.transpileModule(functions, {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText, context);
const employment = context.parseBlsReleaseReport('THE EMPLOYMENT SITUATION - AUGUST 2026. Total nonfarm payroll employment increased by 162,000 in August, and the unemployment rate was unchanged at 4.1 percent. The change for July was revised up by 44,000, from -23,000 to +21,000.', 'employment', 'test');
assert.equal(employment.nonfarm, 162);
assert.equal(employment.nonfarmPrevious, 21, 'Use revised prior payrolls');
assert.equal(context.parseBlsReleaseReport('PRODUCER PRICE INDEXES - JULY 2026. The Producer Price Index for final demand was unchanged in July. The index for final demand increased 4.7 percent for the 12 months ended in July.', 'ppi', 'test').ppiYoy, 4.7, 'A missing prior value must not invalidate the actual PPI');
assert.equal(context.parseBlsReleaseReport('CONSUMER PRICE INDEX - JULY 2026. The Consumer Price Index for All Urban Consumers (CPI-U) increased 0.1 percent in July. Over the last 12 months, the all items index increased 3.4 percent.', 'cpi', 'test').cpiYoy, 3.4);
for (const id of ['nonfarm', 'unemployment', 'cpi', 'ppi', 'pmi', 'pce']) {
  const card = await context.refreshIsolatedUsMacroCard(id);
  assert.equal(card.updatedAt.slice(0, 7), '2026-08', `${id} advances without consensus`);
  assert.equal(card.stale, false);
  assert.equal(card.stats.find(s=>s.label.includes('预期')).display, '—');
}
assert.equal(cache.get('nonfarm').data.change, 141);
assert.equal(cache.get('pce').data.value, 0.2, 'BEA actual must not be overridden by a mismatched market actual');
fail = true;
const stale = await context.refreshIsolatedUsMacroCard('nonfarm');
assert.equal(stale.value, 162);
assert.equal(stale.stale, true);
assert.equal(stale.refreshError, 'test upstream failure');
assert.equal(cache.get('cpi').data.stale, false, 'Failures remain isolated per card');
fail = false;
period = '2026-07';
assert.equal((await context.refreshIsolatedUsMacroCard('nonfarm')).updatedAt.slice(0,7), '2026-08');
period = '2026-08';
assert.equal((await context.refreshIsolatedUsMacroCard('nonfarm')).stale, false, 'A successful retry clears failure state');
console.log('US macro parsing, six-card updates, revisions, missing fields, stale fallback and recovery: passed');

if (process.argv.includes('--live')) {
  const { ProxyAgent } = await import('undici');
  const dispatcher = new ProxyAgent('http://127.0.0.1:7890');
  try {
    const response = await fetch('https://r.jina.ai/http://www.bls.gov/news.release/empsit.htm', {dispatcher,signal:AbortSignal.timeout(20000)});
    assert(response.ok, `BLS rendered source HTTP ${response.status}`);
    const raw = await response.text();
    console.time('parse live BLS');
    console.log(context.parseBlsReleaseReport(raw, 'employment', 'https://www.bls.gov/news.release/empsit.htm'));
    console.timeEnd('parse live BLS');
  } finally { await dispatcher.close(); }
}
