import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createDailyDigestMarkets, parseDigestSina, parseDigestTencent, parseDigestYahoo, parseCoinbaseDigest, parseKrakenDigest, parseTreasuryDigest, parseFredDigest, parseGoldDigest, currentDigestQuote, digestZonedTime } from '../../server/dailyDigestMarkets.ts';

const NOW = Date.parse('2026-10-22T07:00:00Z');
const raw = (value, time = NOW) => { const text = typeof value === 'string' ? value : JSON.stringify(value); return { text, fetchedAt: new Date(time).toISOString(), sha256: createHash('sha256').update(text).digest('hex') }; };
const fields = (values, length = 35) => { const f = Array(length).fill(''); for (const [k, v] of Object.entries(values)) f[Number(k)] = v; return f; };
function sina() {
  const us = (name, price, previous) => fields({ 0: name, 1: price, 2: 1, 3: '2026-10-22 08:00:00', 5: price, 25: 'Oct 21 04:00PM EDT', 26: previous }).join(',');
  return ['gb_$ixic=' + us('纳斯达克', 20200, 20000), 'gb_$inx=' + us('标普500', 6060, 6000), 'gb_mags=' + us('MAGS', 101, 100),
    'sh000001=' + fields({ 0: '上证指数', 2: 3500, 3: 3535, 30: '2026-10-22', 31: '15:00:00' }).join(','),
    'rt_hkHSI=' + fields({ 0: 'HSI', 1: '恒生指数', 3: 20000, 6: 20200, 8: 1, 17: '2026-10-22', 18: '15:00:00' }).join(','),
    'hf_XAU=' + fields({ 0: 2525, 6: '15:00:00', 7: 2500, 12: '2026-10-22', 13: '伦敦金（现货黄金）' }).join(','),
    'hf_OIL=' + fields({ 0: 80.8, 6: '15:00:00', 7: 80, 12: '2026-10-22', 13: '布伦特原油' }).join(',')].map(s => { const i = s.indexOf('='); return `var hq_str_${s.slice(0,i)}="${s.slice(i+1)}";`; }).join('\n');
}
function tencent() {
  return [['us.IXIC', '.IXIC', 20200, 20000, '2026-10-21 16:00:00'], ['us.INX', '.INX', 6060, 6000, '2026-10-21 16:00:00'], ['usMAGS', 'MAGS.AM', 101, 100, '2026-10-21 16:00:00'], ['sh000001', '000001', 3535, 3500, '20261022150000'], ['hkHSI', 'HSI', 20200, 20000, '2026/10/22 15:00:00']]
    .map(([code, symbol, price, previous, stamp]) => `v_${code}="${fields({2:symbol,3:price,4:previous,30:stamp,32:1}).join('~')}";`).join('\n');
}
const treasury = '<table><tr><th>Date</th><th>2 Yr</th><th>10 Yr</th></tr><tr><td>10/20/2026</td><td>4.1</td><td>4.50</td></tr><tr><td>10/21/2026</td><td>4.2</td><td>4.53</td></tr><tr><td>10/23/2026</td><td>9</td><td>9</td></tr></table>';
function yahoo(symbol = '^IXIC', currency = 'USD', type = 'INDEX') {
  return { chart: { result: [{ meta: { symbol, currency, instrumentType:type, regularMarketTime: Date.parse('2026-10-21T20:00:00Z') / 1000, regularMarketPrice:20200, chartPreviousClose:1, exchangeTimezoneName:'America/New_York' }, timestamp: [Date.parse('2026-10-20T13:30:00Z')/1000,Date.parse('2026-10-21T13:30:00Z')/1000], indicators:{quote:[{close:[20000,20200]}]} }] } };
}

