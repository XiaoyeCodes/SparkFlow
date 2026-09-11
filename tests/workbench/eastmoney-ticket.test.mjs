import test from 'node:test';
import assert from 'node:assert/strict';
import { EastmoneyTicketQuotes, mergeBrokerTicketQuote, parseTencentTicketQuote, parseTicketQuote } from '../../server/ibkrEastmoneyTicket.ts';

const stock = { conId: 265598, symbol: 'AAPL', currency: 'USD', exchange: 'NASDAQ' };
const now = Date.parse('2026-09-10T06:00:00Z');
const raw = { rc: 0, data: { f57: 'AAPL', f43: 315.34, f60: 316.22, f86: 1788984000, f162: 36.16, f163: 42.27, f164: 38.12 } };

test('Eastmoney keeps source time without exposing unsupported market depth', () => {
  const quote = parseTicketQuote(raw, stock, now);
  assert.equal(quote.last, '315.34');
  assert.equal(quote.asOf, '2026-09-09T20:00:00.000Z');
  assert.equal(quote.state, 'reference');
  assert.equal(quote.peDynamic, '36.16');
  assert.equal(quote.peStatic, '42.27');
  assert.equal(quote.bid, null);
  assert.equal(quote.ask, null);
  const invalid = parseTicketQuote({ rc: 0, data: { f57:'AAPL', f43:'-', f60:-1, f19:0, f20:50, f86:now/1000+3600 } },stock,now);
  assert.equal(invalid.state, 'missing');
  assert.equal(invalid.asOf, null);
  assert.throws(()=>parseTicketQuote({...raw,data:{...raw.data,f57:'MSFT'}},stock,now));
});

