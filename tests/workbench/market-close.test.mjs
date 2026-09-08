import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { closeSchedule, closeSessionDue } from '../../server/marketCloseCalendar.ts';
import { parseEastmoneyClose, parseYahooClose, yicaiArticle, collectCloseResearch } from '../../server/marketCloseData.ts';
import { closeMarkdown, createMarketCloseService } from '../../server/marketCloseService.ts';

test('close schedule follows exchange holidays, DST and early closes', () => {
  assert.equal(closeSessionDue('cn', '2026-09-08').toISOString(), '2026-09-08T07:10:00.000Z');
  for (const date of ['2026-09-25', '2026-10-01', '2026-09-06']) assert.equal(closeSessionDue('cn', date), null);
  assert.equal(closeSessionDue('us', '2026-09-07'), null);
  assert.equal(closeSessionDue('us', '2026-09-08').toISOString(), '2026-09-08T20:10:00.000Z');
  assert.equal(closeSessionDue('us', '2026-01-06').toISOString(), '2026-01-06T21:10:00.000Z');
  assert.equal(closeSessionDue('us', '2026-11-27').toISOString(), '2026-11-27T18:10:00.000Z');
  assert.equal(closeSchedule('cn', new Date('2026-09-08T07:09:59Z')).dueDate, '2026-09-07');
  assert.equal(closeSchedule('cn', new Date('2026-09-08T07:10:00Z')).dueDate, '2026-09-08');
  assert.equal(closeSchedule('cn', new Date('2027-01-04T08:00:00Z')).calendarSupported, false);
});
const index = { name: '上证指数', symbol: '1.000001', date: '2026-09-08', close: 100, change: 1, changePercent: 1.01, sourceUrl: 'https://quote.eastmoney.com/zs000001.html' };
const research = { indices: [index], sources: [{ id: 'S1', title: '指数收盘', url: index.sourceUrl, publishedAt: '2026-09-08', fetchedAt: '2026-09-08T07:11:00Z', content: JSON.stringify(index) }], gaps: ['测试缺口'] };
const point = { text: '沪指收涨，后续关注上涨能否延续。', sources: ['S1'] };
const response = JSON.stringify({ overview: [point], sectors: [], news: [], outlook: [point], risks: [point] });
test('index parsing refuses stale or missing closes and calculates US change from prior session', () => {
  const raw = JSON.stringify({ data: { klines: ['2026-09-08,99,100,101,98,123,1,1,1.01,1,1'] } });
  assert.equal(parseEastmoneyClose(raw, index.symbol, index.name, index.date).close, 100);
  assert.throws(() => parseEastmoneyClose(raw, index.symbol, index.name, '2026-09-09'));
  const yahoo = JSON.stringify({ chart: { result: [{ timestamp: [Date.parse('2026-09-04T13:30:00Z') / 1000, Date.parse('2026-09-08T13:30:00Z') / 1000], indicators: { quote: [{ close: [100, 105] }] } }] } });
  assert.equal(parseYahooClose(yahoo, '^GSPC', '标普500', '2026-09-08').change, 5);
  assert.throws(() => parseYahooClose(yahoo, '^GSPC', '标普500', '2026-09-09'));
});
test('Markdown has deterministic index table, all sections and valid evidence links', () => {
  const markdown = closeMarkdown('cn', '2026-09-08', response, research);
  for (const text of ['100.00', '+1.01%', '主要指数收盘', '市场概况', '热点板块', '重要新闻', '后市展望', '风险提示', '不构成投资建议', '测试缺口']) assert.ok(markdown.includes(text));
  assert.throws(() => closeMarkdown('cn', '2026-09-08', response.replaceAll('S1', 'FAKE'), research));
  assert.throws(() => closeMarkdown('cn', '2026-09-08', response.slice(0, -3), research));
});
test('source extraction reads original article body and rejects a title-only page', () => {
  const html = '<h1>收盘报道</h1><div id="multi-text" class="f-cb"><p>油气板块上涨，科技板块回落。</p><div id="jb_report">举报</div>';
  assert.equal(yicaiArticle(html).text, '油气板块上涨，科技板块回落。');
  assert.equal(yicaiArticle('<h1>没有原文</h1>').text, '');
});
test('US uses dated alternate indices when Yahoo fails without confusing Nasdaq mappings', async () => {
  const requested = [];
  const result = await collectCloseResearch('us', '2026-09-04', async url => {
    requested.push(url);
    if (url.includes('yahoo.com')) throw new Error('HTTP 403');
    if (url.includes('kline/get')) return JSON.stringify({ data: { klines: ['2026-09-04,99,100,101,98,123,1,1,1.01,1,1'] } });
    if (url.includes('flash_newest')) return 'var newest = [];';
    return '<html></html>';
  });
  assert.equal(result.indices.length, 3);
  assert.ok(requested.some(url => url.includes('secid=100.NDX')));
  assert.equal(result.indices.find(row => row.symbol === '^IXIC').name, '纳斯达克综合指数');
  assert.equal(result.indices.some(row => row.symbol === '^NDX'), false);
});
test('single model call is persisted, deduplicated across restart, and holidays do not trigger', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'sparkflow-close-'));
  let calls = 0;
  const options = { stateDir: dir, clock: () => new Date('2026-09-08T07:12:00Z'), collect: async () => research, model: async () => ({ model: 'fixture', provider: 'test', invoke: async () => { calls++; return response; } }) };
  try {
    const service = createMarketCloseService(options);
    await Promise.all([service.generate('cn'), service.generate('cn')]);
    assert.equal(calls, 1); assert.equal((await service.state('cn')).status, 'complete');
    const restarted = createMarketCloseService(options); await restarted.generate('cn'); assert.equal(calls, 1);
    assert.ok(JSON.parse(await readFile(path.join(dir, 'market-close/cn-2026-09-08.json'), 'utf8')).markdown);
    const holiday = createMarketCloseService({ ...options, clock: () => new Date('2026-09-25T08:00:00Z') }); await holiday.tick(); assert.equal(calls, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('missing data does not call AI; format failures preserve prior report', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'sparkflow-close-'));
  let calls = 0, now = new Date('2026-09-08T07:12:00Z'), raw = response, data = research;
  const options = { stateDir: dir, clock: () => now, collect: async () => data, model: async () => ({ model: 'fixture', provider: 'test', invoke: async () => { calls++; return raw; } }) };
  try {
    const service = createMarketCloseService(options); await service.generate('cn');
    now = new Date('2026-09-09T07:12:00Z'); data = { ...research, indices: [] }; await service.generate('cn');
    assert.equal(calls, 1); assert.equal((await service.state('cn')).status, 'failed');
    data = research; raw = '{broken'; await service.generate('cn');
    const state = await service.state('cn'); assert.equal(state.report.date, '2026-09-08'); assert.equal(state.status, 'failed'); assert.match(state.error, /格式不完整/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
