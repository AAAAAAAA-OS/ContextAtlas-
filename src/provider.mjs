import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import readline from 'node:readline';
import {fileURLToPath} from 'node:url';

export const digest = value => crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
export const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
export function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), {recursive:true});
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2) + '\n');
  fs.renameSync(temp, file);
}
export function loadDotEnv(file = '.env') {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) throw new Error('Invalid .env assignment. Use KEY=value.');
    let value = match[2];
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1,-1);
    if (process.env[match[1]] === undefined) process.env[match[1]] = value;
  }
}
function integer(name, fallback, minimum=1, maximum=1000000) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw new Error(`Invalid ${name}.`);
  return value;
}
export function apiConfig() {
  const baseUrl = process.env.LLM_BASE_URL?.trim();
  const model = process.env.LLM_MODEL?.trim();
  if (!process.env.LLM_API_KEY || !baseUrl || !model) throw new Error('Set LLM_API_KEY, LLM_BASE_URL, and LLM_MODEL in the environment or .env.');
  const parsed = new URL(baseUrl);
  if (!['http:','https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('LLM_BASE_URL must be an HTTP(S) endpoint without credentials.');
  const reasoningEffort = process.env.LLM_REASONING_EFFORT?.trim() || undefined;
  const extraBody = process.env.LLM_EXTRA_BODY_JSON ? JSON.parse(process.env.LLM_EXTRA_BODY_JSON) : undefined;
  if (extraBody && (typeof extraBody !== 'object' || Array.isArray(extraBody))) throw new Error('LLM_EXTRA_BODY_JSON must be a JSON object.');
  if (extraBody && ['messages','stream','model','api_key','apiKey'].some(key => key in extraBody)) throw new Error('LLM_EXTRA_BODY_JSON cannot override messages, streaming, model, or credentials.');
  return {baseUrl, model, reasoningEffort, extraBody, concurrency:integer('LLM_CONCURRENCY',8,1,64),
    timeoutSeconds:integer('LLM_TIMEOUT_SECONDS',180), maxOutputTokens:integer('LLM_MAX_OUTPUT_TOKENS',5000),
    maxRetries:integer('LLM_MAX_RETRIES',2,0,8), python:process.env.PYTHON || 'python', stream:false};
}
export class PythonProvider {
  constructor(config, {bridgePath=fileURLToPath(new URL('../python/bridge.py',import.meta.url))}={}) {
    this.config = config; this.pending = new Map(); this.nextId = 0;
    this.child = spawn(config.python, [bridgePath], {
      stdio:['pipe','pipe','pipe'], env:{...process.env,PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8'}, windowsHide:true,
    });
    this.errorText = '';
    this.child.stderr.on('data', chunk => { this.errorText = (this.errorText + chunk.toString()).slice(-2500); });
    const failAll = error => { for(const item of this.pending.values()) item.reject(error); this.pending.clear(); };
    this.child.on('error', error => failAll(new Error(`Cannot start Python bridge: ${error.message}`)));
    this.child.on('exit', code => { if (this.pending.size) failAll(new Error(`Python bridge exited (${code}). ${this.errorText.replaceAll(process.env.LLM_API_KEY || '\0','[REDACTED]')}`)); });
    readline.createInterface({input:this.child.stdout}).on('line', line => {
      let result; try { result=JSON.parse(line); } catch { failAll(new Error('Invalid Python bridge output.')); return; }
      const pending=this.pending.get(result.id); if(!pending) return;
      if(result.event) { pending.events.push(result); return; }
      this.pending.delete(result.id);
      result.events=pending.events;
      if(result.messagesSha256 !== pending.hash) pending.reject(new Error('Message integrity check failed.'));
      else pending.resolve(result);
    });
  }
  request(role, system, payload) {
    const messages=[{role:'system',content:system},{role:'user',content:JSON.stringify(payload)}];
    const id=String(++this.nextId);
    return new Promise((resolve,reject)=>{
      this.pending.set(id,{resolve,reject,hash:digest(messages),events:[]});
      this.child.stdin.write(JSON.stringify({id,role,messages,settings:this.config})+'\n','utf8',error=>{
        if(error) {this.pending.delete(id);reject(error);}
      });
    });
  }
  close() { this.child.stdin.end(); }
}
export class RecordedModel {
  constructor(provider, output, {retryUncertain=false}={}) {
    this.provider=provider;this.output=output;this.retryUncertain=retryUncertain;
    fs.mkdirSync(path.join(output,'calls'),{recursive:true});
  }
  async call(role,system,payload) {
    const request={role,system,payload}; const hash=digest(request);
    const file=path.join(this.output,'calls',`${role}-${hash}.json`);
    let attempts=[];
    if(fs.existsSync(file)) {
      const previous=readJson(file);
      if(previous.status==='completed') return previous.parsed;
      if(previous.status==='invalid') throw new Error(`Stored ${role} response is invalid. Inspect ${path.basename(file)}; accepted decisions are never resampled automatically.`);
      if(previous.status==='pending' && !this.retryUncertain) throw new Error(`An interrupted ${role} call has an uncertain provider outcome. Inspect calls/ and explicitly use --retry-uncertain to repeat it.`);
      attempts=previous.attempts || [];
    }
    const record={hash,request,status:'pending',startedAt:new Date().toISOString(),attempts};
    writeJson(file,record);
    let response;
    try { response=await this.provider.request(role,system,payload); }
    catch(error) {record.error=error.message;writeJson(file,record);throw error;}
    record.attempts.push(response);record.completedAt=new Date().toISOString();
    if(response.error) {
      record.status=response.uncertain?'pending':'failed';record.error=response.message;
      writeJson(file,record); throw new Error(`${role}: ${response.error}: ${response.message}`);
    }
    if(response.finishReason && !['stop','completed'].includes(response.finishReason)) {
      record.status='invalid';writeJson(file,record);throw new Error(`${role} response ended with ${response.finishReason}; inspect calls/ before changing output limits.`);
    }
    try {record.parsed=JSON.parse(response.content);record.status='completed';}
    catch {record.status='invalid';writeJson(file,record);throw new Error(`${role} did not return a JSON object.`);}
    writeJson(file,record);return record.parsed;
  }
}
export function usageSummary(output) {
  let inputTokens=0,outputTokens=0,totalTokens=0,providerAttempts=0,completedCalls=0,uncertainCalls=0;
  const byRole={};
  for(const name of fs.readdirSync(path.join(output,'calls'))) {
    if(!name.endsWith('.json'))continue;
    const call=readJson(path.join(output,'calls',name));
    if(call.status==='pending')uncertainCalls++;
    for(const response of call.attempts||[]) {
      const usage=response.usage||{};
      inputTokens+=usage.prompt_tokens||0;outputTokens+=usage.completion_tokens||0;totalTokens+=usage.total_tokens||0;
      providerAttempts+=response.attempts||0;
      const entry=byRole[call.request.role]??={completedCalls:0,tokens:0};
      entry.tokens+=usage.total_tokens||0;
      if(!response.error){completedCalls++;entry.completedCalls++;}
    }
  }
  return {inputTokens,outputTokens,totalTokens,providerAttempts,completedCalls,uncertainCalls,byRole,
    cost:null,costNote:'Monetary cost is not inferred. Token counts are provider-reported; interrupted or rejected requests may have unreported usage.'};
}
