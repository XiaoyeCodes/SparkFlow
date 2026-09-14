import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { createPublicDataCache } from '../server/publicDataCache.ts';
import { resolvePublicDataPolicy } from '../src/lib/publicDataPolicy.ts';
import { startQuotePolling, mergeQuoteRows } from '../src/lib/realtimeQuotes.ts';
import { withPublicSourceRefresh, isPublicSourceRefresh } from '../server/publicSourceContext.ts';
const flush = async () => { for(let i=0;i<12;i++) await new Promise(resolve=>setImmediate(resolve)); };
for(const key of ['/api/market-quotes','/api/global-macro-quotes','/api/china-macro-dashboard?section=indices',
 '/api/china-market-heatmap','/api/us-market-heatmap','/api/hong-kong-market-heatmap',
 '/api/global-macro-core-index?id=nasdaq','/api/global-macro-fx-rate?id=usd-cny',
 '/api/global-macro-asset?id=gold','/api/global-macro-asset?id=brent','/api/global-macro-asset?id=bitcoin',
 '/api/global-market-heatmap?market=japan','/api/international-market-overview?market=korea']) {
 const p=resolvePublicDataPolicy(key);assert.equal(p.refreshMs,3000,key);assert.equal(p.clientMs,0,key);assert.equal(p.realtime,true,key);
}
assert.equal(resolvePublicDataPolicy('/api/china-macro-dashboard?section=metrics').refreshMs,120000);
assert.equal(resolvePublicDataPolicy('/api/china-gdp').refreshMs,3600000);
assert.equal(resolvePublicDataPolicy('/api/ibkr/status'),undefined);
let now=100000, calls=0,writes=0,releaseSlow,fail=false;
const cache=createPublicDataCache({now:()=>now,concurrency:1,realtimeConcurrency:1,
 store:{read:async()=>null,write:async()=>{writes++;}},resources:[
 {key:'slow',warm:true,refreshMs:60000,maxAgeMs:90000,validate:()=>true,load:()=>new Promise(resolve=>{releaseSlow=()=>resolve({value:1});})},
 {key:'quote',warm:true,realtime:true,refreshMs:3000,maxAgeMs:10000,validate:d=>d?.value>0,load:async()=>{calls++;if(fail)throw Error('upstream');now+=500;return {value:calls};}},
 ]});
await cache.tick();await flush();
assert.equal(cache.status().active,1,'slow load remains occupied');
assert.equal(calls,1,'reserved quote lane runs despite occupied slow lane');
const first=await cache.read('quote');assert.equal(first.meta.refreshAt,new Date(103000).toISOString(),'cadence measured from start, not completion');
assert.equal(writes,1);
now=103000;await cache.tick();await flush();assert.equal(calls,2);
assert.equal(writes,1,'do not write quote snapshots to disk every three seconds');
assert.equal((await cache.read('quote')).data.value,2);
fail=true;now=106000;await cache.tick();await flush();
assert.equal((await cache.read('quote')).data.value,2,'temporary failure retains bounded last-good');
now=107000;await cache.tick();await flush();assert.equal(calls,3,'failure backoff prevents a retry storm');
now=120000;await assert.rejects(cache.read('quote'),'hard-expired data must not be served');
cache.stop();releaseSlow();await flush();

const original={document:globalThis.document,setInterval:globalThis.setInterval,clearInterval:globalThis.clearInterval};
const doc=new EventTarget();doc.hidden=false;globalThis.document=doc;
let tick,removed=false,polls=0,release,seenSignal;
globalThis.setInterval=(fn,ms)=>{assert.equal(ms,3000);tick=fn;return 1;};
globalThis.clearInterval=()=>{removed=true;};
try {
 const stop=startQuotePolling(async signal=>{polls++;seenSignal=signal;if(polls===1)await new Promise(r=>release=r);if(polls===2)throw Error('offline');});
 tick();tick();assert.equal(polls,1,'slow request must not overlap');release();await flush();
 tick();await flush();assert.equal(polls,2);tick();await flush();assert.equal(polls,3,'failure does not stop polling forever');
 doc.hidden=true;tick();assert.equal(polls,3);
 doc.hidden=false;doc.dispatchEvent(new Event('visibilitychange'));await flush();assert.equal(polls,4,'resume immediately');
 stop();tick();assert.equal(polls,4);assert.equal(seenSignal.aborted,true);assert.equal(removed,true);
}finally{Object.assign(globalThis,original);}
assert.equal(mergeQuoteRows([{id:'a',price:2,updatedAt:'2026-09-14T01:00:02Z'}],[{id:'a',price:1,updatedAt:'2026-09-14T01:00:01Z'}])[0].price,2);

