import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createPublicDataCache } from '../server/publicDataCache.ts';
import { createPublicDataHandler } from '../server/publicDataHttp.ts';
import { PUBLIC_DATA_POLICIES, resolvePublicDataPolicy, isUsablePublicPayload, validatePublicResource } from '../src/lib/publicDataPolicy.ts';
assert.equal(new Set(PUBLIC_DATA_POLICIES.map(item => item.key)).size, PUBLIC_DATA_POLICIES.length);
for (const url of ['/api/ibkr/status', '/api/ai-analysis', '/api/daily-brief', '/api/news-sources', '/api/news-feed', '/api/market-intelligence', '/api/integration-settings', '/api/vibe/research/sessions', '/api/global-macro-stream', '/api/market-quotes?token=private', '/api/china-fisher?mode=bad', '/api/china-fisher?mode=loan&mode=deposit']) assert.equal(resolvePublicDataPolicy(url), undefined, url);
assert.equal(resolvePublicDataPolicy('/api/china-fisher?fresh=1&mode=loan').key, '/api/china-fisher?mode=loan');
assert.equal(resolvePublicDataPolicy('/api/global-macro-dashboard?section=markets&region=apac').key, '/api/global-macro-dashboard?region=global&section=markets');
assert.equal(isUsablePublicPayload({generatedAt:'today',metrics:[]}), false);
assert.equal(isUsablePublicPayload({status:'unavailable',value:1}), false);
assert.equal(isUsablePublicPayload({card:{stale:true,value:1,stats:[{value:2}]}}), false, 'legacy last-good fallbacks must not renew public freshness');
assert.equal(validatePublicResource('/api/global-macro-quotes',{coverage:{yahoo:0,latencyMs:{yahoo:200}},markets:[],coreIndices:[]}),false,'transport metadata is not a successful quote');
assert.equal(isUsablePublicPayload({metrics:[{value:null, status:'unavailable',period:'2026-08'}]}), false);
assert.equal(isUsablePublicPayload({news:[{title:'Public release',url:'https://example.com'}]}), true);
assert.equal(validatePublicResource('/api/china-macro-dashboard?section=metrics',{metrics:[],quadrant:{growthDirection:0},newsMeta:{total:5}}),false,'metadata cannot make a failed section valid');
let calls = 0;
const policy = resolvePublicDataPolicy('/api/market-quotes');
const cache = createPublicDataCache({resources:[{...policy, validate:isUsablePublicPayload, load:async()=>{calls++; return {indices:[{price:100}]};}}]});
const handler = createPublicDataHandler(cache, 30);
const server = createServer(async(req,res)=>{if(!await handler(req,res)){res.statusCode=418;res.end('uncached');}});
server.listen(0,'127.0.0.1'); await once(server,'listening');
const base=`http://127.0.0.1:${server.address().port}`;
try {
  const responses=await Promise.all(Array.from({length:20},()=>fetch(base+'/api/market-quotes?fresh=1')));
  assert.equal(calls,1);
  assert.ok(responses.every(response=>response.status===200 && response.headers.get('x-sparkflow-cache')==='fresh'));
  const first=await responses[0].json(); assert.equal(first.indices[0].price,100); assert.ok(first._publicCache.expiresAt);
  assert.equal(responses[0].headers.get('cache-control'),'no-store');
  assert.equal((await fetch(base+'/api/market-quotes',{method:'POST'})).status,418);
  assert.equal((await fetch(base+'/api/market-quotes',{headers:{Authorization:'Bearer private'}})).status,418);
  assert.equal((await fetch(base+'/api/ibkr/status')).status,418);
  const status=await (await fetch(base+'/api/public-data-cache/status')).json(); assert.equal(status.entries,1); assert.equal(JSON.stringify(status).includes('Bearer'),false);
} finally { cache.stop(); server.closeAllConnections(); await new Promise(resolve=>server.close(resolve)); }
let lateCalls=0;
const lateCache=createPublicDataCache({resources:[{...policy,validate:isUsablePublicPayload,load:async()=>{lateCalls++;await new Promise(resolve=>setTimeout(resolve,80));return {indices:[{price:100}]};}}]});
const lateHandler=createPublicDataHandler(lateCache,10);
const lateServer=createServer(async(req,res)=>{await lateHandler(req,res);});
lateServer.listen(0,'127.0.0.1');await once(lateServer,'listening');
const lateBase=`http://127.0.0.1:${lateServer.address().port}`;
try {
  const first=await fetch(lateBase+'/api/market-quotes');assert.equal(first.status,503);assert.equal(first.headers.get('retry-after'),'5');
  await new Promise(resolve=>setTimeout(resolve,100));
  assert.equal((await fetch(lateBase+'/api/market-quotes')).status,200);assert.equal(lateCalls,1,'HTTP timeout does not duplicate or cancel shared background work');
} finally {lateCache.stop();lateServer.closeAllConnections();await new Promise(resolve=>lateServer.close(resolve));}
console.log('Public HTTP: finite allowlist, query normalization, auth/method isolation, response metadata and warm-request coalescing passed.');
