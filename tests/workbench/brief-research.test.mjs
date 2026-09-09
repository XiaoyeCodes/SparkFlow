import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, utimes, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { prepareBriefResearch } from '../../server/ibkrBriefResearch.ts';
import { readBriefProfileFallback } from '../../server/ibkrWorkbench.ts';

const analysisAsOf = '2026-09-08T12:00:00.000Z';
const makeSnapshot = (symbols = ['AAPL', 'QQQ']) => ({
 accountKey: 'PRIVATE_ACCOUNT_NEVER_PUBLISH', snapshotId: 'PRIVATE_SNAPSHOT_NEVER_PUBLISH', asOf: analysisAsOf, baseCurrency: 'USD',
 metrics: { netLiquidation: '987654321.123456', maintenanceMargin: '87654321.76543' }, cash: [],
 positions: symbols.map((symbol, i) => ({ accountKey: 'PRIVATE_ACCOUNT_NEVER_PUBLISH', conId: 99887766 + i, symbol, assetType: 'STK', currency: 'USD', name: 'PRIVATE_ACCOUNT_LABEL_NEVER_PUBLISH', marketValue: String(11000 - i), quantity: '12345.987654', instrumentType: symbol === 'QQQ' ? 'ETF' : 'EQUITY' })),
});
function fixtureTool(calls, override) {
 return async (name, args, signal) => {
  calls.push({ name, args });
  const replacement = await override?.(name, args, signal);
  if (replacement !== undefined) return replacement;
  if (name === 'profile') return { url: `https://finance.yahoo.com/quote/${args.symbol}/profile/`, name: args.symbol === 'UL' ? 'Unilever PLC' : `${args.symbol} Public Company`, instrumentType: args.symbol === 'QQQ' ? 'ETF' : 'EQUITY', statistics: { forwardPE: 21.1, mostRecentQuarter: 1782777600 }, financials: { totalRevenue: 1234000000, freeCashflow: 89000000 } };
  if (name === 'financials') return { url: 'https://data.sec.gov/api/xbrl/companyfacts/CIK0000123456.json', data: { [`${args.symbol}.US`]: { periods: [{ REPORT_DATE: '2026-06-30', FORM: '10-Q', Revenue: 1234000000, NetIncome: 100000000 }] } } };
  if (name === 'prices') return { url: `https://finance.yahoo.com/quote/${args.symbol}/history/`, rows: [{ trade_date: Date.parse('2026-09-04T20:00:00Z') / 1000, close: 200.11 }] };
  if (name === 'search') {
   const symbol = args.query.startsWith('Federal') ? 'MACRO' : args.query.split(' ')[0];
   const calendar = args.query.includes('calendar');
   return { results: [{ url: `https://investors.example.com/${symbol}/${calendar ? 'calendar' : 'announcement'}`, title: `${symbol} search-only title`, snippet: 'UNREAD_SEARCH_SNIPPET_NEVER_CITE' }] };
  }
  if (name === 'read') {
   const symbol = /example.com/.test(args.url) ? new URL(args.url).pathname.split('/')[1] : 'MACRO';
   const content = symbol === 'MACRO'
    ? 'Federal Reserve economic release schedule and interest rate policy. Employment and consumer price inflation are reported in official economic releases. '.repeat(3)
    : `${symbol === 'UL' ? 'Unilever' : symbol} Public Company investor relations financial release. The company announced quarterly revenue and earnings guidance; upcoming investor conference is scheduled for September 10, 2026. `.repeat(3);
   return { title: `${symbol} original financial release`, url: args.url, content: `Published Time: 2026-09-07T13:00:00Z\n${content}`, links: args.url.includes('fomccalendars') ? [{url:'https://www.federalreserve.gov/newsevents/pressreleases/monetary20260729a.htm'}] : [] };
  }
  throw new Error(`Unexpected ${name}`);
 };
}

