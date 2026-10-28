import fs from 'node:fs';
import path from 'node:path';
import * as engine from './engine.mjs';
import {writeJson} from './provider.mjs';

export function validateInput(input) {
  const merged={rounds:5,contextsPerRound:2,perCondition:12,...input};
  if(!Number.isInteger(merged.rounds)||merged.rounds<1||merged.rounds>100) throw new Error('rounds must be an integer from 1 to 100.');
  if(!Number.isInteger(merged.contextsPerRound)||merged.contextsPerRound<1||merged.contextsPerRound>4) throw new Error('contextsPerRound must be from 1 to 4.');
  if(!Number.isInteger(merged.perCondition)||merged.perCondition<2||merged.perCondition>1000||merged.perCondition%2) throw new Error('perCondition must be an even integer from 2 to 1000.');
  for(const key of ['x','y','context','unit'])if(typeof merged[key]!=='string'||!merged[key].trim())throw new Error(`${key} must be a nonempty string.`);
  return merged;
}
export function createStudy(input,id='study') {
  input=validateInput(input); const now=new Date().toISOString();
  return {id,title:input.title||'Context exploration',createdAt:now,updatedAt:now,input,stage:'design',round:0,status:'ready',contexts:[],decisions:[],reflections:[],events:[],revision:1,attempts:0,tokens:0,reviewAttempts:0};
}
export function baselineContext(design) {
  return {id:'baseline',round:0,title:design.baselineTitle,summary:'Reference setting before contextual exploration.',facts:design.baselineFacts,attributes:[],
    inspiration:{type:'mechanism',text:'Reference configuration from the accepted design.',sourceIds:[]},expectedEffect:'uncertain',
    prediction:'The reference contrast is measured before exploratory contexts are proposed.',learningValue:'Provide a common reference for contextual changes.',status:'queued'};
}
export async function boundedMap(items,concurrency,worker) {
  let cursor=0;const errors=[];
  await Promise.all(Array.from({length:Math.min(concurrency,items.length)},async()=>{
    while(cursor<items.length && !errors.length) {const item=items[cursor++];try{await worker(item);}catch(error){errors.push(error);}}
  }));
  if(errors.length)throw errors[0];
}
export async function runStudy(study,model,{save=()=>{},concurrency=8,onProgress=()=>{}}={}) {
  validateInput(study.input);
  const checkpoint=message=>{study.updatedAt=new Date().toISOString();study.revision++;if(message){study.events.push({id:`e${study.events.length+1}`,at:study.updatedAt,stage:study.stage,message});onProgress(message);}save(study);};
  // A malformed output halts for inspection. Transport retries never replace accepted choices.
  study.status='running';delete study.error;checkpoint();
  const simulate=async(contexts)=>{
    const jobs=[];
    for(const context of contexts) {
      context.status='running';
      for(let block=0;block<study.input.perCondition/2;block++)for(const x of [0,1])for(const mirror of [0,1]) {
        const id=`${context.id}:x${x}:b${block}:m${mirror}`;
        if(!study.decisions.some(d=>d.id===id))jobs.push({context,x,block,mirror});
      }
    }
    checkpoint();
    await boundedMap(jobs,concurrency,async({context,x,block,mirror})=>{
      const decision=await engine.generateDecision(model,study.design,context,x,block,mirror);
      study.decisions.push(decision);checkpoint();
    });
    // Stable order makes evidence examples independent of request completion timing.
    study.decisions.sort((a,b)=>a.contextId.localeCompare(b.contextId)||a.x-b.x||a.block-b.block||a.mirror-b.mirror);
    for(const context of contexts) {
      context.result=engine.summarizeContext(study.decisions,context.id);
      if(context.result.n0!==study.input.perCondition||context.result.n1!==study.input.perCondition)throw new Error(`Incomplete decisions in ${context.id}.`);
      context.status='completed';
    }
    checkpoint(`Completed ${contexts.map(c=>c.id).join(', ')}.`);
  };
  try {
    while(study.stage!=='completed') {
      switch(study.stage) {
        case 'design':
          study.design=await engine.generateDesign(model,study.input);study.title=study.design.title;
          study.contexts=[baselineContext(study.design)];study.stage='baseline';checkpoint('Research design created.');break;
        case 'baseline':
          await simulate([study.contexts.find(c=>c.id==='baseline')]);study.round=1;study.stage='plan';checkpoint('Reference decisions completed.');break;
        case 'plan':
          study.draft=await engine.proposeContexts(model,study);study.stage='review';checkpoint(`Round ${study.round}: six candidates proposed.`);break;
        case 'review': {
          const review=await engine.reviewContexts(model,study,study.draft);
          study.reviews??=[];study.reviews.push({round:study.round,attempt:study.reviewAttempts+1,...review,draft:structuredClone(study.draft)});
          if(!review.approved) {
            study.reviewAttempts++;study.reviewIssues=review.issues;
            if(study.reviewAttempts>=3)throw new Error('Context review rejected three proposals. Inspect the review evidence and revise the study input before a new run.');
            study.stage='plan';checkpoint('Review requested a revised proposal.');break;
          }
          const selected=study.draft.candidates.filter(c=>study.draft.selectedIds.includes(c.id));
          study.contexts.push(...selected);study.reviewAttempts=0;delete study.reviewIssues;study.stage='simulate';checkpoint(`Round ${study.round}: ${selected.length} contexts approved.`);break;
        }
        case 'simulate':
          await simulate(study.contexts.filter(c=>c.round===study.round));study.stage='reflect';checkpoint();break;
        case 'reflect':
          study.reflections.push(await engine.reflectRound(model,study));
          if(study.round>=study.input.rounds)study.stage='report';else{study.round++;study.stage='plan';}
          delete study.draft;checkpoint('Reflection saved to planner memory.');break;
        case 'report':
          study.report=await engine.generateReport(model,study);study.stage='completed';study.status='completed';checkpoint('Exploration report completed.');break;
        default:throw new Error(`Unknown stage ${study.stage}.`);
      }
    }
    return study;
  }catch(error){study.status='error';study.error=error.message;checkpoint('Run stopped; completed requests and decisions are retained.');throw error;}
}
function csv(value){return '"'+String(value??'').replaceAll('"','""')+'"';}
export function writeReports(study,output) {
  if(!study.report)return;
  writeJson(path.join(output,'report.json'),study.report);
  const baseline=study.contexts.find(c=>c.id==='baseline')?.result;
  const header=['context_id','round','title','n_x0','n_x1','positive_x0','positive_x1','negative_x0','negative_x1','equivalent_x0','equivalent_x1','insufficient_x0','insufficient_x1','contrast_pp','change_from_baseline_pp','mirror_agreement_pct'];
  const lines=[header.map(csv).join(',')];
  for(const c of study.contexts) {
    const r=c.result;if(!r)continue;
    lines.push([c.id,c.round,c.title,r.n0,r.n1,r.counts0.positive,r.counts1.positive,r.counts0.negative,r.counts1.negative,r.counts0.equivalent,r.counts1.equivalent,r.counts0.insufficient,r.counts1.insufficient,(100*r.effect).toFixed(1),(100*(r.effect-baseline.effect)).toFixed(1),(100*r.mirrorAgreement).toFixed(1)].map(csv).join(','));
  }
  fs.writeFileSync(path.join(output,'results.csv'),lines.join('\n')+'\n');
  const report=study.report;
  const sections=[`# ${report.title}`,report.executiveSummary?.takeaway,report.overview,
    '## Findings',...report.findings.map(f=>`### ${f.title}\n\n${f.text}\n\nContexts: ${f.contextIds.join(', ')}`),
    '## Next studies',...report.nextStudies.map(s=>`- ${s}`),'## Limitations',...report.limitations.map(s=>`- ${s}`)];
  fs.writeFileSync(path.join(output,'report.md'),sections.filter(Boolean).join('\n\n')+'\n');
}
