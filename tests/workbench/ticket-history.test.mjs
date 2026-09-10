import test from 'node:test';
import assert from 'node:assert/strict';
import {parseTicketHistory,TicketHistories,historyUrl,parseTencentHistory} from '../../server/ibkrTicketHistory.ts';
const raw=lines=>({rc:0,data:{code:'AAPL',klines:lines,trends:lines}});
test('history keeps raw session time and rejects malformed or mismatched prices',()=>{
  const data=parseTicketHistory(raw(['2026-09-09 21:30,315.411,315.600,315.615,315.411,621863','2026-09-10 04:00,315.25,315.34,315.47,315.13,8755408','2026-09-10 04:01,10,11,9,8,1','2026-02-30 04:00,10,11,12,8,1']),'AAPL','intraday');
  assert.equal(data.bars.length,2);assert.equal(data.bars[0].time,'2026-09-09 21:30');
  assert.equal(data.bars[1].close,315.34);assert.equal(data.timeZone,'北京时间');
  assert.throws(()=>parseTicketHistory(raw([]),'MSFT','day'),/匹配/);
});
test('year candles aggregate monthly OHLC and volume in date order',()=>{
  const data=parseTicketHistory(raw(['2026-02-27,12,15,16,10,30','2025-12-31,8,9,10,7,5','2026-01-30,10,12,13,9,20']),'AAPL','year');
  assert.deepEqual(data.bars[1],{time:'2026-01-01',open:10,close:15,high:16,low:9,volume:50});
  assert.equal(data.asOf,'2026-02-27');assert.match(data.note,/本年尚未结束/);
  for(const [period,klt] of [['day','101'],['week','102'],['month','103'],['year','103']])assert.equal(new URL(historyUrl('105.AAPL',period)).searchParams.get('klt'),klt);
});
test('history caches matching periods, coalesces requests, labels a failed refresh stale',async t=>{
  let calls=0,clock=0,fail=false;t.mock.method(Date,'now',()=>clock);
  const provider=new TicketHistories(async()=>{calls++;if(fail)throw new Error('offline');return raw(['2026-09-09,10,11,12,9,1']);});
  const contract={conId:1,symbol:'AAPL',currency:'USD',exchange:'NASDAQ'};
  await Promise.all([provider.history(contract,'day'),provider.history(contract,'day')]);assert.equal(calls,1);
  await provider.history(contract,'week');assert.equal(calls,2);
  clock=400000;fail=true;const data=await provider.history(contract,'day');assert.equal(data.stale,true);assert.equal(data.bars[0].close,11);
});

const tencent=(ticker,id,interval='day',currency='USD')=>{
  const quote=[];quote[2]=id;quote[35]=currency;
  return {code:0,data:{[ticker]:{qt:{[ticker]:quote},['qfq'+interval]:[['2025-12-31','8','9','10','7','5'],['2026-01-30','10','12','13','9','20'],['2026-02-27','12','15','16','10','30']]}}};
};
test('fallback verifies identity and currency, reports its source and aggregates adjusted monthly bars',()=>{
  const result=parseTencentHistory(tencent('usHSBC.N','HSBC.N','month'),'usHSBC.N','HSBC','year');
  assert.equal(result.source,'腾讯财经（备用）');assert.equal(result.adjustment,'前复权');
  assert.deepEqual(result.bars[1],{time:'2026-01-01',open:10,close:15,high:16,low:9,volume:50});
  assert.throws(()=>parseTencentHistory(tencent('usHSBC.N','HSBC.N','day','HKD'),'usHSBC.N','HSBC','day'),/匹配/);
  assert.throws(()=>parseTencentHistory(tencent('usHSBC.N','OTHER.N'),'usHSBC.N','HSBC','day'),/匹配/);
});
test('failed Eastmoney requests fall back once and do not block successive period switches',async()=>{
  let primary=0,lookups=0;
  const service=new TicketHistories(async url=>{
    if(url.includes('eastmoney')){primary++;throw new Error('socket closed');}
    const [ticker,interval]=new URL(url).searchParams.get('param').split(',');
    if(ticker==='usHSBC')lookups++;
    return tencent(ticker,'HSBC.N',interval);
  });
  const contract={conId:1,symbol:'HSBC',currency:'USD',exchange:'NYSE'};
  assert.equal((await service.history(contract,'day')).bars.length,3);
  assert.equal((await service.history(contract,'week')).source,'腾讯财经（备用）');
  assert.equal(primary,1);assert.equal(lookups,1);
  await assert.rejects(service.history({...contract,exchange:'NASDAQ'},'month'),/交易所/);
});
