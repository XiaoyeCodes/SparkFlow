import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createDailyDigests, digestSchedule, DigestGenerationError } from '../../server/dailyDigests.ts';

const time = text => Date.parse(text);
const payload = (id, date) => ({ id, editionDate: date, sourceDate: date, sourceUrl: 'https://example.com/source', generatedAt: '2026-10-22T07:00:00Z', html: '<!doctype html><html><body>真实测试内容</body></html>', text: '真实测试内容', data: {}, itemCount: 1, quality: 'ready', warnings: [] });
async function fixture(t, at = '2026-10-22T07:00:00Z', generate) {
  const cacheDir = await mkdtemp(path.join(tmpdir(), 'sparkflow-digests-'));
  let clock = time(at);
  const calls = [];
  const service = createDailyDigests({ cacheDir, now: () => clock, generate: async (id, date, signal) => { calls.push([id, date]); return generate ? generate(id, date, signal) : payload(id, date); } });
  t.after(async () => { service.stop(); await service.idle(); await rm(cacheDir, { recursive: true, force: true }); });
  return { service, cacheDir, calls, setTime: value => { clock = time(value); } };
}

test('Beijing 08/09/18 boundaries use last due date, including UTC midnight and year rollover', () => {
  for (const hour of [8, 9, 18]) {
    const due = time('2026-10-22T00:00:00Z') + (hour - 8) * 3600000;
    assert.equal(digestSchedule(due - 1, hour).dueDate, '2026-10-21');
    assert.equal(digestSchedule(due, hour).dueDate, '2026-10-22');
    assert.equal(digestSchedule(due, hour).nextRunAt, new Date(due + 86400000).toISOString());
  }
  assert.equal(digestSchedule(time('2026-12-31T16:01:00Z'), 8).dueDate, '2026-12-31');
  assert.equal(digestSchedule(time('2027-01-01T00:00:00Z'), 8).dueDate, '2027-01-01');
});

test('afternoon startup catches up independent editions; repeated visits do not generate; restart restores', async t => {
  const f = await fixture(t);
  await f.service.start(); await f.service.idle();
  assert.deepEqual(f.calls.sort(), [['aibase', '2026-10-21'], ['daily60', '2026-10-22'], ['jin10', '2026-10-22']]);
  for (let n = 0; n < 30; n++) f.service.status();
  await f.service.tick(); await f.service.idle();
  assert.equal(f.calls.length, 3);
  let restartedCalls = 0;
  const restart = createDailyDigests({ cacheDir: f.cacheDir, now: () => time('2026-10-22T07:00:00Z'), generate: async (id, date) => { restartedCalls++; return payload(id, date); } });
  await restart.start(); await restart.idle(); restart.stop();
  assert.equal(restartedCalls, 0);
  assert.equal(restart.status().items.every(i => i.state === 'ready'), true);
});

test('only enabled sources dispatch jobs or appear in status', async t=>{
  const f=await fixture(t); const calls=[];
  const service=createDailyDigests({cacheDir:f.cacheDir,enabledIds:['jin10'],now:()=>time('2026-10-22T12:00:00Z'),generate:async(id,date)=>{calls.push(id);return payload(id,date);}});
  t.after(()=>service.stop()); await service.start(); await service.idle();
  assert.deepEqual(calls,['jin10']); assert.deepEqual(service.status().items.map(i=>i.id),['jin10']);
});

test('hour transition only dispatches newly due source; no successful rerun same day', async t => {
  const f = await fixture(t);
  await f.service.start(); await f.service.idle();
  f.setTime('2026-10-22T10:00:00Z');
  await f.service.tick(); await f.service.idle();
  assert.deepEqual(f.calls[3], ['aibase', '2026-10-22']);
  assert.equal(f.calls.length, 4);
});

test('one-time quote upgrade preserves old edition on failure, then never recollects a successful current edition', async t => {
  const f = await fixture(t); await f.service.start(); await f.service.idle(); f.service.stop();
  let clock = time('2026-10-22T07:00:00Z'), calls = 0, broken = true;
  const upgraded = createDailyDigests({ cacheDir:f.cacheDir, now:()=>clock,
    requiresUpgrade:(id,e)=>id==='jin10' && (e.generatorVersion??0)<2,
    generate:async(id,date)=>{ calls++; if(broken) throw new Error('quotes unavailable'); return {...payload(id,date),generatorVersion:2}; }
  });
  t.after(()=>upgraded.stop());
  const file = path.join(f.cacheDir,'jin10/latest.json'), old = await readFile(file,'utf8');
  await upgraded.start(); await upgraded.idle();
  assert.equal(calls,1); assert.equal(upgraded.status().items.find(i=>i.id==='jin10').state,'error');
  assert.equal(await readFile(file,'utf8'),old);
  broken=false; clock+=300000; await upgraded.tick(); await upgraded.idle();
  assert.equal(calls,2); assert.equal(upgraded.edition('jin10').generatorVersion,2);
  clock+=3600000; for(let i=0;i<3;i++){ await upgraded.tick(); upgraded.status(); } await upgraded.idle();
  assert.equal(calls,2);
  const restarted = createDailyDigests({cacheDir:f.cacheDir,now:()=>clock,requiresUpgrade:(id,e)=>id==='jin10'&&(e.generatorVersion??0)<2,generate:async()=>{throw new Error('no new generation expected');}});
  await restarted.start(); await restarted.idle(); assert.equal(restarted.status().items.every(i=>i.state==='ready'),true); restarted.stop();
});

