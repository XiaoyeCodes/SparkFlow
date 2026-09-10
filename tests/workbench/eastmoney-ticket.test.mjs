import test from 'node:test';
import assert from 'node:assert/strict';
import { EastmoneyTicketQuotes, mergeBrokerTicketQuote, parseTencentTicketQuote, parseTicketQuote } from '../../server/ibkrEastmoneyTicket.ts';

const stock = { conId: 265598, symbol: 'AAPL', currency: 'USD', exchange: 'NASDAQ' };
const now = Date.parse('2026-09-10T06:00:00Z');
const raw = { rc: 0, data: { f57: 'AAPL', f43: 315.34, f60: 316.22, f86: 1788984000, f114: 42.27, f115: 36.16 } };

test('Eastmoney keeps source time and does not synthesize missing market depth', () => {
  const quote = parseTicketQuote(raw, stock, now);
  assert.equal(quote.last, '315.34');
  assert.equal(quote.asOf, '2026-09-09T20:00:00.000Z');
  assert.equal(quote.state, 'reference');
  assert.equal(quote.peDynamic, '36.16');
  assert.equal(quote.peStatic, '42.27');
  assert.equal(quote.bid, null);
  assert.equal(quote.ask, null);
  assert.equal(quote.bids.length, 3);
  assert.ok([...quote.bids, ...quote.asks].every(row => row.price === null && row.size === null));
  const invalid = parseTicketQuote({ rc: 0, data: { f57:'AAPL', f43:'-', f60:-1, f19:0, f20:50, f86:now/1000+3600 } },stock,now);
  assert.equal(invalid.state, 'missing');
  assert.equal(invalid.asOf, null);
  assert.equal(invalid.bids[0].size, null);
  assert.throws(()=>parseTicketQuote({...raw,data:{...raw.data,f57:'MSFT'}},stock,now));
});

test('Eastmoney cache coalesces concurrent refreshes and preserves quote time on failure', async t => {
  let clock = now, calls = 0, fail = false;
  t.mock.method(Date, 'now', ()=>clock);
  const provider = new EastmoneyTicketQuotes(async url => {
    calls++;
    assert.equal(new URL(url).searchParams.get('secid'),'105.AAPL');
    assert.ok(new URL(url).searchParams.get('fields').split(',').includes('f530'));
    if (fail) throw new Error('upstream unavailable');
    return raw;
  });
  const [first, second] = await Promise.all([provider.quote(stock),provider.quote(stock)]);
  assert.equal(calls,1); assert.deepEqual(first,second);
  await provider.quote(stock); assert.equal(calls,1);
  clock+=5000; fail=true;
  const stale = await provider.quote(stock);
  assert.equal(stale.state,'stale'); assert.equal(stale.last,first.last);
  assert.equal(stale.asOf,first.asOf); assert.equal(stale.fetchedAt,first.fetchedAt);
  clock+=5000; fail=false;
  assert.equal((await provider.quote(stock)).state,'reference');
  assert.equal(calls,4);
});

test('Eastmoney depth maps nearest ask from f39 and preserves raw quantities', () => {
  const quote = parseTicketQuote({rc:0,data:{...raw.data,f19:100,f20:2,f17:99,f18:3,f15:98,f16:4,f39:101,f40:5,f37:102,f38:6,f35:103,f36:7,f31:105}},stock,now);
  assert.deepEqual(quote.bids.map(row=>row.price),['100','99','98']);
  assert.deepEqual(quote.asks.map(row=>row.price),['101','102','103']);
  assert.equal(quote.ask,'101');
  assert.deepEqual(quote.asks.map(row=>row.size),['5','6','7']);
});

test('IBKR top of book replaces public order-entry prices while public fundamentals remain available', () => {
  const reference = parseTicketQuote({rc:0,data:{...raw.data,f19:314,f20:2,f39:315,f40:3,f46:313,f47:12345}},stock,now);
  const merged = mergeBrokerTicketQuote(reference, {...stock,bid:'320.10',ask:'320.20',last:'320.15',close:null,high:null,low:null,minTick:'0.01',state:'realtime',regularHours:true,nextOpen:null,fetchedAt:'2026-09-10T06:00:01Z',source:'IBKR Gateway',detail:''});
  assert.equal(merged.bid,'320.10');
  assert.equal(merged.ask,'320.20');
  assert.equal(merged.last,'320.15');
  assert.equal(merged.bids[0].price,'320.10');
  assert.equal(merged.bids[0].size,null);
  assert.ok(merged.bids.slice(1).every(level=>level.price===null));
  assert.equal(merged.open,'313');
  assert.equal(merged.peDynamic,'36.16');
  assert.match(merged.source,/IBKR Gateway/);
  assert.strictEqual(mergeBrokerTicketQuote(reference,{...merged,conId:999}),reference);
});

test('Eastmoney unknown venues require a unique matching symbol', async () => {
  const smart = {...stock,exchange:'SMART'};
  const unique = new EastmoneyTicketQuotes(async url=>new URL(url).searchParams.get('secid')==='105.AAPL'?raw:{rc:0,data:null});
  assert.equal((await unique.quote(smart)).symbol,'AAPL');
  const ambiguous = new EastmoneyTicketQuotes(async()=>raw);
  await assert.rejects(ambiguous.quote(smart),/匹配不唯一/);
  await assert.rejects(unique.quote({...stock,currency:'CNY'}),/仅支持/);
});

test('quote falls back to a verified Tencent USD listing when Eastmoney is unavailable', async () => {
  const row = Array(70).fill('');
  Object.assign(row, { 1:'苹果', 2:'AAPL.OQ', 3:'322.85', 4:'315.34', 5:'316.67', 6:'23720305', 30:'2026-09-10 11:25:21', 33:'323.37', 34:'316.57', 35:'USD', 37:'7596720953', 39:'37.02', 41:'43.28', 46:'Apple Inc.' });
  const backup = {code:0,data:{usAAPL:{qt:{usAAPL:row}}}};
  const parsed = parseTencentTicketQuote(backup,stock,Date.parse('2026-09-10T16:00:00Z'));
  assert.equal(parsed.last,'322.85');
  assert.equal(parsed.close,'315.34');
  assert.equal(parsed.open,'316.67');
  assert.equal(parsed.high,'323.37');
  assert.equal(parsed.low,'316.57');
  assert.equal(parsed.volume,'23720305');
  assert.equal(parsed.amount,'7596720953');
  assert.equal(parsed.peDynamic,'37.02');
  assert.equal(parsed.peStatic,'43.28');
  assert.equal(parsed.asOf,'2026-09-10T15:25:21.000Z');
  assert.equal(parsed.source,'腾讯财经（备用）');
  assert.ok(parsed.bids.every(level=>level.price===null));

  const provider = new EastmoneyTicketQuotes(async url => url.includes('push2.eastmoney.com') ? Promise.reject(new Error('blocked')) : backup);
  assert.equal((await provider.quote(stock)).source,'腾讯财经（备用）');
  assert.throws(()=>parseTencentTicketQuote({code:0,data:{usAAPL:{qt:{usAAPL:[...row.slice(0,35),'HKD',...row.slice(36)]}}}},stock));
  assert.throws(()=>parseTencentTicketQuote({code:0,data:{usAAPL:{qt:{usAAPL:Object.assign([...row],{2:'MSFT.OQ'})}}}},stock));
});