test('all twelve holdings receive public profile, news and upcoming calendar scans without account data', async () => {
 const symbols = ['AAPL', 'AMD', 'AMZN', 'GOOG', 'KO', 'LLY', 'MCD', 'MSFT', 'NVDA', 'QQQ', 'TSLA', 'UL'];
 const calls = [];
 let active = 0, maximum = 0;
 const base = fixtureTool(calls);
 const result = await prepareBriefResearch(makeSnapshot(symbols), { tool: async (...args) => { active++; maximum = Math.max(maximum, active); try { await new Promise(resolve => setTimeout(resolve, 1)); return await base(...args); } finally { active--; } } }, new AbortController().signal, { analysisAsOf });
 assert.equal(result.coverage.length, 12);
 assert.ok(maximum <= 3);
 for (const symbol of symbols) {
  const item = result.coverage.find(c => c.symbol === symbol);
  assert.ok(item.areas.includes('profile'), symbol);
  assert.ok(item.areas.includes('news'), symbol);
  assert.ok(item.areas.includes('calendar'), symbol);
  assert.ok(calls.some(c => c.name === 'search' && c.args.query.startsWith(`${symbol} `) && c.args.query.includes('calendar')), symbol);
 }
 const publicCalls = JSON.stringify(calls);
 assert.doesNotMatch(publicCalls, /PRIVATE_|987654321|12345\.987654|99887766/);
 assert.doesNotMatch(JSON.stringify(result.evidence), /UNREAD_SEARCH_SNIPPET/);
 assert.ok(result.evidence.every((e, i) => e.read && e.id === `E${i + 1}` && e.url.startsWith('https://') && e.fetchedAt));
 assert.ok(result.evidence.some(e => e.kind === 'macro'));
 assert.ok(result.evidence.reduce((sum, e) => sum + e.content.length, 0) <= 85000);
 assert.ok(result.evidence.every(e => e.content.length <= 4800));
});

test('structured valuation and full fiscal records are preserved; ETF avoids corporate statements', async () => {
 const calls = [];
 const result = await prepareBriefResearch(makeSnapshot(), { tool: fixtureTool(calls) }, new AbortController().signal, { analysisAsOf });
 assert.ok(!calls.some(c => c.name === 'financials' && c.args.symbol === 'QQQ'));
 const profile = result.evidence.find(e => e.kind === 'profile' && e.symbols.includes('AAPL'));
 assert.equal(JSON.parse(profile.content).statistics.forwardPE, 21.1);
 const filing = result.evidence.find(e => e.kind === 'filing');
 assert.equal(JSON.parse(filing.content).data['AAPL.US'].periods[0].Revenue, 1234000000);
 const prices = result.evidence.find(e => e.kind === 'market');
 assert.equal(JSON.parse(prices.content).rows[0].close, 200.11);
 assert.ok(result.gaps.some(g => g.includes('仅提供损益表')));
});

test('search title or ticker URL never substitutes for actual security-specific original', async () => {
 const calls = [];
 const result = await prepareBriefResearch(makeSnapshot(['AAPL']), { tool: fixtureTool(calls, async (name, args) => {
  if (name === 'read' && args.url.includes('/AAPL/')) return { url: args.url, title: 'Other Company earnings', content: 'A completely different company announced quarterly earnings, revenue, margins and dividend changes. '.repeat(5) };
 }) }, new AbortController().signal, { analysisAsOf });
 assert.ok(!result.evidence.some(e => e.kind === 'news' && e.symbols.includes('AAPL')));
 assert.ok(result.coverage[0].gaps.some(g => g.includes('不能据此断言没有事件')));
});

test('unknown, stale and cached publication dates remain explicit gaps; future originals excluded', async () => {
 const calls = [];
 const result = await prepareBriefResearch(makeSnapshot(['AAPL', 'AMD', 'QQQ']), { tool: fixtureTool(calls, async (name, args) => {
  if (name !== 'read' || !args.url.includes('example.com')) return;
  const symbol = new URL(args.url).pathname.split('/')[1];
  const content = `${symbol} Public Company quarterly earnings investor relations original release. Revenue growth is uncertain, and the next earnings report will confirm current demand. `.repeat(3);
  return { url: args.url, title: `${symbol} earnings`, content, publishedAt: symbol === 'AMD' ? '2026-09-09T12:00:00Z' : symbol === 'QQQ' ? '2026-01-01T12:00:00Z' : undefined, cached: symbol === 'AAPL' };
 }) }, new AbortController().signal, { analysisAsOf });
 assert.equal(result.evidence.find(e => e.kind === 'news' && e.symbols.includes('AAPL')).publishedAt, null);
 assert.ok(result.coverage.find(c => c.symbol === 'AAPL').gaps.some(g => g.includes('发布时间未确认')));
 assert.ok(result.coverage.find(c => c.symbol === 'AAPL').gaps.some(g => g.includes('缓存')));
 assert.ok(!result.evidence.some(e => e.kind === 'news' && e.symbols.includes('AMD')));
 assert.ok(result.coverage.find(c => c.symbol === 'QQQ').gaps.some(g => g.includes('历史背景')));
});

