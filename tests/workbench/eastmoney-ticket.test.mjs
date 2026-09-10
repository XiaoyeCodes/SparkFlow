import test from 'node:test';
import assert from 'node:assert/strict';
import { EastmoneyTicketQuotes, parseTicketQuote } from '../../server/ibkrEastmoneyTicket.ts';

const stock = { conId: 265598, symbol: 'AAPL', currency: 'USD', exchange: 'NASDAQ' };
const now = Date.parse('2026-09-10T06:00:00Z');
const raw = { rc: 0, data: { f57: 'AAPL', f43: 315.34, f60: 316.22, f86: 1788984000 } };

test('Eastmoney keeps source time and does not synthesize missing market depth', () => {
  const quote = parseTicketQuote(raw, stock, now);
  assert.equal(quote.last, '315.34');
  assert.equal(quote.asOf, '2026-09-09T20:00:00.000Z');
  assert.equal(quote.state, 'reference');
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
  assert.equal(calls,3);
});

test('Eastmoney depth maps nearest ask from f39 and preserves raw quantities', () => {
  const quote = parseTicketQuote({rc:0,data:{...raw.data,f19:100,f20:2,f17:99,f18:3,f15:98,f16:4,f39:101,f40:5,f37:102,f38:6,f35:103,f36:7,f31:105}},stock,now);
  assert.deepEqual(quote.bids.map(row=>row.price),['100','99','98']);
  assert.deepEqual(quote.asks.map(row=>row.price),['101','102','103']);
  assert.equal(quote.ask,'101');
  assert.deepEqual(quote.asks.map(row=>row.size),['5','6','7']);
});

test('Eastmoney unknown venues require a unique matching symbol', async () => {
  const smart = {...stock,exchange:'SMART'};
  const unique = new EastmoneyTicketQuotes(async url=>new URL(url).searchParams.get('secid')==='105.AAPL'?raw:{rc:0,data:null});
  assert.equal((await unique.quote(smart)).symbol,'AAPL');
  const ambiguous = new EastmoneyTicketQuotes(async()=>raw);
  await assert.rejects(ambiguous.quote(smart),/匹配不唯一/);
  await assert.rejects(unique.quote({...stock,currency:'CNY'}),/仅支持/);
});
