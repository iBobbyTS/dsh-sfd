/** One durable machine state; PLAN-FULL and reviewer-authored reports remain separate evidence. */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { status as flowStatus } from './flow.js';

export const AGENT_WORK='.agent-work';
export const STATE_FILE='sfd-state.json';
const queues=new Map();
export const PHASES=['CLEANUP','PLAN','ACTIVE','DONE'];

export function initialState(repoRoot) {
  return {schema:1,repoRoot,createdAt:new Date().toISOString(),updatedAt:null,
    seq:0,phase:'CLEANUP',hold:null,task:null,git:{authority:null},flow:null,journal:[]};
}
export async function loadState(repoRoot) {
  let raw;
  try {raw=await readFile(join(repoRoot,AGENT_WORK,STATE_FILE),'utf8');}
  catch(e){if(e?.code==='ENOENT')return null;throw e;}
  let state;try{state=JSON.parse(raw);}catch(e){throw new Error(`sfd-state.json is not valid JSON: ${e.message}`);}
  if(state?.schema!==1)throw new Error(`Unsupported sfd-state.json schema: ${state?.schema}`);
  return state;
}
export async function detectWork(repoRoot) {
  const state=await loadState(repoRoot);
  if(state)return {present:true,kind:'state',state};
  const markers=[];
  for(const name of ['PLAN-FULL.md','FEATURE-STATE.md','REQUIREMENTS.md']) {
    try{await readFile(join(repoRoot,AGENT_WORK,name));markers.push(name)}catch(e){if(e?.code!=='ENOENT')throw e;}
  }
  return markers.length ? {present:true,kind:'legacy-markers',markers}:{present:false};
}
export async function flush(state) {
  const file=join(state.repoRoot,AGENT_WORK,STATE_FILE);
  await mkdir(dirname(file),{recursive:true});
  const tmp=`${file}.tmp-${process.pid}-${randomUUID()}`;
  await writeFile(tmp,`${JSON.stringify(state,null,2)}\n`,'utf8');
  await rename(tmp,file);
}
function record(state,kind,detail) {
  state.seq=(state.seq??0)+1;state.updatedAt=new Date().toISOString();
  state.journal=[...(state.journal??[]),{seq:state.seq,at:state.updatedAt,kind,detail}].slice(-500);
}
// Serializes read-modify-write operations per repository, eliminating lost updates
// between parallel tool calls. The stored state, not the model's copy, is authoritative.
export async function mutateState(repo,kind,fn,detail='') {
  const previous=queues.get(repo)??Promise.resolve();let release;
  const next=new Promise(resolve=>{release=resolve});
  queues.set(repo,next);await previous;
  try{
    const current=await loadState(repo);
    if(!current)throw new Error('SFD not started; call sfd_start first');
    const state=structuredClone(current);
    const result=await fn(state);
    record(state,kind,detail);
    await flush(state);
    return {state,result};
  }finally{release();if(queues.get(repo)===next)queues.delete(repo);}
}
export async function transition(state,kind,patch,detail='') {
  // Compatibility for the initial cleanup handoff. Do not use this on an
  // existing flow: mutateState reloads under a per-repository mutex.
  const next=structuredClone(state);Object.assign(next,structuredClone(patch??{}));
  record(next,kind,detail);await flush(next);return next;
}
export function gate(state){
  if(state.phase==='DONE')return{allowed:false,reason:'SFD run completed'};
  if(state.hold)return{allowed:false,reason:`Hold ${state.hold.kind}: ${state.hold.reason}`};
  return{allowed:true};
}
export function renderBrief(state,t=k=>k) {
  const lines=[`# SFD ${t('state.resume')}`,'',`- Phase: ${state.phase}`];
  if(state.task?.summary)lines.push(`- Task: ${state.task.summary}`);
  if(state.hold)lines.push(`- Hold: ${state.hold.kind}: ${state.hold.reason}`);
  if(state.flow){
    const s=flowStatus(state.flow);
    lines.push(`- Workflow revision: ${s.revision}`);
    for(const x of s.tasks.filter(x=>x.status!=='done'&&x.status!=='waived')){
      lines.push(`- ${x.id}: ${x.status}${x.missing.length?` (waiting for ${x.missing.join(', ')})`:''}`);
    }
    if(s.openFindings.length)lines.push(`- Open findings: ${s.openFindings.join(', ')}`);
    if(s.activeActors.length)lines.push(`- Live actors: ${s.activeActors.map(a=>`${a.id}→${a.task}`).join(', ')}`);
    if(Object.keys(s.waivers).length)lines.push(`- User waivers: ${Object.keys(s.waivers).join(', ')}`);
  }
  lines.push('',t('state.readSkillFirst'));
  return lines.join('\n');
}
