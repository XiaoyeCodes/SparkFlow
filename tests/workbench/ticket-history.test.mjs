import test from 'node:test';
import assert from 'node:assert/strict';
import {parseTicketHistory,TicketHistories,historyUrl,parseTencentHistory} from '../../server/ibkrTicketHistory.ts';
import {ticketPriceChange} from '../../src/lib/ibkr/ticketPriceChange.ts';
import {usesPinnedIntradayZoom,zoomTicketRange} from '../../src/lib/ibkr/ticketChartRange.ts';
const raw=(lines,preClose)=>({rc:0,data:{code:'AAPL',klines:lines,trends:lines,...(preClose===undefined?{}:{preClose})}});
test('history keeps raw session time and rejects malformed or mismatched prices',()=>{
  const data=parseTicketHistory(raw(['2026-09-09 21:30,315.411,315.600,315.615,315.411,621863','2026-09-10 04:00,315.25,315.34,315.47,315.13,8755408','2026-09-10 04:01,10,11,9,8,1','2026-02-30 04:00,10,11,12,8,1'],314.5),'AAPL','intraday');
  assert.equal(data.bars.length,2);assert.equal(data.bars[0].time,'2026-09-09 21:30');
  assert.equal(data.bars[1].close,315.34);assert.equal(data.timeZone,'北京时间');assert.equal(data.previousClose,314.5);
  assert.throws(()=>parseTicketHistory(raw([]),'MSFT','day'),/匹配/);
});
test('intraday price change uses previous close and only falls back to the session open',()=>{
  const bar={open:509.07,close:504.22};
  const result=ticketPriceChange({period:'intraday',previousClose:521.10,sessionOpen:509.07},bar);
  assert.equal(result.label,'较昨收');
  assert.ok(Math.abs(result.change-(-16.88))<1e-10);
  assert.ok(Math.abs(result.changePct-(-16.88/521.10))<1e-12);
  const fallback=ticketPriceChange({period:'intraday',sessionOpen:509.07},bar);
  assert.equal(fallback.label,'较开盘');assert.ok(Math.abs(fallback.change-(-4.85))<1e-10);
});
test('wheel zoom anchors right-side whitespace to the first valid data point and keeps the left edge bounded',()=>{
  assert.equal(usesPinnedIntradayZoom('intraday'),true);
  for(const period of ['day','week','month','year'])assert.equal(usesPinnedIntradayZoom(period),false);
  const range={from:0,to:390},lastData=210;
  const zoomed=zoomTicketRange(range,340,0,lastData,-100);
  assert.ok(zoomed.to-zoomed.from<range.to-range.from);
  assert.equal(zoomed.from,0);
  assert.equal(zoomTicketRange(range,100,0,lastData,-100).from,0);
  const expanded=zoomTicketRange(range,340,0,lastData,100);
  assert.equal(expanded.from,0);assert.ok(expanded.to>range.to);
  const noWhitespace=zoomTicketRange({from:50,to:200},100,0,lastData,-100);
  assert.ok(noWhitespace.from>50);
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

const minutes=(date,lines)=>{
  const result=tencent('usAAPL.OQ','AAPL.OQ');
  result.data['usAAPL.OQ'].qt['usAAPL.OQ'][4]='99';
  result.data['usAAPL.OQ'].qt['usAAPL.OQ'][5]='100';
  result.data['usAAPL.OQ'].data={date,data:lines};
  return result;
};
test('Tencent minutes convert New York summer/winter time and cumulative volume without inventing OHLC',()=>{
  const data=parseTencentHistory(minutes('20260910',['0930 101 10','0931 102 25','1600 103 50']),'usAAPL.OQ','AAPL','intraday');
  assert.equal(data.bars[0].time,'2026-09-10 21:30');
  assert.equal(data.bars[2].time,'2026-09-11 04:00');
  assert.deepEqual(data.bars.map(bar=>bar.volume),[10,15,25]);
  assert.equal(data.pointPrices,true);assert.equal(data.sessionOpen,100);assert.equal(data.previousClose,99);
  const winter=parseTencentHistory(minutes('20260102',['0930 101 10','0931 102 5','0932 103 8','1600 104 20','1700 999 999']),'usAAPL.OQ','AAPL','intraday');
  assert.equal(winter.bars[0].time,'2026-01-02 22:30');
  assert.equal(winter.bars.at(-1).time,'2026-01-03 05:00');
  assert.deepEqual(winter.bars.map(bar=>bar.volume),[10,null,3,12]);
  assert.throws(()=>parseTencentHistory(minutes('20260230',['0930 101 10']),'usAAPL.OQ','AAPL','intraday'));
});
test('history source switch isolates periods and caches, including Tencent intraday',async()=>{
  const calls=[];
  const service=new TicketHistories(async url=>{
    calls.push(url);
    if(url.includes('eastmoney'))return raw(['2026-09-09,10,11,12,9,1']);
    if(url.includes('UsMinute'))return minutes('20260910',['0930 101 10']);
    const [ticker,period]=new URL(url).searchParams.get('param').split(',');
    return tencent(ticker,'AAPL.OQ',period);
  });
  const contract={conId:1,symbol:'AAPL',currency:'USD',exchange:'NASDAQ'};
  assert.equal((await service.history(contract,'intraday','tencent')).source,'腾讯财经');
  assert.equal(calls.filter(url=>url.includes('eastmoney')).length,0);
  assert.equal((await service.history(contract,'day','tencent')).source,'腾讯财经');
  assert.equal((await service.history(contract,'day','eastmoney')).source,'东方财富');
  const count=calls.length;
  assert.equal((await service.history(contract,'day','tencent')).source,'腾讯财经');
  assert.equal(calls.length,count);
  const failed=new TicketHistories(async url=>{assert.ok(url.includes('eastmoney'));throw new Error('offline');});
  await assert.rejects(failed.history(contract,'day','eastmoney'));
});
test('Tencent unadjusted history is accepted only under its actual adjustment label',()=>{
  const fixture=tencent('usAAPL.OQ','AAPL.OQ');
  fixture.data['usAAPL.OQ'].day=fixture.data['usAAPL.OQ'].qfqday;
  delete fixture.data['usAAPL.OQ'].qfqday;
  assert.equal(parseTencentHistory(fixture,'usAAPL.OQ','AAPL','day').adjustment,'不复权');
});