test('unavailable sources and unsupported assets cannot be presented as completed research', async () => {
 const snapshot = makeSnapshot(['AAPL', 'OPTION']);
 snapshot.positions[1].assetType = 'OPT';
 const calls = [];
 const result = await prepareBriefResearch(snapshot, { tool: async (name, args) => { calls.push({ name, args }); throw new Error('offline'); } }, new AbortController().signal, { analysisAsOf });
 assert.equal(result.evidence.length, 0);
 assert.equal(result.coverage.find(c => c.symbol === 'AAPL').status, 'failed');
 assert.equal(result.coverage.find(c => c.symbol === 'OPTION').status, 'unsupported');
 assert.ok(!JSON.stringify(calls).includes('OPTION'));
 assert.ok(result.gaps.some(g => g.includes('不能推断当前经济周期')));
});

test('private, authenticated and irrelevant URLs are never forwarded to reader', async () => {
 const calls = [];
 const result = await prepareBriefResearch(makeSnapshot(['AAPL']), { tool: fixtureTool(calls, async name => {
  if (name === 'search') return { results: ['https://127.0.0.1/private', 'https://10.0.0.1/aapl', 'https://foo.internal/aapl', 'https://user:pass@example.com/aapl', 'https://example.com/aapl?access_token=private'].map(url => ({ url, title: 'AAPL earnings' })) };
 }) }, new AbortController().signal, { analysisAsOf });
 assert.ok(!calls.some(c => c.name === 'read' && /127\.0|10\.0|internal|access_token|user:pass/.test(c.args.url)));
 assert.ok(!result.evidence.some(e => e.kind === 'news'));
});

test('cancellation aborts active calls without continuing to model or further research', async () => {
 const controller = new AbortController();
 let observedAbort = false;
 const pending = prepareBriefResearch(makeSnapshot(['AAPL']), { tool: async (_name, _args, signal) => {
  signal.addEventListener('abort', () => { observedAbort = true; }, { once: true });
  queueMicrotask(() => controller.abort());
  return new Promise(() => {});
 } }, controller.signal, { analysisAsOf });
 await assert.rejects(pending, /BRIEF_RESEARCH_CANCELLED/);
 assert.equal(observedAbort, true);
});

test('overall deadline returns transparent partial evidence and stops source work', async () => {
 const realNow = Date.now;
 let clock = realNow(), calls = 0;
 Date.now = () => clock;
 try {
  const result = await prepareBriefResearch(makeSnapshot(['AAPL']), { tool: async () => { calls++; clock += 370000; throw new Error('slow upstream'); } }, new AbortController().signal, { analysisAsOf });
  assert.equal(calls, 1);
  assert.equal(result.coverage[0].status, 'failed');
  assert.ok(result.gaps.some(g => g.includes('6分钟上限')));
 } finally { Date.now = realNow; }
});

test('macro and focused filings precede calendar scans; excerpts stay continuous and focus on current month', async () => {
 const calls = [];
 const originalPages = new Map();
 const result = await prepareBriefResearch(makeSnapshot(['AAPL']), { tool: fixtureTool(calls, async (name, args) => {
  if (name !== 'read') return;
  const isCalendar = /calendar|schedule/.test(args.url);
  if (!isCalendar) return;
  const title = args.url.includes('/AAPL/') ? 'AAPL investor financial calendar' : 'Federal Reserve economic release schedule';
  const content = `Published Time: 2026-09-07T13:00:00Z\nTitle: ${title}\nMarkdown Content:\nJanuary 2026\n${'Earlier historical events and links. '.repeat(180)}\nSeptember 2026\n${title}. September 10, 2026: Upcoming investor and economic release events with explicit local time and confirmation.\n${'Later events and calendar notes. '.repeat(100)}`;
  originalPages.set(args.url, content);
  return { url: args.url, title, content };
 }) }, new AbortController().signal, { analysisAsOf });
 const firstEventSearch = calls.findIndex(c => c.name === 'search' && c.args.query.startsWith('AAPL'));
 assert.ok(calls.findIndex(c => c.name === 'financials') < firstEventSearch);
 assert.ok(calls.findIndex(c => c.name === 'read' && c.args.url.includes('bls.gov')) < firstEventSearch);
 const calendarEvidence = result.evidence.filter(e => originalPages.has(e.url));
 assert.ok(calendarEvidence.length >= 3);
 for (const item of calendarEvidence) {
  assert.ok(originalPages.get(item.url).includes(item.content));
  assert.match(item.content, /September 2026/);
 }
});

