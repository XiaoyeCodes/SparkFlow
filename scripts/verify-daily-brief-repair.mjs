import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import { runDailyBriefRepairs } from '../server/dailyBriefRepair.ts';
import { fillBriefGaps, createDailyBriefRepairTasks } from '../server/dailyBriefRepairTasks.ts';
import { createDailyBriefService } from '../server/dailyBriefService.ts';
import { dailyBriefEditionDate, isCurrentDailyBrief } from '../src/lib/dailyBriefFreshness.ts';

const date = '2026-09-14';
let now = Date.parse(`${date}T02:00:00Z`);
const metric = value => ({ value, display: value == null ? '暂无数据' : String(value), status: value == null ? 'unavailable' : 'delayed', source: 'fixture', sourceUrl: 'https://example.com' });
const base = () => ({ version: 18, date, slot: 'morning', generatedAt: `${date}T01:00:00Z`, updatedAt: `${date}T01:00:00Z`,
  summaryMode: 'rules', summary: { headline: 'frozen', regime: 'test', tone: 'balanced', highlights: [], risks: [], watchlist: [], portfolioNotes: [] },
  markets: [], macro: [], news: [], sources: [], errors: [], portfolio: { connected: false, positions: [] },
  editorial: { stocks: [], indices: [], crypto: [], assetGroups: [], macroAssets: [], marketSeries: [], events: [],
    sentiment: { vix: metric(15), cryptoFearGreed: metric(50), stockFearGreed: metric(50), mvrvZScore: metric(null), lthSupplyRatio: metric(null), sopr: metric(null), stockComponents: [], cryptoHistory: [] },
    onchain: { sopr: metric(null), lthSopr: metric(null), wma200Multiple: metric(null), puellMultiple: metric(null), fundingRate: metric(null), openInterest: metric(null), dominance: metric(null) },
    signals: { top: null, bottom: null, coverage: 25, methodology: 'fixture' } } });
assert.equal(dailyBriefEditionDate(Date.parse('2026-09-15T00:59:59Z')), date);
assert.equal(dailyBriefEditionDate(Date.parse('2026-09-15T01:00:00Z')), '2026-09-15');
assert.ok(isCurrentDailyBrief(base(), Date.parse('2026-09-15T00:59:59Z')));
assert.equal(isCurrentDailyBrief(base(), Date.parse('2026-09-15T01:00:00Z')), false);
assert.deepEqual(fillBriefGaps([{ symbol: 'A', price: 10, history: [] }], [{ symbol: 'A', price: 11, history: [{ time: 'x', value: 1 }] }]), [{ symbol: 'A', price: 10, history: [{ time: 'x', value: 1 }] }]);
assert.equal(fillBriefGaps(metric(null), metric(0)).value, 0, 'zero is valid');

let state = base(), fail = true, concurrent = 0, peak = 0;
const calls = {};
const tasks = ['success', 'failure', 'ready', 'invalid', 'blocked'].map(id => ({ id, label: id,
  needed: s => !s[id], blocked: () => id === 'blocked' ? 'missing key' : undefined,
  load: async () => {
    calls[id] = (calls[id] || 0) + 1; concurrent++; peak = Math.max(peak, concurrent);
    await new Promise(resolve => setTimeout(resolve, 5)); concurrent--;
    if (id === 'failure' && fail) throw new Error('network');
    return draft => { draft[id] = 1; if (id === 'invalid') throw new Error('invalid'); };
  } }));
state.ready = 1;
const run = () => runDailyBriefRepairs({ tasks, get: () => state, commit: async change => change(state), now: () => now });
await run();
assert.equal(peak, 2); assert.equal(calls.ready, undefined); assert.equal(calls.blocked, undefined);
assert.equal(state.success, 1); assert.equal(state.invalid, undefined, 'invalid patch is atomic');
assert.equal(state.repair.failure.state, 'failed'); assert.equal(state.repair.blocked.state, 'blocked');
await run(); assert.equal(calls.failure, 1, 'backoff skips failed source');
now += 31_000; fail = false; await run();
assert.equal(calls.success, 1); assert.equal(calls.failure, 2); assert.equal(state.failure, 1);
assert.equal(state.repair.failure.nextRetryAt, undefined);

// Source task selection: missing asset history invokes that symbol only and retains valid daily prices.
state = base(); state.editorial.assetGroups = [{ id: 'technology', items: [{ symbol: 'QQQ', name: 'QQQ', price: 99, changePercent: 1, history: [] }] }];
const requests = [];
const loaders = { yahooConfigs: [{ symbol: 'QQQ', displaySymbol: 'QQQ', name: 'QQQ', kind: 'asset' }],
  yahoo: async (symbol, range) => { requests.push([symbol, range]); return { price: 101, changePercent: 2, change: 1, sourceUrl: 'https://example.com', history: [{ time: 'x', value: 101 }] }; } };
const yahoo = createDailyBriefRepairTasks(loaders).find(t => t.id === 'yahoo:QQQ');
assert.ok(yahoo.needed(state)); (await yahoo.load(state))(state);
assert.equal(yahoo.needed(state), false); assert.equal(state.editorial.assetGroups[0].items[0].price, 99);
assert.deepEqual(requests, [['QQQ', '3mo']]);

