import assert from 'node:assert/strict';
import { publicDataFetch, peekPublicData, clearPublicDataMemory } from '../src/lib/publicDataClient.ts';
const originalFetch=globalThis.fetch;
const originalNow=Date.now;
let now=1_000_000,calls=0,complete;
Date.now=()=>now;
globalThis.fetch=async()=>{calls++;await new Promise(resolve=>complete=resolve);return new Response(JSON.stringify({indices:[{price:100}],_publicCache:{state:'fresh',storedAt:new Date(now).toISOString(),refreshAt:new Date(now+5000).toISOString(),expiresAt:new Date(now+6000).toISOString()}}));};
try {
  const cancel=new AbortController();
  const a=publicDataFetch('/api/market-quotes',{signal:cancel.signal});
  const b=publicDataFetch('/api/market-quotes');
  cancel.abort(); await assert.rejects(a); complete();
  assert.equal((await(await b).json()).indices[0].price,100); assert.equal(calls,1,'one consumer cannot cancel another');
  const nextPoll=publicDataFetch('/api/market-quotes'); complete(); await nextPoll;
  assert.equal(calls,2,'live polls check server; first-paint snapshot remains available');
  assert.equal(peekPublicData('/api/market-quotes').indices[0].price,100);
  const copy=peekPublicData('/api/market-quotes');copy.indices[0].price=0;assert.equal(peekPublicData('/api/market-quotes').indices[0].price,100);
  now+=6100;assert.equal(peekPublicData('/api/market-quotes'),undefined,'expired snapshots cannot render on remount');
  globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify({indices:[{price:200}]}));};
  await publicDataFetch('/api/market-quotes');assert.equal(calls,3);
  await publicDataFetch('/api/market-quotes?fresh=1');assert.equal(calls,4,'manual refresh bypasses browser memory only');
  const slowBefore=calls;
  await publicDataFetch('/api/china-macro-dashboard?section=metrics');
  await publicDataFetch('/api/china-macro-dashboard?section=metrics');
  assert.equal(calls,slowBefore+1,'slow data still reuses browser memory');
  for(const url of ['/api/ibkr/status','/api/daily-brief','/api/ai-analysis','https://example.com/api/market-quotes']){
    const before=calls;await publicDataFetch(url);await publicDataFetch(url);assert.equal(calls,before+2,url);
  }
  let before=calls;await publicDataFetch('/api/market-quotes',{headers:{Authorization:'secret'}});assert.equal(calls,before+1);
  before=calls;await publicDataFetch('/api/market-quotes',{method:'POST',body:'{}'});assert.equal(calls,before+1);
  clearPublicDataMemory();globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify({status:'unavailable',indices:[{price:100}]}));};
  before=calls;await publicDataFetch('/api/market-quotes');await publicDataFetch('/api/market-quotes');assert.equal(calls,before+2,'invalid 200 response must not poison cache');
} finally {clearPublicDataMemory();globalThis.fetch=originalFetch;Date.now=originalNow;}
console.log('Public browser cache: reuse, independent aborts, bounded freshness, cloning, manual refresh and private API isolation passed.');
