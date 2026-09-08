import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import path from 'node:path';

test('research bridge assembles one stream, preserving final text and finish reason',()=>{
 const result=spawnSync(path.resolve('services/vibe-trading/.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python'),['-c',`
import importlib.util
from langchain_core.messages import AIMessageChunk
spec=importlib.util.spec_from_file_location('bridge','scripts/ibkr-ai-analysis.py')
bridge=importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)
class Model:
    calls=0
    def stream(self,messages):
        self.calls+=1
        yield AIMessageChunk(content='')
        yield AIMessageChunk(content='{"headline":')
        yield AIMessageChunk(content='"ok"}',response_metadata={'finish_reason':'stop'})
m=Model()
r=bridge.collect_response(m,[])
assert m.calls==1 and r.content=='{"headline":"ok"}' and r.response_metadata['finish_reason']=='stop'
class Empty:
    def stream(self,messages):return iter([])
assert bridge.collect_response(Empty(),[]) is None
assert bridge.generation_options('deepseek','brief-json')=={'max_tokens':8192,'response_format':{'type':'json_object'},'extra_body':{'thinking':{'type':'disabled'}}}
assert 'extra_body' not in bridge.generation_options('deepseek','json')
assert 'response_format' not in bridge.generation_options('deepseek','text')
assert 'extra_body' not in bridge.generation_options('openai','brief-json')
`],{encoding:'utf8',windowsHide:true,timeout:20000});
 assert.equal(result.status,0,result.stderr||String(result.error));
});
