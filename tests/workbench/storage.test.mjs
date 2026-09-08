import test from 'node:test';
import assert from 'node:assert/strict';
import {atomicReplace} from '../../server/ibkrMcp.ts';

test('temporary Windows sharing errors retry atomic replacement without deleting data',async()=>{
 let calls=0;
 await atomicReplace('temporary','report',async(from,to)=>{assert.equal(from,'temporary');assert.equal(to,'report');if(++calls<3)throw Object.assign(new Error('busy'),{code:'EPERM'});});
 assert.equal(calls,3);
 let denied=0;await assert.rejects(()=>atomicReplace('temporary','report',async()=>{denied++;throw Object.assign(new Error('denied'),{code:'EACCES'});}),/denied/);assert.equal(denied,1);
});