test('large portfolios hit bounded source budgets while retaining honest coverage rows for every symbol', async () => {
 const symbols = Array.from({ length: 40 }, (_, i) => `STK${i}`);
 const calls = [];
 const result = await prepareBriefResearch(makeSnapshot(symbols), { tool: fixtureTool(calls) }, new AbortController().signal, { analysisAsOf });
 assert.equal(result.coverage.length, symbols.length);
 assert.ok(calls.length <= 120);
 assert.ok(calls.filter(c => c.name === 'read').length <= 48);
 assert.ok(calls.filter(c => c.name === 'search').length <= 36);
 assert.ok(result.evidence.length <= 64);
 assert.ok(result.evidence.reduce((total, item) => total + item.content.length, 0) <= 85000);
 assert.ok(result.coverage.some(item => !item.areas.includes('calendar') && item.status === 'partial'));
 assert.ok(result.coverage.some(item => item.gaps.some(g => g.includes('预算'))));
});

test('empty valuation objects do not imply coverage and quote currency stays distinct from reporting currency', async () => {
 const calls = [];
 const result = await prepareBriefResearch(makeSnapshot(['QQQ']), { tool: fixtureTool(calls, async (name, args) => {
  if (name === 'profile') return { url: `https://finance.yahoo.com/quote/${args.symbol}/profile/`, name: 'QQQ Public Company', instrumentType: 'ETF', currency: 'USD', regularMarketTime: 1788897600, statistics: { forwardPE: {}, trailingPE: null, priceToBook: { raw: null } }, financials: { financialCurrency: 'EUR', totalRevenue: {}, currentPrice: { raw: 400.5 } } };
 }) }, new AbortController().signal, { analysisAsOf });
 assert.ok(!result.coverage[0].areas.includes('valuation'));
 const content = JSON.parse(result.evidence.find(e => e.kind === 'profile').content);
 assert.deepEqual(content.statistics, {});
 assert.equal(content.currency, 'USD');
 assert.equal(content.financials.financialCurrency, 'EUR');
 assert.equal(content.financials.currentPrice, 400.5);
 assert.ok(!Object.hasOwn(content.financials, 'totalRevenue'));
 assert.equal(content.regularMarketTime, 1788897600);
});

test('Fed September excerpt anchors to analysis year rather than first future-year September', async () => {
 const calls = [];
 const result = await prepareBriefResearch(makeSnapshot(['AAPL']), { tool: fixtureTool(calls, async (name, args) => {
  if (name !== 'read' || !args.url.includes('fomccalendars')) return;
  return { url: args.url, title: 'Federal Reserve FOMC Meetings calendar', content: `Federal Reserve economic calendar\n2027 FOMC Meetings\nSeptember\n20-21\n${'Other future calendar entries. '.repeat(120)}\n2026 FOMC Meetings\nJanuary\n27-28\nSeptember\n15-16\n${'Federal Reserve calendar information. '.repeat(120)}` };
 }) }, new AbortController().signal, { analysisAsOf });
 const content = result.evidence.find(e => e.url.includes('fomccalendars')).content;
 assert.match(content, /2026 FOMC Meetings/);
 assert.match(content, /15-16/);
 assert.doesNotMatch(content, /2027 FOMC Meetings/);
});

