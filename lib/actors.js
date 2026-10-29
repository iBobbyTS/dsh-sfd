/** External-subagent CLI uses the same input and output schema as its MCP tools. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { ROUTES } from './es.js';
const run = promisify(execFile);
const END = new Set(['completed','failed','cancelled','timed_out','runtime_lost','result_invalid','closed']);
const git = async (repo, ...args) => (await run('git',['-C',repo,...args],{maxBuffer:32*1024*1024})).stdout;

export async function candidate(repo, taskId) {
  const h=createHash('sha256');
  if(taskId.startsWith('plan:')){
    const plan=await readFile(join(repo,'.agent-work','PLAN-FULL.md'));
    h.update(plan);return `plan:${h.digest('hex')}`;
  }
  h.update(await git(repo,'rev-parse','HEAD'));
  h.update(await git(repo,'diff','--binary','HEAD','--','.',':(exclude).agent-work'));
  const untracked=(await git(repo,'ls-files','--others','--exclude-standard','-z')).split('\0').filter(file=>file && !file.startsWith('.agent-work/'));
  for(const file of untracked){
    // git -z output preserves spaces and prevents ambiguous path boundaries
    const bytes=await readFile(join(repo,file));
    if(bytes.length>64*1024*1024)throw new Error(`oversized untracked candidate file: ${file}`);
    h.update(file);h.update('\0');h.update(bytes);
  }
  return `code:${h.digest('hex')}`;
}

export async function es(command, args, invoke=run) {
  const { stdout }=await invoke('external-subagent',[command,'--json',JSON.stringify(args)],{timeout:command==='wait'?45000:25000,maxBuffer:8*1024*1024});
  let value;
  try {value=JSON.parse(stdout);}catch{throw new Error(`external-subagent ${command} returned invalid JSON`);}
  if(value.ok!==true || value.result===undefined)throw new Error(`external-subagent ${command} failed: ${JSON.stringify(value.error??value).slice(0,1000)}`);
  return value.result;
}

export function spawnRequest(repo, task, assignment, lens) {
  if(typeof assignment!=='string' || !assignment.trim())throw new Error('assignment must be non-empty');
  const role=task.route;const route=ROUTES[role];
  if(!route)throw new Error(`unknown ES route: ${role}`);
  const prelude=task.type==='review' ? [
    'Independent REVIEW. Inspect the real candidate and the applicable SFD scope.',
    'Do not modify source, tests, branch, or HEAD. Report material findings with evidence.',
    'A completed tool call is not a CLEAN verdict. Do not assume other reviewers approved.',
    task.id.endsWith(':B1') ? 'Blind B1: independently inspect the entire bounded final diff. No A findings or repair narrative are provided.' : '',
    task.checkpoint?'SUBSECTION_DELTA: inspect actual increment and parent invariants; not a Section acceptance.':'',
    task.id.endsWith(':A') && !task.id.startsWith('plan:')?`Code A risk lens: ${lens??'R01'}.`:''
  ].filter(Boolean).join('\n') : 'Implement assigned bounded contract only; return test/changed-path handoff. Do not commit or manage branches.';
  const payload={repository:repo, prompt:`${prelude}\n\nTASK: ${task.id}\n${assignment}`};
  if(route.profile)payload.profile=route.profile;
  else {payload.subagent=route.subagent;payload.permission_mode=route.mode;if(route.model)payload.model=route.model;if(route.effort)payload.effort=route.effort;}
  return payload;
}

export async function collect(repo, agentId, invoke=es) {
  const wait=await invoke('wait',{agent_id:Number(agentId),wait_time:0});
  const state=wait.task?.status;
  if(!END.has(state))return {finished:false,status:state??'unknown',pendingRequests:wait.pending_requests??[]};
  const chunks=[];let offset=0;let outcome;
  for(let page=0;page<64;page++){
    const r=await invoke('result',{agent_id:Number(agentId),offset});
    const result=r.result;
    if(!result)throw new Error('terminal ES actor has no result');
    if(result.partial)throw new Error('ES returned partial result: cannot accept');
    if(outcome && result.outcome!==outcome)throw new Error('ES result outcome changed between pages');
    outcome=result.outcome;
    chunks.push(result.final_text??'');
    if(result.next_offset==null)break;
    if(!Number.isSafeInteger(result.next_offset)||result.next_offset<=offset)throw new Error('ES result pagination did not advance');
    offset=result.next_offset;
    if(page===63)throw new Error('ES result too many pages');
  }
  const full=chunks.join('');
  if(full.trim().length===0)throw new Error('empty actor report');
  const ok=(state==='completed'||state==='closed') && outcome==='COMPLETED';
  return {finished:true,status:ok?'completed':'failed',rawStatus:state,outcome,reportText:full};
}

export async function writeReport(repo, task, agentId, text) {
  const group=task.type==='review'?'reviews':'handoffs';
  const dir=join(repo,'.agent-work',group);await mkdir(dir,{recursive:true});
  const safe=task.id.replace(/[^a-zA-Z0-9_-]/g,'-');
  const file=`${safe}-${agentId}.md`;
  const target=join(dir,file);
  await writeFile(target,text,{encoding:'utf8',flag:'wx'});
  return `.agent-work/${group}/${file}`;
}