test('Sina yields exact nine-instrument subset with correct previous values and exchange timestamps', () => {
  const q = parseDigestSina(raw(sina()), NOW);
  assert.equal(q.length, 7);
  assert.deepEqual(q.map(r => r.id), ['COMP','SPX','MAGS','SSE','HSI','XAUUSD','BRENT']);
  assert.equal(q[0].quotedAt, '2026-10-21T20:00:00.000Z'); // Not the wrapper's Beijing timestamp.
  assert.equal(q[3].quotedAt, '2026-10-22T07:00:00.000Z');
  assert.ok(q.every(r => Math.abs(r.changePercent - 1) < .00001));
  assert.match(q[5].instrument, /现货/); assert.match(q[6].instrument, /期货/);
  const corrupt = sina().replace('纳斯达克,20200,1,', '纳斯达克,20200,50,');
  assert.ok(!parseDigestSina(raw(corrupt), NOW).some(q => q.id === 'COMP'));
  assert.equal(parseDigestSina(raw(sina().replace('gb_$ixic', 'gb_$ndx')), NOW).length, 6);
});

test('Tencent backup uses its own symbol, previous close and local exchange timezone', () => {
  const rows = parseDigestTencent(raw(tencent()));
  assert.equal(rows.length, 5); assert.equal(rows[0].quotedAt, '2026-10-21T20:00:00.000Z');
  assert.equal(rows[4].quotedAt, '2026-10-22T07:00:00.000Z');
  assert.equal(parseDigestTencent(raw(tencent().replace('~.IXIC~', '~.NDX~'))).length, 4);
});

test('DST conversion and closed-session freshness reject stale morning data and future observations', () => {
  assert.equal(digestZonedTime('2026-01-21','16:00:00','America/New_York'), '2026-01-21T21:00:00.000Z');
  assert.throws(() => digestZonedTime('2026-02-31','16:00:00'));
  const q = parseDigestSina(raw(sina()), NOW)[0];
  assert.equal(currentDigestQuote(q, NOW), true);
  assert.equal(currentDigestQuote({...q,quotedAt:'2026-10-21T14:00:00Z'}, NOW), false);
  const cmt = parseTreasuryDigest(raw(treasury), NOW);
  assert.equal(currentDigestQuote({...cmt,observationDate:'2026-10-23'}, NOW), false);
});

test('Yahoo uses the daily close preceding the quote session, never the range anchor or wrong currency', () => {
  const q = parseDigestYahoo(raw(yahoo()),'COMP','^IXIC');
  assert.equal(q.previous, 20000); assert.ok(Math.abs(q.changePercent-1)<.00001);
  assert.throws(() => parseDigestYahoo(raw(yahoo('^IXIC','HKD')),'COMP','^IXIC'));
  assert.throws(() => parseDigestYahoo(raw(yahoo('^NDX')),'COMP','^IXIC'));
  assert.throws(() => parseDigestYahoo(raw(yahoo('BZ=F')),'BRENT','BZ=F'));
});

test('BTC stats use last/open consistently; ticker only verifies freshness and cannot fabricate an event timestamp', () => {
  const stats = raw({last:'101',open:'100'}), ticker = raw({price:'101.1',time:new Date(NOW-1000).toISOString()});
  const q = parseCoinbaseDigest(stats,ticker,NOW);
  assert.equal(q.price,101); assert.equal(q.previous,100); assert.equal(q.quotedAt,null);
  assert.throws(() => parseCoinbaseDigest(stats,raw({price:'101',time:new Date(NOW-600000).toISOString()}),NOW));
  assert.throws(() => parseCoinbaseDigest(stats,raw({price:'150',time:new Date(NOW).toISOString()}),NOW));
  const end = NOW / 1000, candle = (stamp, close) => [stamp,'0','0','0',close,'0','0',1];
  const payload = {error:[], result:{XXBTZUSD:[candle(end-300-86400,'100'),candle(end-300,'101'),candle(end,'999')]}};
  const k = parseKrakenDigest(raw(payload),NOW);
  assert.equal(k.price,101); assert.equal(k.previous,100); assert.equal(k.quotedAt,new Date(NOW).toISOString());
  payload.result.XXBTZUSD.shift(); assert.throws(() => parseKrakenDigest(raw(payload),NOW));
});