// Run the actual selective crypto loader with synthetic transport (no upstream traffic).
const configSource = await readFile(new URL('../vite.config.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('vite.config.ts', configSource, ts.ScriptTarget.Latest, true);
const cryptoFunction = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'fetchEditorialCryptoData');
assert.ok(cryptoFunction);
const compiled = ts.transpileModule(cryptoFunction.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
let transportBody = '[]';
const cryptoRequests = [];
const cryptoLoader = new Function('fetchRoutedText', 'finiteNumber', 'round', 'editorialMetric', 'editorialAssetDisplay', `${compiled}; return fetchEditorialCryptoData;`)(
  async url => { cryptoRequests.push(url); return transportBody; },
  value => value == null || !Number.isFinite(Number(value)) ? null : Number(value),
  (value, digits) => Number(value.toFixed(digits)),
  (value, display) => ({ ...metric(value), display }), (_symbol, value) => String(value ?? '—'));
transportBody = JSON.stringify([{ buyVol: '4', sellVol: '2' }]);
const previous = base().editorial;
previous.crypto = [{ symbol: 'BTC', name: 'BTC', price: 50, history: [{ time: date, value: 50 }] }];
previous.derivativeInputs = { markPrice: 50, contracts: 100 };
const taker = await cryptoLoader([4], previous);
assert.equal(cryptoRequests.length, 1); assert.match(cryptoRequests[0], /takerlongshortRatio/);
assert.equal(taker.derivativesSentiment.takerBuySellRatio, 2);
assert.equal(taker.crypto.find(q => q.symbol === 'BTC').price, 50);
assert.equal(taker.openInterest.value, 5000, 'dependent inputs survive independent repair');
cryptoRequests.length = 0;
transportBody = JSON.stringify(Array.from({ length: 40 }, (_, index) => [Date.parse(date) + index * 86400_000, 50, 52, 48, 50 + index / 10, 10]));
const historyOnly = await cryptoLoader([10], base().editorial);
assert.equal(cryptoRequests.length, 1); assert.match(cryptoRequests[0], /klines\?symbol=BTCUSDT/);
assert.equal(historyOnly.crypto.find(q => q.symbol === 'BTC').history.length, 40, 'history survives failed spot quote');
assert.ok(historyOnly.btcTechnical);

// Real disk service: simultaneous visitors share repair; restart reuses repaired edition.
const root = await mkdtemp(path.join(tmpdir(), 'sparkflow-brief-repair-'));
let generations = 0, loads = 0, release;
const task = { id: 'one', label: 'one', needed: s => !s.news.length, load: async () => {
  loads++; await new Promise(resolve => { release = resolve; }); return draft => { draft.news = [{ id: 'n', title: 'repaired', source: 'test', category: 'test', url: 'https://example.com' }]; };
} };
const until = async predicate => { for (let i = 0; i < 200; i++) { if (await predicate()) return; await new Promise(r => setTimeout(r, 5)); } throw new Error('timed out'); };
try {
  const service = createDailyBriefService({ stateDir: root, now: () => new Date(now), generate: async () => { generations++; return base(); }, repairTasks: () => [task] });
  const pages = await Promise.all(Array.from({ length: 6 }, () => service.getForPage()));
  await until(() => Boolean(release)); assert.equal(loads, 1); assert.equal(generations, 1);
  assert.equal(pages[0].snapshot.news.length, 0, 'cache returned before slow missing source');
  release();
  await until(async () => (await service.latest())?.news.length === 1);
  const file = path.join(root, 'daily-brief', date, 'morning.json');
  const stored = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(stored.repair.one.state, 'ready'); assert.equal(stored.generatedAt, base().generatedAt);
  assert.equal(stored.updatedAt, new Date(now).toISOString()); assert.equal(stored.summary.headline, 'frozen');
  const restart = createDailyBriefService({ stateDir: root, now: () => new Date(now), generate: async () => { throw new Error('must use cache'); }, repairTasks: () => [task] });
  assert.equal((await restart.getForPage()).snapshot.news[0].title, 'repaired'); assert.equal(loads, 1);

  // An in-flight yesterday repair cannot write after the 09:00 edition boundary.
  release = undefined;
  const late = createDailyBriefService({ stateDir: root, now: () => new Date(now), generate: async () => base(),
    repairTasks: () => [{ ...task, id: 'late', needed: s => !s.macro.length, load: async () => {
      await new Promise(resolve => { release = resolve; }); return draft => { draft.macro = [{ id: 'invalid-late' }]; };
    } }] });
  await late.getForPage(); await until(() => Boolean(release));
  now = Date.parse('2026-09-15T01:00:00Z'); release();
  await new Promise(r => setTimeout(r, 50));
  assert.equal(JSON.parse(await readFile(file, 'utf8')).macro.length, 0);
} finally { await rm(root, { recursive: true, force: true }); }
console.log('Daily brief repair: 09:00 boundary, field isolation, bounded concurrency, failure backoff, blocked configuration, disk persistence, cross-visitor deduplication and obsolete-write protection passed.');
