import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture } from './wrapper-fixtures.js';
import { label,plan,section } from './plan-fixtures.js';
import { reload } from '../lib/execution.js';
const own=label(1),node=suffix=>own+':'+suffix;

test('trailing blank lines preserve the exact plan review receipts without another dispatch',async()=>{
 const f=await fixture();try{
  await f.prepare();const previous=structuredClone(f.run.dispositions),revision=f.run.revision,count=f.calls.length;
  await writeFile(join(f.repo,'.agent-work','PLAN-FULL.md'),plan()+'\n\n');await reload(f.run,f.repo);
  assert.deepEqual(f.run.dispositions,previous);assert.equal(f.run.revision,revision);assert.equal(f.calls.length,count);
  assert.ok(await f.spawn(node('implement')));
 }finally{await f.cleanup();}
});

test('Main retains unaffected plan coverage while affected Plan B continues its actual original session',async()=>{
 const f=await fixture();try{
  await f.prepare();const initial=Object.values(f.run.actors).find(a=>a.node==='plan:initial'),final=Object.values(f.run.actors).find(a=>a.node==='plan:final');
  const originalRevision=initial.rounds[0].revision;
  await writeFile(join(f.repo,'.agent-work','PLAN-FULL.md'),plan().replace('Foundation','Clarified contract'));await reload(f.run,f.repo);
  await assert.rejects(()=>f.confirm('plan:initial',{actor_id:initial.id,round:1}),/evidence/);
  await f.confirm('plan:initial',{action:'retain',actor_id:initial.id,round:1,reason:'Main checked the changed cone; original A coverage remains applicable'});
  assert.equal(initial.rounds[0].revision,originalRevision);assert.equal(initial.rounds.length,1);
  await assert.rejects(()=>f.spawn(node('implement')),/plan:final/);
  await f.invoke('send',{agent_id:final.id,content:'Complete final plan review after bounded corrections'});await f.wait(final.id);await f.confirm('plan:final',{actor_id:final.id,round:2});
  assert.ok(await f.spawn(node('implement')));
 }finally{await f.cleanup();}
});

test('Plan B corrections recheck affected A in its own session then complete continuing B',async()=>{
 const f=await fixture();try{
  await f.prepare();const initial=Object.values(f.run.actors).find(a=>a.node==='plan:initial'),final=Object.values(f.run.actors).find(a=>a.node==='plan:final');
  await writeFile(join(f.repo,'.agent-work','PLAN-FULL.md'),plan().replace('Foundation','Corrected scope'));await reload(f.run,f.repo);
  await f.invoke('update',{reason:'B correction invalidated original A cone',obligations:[{id:'affected-plan-proof',purpose:'plan-delta',source_actor_id:initial.id,before:['plan:final']}]});
  await assert.rejects(()=>f.spawn('affected-plan-proof'),/continue/);
  await f.invoke('send',{agent_id:initial.id,node:'affected-plan-proof',content:'Bounded invalidated-cone plan recheck'});const response=await f.wait(initial.id);
  assert.equal(response.instructions[0].fullInstructions,undefined);assert.equal(response.instructions[0].session_id,initial.sessionId);
  await f.confirm('affected-plan-proof',{actor_id:initial.id,round:2});await f.confirm('plan:initial',{actor_id:initial.id,round:2});
  await f.invoke('send',{agent_id:final.id,content:'Complete current corrected plan review'});await f.wait(final.id);await f.confirm('plan:final',{actor_id:final.id,round:2});
  assert.ok(await f.spawn(node('implement')));
 }finally{await f.cleanup();}
});

test('one real final-child report may author separate checkpoint and parent reconciliation conclusions',async()=>{
 const f=await fixture('# Plan\n'+section(1,{children:true}));try{
  await f.prepare();await f.accept(own+'.A:implement');const reviewer=await f.accept(own+'.A:checkpoint');
  await f.accept(own+'.B:implement');const count=f.calls.filter(c=>c.command==='send').length;
  await f.invoke('send',{agent_id:reviewer,node:own+'.B:checkpoint',covers:[node('reconcile')],content:'Author final delta and cumulative parent conclusions separately with joint oracles'});await f.wait(reviewer);
  await assert.rejects(()=>f.confirm(node('reconcile'),{actor_id:reviewer,round:2}),/requires/);
  await f.confirm(own+'.B:checkpoint',{actor_id:reviewer,round:2});await f.confirm(node('reconcile'),{actor_id:reviewer,round:2});
  assert.equal(f.calls.filter(c=>c.command==='send').length,count+1);
  assert.equal(f.run.dispositions[own+'.B:checkpoint'].actorId,f.run.dispositions[node('reconcile')].actorId);
  await f.confirm(node('behavior'));
 }finally{await f.cleanup();}
});

test('ordinary checkpoint and unrelated obligations cannot claim combined report evidence',async()=>{
 const f=await fixture('# Plan\n'+section(1,{children:true}));try{
  await f.prepare();await f.accept(own+'.A:implement');
  await assert.rejects(()=>f.spawn(own+'.A:checkpoint',{covers:[node('reconcile')]}),/final child/);
  const id=await f.accept(own+'.A:checkpoint');await f.accept(own+'.B:implement');
  await f.invoke('send',{agent_id:id,node:own+'.B:checkpoint',content:'Only checkpoint result'});await f.wait(id);await f.confirm(own+'.B:checkpoint',{actor_id:id,round:2});
  await assert.rejects(()=>f.confirm(node('reconcile'),{actor_id:id,round:2}),/evidence/);
 }finally{await f.cleanup();}
});

test('a reviewer continued through plan-delta remains eligible for explicit unaffected-evidence retention on later revisions',async()=>{
 const f=await fixture();try{
  await f.prepare();const initial=Object.values(f.run.actors).find(a=>a.node==='plan:initial');
  const changed=plan().replace('Foundation','Clarified contract');await writeFile(join(f.repo,'.agent-work','PLAN-FULL.md'),changed);await reload(f.run,f.repo);
  await f.invoke('update',{reason:'Affected original Plan A evidence',obligations:[{id:'bounded-plan-proof',purpose:'plan-delta',source_actor_id:initial.id,before:['plan:final']}]});
  await f.invoke('send',{agent_id:initial.id,node:'bounded-plan-proof',content:'Actual bounded recheck'});await f.wait(initial.id);await f.confirm('bounded-plan-proof',{actor_id:initial.id,round:2});await f.confirm('plan:initial',{actor_id:initial.id,round:2});
  const reportRevision=initial.rounds[1].revision;
  await writeFile(join(f.repo,'.agent-work','PLAN-FULL.md'),changed.replace('# Plan','# Revised plan'));await reload(f.run,f.repo);
  await f.confirm('plan:initial',{action:'retain',actor_id:initial.id,round:2,reason:'Main checked that this later edit does not invalidate the bounded A evidence'});
  assert.equal(initial.rounds.length,2);assert.equal(initial.rounds[1].revision,reportRevision);assert.equal(f.run.dispositions['plan:initial'].retained,true);
 }finally{await f.cleanup();}
});