test('gold fallback requires USD spot basis; Treasury/FRED match the 10-year daily series and bp arithmetic', () => {
  const gold = parseGoldDigest(raw({ts:NOW,items:[{curr:'USD',xauPrice:2525,chgXau:25,pcXau:1}]}));
  assert.equal(gold.previous,2500); assert.match(gold.instrument,/现货/);
  assert.throws(() => parseGoldDigest(raw({ts:NOW,items:[{curr:'EUR',xauPrice:2525,chgXau:25,pcXau:1}]})));
  const q = parseTreasuryDigest(raw(treasury),NOW);
  assert.equal(q.price,4.53); assert.equal(q.previous,4.5); assert.equal(q.observationDate,'2026-10-21'); assert.ok(Math.abs(q.changeBp-3)<1e-10);
  const fred = parseFredDigest(raw('observation_date,DGS10\n2026-10-20,4.5\n2026-10-21,4.53\n2026-10-22,.\n'),NOW);
  assert.equal(fred.price,q.price); assert.equal(fred.changeBp,q.changeBp);
  assert.throws(() => parseFredDigest(raw('observation_date,TNX\n2026-10-20,4.5\n2026-10-21,4.53'),NOW));
});

test('only explicit generation fetches; parallel primary requests coalesce; failed retry and restart retain provenance', async t => {
  const cacheDir = await mkdtemp(path.join(tmpdir(),'digest-markets-'));
  let now = NOW, broken = false, useBackup = false;
  const calls = [];
  const feed = async url => {
    calls.push(url);
    await new Promise(resolve => setTimeout(resolve,5));
    if (broken) throw new Error('offline');
    if (url.includes('sinajs')) return raw(useBackup ? sina().replace(/var hq_str_(gb|sh|rt)[^\n]*\n?/g,'') : sina(),now);
    if (url.includes('gtimg')) return raw(tencent(),now);
    if (url.endsWith('/stats')) return raw({open:'100',last:'101'},now);
    if (url.endsWith('/ticker')) return raw({price:'101',time:new Date(now).toISOString()},now);
    if (url.includes('treasury')) return raw(treasury,now);
    throw new Error('Unexpected feed '+url);
  };
  const market = createDailyDigestMarkets({cacheDir,feed,now:()=>now});
  t.after(async()=>{ market.stop(); await market.idle(); await rm(cacheDir,{recursive:true,force:true}); });
  await market.start(); for(let i=0;i<20;i++) market.snapshot(); assert.equal(calls.length,0);
  await Promise.all([market.refresh(),market.refresh(),market.refresh()]);
  assert.equal(calls.length,4); assert.equal(market.snapshot().available,9); assert.equal(market.snapshot().nextRefreshAt,null);
  const first = market.snapshot(); assert.ok(first.rows.every(r=>r.state==='current'));
  await new Promise(resolve=>setTimeout(resolve,30)); assert.equal(calls.length,4);
  useBackup=true; now+=1000; await market.refresh();
  assert.equal(market.snapshot().rows.find(r=>r.id==='COMP').quote.source,'腾讯财经');
  broken=true; now+=60_000; await market.refresh();
  const retained = market.snapshot(); assert.equal(retained.available,9); assert.ok(retained.rows.filter(r=>r.id!=='US10Y').every(r=>r.state==='cached'));
  assert.equal(retained.rows.find(r=>r.id==='SSE').quote.quotedAt,first.rows.find(r=>r.id==='SSE').quote.quotedAt);
  const restart = createDailyDigestMarkets({cacheDir,feed:async()=>{throw new Error('must not fetch on startup');},now:()=>now});
  await restart.start(); assert.equal(restart.snapshot().available,9); restart.stop();
  const persisted = JSON.parse(await readFile(path.join(cacheDir,'markets.json'),'utf8'));
  assert.equal(persisted.quotes.length,9); assert.match(persisted.quotes[0].evidence.sha256,/^[a-f0-9]{64}$/);
});
