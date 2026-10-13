import assert from 'node:assert/strict';
import { buildFredEmploymentReport, buildFredPpiReport, buildFredPceMetric } from '../server/usMacroFallbacks.ts';
import { parseNewYorkFedEffr, latestEffectiveFedRate } from '../server/effectiveFedRate.ts';
import { parseSinaVtQuote, parseTencentVtQuote, validGlobalEquityQuote } from '../server/globalEquityQuote.ts';
import { createPublicDataCache } from '../server/publicDataCache.ts';
import { macroComparison } from '../server/usMacroRelease.ts';
import { validatePublicResource } from '../src/lib/publicDataPolicy.ts';

const now = Date.parse('2026-10-13T08:00:00Z');
const p = (month, value) => ({time: `${month}-01T00:00:00.000Z`, value});
const jobs = [p('2026-07',158882),p('2026-08',159015),p('2026-09',159044)];
const rates = [p('2026-08',4.1),p('2026-09',4.2)];
const employment = buildFredEmploymentReport(jobs,rates,now);
assert.equal(employment.nonfarm,29); assert.equal(employment.nonfarmPrevious,133);
assert.equal(employment.unemployment,4.2); assert.equal(employment.unemploymentPrevious,4.1);
assert.equal(employment.period,'2026-09');
assert.throws(()=>buildFredEmploymentReport(jobs.filter(v=>v.time.slice(0,7)!=='2026-08'),rates,now));
assert.equal(macroComparison('2026-09',29,133,{period:'2026-09',actual:29,consensus:90,sourceUrl:'calendar'},[]).consensus,90);
assert.equal(macroComparison('2026-09',29,133,{period:'2026-08',actual:29,consensus:90,sourceUrl:'calendar'},[]).consensus,undefined);
assert.equal(macroComparison('2026-09',29,133,{period:'2026-09',actual:162,consensus:90,sourceUrl:'calendar'},[]).consensus,undefined);
const ppi=buildFredPpiReport([p('2026-07',100),p('2026-08',100.4)], [p('2025-08',100),p('2026-08',105.4)],now);
assert.ok(Math.abs(ppi.ppi-0.4)<1e-8); assert.ok(Math.abs(ppi.ppiYoy-5.4)<1e-8);
assert.match(ppi.sourceUrls[0],/PPIFID$/);
assert.ok(Math.abs(buildFredPceMetric([p('2026-07',100),p('2026-08',100.3)],now).value-0.3)<1e-8);
assert.equal(buildFredPceMetric([p('2026-07',100),p('2026-08',100.306)],now).display,'0.30%','derived PCE matches published one-decimal headline precision');
assert.throws(()=>buildFredPceMetric([p('2026-06',100),p('2026-08',100.3)],now));

const effr=parseNewYorkFedEffr({refRates:[{type:'EFFR',effectiveDate:'2026-10-09',percentRate:3.88}]},now);
assert.equal(effr.value,3.88);
assert.throws(()=>parseNewYorkFedEffr({refRates:[{type:'FEDFUNDS',effectiveDate:'2026-10-09',percentRate:3.88}]},now));
assert.throws(()=>parseNewYorkFedEffr({refRates:[{type:'EFFR',effectiveDate:'2026-11-01',percentRate:3.88}]},now));
assert.equal((await latestEffectiveFedRate([Promise.reject(Error('FRED offline')),Promise.resolve(effr)],1)).value,3.88);
assert.equal((await latestEffectiveFedRate([new Promise(()=>{}),Promise.resolve(effr)],1)).value,3.88,'slow sibling does not block a ready official EFFR');
await assert.rejects(latestEffectiveFedRate([Promise.reject(Error('offline'))],1));
await assert.rejects(latestEffectiveFedRate([new Promise(()=>{})],1),/不可用/);

const fields=Array(36).fill('0');Object.assign(fields,{1:'159.50',2:'-0.21',3:'2026-10-13 09:40:37',4:'-0.33',5:'159.85',6:'159.89',7:'159.36',26:'159.83'});
const sina=values=>'var hq_str_gb_vt="'+values.join(',')+'";';
const vt=parseSinaVtQuote(sina(fields),now);
assert.equal(vt.price,159.5);assert.equal(vt.changePercent,-0.21);assert.equal(vt.updatedAt,'2026-10-13T01:40:37.000Z');
const reset=Array(36).fill('0');Object.assign(reset,{1:'159.50',2:'0',3:fields[3],26:'159.50'});
assert.equal(parseSinaVtQuote(sina(reset),now),undefined,'preopen reset is not a new flat session');
assert.equal(validGlobalEquityQuote({...vt,updatedAt:'2026-11-01'},now),undefined);
const qt=Array(40).fill('');Object.assign(qt,{3:'159.50',30:'2026-10-12 16:00:02',31:'-0.33',32:'-0.21'});
const tencent=parseTencentVtQuote('v_usVT="'+qt.join('~')+'";',(raw,symbol)=>{assert.equal(symbol,'usVT');assert.equal(raw,qt[30]);return '2026-10-12T20:00:02.000Z';},now);
assert.equal(tencent.price,159.5);assert.equal(tencent.change,-0.33);

let clock=10_000,calls=0;const lastSuccess=9_000;
const saved=new Map();const store={read:async key=>saved.get(key)||null,write:async(key,value)=>{saved.set(key,value);}};
const resource={key:'/macro',warm:true,refreshMs:100,maxAgeMs:20_000,validate:()=>true,
 fallbackAt:data=>data.stale?data.lastSuccess:undefined,
 load:async()=>{calls++;return{value:29,stale:true,lastSuccess};}};
const cache=createPublicDataCache({now:()=>clock,store,resources:[resource]});
const first=await cache.read('/macro');
assert.equal(first.meta.state,'stale');assert.equal(Date.parse(first.meta.storedAt),lastSuccess);
assert.equal(Date.parse(first.meta.expiresAt),29_000);
await cache.tick();assert.equal(calls,1,'fallback failures retain retry backoff');
clock=15_001;await cache.refresh('/macro');
assert.equal(Date.parse((await cache.readPrepared('/macro')).meta.expiresAt),29_000,'re-reading fallback never extends its hard deadline');
cache.stop();
const restored=createPublicDataCache({now:()=>clock,store,resources:[resource]});
assert.equal((await restored.read('/macro')).meta.state,'stale','restart preserves last-good fallback status');
clock=30_001;await assert.rejects(restored.read('/macro'));restored.stop();
const card={id:'nonfarm',value:29,display:'+29K',stats:[],history:[],updatedAt:'2026-09-01',stale:true,lastSuccessAt:new Date().toISOString()};
assert.equal(validatePublicResource('/api/us-macro-card?id=nonfarm',{card}),true);
assert.equal(validatePublicResource('/api/us-macro-card?id=unemployment',{card}),false,'cross-card data is rejected');
assert.equal(validatePublicResource('/api/us-macro-card?id=nonfarm',{card:{...card,lastSuccessAt:'2000-01-01'}}),false);
console.log('Terminal reliability: monthly units/revisions, forecast matching, VT providers, daily EFFR, source failure, restart, bounded stale cache and backoff passed.');