test('the latest statement is selected from actual calendar links with a future cutoff', async () => {
 const calls = [];
 const result = await prepareBriefResearch(makeSnapshot(['AAPL']), { tool: fixtureTool(calls, async (name, args) => {
  if (name !== 'read' || !args.url.includes('fomccalendars')) return;
  return { url: args.url, title: 'Federal Reserve FOMC Calendar', content: 'Federal Reserve economic and monetary policy calendar with links to actually released statements. '.repeat(3), links: [
   {url:'https://www.federalreserve.gov/newsevents/pressreleases/monetary20260128a.htm'},
   {url:'https://www.federalreserve.gov/newsevents/pressreleases/monetary20260729a.htm'},
   {url:'https://www.federalreserve.gov/newsevents/pressreleases/monetary20260916a.htm'},
   {url:'https://www.federalreserve.gov/newsevents/pressreleases/monetary20260729a1.htm'},
  ] };
 }) }, new AbortController().signal, { analysisAsOf });
 assert.ok(calls.some(c => c.name === 'read' && c.args.url.includes('monetary20260729a.htm')));
 assert.ok(!calls.some(c => c.name === 'read' && /monetary20260128|monetary20260916|monetary20260729a1/.test(c.args.url)));
 assert.ok(!calls.some(c => c.name === 'search' && c.args.query.includes('Federal Reserve latest')));
 assert.ok(result.evidence.some(e => e.url.includes('monetary20260729a.htm')));
});

test('legal navigation and historical press lists are not upcoming calendar coverage', async () => {
 const calls = [];
 const result = await prepareBriefResearch(makeSnapshot(['AMD', 'MCD', 'KO']), { tool: fixtureTool(calls, async (name, args) => {
  if (name !== 'read' || !args.url.endsWith('/calendar')) return;
  const symbol = new URL(args.url).pathname.split('/')[1];
  const content = symbol === 'KO'
   ? 'KO Public Company investor relations. Upcoming Events. Sep 9, 2026 11:15 am ET. Barclays Global Consumer Conference. '
   : symbol === 'AMD' ? 'AMD Public Company financial press releases. Aug 31, 2026. Previous quarterly earnings and investor conference. '
   : 'MCD Public Company investor navigation. Terms and Conditions. Our company. Investor relations. View our company. Accept cookies. ';
  return { url: args.url, title: `${symbol} Events`, content: content.repeat(3) };
 }) }, new AbortController().signal, { analysisAsOf });
 assert.ok(result.coverage.find(c => c.symbol === 'KO').areas.includes('calendar'));
 assert.ok(!result.coverage.find(c => c.symbol === 'AMD').areas.includes('calendar'));
 assert.ok(!result.coverage.find(c => c.symbol === 'MCD').areas.includes('calendar'));
});

test('EQUITY enrichment remains supported and failed profile preserves known issuer identity', async () => {
 const snapshot = makeSnapshot(['AAPL', 'UL']);
 snapshot.positions.forEach(p => { p.assetType = 'EQUITY'; p.instrumentType = 'EQUITY'; });
 snapshot.positions[1].name = 'Unilever PLC';
 const calls = [];
 const result = await prepareBriefResearch(snapshot, { tool: fixtureTool(calls, async (name, args) => {
  if (name === 'profile' && args.symbol === 'UL') throw new Error('upstream unavailable');
  if (name === 'read' && args.url.includes('/UL/')) return { url: args.url, title: 'UL Solutions Earnings Morningstar', content: 'UL Solutions reported quarterly revenue and earnings. The company hosts an investor conference September 10, 2026. '.repeat(3) };
 }) }, new AbortController().signal, { analysisAsOf });
 assert.ok(result.coverage.every(c => c.status !== 'unsupported'));
 assert.ok(calls.some(c => c.name === 'profile' && c.args.symbol === 'AAPL'));
 assert.ok(calls.some(c => c.name === 'search' && c.args.query.startsWith('UL Unilever')));
 assert.ok(!result.evidence.some(e => e.kind === 'news' && e.symbols.includes('UL')));
});

const cachedProfileEvidence = () => {
 const url='https://finance.yahoo.com/quote/AAPL/profile/';
 return { id:'old-profile-id',kind:'profile',symbols:['AAPL'],url,title:'AAPL cached profile',source:'finance.yahoo.com',summary:'Original public profile',read:true,fetchedAt:'2026-09-08T04:10:03.600Z',publishedAt:null,
  content:JSON.stringify({url,name:'Apple Inc.',instrumentType:'EQUITY',currency:'USD',regularMarketTime:1788552001,statistics:{forwardPE:21.1},financials:{currentPrice:319.97,financialCurrency:'USD'}}) };
};

