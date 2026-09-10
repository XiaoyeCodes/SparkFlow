import test from 'node:test';
import assert from 'node:assert/strict';
import { bridgePortCandidates, findAvailableBridgePort, replaceStaleBridge, coordinateBridgeStart, bridgeCodeRevision } from '../../server/ibkrGatewayBridge.ts';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';

test('smart connection reuses current code, upgrades old code and never force-kills after graceful refusal', async () => {
  const calls=[];
  const actions={graceful:async id=>calls.push(id),legacy:async()=>calls.push('legacy'),wait:async()=>calls.push('wait')};
  assert.equal(await replaceStaleBridge({bridge:{codeRevision:'new'}},'new',actions),false);
  assert.deepEqual(calls,[]);
  assert.equal(await replaceStaleBridge({bridge:{codeRevision:'old',instanceId:'instance',gracefulRestart:true}},'new',actions),true);
  assert.deepEqual(calls,['instance','wait']);
  calls.length=0;
  await replaceStaleBridge({},'new',actions);
  assert.deepEqual(calls,['legacy','wait']);
  calls.length=0;
  await assert.rejects(()=>replaceStaleBridge({bridge:{instanceId:'changed',gracefulRestart:true}},'new',{
    ...actions,graceful:async()=>{throw Error('instance changed');}
  }),/instance changed/);
  assert.deepEqual(calls,[]);
});

test('simultaneous bridge connections share one startup and a failed start can retry', async () => {
  let calls=0,finish;
  const run=()=>{calls++;return new Promise(resolve=>{finish=resolve;});};
  const first=coordinateBridgeStart('test-workspace',run);
  const second=coordinateBridgeStart('test-workspace',run);
  assert.equal(first,second);assert.equal(calls,1);
  finish({port:8765,reused:false});await first;
  await assert.rejects(()=>coordinateBridgeStart('test-workspace',async()=>{throw Error('failed');}));
  assert.deepEqual(await coordinateBridgeStart('test-workspace',async()=>({port:8765,reused:true})),{port:8765,reused:true});
});

test('bridge code fingerprint follows Python sources, not bytecode or logs', async () => {
  const root=await mkdtemp(path.join(tmpdir(),'bridge-revision-'));
  try {
    await mkdir(path.join(root,'nested'));
    await writeFile(path.join(root,'a.py'),'a=1\n');
    await writeFile(path.join(root,'nested','b.py'),'b=2\n');
    const expected=createHash('sha256').update('a.py\0a=1\n\0nested/b.py\0b=2\n\0').digest('hex');
    assert.equal(await bridgeCodeRevision(root),expected);
    await writeFile(path.join(root,'runtime.log'),'changed');
    assert.equal(await bridgeCodeRevision(root),expected);
    await writeFile(path.join(root,'a.py'),'a=2\n');
    assert.notEqual(await bridgeCodeRevision(root),expected);
  } finally {await rm(root,{recursive:true,force:true});}
});

test('bridge port selection keeps the configured port first and falls back deterministically', async () => {
  const candidates = bridgePortCandidates(8765);
  assert.equal(candidates[0], 8765);
  assert.equal(new Set(candidates).size, candidates.length);
  const checked = [];
  const selected = await findAvailableBridgePort(8765, async port => {
    checked.push(port);
    return port === 18767;
  });
  assert.equal(selected, 18767);
  assert.deepEqual(checked.slice(0, 4), [8765, 18765, 18766, 18767]);
});

test('bridge port selection reports a clear error when all candidates are occupied', async () => {
  await assert.rejects(() => findAvailableBridgePort(18765, async () => false), /没有可用的本机桥接端口/);
});
