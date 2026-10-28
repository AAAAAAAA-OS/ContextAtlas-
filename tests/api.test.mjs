import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {PythonProvider} from '../src/provider.mjs';

test('real Python bridge and OpenAI SDK honor the non-streaming API contract with an in-memory transport',async()=>{
  const previous=process.env.LLM_API_KEY;process.env.LLM_API_KEY='local-test-key';let provider;
  try{
    provider=new PythonProvider({python:process.env.PYTHON||'python',baseUrl:'https://mock.invalid/v1',model:'mock-model',reasoningEffort:'high',maxOutputTokens:500,timeoutSeconds:10,maxRetries:0}, {bridgePath:fileURLToPath(new URL('./mock_bridge.py',import.meta.url))});
    const results=await Promise.all([provider.request('actor','Return JSON only.',{text:'First — 测试'}),provider.request('actor','Return JSON only.',{text:'Second'})]);
    assert.equal(results.length,2);
    const received=results.map(result=>{assert.ok(!result.error,JSON.stringify(result));assert.equal(result.usage.total_tokens,15);return JSON.parse(result.content);});
    for(const request of received){assert.equal(request.path,'/v1/chat/completions');assert.equal(request.body.stream,false);assert.equal(request.body.reasoning_effort,'high');assert.deepEqual(request.body.response_format,{type:'json_object'});assert.equal(request.body.messages.length,2);assert.equal(request.authorization,'Bearer local-test-key');}
    assert.ok(received.some(r=>r.body.messages[1].content.includes('First — 测试')));
  }finally{provider?.close();if(previous===undefined)delete process.env.LLM_API_KEY;else process.env.LLM_API_KEY=previous;}
});