test('failed live profile falls back only to same-day source and preserves original observation times', async () => {
 const fallback=cachedProfileEvidence(), calls=[];
 const result=await prepareBriefResearch(makeSnapshot(['AAPL']),{tool:fixtureTool(calls,async name=>{if(name==='profile')throw new Error('TOOL_SOURCE_UNAVAILABLE');})},new AbortController().signal,{analysisAsOf,fallbackEvidence:[fallback]});
 const evidence=result.evidence.find(e=>e.kind==='profile');
 assert.ok(calls.some(c=>c.name==='profile'));
 assert.equal(evidence.content,fallback.content);
 assert.equal(evidence.fetchedAt,fallback.fetchedAt);
 assert.equal(evidence.cached,true);
 assert.match(evidence.id,/^E\d+$/);
 assert.notEqual(evidence.id,fallback.id);
 assert.equal(JSON.parse(evidence.content).regularMarketTime,1788552001);
 assert.ok(result.coverage[0].gaps.some(g=>g.includes('TOOL_SOURCE_UNAVAILABLE')));
 assert.ok(result.coverage[0].gaps.some(g=>g.includes('复用同UTC日')));
 assert.equal(result.coverage[0].status,'partial');
});

test('fresh profile always wins and unsafe, stale or mismatched cache never becomes evidence', async () => {
 const valid=cachedProfileEvidence();
 const fresh=await prepareBriefResearch(makeSnapshot(['AAPL']),{tool:fixtureTool([])},new AbortController().signal,{analysisAsOf,fallbackEvidence:[valid]});
 assert.notEqual(fresh.evidence.find(e=>e.kind==='profile').cached,true);
 const bad=[
  {...valid,fetchedAt:'2026-09-07T23:59:59Z'}, {...valid,fetchedAt:'2026-09-08T13:00:00Z'}, {...valid,symbols:['AMD']}, {...valid,read:false}, {...valid,kind:'news'},
  {...valid,url:'https://finance.yahoo.com/quote/AMD/profile/'}, {...valid,content:'not json'}, {...valid,content:valid.content.replace('"forwardPE":21.1','"forwardPE":1e999')},
  {...valid,content:valid.content.replace('"currency":"USD"','"currency":"EUR"')}, {...valid,content:valid.content.replace('/AAPL/','/AMD/')},
 ];
 const failed=await prepareBriefResearch(makeSnapshot(['AAPL']),{tool:fixtureTool([],async name=>{if(name==='profile')throw new Error('secret=PRIVATE_DO_NOT_EXPOSE');})},new AbortController().signal,{analysisAsOf,fallbackEvidence:bad});
 assert.ok(!failed.evidence.some(e=>e.kind==='profile'));
 assert.doesNotMatch(JSON.stringify(failed),/PRIVATE_DO_NOT_EXPOSE/);
 assert.ok(failed.coverage[0].gaps.some(g=>g.includes('BRIEF_RESEARCH_SOURCE_FAILED')));
});

test('TradingView replacement profile has source identity and never masquerades as Yahoo', async () => {
 const result = await prepareBriefResearch(makeSnapshot(['AAPL']), { tool: fixtureTool([], async name => {
  if (name === 'profile') return { source: 'TradingView', symbol: 'AAPL', url: 'https://www.tradingview.com/symbols/NASDAQ-AAPL/', name: 'Apple Inc.', currency: 'USD', statistics: { trailingPE: 30.2 }, financials: { currentPrice: 210.5 } };
 }) }, new AbortController().signal, { analysisAsOf });
 const profile = result.evidence.find(item => item.kind === 'profile');
 assert.equal(profile.source, 'www.tradingview.com');
 assert.equal(JSON.parse(profile.content).statistics.trailingPE, 30.2);
 assert.ok(result.coverage[0].areas.includes('valuation'));
});

