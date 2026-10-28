#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {apiConfig,loadDotEnv,PythonProvider,RecordedModel,readJson,writeJson,digest,usageSummary} from './provider.mjs';
import {createStudy,runStudy,writeReports} from './runner.mjs';
import {FixtureProvider} from './fixture.mjs';
import {extractPaper} from './engine.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const runtimeHashes=()=>Object.fromEntries(['src/engine.mjs','src/runner.mjs','src/provider.mjs','src/cli.mjs','python/bridge.py'].map(name=>[name,digest(fs.readFileSync(path.join(root,name),'utf8'))]));
const [command,...args]=process.argv.slice(2);
const flag=name=>{const index=args.indexOf(name);return index<0?undefined:args[index+1];};
const output=path.resolve(flag('--output')||(command==='demo'?'runs/offline-demo':''));
const known=new Set(['--input','--output','--retry-uncertain']);
for(let i=0;i<args.length;i++) {
  if(!known.has(args[i]))throw new Error(`Unknown argument: ${args[i]}`);
  if(args[i]!=='--retry-uncertain' && (!args[++i] || args[i].startsWith('--')))throw new Error('Missing argument value.');
}
function acquireLock(directory){
  const lock=path.join(directory,'.run.lock');
  if(fs.existsSync(lock)){
    const previous=readJson(lock);let live=false;
    try{process.kill(previous.pid,0);live=true;}catch(error){if(error.code!=='ESRCH')live=true;}
    if(live)throw new Error(`Another process (${previous.pid}) is using this output directory.`);
    fs.unlinkSync(lock);
  }
  const descriptor=fs.openSync(lock,'wx');fs.writeFileSync(descriptor,JSON.stringify({pid:process.pid,at:new Date().toISOString()}));fs.closeSync(descriptor);
  return()=>{if(fs.existsSync(lock))fs.unlinkSync(lock);};
}
let provider,unlock;
try{
  if(!['run','resume','demo','extract'].includes(command))throw new Error('Use run, resume, demo, or extract. See README for examples.');
  if(command!=='demo'&&!flag('--output'))throw new Error('--output is required.');
  loadDotEnv();
  const demo=command==='demo';
  if(command==='extract'){
    if(!flag('--input'))throw new Error('--input must name a UTF-8 plain-text file.');
    if(fs.existsSync(output))throw new Error('Extraction output already exists; choose a new file.');
    const config=apiConfig();provider=new PythonProvider(config);
    const ledger=output+'.calls';fs.mkdirSync(ledger,{recursive:true});unlock=acquireLock(ledger);
    const model=new RecordedModel(provider,ledger,{retryUncertain:args.includes('--retry-uncertain')});
    const extraction=await extractPaper(model,fs.readFileSync(flag('--input'),'utf8'),path.basename(flag('--input')));
    writeJson(output,extraction);writeJson(path.join(ledger,'usage.json'),usageSummary(ledger));
    console.log(`Extraction saved to ${output}`);
  }else{
    const checkpoint=path.join(output,'study.json');let study,manifest;
    if(command==='resume'){
      study=readJson(checkpoint);manifest=readJson(path.join(output,'manifest.json'));
      if(study.stage==='completed'){writeReports(study,output);console.log('Study already completed; no API requests made.');process.exit(0);}
      if(digest(fs.readFileSync(new URL('./engine.mjs',import.meta.url),'utf8'))!==manifest.engineSha256)throw new Error('Engine changed since this run. Resume with the matching release.');
      if(digest(runtimeHashes())!==digest(manifest.runtimeHashes))throw new Error('Runtime source changed since this run. Resume with the matching release.');
      if(digest(study.input)!==manifest.inputSha256)throw new Error('Study input changed since this run. Start a new output directory.');
    }else{
      if(fs.existsSync(output)&&fs.readdirSync(output).length)throw new Error('Output directory is not empty. Use a new directory or resume.');
      const inputFile=flag('--input')||path.join(root,'examples','collaboration-history.json');
      study=createStudy(readJson(inputFile),path.basename(output));
    }
    const isFixture=demo||manifest?.mode==='offline-fixture';
    const config=isFixture?{model:'offline-fixture',concurrency:8,stream:false}:apiConfig();
    if(manifest&&digest(config)!==manifest.settingsSha256)throw new Error('API settings differ from the recorded run. Restore the original settings or start a new run.');
    fs.mkdirSync(output,{recursive:true});unlock=acquireLock(output);
    manifest??={formatVersion:1,createdAt:new Date().toISOString(),mode:isFixture?'offline-fixture':'llm-api',
      settings:config,runtimeHashes:runtimeHashes(),settingsSha256:digest(config),inputSha256:digest(study.input),engineSha256:digest(fs.readFileSync(new URL('./engine.mjs',import.meta.url),'utf8')),
      plannedDecisions:(1+study.input.rounds*study.input.contextsPerRound)*study.input.perCondition*2,
      note:isFixture?'Programmed offline software fixture; not research evidence.':'Fresh memory; outputs produced through the configured LLM API.'};
    writeJson(path.join(output,'manifest.json'),manifest);writeJson(checkpoint,study);
    provider=isFixture?new FixtureProvider():new PythonProvider(config);
    const model=new RecordedModel(provider,output,{retryUncertain:args.includes('--retry-uncertain')});
    console.log(`Mode: ${manifest.mode}; planned decisions: ${manifest.plannedDecisions}; rounds: ${study.input.rounds}.`);
    try{await runStudy(study,model,{save:s=>writeJson(checkpoint,s),concurrency:config.concurrency,onProgress:message=>console.log(message)});}
    finally{writeJson(path.join(output,'usage.json'),usageSummary(output));}
    writeReports(study,output);console.log(`Saved report and complete audit record to ${output}`);
  }
}catch(error){console.error(error.message);process.exitCode=1;}
finally{provider?.close();unlock?.();}
