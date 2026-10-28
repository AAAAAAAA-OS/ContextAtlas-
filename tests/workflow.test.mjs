import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createStudy,runStudy,baselineContext,validateInput,boundedMap} from '../src/runner.mjs';
import {FixtureModel,FixtureProvider,fixtureDesign} from '../src/fixture.mjs';
import {RecordedModel,usageSummary} from '../src/provider.mjs';
import {generateDecision,summarizeContext,proposeContexts} from '../src/engine.mjs';
const input={x:'History',y:'Partner choice',unit:'Firm',context:'Two feasible partners.',rounds:5,contextsPerRound:2,perCondition:12};

test('default workflow preserves all decisions and isolates actors from private memory',async()=>{
  const model=new FixtureModel(),study=createStudy(input);
  await runStudy(study,model,{concurrency:5});
  assert.equal(study.status,'completed');assert.equal(study.contexts.length,11);assert.equal(study.decisions.length,264);assert.equal(study.reflections.length,5);assert.equal(model.calls.length,281);
  assert.equal(new Set(study.decisions.map(d=>d.id)).size,264);
  const plans=model.calls.filter(c=>c.role==='plan');assert.equal(plans[0].payload.strategyLessons.length,0);assert.equal(plans[4].payload.strategyLessons.length,4);
  for(const request of model.calls.filter(c=>c.role==='actor'))assert.deepEqual(Object.keys(request.payload).sort(),['facts','options','requestId','task']);
  for(const context of study.contexts){assert.equal(context.result.n0,12);assert.equal(context.result.n1,12);assert.equal(context.result.effect,1);assert.equal(context.result.counts0.equivalent,12);assert.equal(context.result.mirrorPairs,12);assert.equal(context.result.mirrorAgreement,1);}
});

test('mirrors reverse order and retain option labels across both X conditions',async()=>{
  const model=new FixtureModel(),context=baselineContext(fixtureDesign);
  for(const x of [0,1])for(const mirror of [0,1])await generateDecision(model,fixtureDesign,context,x,2,mirror);
  const requests=model.calls.map(c=>c.payload);
  assert.deepEqual(requests[0].options,[...requests[1].options].reverse());assert.deepEqual(requests[0].options,requests[2].options);assert.equal(new Set(requests.map(r=>r.requestId)).size,4);
});

test('both neutral categories stay in denominator; duplicate decision slots are rejected',()=>{
  const choices=['positive','negative','equivalent','insufficient'];
  const decisions=[0,1].flatMap(x=>choices.map((outcome,i)=>({contextId:'c',x,block:Math.floor(i/2),mirror:i%2,outcome})));
  const result=summarizeContext(decisions,'c');assert.equal(result.rate0,.25);assert.equal(result.effect,0);assert.throws(()=>summarizeContext([...decisions,decisions[0]],'c'),/duplicate/);
});

test('unknown evidence and duplicate contexts fail validation',async()=>{
  const context=baselineContext(fixtureDesign);
  await assert.rejects(generateDecision({call:async()=>({choice:'A',noPreferenceReason:null,justification:'Unsupported fact.',factIds:['PRIVATE']})},fixtureDesign,context,0,0,0),/unknown/);
  const study=createStudy(input);study.design=fixtureDesign;study.round=1;study.contexts=[context];context.status='completed';study.decisions=[{contextId:'baseline',x:0,block:0,mirror:0,outcome:'positive'}];
  const fixture=new FixtureModel(),model={call:async(...args)=>{const result=await fixture.call(...args);result.candidates[1].facts=result.candidates[0].facts;return result;}};
  await assert.rejects(proposeContexts(model,study),/duplicates/);
});

test('resume retains accepted decisions and requires explicit replay of an uncertain call',async()=>{
  const directory=fs.mkdtempSync(path.join(process.cwd(),'.contextatlas-test-'));
  try{
    const fixture=new FixtureProvider();let actorCalls=0;
    const failing={request:async(...args)=>{if(args[0]==='actor' && ++actorCalls===4)throw new Error('simulated interruption');return fixture.request(...args);}};
    const study=createStudy({...input,rounds:2,perCondition:2});
    await assert.rejects(runStudy(study,new RecordedModel(failing,directory),{concurrency:1}),/interruption/);
    const accepted=structuredClone(study.decisions);assert.equal(accepted.length,3);
    await assert.rejects(runStudy(study,new RecordedModel(fixture,directory),{concurrency:1}),/uncertain/);
    await runStudy(study,new RecordedModel(fixture,directory,{retryUncertain:true}),{concurrency:1});
    assert.equal(study.decisions.length,20);for(const decision of accepted)assert.deepEqual(study.decisions.find(d=>d.id===decision.id),decision);
    assert.equal(usageSummary(directory).uncertainCalls,0);
  }finally{fs.rmSync(directory,{recursive:true,force:true});}
});

test('independent jobs execute concurrently within the configured bound',async()=>{
  let active=0,peak=0;
  await boundedMap(Array.from({length:9}),3,async()=>{active++;peak=Math.max(peak,active);await new Promise(resolve=>setTimeout(resolve,5));active--;});assert.equal(peak,3);
});

test('budgets enforce even repetitions and configurable rounds',()=>{
  assert.throws(()=>validateInput({...input,perCondition:3}),/even/);assert.throws(()=>validateInput({...input,rounds:101}),/100/);assert.equal(validateInput({...input,rounds:100}).rounds,100);
});

test('exported prompt snapshots exactly match actual runtime system messages',async()=>{
  const model=new FixtureModel();await runStudy(createStudy({...input,rounds:1,perCondition:2}),model);
  for(const call of model.calls)assert.equal(fs.readFileSync(new URL(`../prompts/${call.role}.system.txt`,import.meta.url),'utf8').trimEnd(),call.system);
});

test('review feedback triggers bounded revision without consuming actor slots',async()=>{
  const model=new FixtureModel();let reviews=0;
  const wrapper={call:async(role,system,payload)=>{
    if(role==='review' && ++reviews===1)return{approved:false,issues:['r1-c1: State the delivery constraint more clearly.']};
    return model.call(role,system,payload);
  }};
  const study=createStudy({...input,rounds:1,perCondition:2});await runStudy(study,wrapper);
  assert.equal(study.reviews.length,2);assert.equal(study.decisions.length,12);
  assert.ok(model.calls.filter(c=>c.role==='plan')[1].payload.revision.issuesToFix.length);
  const reject={call:async(role,system,payload)=>role==='review'?{approved:false,issues:['r1-c1: The same unresolved defect remains.']}:model.call(role,system,payload)};
  const stopped=createStudy({...input,rounds:1,perCondition:2});
  await assert.rejects(runStudy(stopped,reject),/three proposals/);assert.equal(stopped.decisions.length,4);
});
