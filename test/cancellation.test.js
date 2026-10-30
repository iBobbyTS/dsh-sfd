import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture } from './wrapper-fixtures.js';
import { label } from './plan-fixtures.js';
import { withRun,readRun } from '../lib/run-store.js';
import { registerWorkflowTools } from '../lib/workflow-tools.js';
const own=label(1),node=suffix=>own+':'+suffix;
async function tools(f){
 await withRun(f.repo,'cancel-session',r=>Object.assign(r,structuredClone(f.run)));
 const definitions=new Map();registerWorkflowTools({tools:{register:d=>definitions.set(d.name,d)},workingDirectory:{ensure:async()=>f.repo}},{es:f.rpc});
 return (name,args)=>definitions.get(name).execute(args,{agent:{session:{id:'cancel-session'}}});
}

test('canonical single-actor cancel remains callable on invalid graph and does not forge terminal state',async()=>{
 const f=await fixture();try{
  await f.prepare();const id=await f.spawn(node('implement'));f.tasks.get(id).status='running';const call=await tools(f);
  await writeFile(join(f.repo,'.agent-work','PLAN-FULL.md'),'invalid plan');
  const response=await call('sfd_subagent_cancel',{agent_id:id});assert.equal(response.ok,true);assert.match(response.graphWarning,/no executable/);
  const saved=await readRun(f.repo,'cancel-session');assert.equal(saved.actors[id].rounds[0].status,'running');assert.equal(saved.dispositions[node('implement')],undefined);
  assert.deepEqual(f.calls.filter(c=>c.command==='cancel').map(c=>c.args.agent_id),[Number(id)]);
  assert.equal(f.calls.some(c=>['respond','send'].includes(c.command)),false);
 }finally{await f.cleanup();}
});

test('process cancellation requests only explicitly selected IDs, validates the entire list, and waits for actual outcomes',async()=>{
 const f=await fixture();try{
  await f.prepare();await f.accept(node('implement'));await f.accept(node('behavior'));await f.confirm(node('risk'),{action:'risks',lenses:['structure','scope']});
  const response=await f.invoke('spawn',{tasks:['structure','scope'].map(l=>({node:node('specialist:'+l),assignment:'Frozen review',route:{profile:'caller-selected'}})),reviewIsolation:'immutable source and isolated effects'});
  const [selected,peer]=response.agent_ids;for(const id of response.agent_ids)f.tasks.get(id).status='running';const call=await tools(f);
  const before=f.calls.length;const invalid=await call('sfd_cancel',{agent_ids:[selected,'99999999'],reason:'Main selected IDs'});assert.equal(invalid.ok,false);assert.equal(f.calls.length,before);
  const cancelled=await call('sfd_cancel',{agent_ids:[selected],reason:'User changed this work; retain other reviewer'});assert.equal(cancelled.ok,true);
  assert.deepEqual(f.calls.filter(c=>c.command==='cancel').map(c=>String(c.args.agent_id)),[selected]);assert.equal(f.tasks.get(peer).status,'running');
  const waited=await call('sfd_subagent_wait',{agent_ids:response.agent_ids,wait_time:0});assert.deepEqual(waited.remaining_ids,[peer]);assert.deepEqual(waited.instructions,[]);
  const confirmed=await call('sfd_workflow_confirm',{node:node('specialist:structure'),action:'accept',reason:'Cannot accept cancelled report',actor_id:selected,round:1});assert.equal(confirmed.ok,false);
 }finally{await f.cleanup();}
});
