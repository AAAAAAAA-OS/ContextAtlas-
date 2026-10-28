import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {FixtureModel} from '../src/fixture.mjs';
import {createStudy,runStudy} from '../src/runner.mjs';
import {extractPaper} from '../src/engine.mjs';
import {readJson,writeJson,digest} from '../src/provider.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const directory=path.join(root,'prompts');fs.mkdirSync(directory,{recursive:true});
const captured={},latest={};
const model=new FixtureModel((role,system,payload)=>{captured[role]??={system,payload};latest[role]={system,payload};});
const input=readJson(path.join(root,'examples','collaboration-history.json'));
await extractPaper(model,fs.readFileSync(path.join(root,'examples','extraction-example.txt'),'utf8'),'extraction-example.txt');
await runStudy(createStudy(input),model);
const manifest={description:'Exact system prompts and representative user JSON payloads captured from the shipped engine with the default five-round, two-context, twelve-per-condition settings. Payload values are offline fixtures, not research results. Dynamic plan/review instructions adapt to contextsPerRound.',engineSha256:digest(fs.readFileSync(path.join(root,'src','engine.mjs'),'utf8')),roles:[]};
for(const [role,{system,payload}] of Object.entries(captured)){
  fs.writeFileSync(path.join(directory,`${role}.system.txt`),system+'\n');
  writeJson(path.join(directory,`${role}.payload.example.json`),payload);
  manifest.roles.push({role,systemFile:`${role}.system.txt`,payloadExampleFile:`${role}.payload.example.json`,systemSha256:digest(system)});
}
for(const role of ['plan','reflect'])writeJson(path.join(directory,`${role}.payload.later-round.example.json`),latest[role].payload);
// Keep template literals, including interpolation, available for exact methodological review.
const source=fs.readFileSync(path.join(root,'src','engine.ts'),'utf8');
const templates={};
const pattern=/ask\(model, '([^']+)', `([\s\S]*?)`, \{/g;
for(const match of source.matchAll(pattern))templates[match[1]]=match[2];
writeJson(path.join(directory,'templates.json'),{description:'Verbatim role-instruction template strings from src/engine.ts. Runtime prepends languageAndTrust and appends schema-derived validation limits. See system snapshots for complete assembled prompts.',instructions:templates});
writeJson(path.join(directory,'manifest.json'),manifest);
console.log(`Exported ${manifest.roles.length} exact role prompts to prompts/.`);