test('old first article does not stop discovery of a recent original; all news precedes calendars', async () => {
 const calls = [];
 const result = await prepareBriefResearch(makeSnapshot(['AAPL', 'MSFT']), { tool: fixtureTool(calls, async (name, args) => {
  if (name === 'discover' && args.area === 'news') return {results: [{url:`https://investors.example.com/${args.symbol}/old`},{url:`https://investors.example.com/${args.symbol}/recent`}]};
  if (name === 'read' && args.url.endsWith('/old')) return {url:args.url,title:'Company financial report',publishedAt:'2026-01-01T00:00:00Z',content:`${args.url.includes('AAPL')?'AAPL':'MSFT'} Public Company reported quarterly earnings and revenue. `.repeat(5)};
 }) }, new AbortController().signal, {analysisAsOf});
 assert.ok(result.coverage.every(item => item.areas.includes('news')));
 assert.ok(result.evidence.some(item => item.url.endsWith('/recent')));
 const lastNews = Math.max(...calls.map((call,i) => call.name==='discover' && call.args.area==='news' ? i : -1));
 const firstCalendar = calls.findIndex(call => call.name==='discover' && call.args.area==='calendar');
 assert.ok(firstCalendar > lastNews);
});

test('search redirect pages are rejected and failed macro does not claim successful API substitution', async () => {
 const result = await prepareBriefResearch(makeSnapshot(['AAPL']), {tool: fixtureTool([], async (name,args) => {
  if(name==='read' && args.url.includes('bls.gov')) throw new Error('PUBLIC_SOURCE_UNAVAILABLE');
  if(name==='read' && args.url.includes('example.com')) return {url:'https://www.sogou.com/link?url=opaque',title:'AAPL company earnings',publishedAt:analysisAsOf,content:'AAPL Public Company investor quarterly earnings announcement. '.repeat(10)};
 })}, new AbortController().signal, {analysisAsOf});
 assert.ok(!result.evidence.some(item=>item.source==='www.sogou.com'));
 assert.ok(!result.gaps.some(gap=>gap.includes('就业与通胀使用官方API')));
});

test('an official event page without a confirmed upcoming date records a check, never event coverage', async () => {
 const result = await prepareBriefResearch(makeSnapshot(['AAPL']), {tool: fixtureTool([], async (name,args) => {
  if(name==='discover' && args.area==='calendar') return {results:[{url:'https://investor.apple.com/events/'}]};
  if(name==='read' && args.url==='https://investor.apple.com/events/') return {url:args.url,title:'AAPL Apple Investor Relations upcoming events',content:'Apple investor relations financial events and presentations. Previously reported quarterly earnings are available in the archive. '.repeat(4)};
 })}, new AbortController().signal, {analysisAsOf});
 assert.ok(result.coverage[0].areas.includes('calendarChecked'));
 assert.ok(!result.coverage[0].areas.includes('calendar'));
 assert.ok(result.coverage[0].gaps.some(gap=>gap.includes('不代表没有事件')));
});

test('fallback loader reads at most eight recent attempts and only returns same-day public profile fields', async () => {
 const directory=await mkdtemp(path.join(tmpdir(),'brief-profile-cache-'));
 try {
  for(let i=0;i<10;i++) {
   const filename=path.join(directory,`00000000-0000-0000-0000-${i.toString(16).padStart(12,'0')}.brief-attempt.json`);
   const profile={...cachedProfileEvidence(),id:`cached-${i}`,accountKey:'PRIVATE_DO_NOT_COPY'};
   await writeFile(filename,JSON.stringify({snapshot:{accountKey:'PRIVATE_SNAPSHOT'},prompt:'PRIVATE_PROMPT',model:{key:'PRIVATE_MODEL'},research:{evidence:[profile,{...profile,kind:'news'},{...profile,kind:'profile',fetchedAt:'2026-09-07T12:00:00Z'}]}}));
   await utimes(filename,new Date(100000+i*1000),new Date(100000+i*1000));
  }
  await writeFile(path.join(directory,'state.json'),'this non-attempt file must not be parsed');
  const result=await readBriefProfileFallback(directory,analysisAsOf);
  assert.equal(result.length,8);
  assert.ok(result.every(e=>e.kind==='profile'&&e.cached));
  assert.ok(!result.some(e=>['cached-0','cached-1'].includes(e.id)));
  assert.doesNotMatch(JSON.stringify(result),/PRIVATE_/);
 } finally { await rm(directory,{recursive:true,force:true}); }
});
