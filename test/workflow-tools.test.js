import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile,readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture } from './wrapper-fixtures.js';
import { label,plan,section } from './plan-fixtures.js';
import { withRun } from '../lib/run-store.js';
import { registerWorkflowTools } from '../lib/workflow-tools.js';
const own=label(1),node=suffix=>`${own}:${suffix}`;

test('actual completion is not acceptance; terminal reports and Main confirmation release adjacent obligations',async()=>{
 const f=await fixture();try{
  await f.prepare();
  await assert.rejects(()=>f.spawn(node('blind')),/requires/);
  const id=await f.spawn(node('implement'));await f.wait(id);
  assert.equal(f.run.dispositions[node('implement')],undefined);
  await assert.rejects(()=>f.confirm(node('implement'),{actor_id:id,round:99}),/round/);
  await f.confirm(node('implement'),{actor_id:id,round:1});await f.accept(node('behavior'));
  assert.equal(f.calls.filter(c=>c.command==='spawn').length,4);
  await f.confirm(node('risk'),{action:'risks',lenses:[]});await f.confirm(node('risk'));
  const blind=await f.accept(node('blind'));
  await f.confirm(node('reconciliation'));await f.confirm(node('accept'));await f.confirm('business:accept');await f.confirm('delivery');
  assert.equal(f.run.dispositions.delivery.decision,'accepted');assert.ok(blind);
  assert.ok(f.calls.every(c=>!['close','respond'].includes(c.command)));
 }finally{await f.cleanup();}
});
test('entire batch prevalidation is side-effect free; mid-dispatch error preserves real IDs without retry/cancel',async()=>{
 const f=await fixture();try{
  await f.prepare();await f.accept(node('implement'));await f.accept(node('behavior'));
  await f.confirm(node('risk'),{action:'risks',lenses:['structure','scope']});
  const task=l=>({node:node('specialist:'+l),assignment:'independent frozen review',route:{subagent:'selected',model:'provider/caller'}});
  const before=f.calls.length;
  await assert.rejects(()=>f.invoke('spawn',{tasks:[task('structure'),{...task('scope'),route:{profile:'chosen',model:'bad'}}],reviewIsolation:'immutable content and isolated report/test sinks'}),/mutually exclusive/);
  assert.equal(f.calls.length,before);
  let calls=0;const rpc=async(cmd,args)=>{if(cmd==='spawn'&&++calls===2)throw new Error('transport lost after dispatch');return f.rpc(cmd,args);};
  const { spawn }=await import('../lib/execution.js');
  const answer=await spawn(f.run,f.repo,{tasks:[task('structure'),task('scope')],reviewIsolation:'immutable content and isolated report/test sinks'},rpc);
  assert.equal(answer.ok,false);assert.equal(answer.agent_ids.length,1);assert.equal(answer.failures[0].node,task('scope').node);assert.equal(calls,2);
  assert.equal(f.calls.some(c=>c.command==='cancel'),false);
 }finally{await f.cleanup();}
});
test('all-ID aggregation holds completed peers; pending input, failures and cancelled tasks never release a node',async()=>{
 const f=await fixture();try{
  await f.prepare();await f.accept(node('implement'));await f.accept(node('behavior'));await f.confirm(node('risk'),{action:'risks',lenses:['structure','scope']});
  const answer=await f.invoke('spawn',{tasks:['structure','scope'].map(l=>({node:node('specialist:'+l),assignment:'Frozen review',route:{profile:'selected'}})),reviewIsolation:'frozen content and isolated effects'});
  const [first,second]=answer.agent_ids;f.tasks.get(second).status='running';
  let response=await f.wait(first);assert.deepEqual(response.remaining_ids,[second]);assert.deepEqual(response.instructions,[]);
  await assert.rejects(()=>f.confirm(node('specialist:structure'),{actor_id:first,round:1}),/evidence/);
  f.tasks.get(second).pending_requests=[{kind:'user_input',request_id:'question',question:{text:'Choose',truncated:false}}];response=await f.wait(answer.agent_ids);assert.deepEqual(response.remaining_ids,[second]);
  f.tasks.get(second).pending_requests=[];f.tasks.get(second).status='failed';f.tasks.get(second).outcome='FAILED';response=await f.wait(answer.agent_ids);
  await assert.rejects(()=>f.confirm(node('specialist:scope'),{actor_id:second,round:1}),/evidence/);
  assert.equal(response.complete,true);
  assert.equal(f.calls.some(c=>c.command==='respond'||c.command==='cancel'),false);
 }finally{await f.cleanup();}
});
test('first role guidance once, short continuation with real identity, queued/stale round rejection and unsupported/changed sessions',async()=>{
 const f=await fixture();try{
  await f.prepare();const id=await f.spawn(node('implement'));const first=await f.wait(id);assert.ok(first.instructions[0].fullInstructions);
  const repeated=await f.wait(id);assert.equal(repeated.instructions[0].fullInstructions,undefined);
  await f.confirm(node('implement'),{actor_id:id,round:1});const review=await f.accept(node('behavior'));
  await f.confirm(node('behavior'),{action:'hold'});
  const sent=await f.invoke('send',{agent_id:id,purpose:'repair',content:'Repair admitted invariant'});assert.equal(sent.actor_id,id);
  assert.equal(f.run.actors[id].rounds.length,2);f.tasks.get(id).receipt='queued';await f.wait(id);
  await assert.rejects(()=>f.confirm(node('implement'),{actor_id:id,round:2}),/evidence|closures/);
  f.tasks.get(id).receipt='delivered';const waited=await f.wait(id);assert.equal(waited.instructions[0].fullInstructions,undefined);assert.equal(waited.instructions[0].actor_id,id);
  f.tasks.get(id).session_id='replacement';await assert.rejects(()=>f.invoke('send',{agent_id:id,purpose:'repair',content:'Repair again'}),/identity/);
  assert.equal(f.calls.filter(c=>c.command==='spawn'&&c.args.prompt.includes('Repair again')).length,0);
 }finally{await f.cleanup();}
});
test('plan reload preserves valid graph on invalid compile, blocks stale dispatch, and sees a fixed plan without a reset',async()=>{
 const f=await fixture();try{
  await f.prepare();const original=f.run.graph.digest;
  await writeFile(join(f.repo,'.agent-work','PLAN-FULL.md'),'malformed');
  await assert.rejects(()=>f.spawn(node('implement')),/no executable/);assert.equal(f.run.graph.digest,original);assert.ok(f.run.stale);
  await writeFile(join(f.repo,'.agent-work','PLAN-FULL.md'),plan());const id=await f.spawn(node('implement'));assert.ok(id);assert.equal(f.run.stale,null);
 }finally{await f.cleanup();}
});
test('serial Sections, child checkpoint and parent cumulative review are required independently of Feature acceptance',async()=>{
 const f=await fixture('# Plan\n'+section(1,{children:true})+section(2));try{
  await f.prepare();const child=own+'.A';await f.accept(child+':implement');
  await assert.rejects(()=>f.spawn(own+'.B:implement'),/checkpoint/);
  await assert.rejects(()=>f.spawn(label(2)+':implement'),/parallel Sections/);
  const reviewer=await f.accept(child+':checkpoint');await f.accept(own+'.B:implement');
  const second=await f.invoke('send',{agent_id:reviewer,node:own+'.B:checkpoint',purpose:'recheck',content:'Real next delta and cumulative invariants'});assert.equal(second.actor_id,reviewer);await f.wait(reviewer);await f.confirm(own+'.B:checkpoint',{actor_id:reviewer,round:2});
  await assert.rejects(()=>f.spawn(node('blind')),/risk/);
  await f.invoke('send',{agent_id:reviewer,node:node('reconcile'),purpose:'recheck',content:'Complete cumulative parent reconciliation'});await f.wait(reviewer);await f.confirm(node('reconcile'),{actor_id:reviewer,round:3});
  assert.equal(f.run.dispositions[node('accept')],undefined);assert.equal(f.run.dispositions['business:accept'],undefined);
 }finally{await f.cleanup();}
});
test('pagination preserves offsets; partial/empty reports are not evidence; observe and cancellation preserve history',async()=>{
 const f=await fixture();try{
  await f.prepare();const id=await f.spawn(node('implement'));f.tasks.get(id).next_offset=17;let waited=await f.wait(id);
  assert.equal(waited.instructions.length,0);await assert.rejects(()=>f.confirm(node('implement'),{actor_id:id,round:1}),/evidence/);
  const response=await f.invoke('result',{agent_id:id,offset:17});assert.equal(response.result.next_offset,null);await f.confirm(node('implement'),{actor_id:id,round:1});
  const reviewer=await f.spawn(node('behavior'));await f.invoke('observe',{agent_id:reviewer});await f.invoke('cencel',{agent_id:reviewer});await f.wait(reviewer);
  await assert.rejects(()=>f.confirm(node('behavior'),{actor_id:reviewer,round:1}),/evidence/);assert.ok(f.run.actors[reviewer]);
 }finally{await f.cleanup();}
});
test('session-scoped files, legacy detection and exact tool surface use real schemas with fake ES',async()=>{
 const f=await fixture();try{
  const tools=new Map();registerWorkflowTools({tools:{register:d=>tools.set(d.name,d)},workingDirectory:{ensure:async()=>f.repo}},{es:f.rpc});
  assert.ok(tools.has('sfd_subagent_cancel'));assert.ok(tools.has('sfd_cancel'));assert.ok(tools.has('sfd_workflow_update'));assert.equal(tools.has('sfd_subagent_respond'),false);assert.equal(tools.has('sfd_flow_init'),false);
  const call=(session)=>tools.get('sfd_compile_workflow').execute({},{agent:{session:{id:session}}});assert.equal((await call('first')).ok,true);assert.equal((await call('second')).ok,true);
  const first=await withRun(f.repo,'first',r=>r.id),second=await withRun(f.repo,'second',r=>r.id);assert.notEqual(first,second);
  for(const file of ['sfd-run.json','sfd-state.json']){
   await writeFile(join(f.repo,'.agent-work',file),'legacy');const r=await call('first');assert.equal(r.ok,false);assert.match(r.error,/legacy/);assert.equal(await readFile(join(f.repo,'.agent-work',file),'utf8'),'legacy');
  }
 }finally{await f.cleanup();}
});
test('Main reconciles partial dispatch explicitly; successful IDs survive and uncreated obligations remain required',async()=>{
 const f=await fixture();try{
  await f.prepare();await f.accept(node('implement'));await f.accept(node('behavior'));await f.confirm(node('risk'),{action:'risks',lenses:['structure','scope']});
  const {spawn}=await import('../lib/execution.js');let count=0;
  const response=await spawn(f.run,f.repo,{tasks:['structure','scope'].map(l=>({node:node('specialist:'+l),assignment:'Frozen scoped review',route:{profile:'caller-selected'}})),reviewIsolation:'immutable bytes and isolated sinks'},async(cmd,args)=>{if(cmd==='spawn'&&++count===2)throw new Error('dispatch failure');return f.rpc(cmd,args);});
  const id=response.agent_ids[0];await f.wait(id);await assert.rejects(()=>f.confirm(node('specialist:structure'),{actor_id:id,round:1}),/evidence/);
  await f.confirm(node('specialist:structure'),{action:'resolve',group_id:response.groupId});await f.confirm(node('specialist:structure'),{actor_id:id,round:1});
  await assert.rejects(()=>f.confirm(node('risk')),/specialist:scope/);assert.equal(f.calls.some(c=>c.command==='cancel'),false);
 }finally{await f.cleanup();}
});