test('three jobs start in parallel; ticks coalesce and failed source does not block others', async t => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const f = await fixture(t, undefined, async (id, date) => { if (id === 'jin10') { await gate; throw new DigestGenerationError('尚未发布', true); } return payload(id, date); });
  await f.service.start();
  await Promise.all([f.service.tick(), f.service.tick()]);
  // Wait for filesystem lock dispatch to enter all generators.
  for (let n = 0; n < 100 && f.calls.length < 3; n++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(f.calls.length, 3);
  release(); await f.service.idle();
  assert.equal(f.service.status().items.find(i => i.id === 'jin10').state, 'waiting');
  assert.equal(f.service.status().items.filter(i => i.state === 'ready').length, 2);
  await f.service.tick(); await f.service.idle(); assert.equal(f.calls.length, 3);
  f.setTime('2026-10-22T07:05:00Z');
  await f.service.tick(); await f.service.idle(); assert.equal(f.calls.length, 4);
});

test('failed next edition preserves old bytes and date until new edition passes validation', async t => {
  let broken = false;
  const f = await fixture(t, undefined, async (id, date) => { if (broken) throw new Error('offline'); return payload(id, date); });
  await f.service.start(); await f.service.idle();
  const file = path.join(f.cacheDir, 'jin10/latest.json');
  const before = await readFile(file, 'utf8');
  broken = true; f.setTime('2026-10-23T00:00:00Z');
  await f.service.tick(); await f.service.idle();
  assert.equal(await readFile(file, 'utf8'), before);
  const item = f.service.status().items.find(i => i.id === 'jin10');
  assert.equal(item.state, 'error'); assert.equal(item.edition.sourceDate, '2026-10-22'); assert.equal(item.dueDate, '2026-10-23');
});

test('wrong source date is rejected; previous successful snapshot survives', async t => {
  const f = await fixture(t, undefined, async (id, date) => ({ ...payload(id, date), sourceDate: '1900-01-01' }));
  await f.service.start(); await f.service.idle();
  assert.equal(f.service.status().items.every(i => !i.edition && i.state === 'error'), true);
});

test('two server instances share locks and successful snapshot; only one generator per source', async t => {
  const f = await fixture(t);
  let calls = 0;
  const shared = async (id, date) => { calls++; await new Promise(resolve => setTimeout(resolve, 50)); return payload(id, date); };
  const a = createDailyDigests({ cacheDir: f.cacheDir, now: () => time('2026-10-22T07:00:00Z'), generate: shared });
  const b = createDailyDigests({ cacheDir: f.cacheDir, now: () => time('2026-10-22T07:00:00Z'), generate: shared });
  await Promise.all([a.start(), b.start()]); await Promise.all([a.idle(), b.idle()]);
  await Promise.all([a.tick(), b.tick()]); await Promise.all([a.idle(), b.idle()]); a.stop(); b.stop();
  assert.equal(calls, 3);
  assert.equal(a.status().items.every(i => i.edition), true);
  assert.equal(b.status().items.every(i => i.edition), true);
});

test('shutdown aborts in-flight generation without replacing cache', async t => {
  const f = await fixture(t, undefined, async (id, date, signal) => {
    await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
    return payload(id, date);
  });
  await f.service.start();
  for (let n = 0; n < 100 && f.calls.length < 3; n++) await new Promise(resolve => setTimeout(resolve, 5));
  f.service.stop(); await f.service.idle();
  assert.equal(f.service.status().items.every(i => !i.edition), true);
});

test('corrupt persisted snapshot does not mask missing edition', async t => {
  const f = await fixture(t);
  await mkdir(path.join(f.cacheDir, 'jin10'), { recursive: true });
  await writeFile(path.join(f.cacheDir, 'jin10/latest.json'), '{broken');
  await f.service.start(); await f.service.idle();
  assert.equal(f.calls.some(([id]) => id === 'jin10'), true);
  assert.equal(f.service.status().items.every(i => i.edition), true);
});