const source=await readFile(new URL('../vite.config.ts',import.meta.url),'utf8');
const from=source.indexOf('function createBudgetedFastQuoteSource<T>');const to=source.indexOf('const readFastEquitySource',from);
const code=ts.transpile(source.slice(from,to),{target:ts.ScriptTarget.ES2022});
let sourceNow=10000;const budgeted=new Function('isPublicSourceRefresh','Date',code+';return createBudgetedFastQuoteSource;')(isPublicSourceRefresh,{now:()=>sourceNow});
let attempts=0,finish;const read=budgeted(async()=>{attempts++;if(attempts===1)return {price:1};return new Promise(resolve=>finish=resolve);},1);
assert.equal((await withPublicSourceRefresh(read)).data.price,1);
await withPublicSourceRefresh(read);assert.equal(attempts,1,'overlapping consumers reuse one source cadence');
sourceNow+=3001;assert.equal((await withPublicSourceRefresh(read)).data.price,1,'short grace during a slow refresh');
sourceNow+=3001;assert.equal((await withPublicSourceRefresh(read)).data,undefined,'hung source cannot renew old quotes indefinitely');
assert.equal(attempts,2,'timeout must not spawn another underlying request');finish({price:2});await flush();
assert.equal((await withPublicSourceRefresh(read)).data.price,2);
const extract = (start, end) => ts.transpile(source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start))), {target:ts.ScriptTarget.ES2022});
const tencentTime = new Function(extract('function zonedDateTimeToIso(', 'function expectedPeriodFromReleaseTitle(')
 + extract('function tencentIndexUpdatedAt(', 'async function getEquityIndexSnapshots()')+';return tencentIndexUpdatedAt;')();
assert.equal(tencentTime('2026-09-11 17:15:59','usNDX'),'2026-09-11T21:15:59.000Z');
assert.equal(tencentTime('2026-01-09 16:00:00','usINX'),'2026-01-09T21:00:00.000Z');
assert.equal(tencentTime('20260914153102','sh000001'),'2026-09-14T07:31:02.000Z');
assert.equal(tencentTime(undefined,'s_sh000001'),undefined,'missing quote time must not become the fetch time');
const equityRows = [{id:'sse',market:'china',price:3100},{id:'sp500',market:'us',price:6000}];
const readEquity = async () => ({data:{indices:equityRows,tencentAvailable:true}});
const readCrypto = async () => ({data:{indices:['BTC','ETH','BNB','SOL','XRP','DOGE'].map(code=>({id:`crypto-${code.toLowerCase()}`,code,price:1}))}});
const noLegacy = () => {throw Error('public fast path must not wait for legacy history/cache');};
const marketLoader = new Function('isPublicSourceRefresh','readFastEquitySource','readFastCryptoSnapshotsSource','getEquityIndexSnapshots','getCachedCryptoMarketSnapshots',
 extract('async function getMarketIndexSnapshots()', 'async function getChinaMarketHeatmap()')+';return getMarketIndexSnapshots;')(
 ()=>true,readEquity,readCrypto,noLegacy,noLegacy);
assert.equal((await marketLoader()).indices.length,8,'fast market path preserves all six crypto assets and equity coverage');
const chinaLoader = new Function('readFastEquitySource','readFastGoldenDragonSource','chinaMacroMethodology',
 extract('async function loadChinaMacroIndicesSection()', 'async function loadChinaMacroMetricsSection()')+';return loadChinaMacroIndicesSection;')(
 readEquity,async()=>({data:{price:7000,updatedAt:'2026-09-14T01:00:00Z'}}),{});
assert.deepEqual((await chinaLoader()).indices.map(row=>row.id),['sse','golden-dragon']);
const refreshCode=extract('async function refreshGlobalMacroFastQuotes()', 'async function getCachedGlobalMacroFastQuotes()');
const failingRefresh = new Function('withPublicSourceRefresh','isPublicSourceRefresh','loadGlobalMacroFastQuotes','validatePublicResource',
 'let globalMacroFastQuoteInFlight; let globalMacroFastQuoteCache={storedAt:Date.now(),data:{price:1}};'+refreshCode+';return refreshGlobalMacroFastQuotes;')(
 fn=>fn(),()=>true,async()=>{throw Error('upstream offline');},()=>true);
await assert.rejects(failingRefresh(),'public snapshot must not renew last-good after all sources fail');
const readMissing = async () => ({error:'source timed out'});
const cryptoFallback = new Function('readFastCryptoYahooSource','readFastCryptoBinanceSource','readFastCryptoCoinGeckoSource',
 'readFastCryptoSnapshotsSource','cryptoAssetConfigs','mergeFreshCryptoQuotes','isPublicSourceRefresh',
 extract('async function readFastCryptoSource()', 'async function loadGlobalMacroFastQuotes()')+';return readFastCryptoSource;')(
 readMissing,readMissing,readMissing,async()=>({data:{indices:[{code:'BTC',price:70000,change:100,changePercent:1,
 updatedAt:'2026-09-14T01:00:00Z',validation:{source:'OKX'},sourceUrl:'https://www.okx.com/trade-spot/btc-usdt'}]}}),
 [{id:'bitcoin',symbol:'BTC'}],()=>{},()=>true);
assert.equal((await cryptoFallback()).data.get('bitcoin').price,70000,'working OKX batch survives other crypto source timeouts');
console.log('Realtime quotes: 3s policies, separate lanes, cadence, disk throttling, expiry, retries, no overlap, visibility, ordering, bounded slow sources and fast index coverage passed.');