test('Eastmoney cache coalesces concurrent refreshes and preserves quote time on failure', async t => {
  let clock = now, calls = 0, fail = false;
  t.mock.method(Date, 'now', ()=>clock);
  const provider = new EastmoneyTicketQuotes(async url => {
    calls++;
    assert.equal(new URL(url).searchParams.get('secid'),'105.AAPL');
    assert.ok(!new URL(url).searchParams.get('fields').split(',').includes('f530'));
    for (const field of ['f162', 'f163', 'f164']) assert.ok(new URL(url).searchParams.get('fields').split(',').includes(field));
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

test('Eastmoney ignores undocumented US depth fields', () => {
  const quote = parseTicketQuote({rc:0,data:{...raw.data,f19:100,f20:2,f17:99,f18:3,f15:98,f16:4,f39:101,f40:5,f37:102,f38:6,f35:103,f36:7,f31:105}},stock,now);
  assert.equal(quote.bid,null);
  assert.equal(quote.ask,null);
  assert.equal('bids' in quote,false);
  assert.equal('asks' in quote,false);
});

test('IBKR top of book replaces public order-entry prices while public fundamentals remain available', () => {
  const reference = parseTicketQuote({rc:0,data:{...raw.data,f19:314,f20:2,f39:315,f40:3,f46:313,f47:12345}},stock,now);
  const merged = mergeBrokerTicketQuote(reference, {...stock,bid:'320.10',ask:'320.20',last:'320.15',close:null,high:null,low:null,minTick:'0.01',state:'realtime',regularHours:true,nextOpen:null,fetchedAt:'2026-09-10T06:00:01Z',source:'IBKR Gateway',detail:''});
  assert.equal(merged.bid,'320.10');
  assert.equal(merged.ask,'320.20');
  assert.equal(merged.last,'320.15');
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
  assert.equal(parsed.peRatio,'37.02');
  assert.equal(parsed.peDynamic,null);
  assert.equal(parsed.peTtm,'37.02');
  assert.equal(parsed.peStatic,'43.28');
  assert.equal(parsed.asOf,'2026-09-10T15:25:21.000Z');
  assert.equal(parsed.source,'腾讯财经（备用）');
  assert.equal('bids' in parsed,false);

  const provider = new EastmoneyTicketQuotes(async url => url.includes('push2.eastmoney.com') ? Promise.reject(new Error('blocked')) : backup);
  assert.equal((await provider.quote(stock)).source,'腾讯财经（备用）');
  assert.throws(()=>parseTencentTicketQuote({code:0,data:{usAAPL:{qt:{usAAPL:[...row.slice(0,35),'HKD',...row.slice(36)]}}}},stock));
  assert.throws(()=>parseTencentTicketQuote({code:0,data:{usAAPL:{qt:{usAAPL:Object.assign([...row],{2:'MSFT.OQ'})}}}},stock));
});

function tencentRaw(symbol = 'AAPL', ratio = '37.45') {
  const row = Array(70).fill('');
  Object.assign(row, { 2:`${symbol}.OQ`, 3:'326.57', 4:'315.34', 5:'316.67', 30:'2026-09-10 16:00:01', 35:'USD', 39:ratio, 41:'43.78' });
  return {code:0,data:{[`us${symbol}`]:{qt:{[`us${symbol}`]:row}}}};
}

test('Tencent US dynamic PE reads official dynamic_ratio field 65 without financial requests or calculation', async () => {
  // Official mobile adapter: secu_quote.dynamic_ratio=e[65], lyr_ratio=e[41].
  for (const [symbol,price,ttm,staticPe,dynamic] of [
    ['AAPL','326.57','37.45','43.78','35.60'],
    ['MSFT','492.44','27.43','27.43','27.43'],
    ['NVDA','218.36','27.61','44.56','22.51'],
  ]) {
    const raw=tencentRaw(symbol,ttm);
    Object.assign(raw.data[`us${symbol}`].qt[`us${symbol}`],{3:price,41:staticPe,65:dynamic});
    let calls=0;
    const service=new EastmoneyTicketQuotes(async url=>{calls++;assert.match(url,/\/appstock\/app\/usfqkline\/get\?/);return raw;});
    const quote=await service.quote({...stock,symbol},'tencent');
    assert.equal(quote.peDynamic,dynamic);assert.equal(quote.peTtm,ttm);assert.equal(quote.peStatic,staticPe);
    assert.equal(quote.peDynamicBasis,undefined);assert.equal(calls,1);
  }
  for (const value of ['-134.71','0','-',null,'',undefined,'Infinity']) {
    const raw=tencentRaw();raw.data.usAAPL.qt.usAAPL[65]=value;
    const quote=parseTencentTicketQuote(raw,stock);
    assert.equal(quote.peDynamic,value==='-134.71'?'-134.71':null);
    assert.equal(quote.peStatic,'43.78');assert.equal(quote.peTtm,'37.45');
  }
});

test('Tencent US static PE uses row 41, independently of TTM and annual EPS source revisions', () => {
  // Cross-checks against Tencent finDetail/search annual diluted EPS, 2026-09-11.
  for (const sample of [
    {symbol:'MSFT',price:492.44,ttm:27.43,staticPe:27.43,eps:17.95},
    {symbol:'NVDA',price:218.36,ttm:27.61,staticPe:44.56,eps:4.90},
    {symbol:'TSLA',price:363.56,ttm:336.63,staticPe:336.63,eps:1.08},
  ]) {
    const payload=tencentRaw(sample.symbol,String(sample.ttm));
    Object.assign(payload.data[`us${sample.symbol}`].qt[`us${sample.symbol}`],{3:String(sample.price),41:String(sample.staticPe)});
    const quote=parseTencentTicketQuote(payload,{...stock,symbol:sample.symbol});
    assert.equal(quote.peTtm,String(sample.ttm));
    assert.equal(quote.peStatic,String(sample.staticPe));
    assert.equal(quote.peDynamic,null);
    assert.ok(Math.abs(sample.price/sample.eps-sample.staticPe)<0.01);
  }
  const apple=parseTencentTicketQuote(tencentRaw(),stock);
  assert.equal(apple.peStatic,'43.78'); // Retain upstream PE, not 326.57 / a separately rounded annual EPS.
  for(const value of ['-290.55','0','-',null,'',undefined,'Infinity']){
    const payload=tencentRaw('SPCX','-134.71');
    payload.data.usSPCX.qt.usSPCX[41]=value;
    const quote=parseTencentTicketQuote(payload,{...stock,symbol:'SPCX'});
    assert.equal(quote.peTtm,'-134.71');
    assert.equal(quote.peStatic,value==='-290.55'?'-290.55':null);
  }
});

test('explicit source selection isolates quote caches and never silently switches provider', async () => {
  const calls=[];
  const provider=new EastmoneyTicketQuotes(async url=>{calls.push(url);return url.includes('eastmoney')?raw:tencentRaw();});
  const qq=await provider.quote(stock,'tencent');
  assert.equal(qq.source,'腾讯财经');assert.equal(qq.last,'326.57');assert.equal(calls.length,1);
  assert.ok(calls.every(url=>new URL(url).hostname==='web.ifzq.gtimg.cn'));
  const em=await provider.quote(stock,'eastmoney');
  assert.equal(em.source,'东方财富');assert.equal(em.last,'315.34');assert.equal(calls.length,2);
  assert.equal((await provider.quote(stock,'tencent')).last,'326.57');assert.equal(calls.length,2);
  const missing=new EastmoneyTicketQuotes(async url=>{assert.ok(url.includes('eastmoney'));return {rc:0,data:{...raw.data,f162:0,f163:0,f164:0}};});
  assert.equal((await missing.quote(stock,'eastmoney')).peRatio,undefined);
  const failed=new EastmoneyTicketQuotes(async()=>{throw new Error('offline');});
  await assert.rejects(failed.quote(stock,'tencent'));
  await assert.rejects(failed.quote(stock,'eastmoney'));
});

test('stock/get PE uses the provider website fields, preserving negative ratios', () => {
  // Actual stock/get field shape: the old f114/f115 fields may be zero, while
  // f163/f164 contain valid data. Dynamic, static and TTM are separate series.
  const quote = parseTicketQuote({rc:0,data:{f57:'SPCX',f43:148.18,f46:145,f114:0,f115:0,f162:0,f163:-395.64,f164:-237.68}}, {...stock,symbol:'SPCX'}, now);
  assert.equal(quote.peDynamic,null);
  assert.equal(quote.peStatic,'-395.64');
  assert.equal(quote.peTtm,'-237.68');
  assert.equal(quote.open,'145');
  const negative = parseTicketQuote({rc:0,data:{...raw.data,f162:-10,f163:-20,f164:-30,f43:-1}}, stock, now);
  assert.equal(negative.peDynamic,'-10');
  assert.equal(negative.last,null); // Price validation must stay positive-only.
  const oldFields = parseTicketQuote({rc:0,data:{f57:'AAPL',f114:42,f115:36}},stock,now);
  assert.equal(oldFields.peDynamic,null);
  assert.equal(oldFields.peStatic,null);
  for (const missing of [0, '0.0', '-', '', ' ', null, undefined, false, NaN, Infinity]) {
    const invalid = parseTicketQuote({rc:0,data:{...raw.data,f162:missing,f163:missing,f164:missing}}, stock, now);
    assert.equal(invalid.peDynamic,null);
    assert.equal(invalid.peStatic,null);
    assert.equal(invalid.peTtm,null);
  }
  assert.equal(parseTencentTicketQuote(tencentRaw('SPCX','-134.71'),{...stock,symbol:'SPCX'},now).peRatio,'-134.71');
});

test('missing primary PE is enriched without replacing primary prices, static PE or timestamps', async () => {
  let calls = 0;
  const provider = new EastmoneyTicketQuotes(async url => {
    calls++;
    return url.includes('push2.eastmoney.com') ? {rc:0,data:{...raw.data,f162:0,f164:'-'}} : tencentRaw();
  });
  const [quote, concurrent] = await Promise.all([provider.quote(stock),provider.quote(stock)]);
  assert.deepEqual(quote,concurrent);
  assert.equal(calls,2);
  assert.equal(quote.last,'315.34');
  assert.equal(quote.peStatic,'42.27');
  assert.equal(quote.peDynamic,null);
  assert.equal(quote.peTtm,null);
  assert.equal(quote.peRatio,'37.45');
  assert.equal(quote.peRatioSource,'腾讯财经');
  assert.equal(quote.source,'东方财富');
  assert.equal(quote.asOf,'2026-09-09T20:00:00.000Z');
  assert.equal(quote.peRatioAsOf,'2026-09-10T20:00:01.000Z');
});

test('available primary TTM avoids an unnecessary fallback for absent dynamic PE', async () => {
  let calls=0;
  const provider = new EastmoneyTicketQuotes(async () => { calls++; return {rc:0,data:{...raw.data,f162:0}}; });
  assert.equal((await provider.quote(stock)).peTtm,'38.12');
  assert.equal(calls,1);
});

test('optional PE fallback failure, invalid values or wrong listings preserve the fresh primary quote', async () => {
  for (const backup of [()=>{throw new Error('timeout');},()=>tencentRaw('MSFT'),()=>tencentRaw('AAPL','-'),()=>tencentRaw('AAPL','0')]) {
    const provider = new EastmoneyTicketQuotes(async url => url.includes('push2.eastmoney.com') ? {rc:0,data:{...raw.data,f162:0,f164:0}} : backup());
    const quote = await provider.quote(stock);
    assert.equal(quote.state,'reference');
    assert.equal(quote.last,'315.34');
    assert.equal(quote.peStatic,'42.27');
    assert.equal(quote.peRatio,undefined);
  }
});
