import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './wrapper-fixtures.js';
import { label,plan,section } from './plan-fixtures.js';
const own=label(1),node=suffix=>own+':'+suffix;

test('first standard implementer instructions include complete repair routing and concrete actual identity',async()=>{
 const f=await fixture(plan().replace('impl_large','impl_std'));try{
  await f.prepare();const id=await f.spawn(node('implement')),response=await f.wait(id),guide=response.instructions[0];
  assert.equal(guide.session_id,'session-'+id);assert.equal(guide.scope.unit,own);
  assert.match(guide.fullInstructions,/one escalated impl_large repair session/);assert.match(guide.instruction,/first admitted repair.*impl_std/);
  assert.equal(guide.sessions.original_implementer.agent_id,id);
  assert.equal(guide.successors[0].next.node,node('behavior'));
  assert.equal((await f.wait(id)).instructions[0].fullInstructions,undefined);
 }finally{await f.cleanup();}
});

test('child checkpoint and parent reconciliation carry distinct obligations with same real parent reviewer',async()=>{
 const f=await fixture('# Plan\n'+section(1,{children:true}));try{
  await f.prepare();await f.accept(own+'.A:implement');const reviewer=await f.spawn(own+'.A:checkpoint'),response=await f.wait(reviewer);
  const guide=response.instructions[0];assert.equal(guide.purpose,'checkpoint');assert.match(guide.fullInstructions,/safe.intermediate.state/);
  assert.match(guide.instruction,new RegExp('parent R01 '+reviewer));assert.match(guide.instruction,/No next child/);
  await f.confirm(own+'.A:checkpoint',{actor_id:reviewer,round:1});await f.accept(own+'.B:implement');
  await f.invoke('send',{agent_id:reviewer,node:own+'.B:checkpoint',covers:[node('reconcile')],content:'Both real conclusions'});
  const next=await f.wait(reviewer);assert.equal(next.instructions[0].fullInstructions,undefined);assert.equal(next.instructions[0].session_id,guide.session_id);
 }finally{await f.cleanup();}
});

test('blind review guidance names its actual closure and same-head reconciliation session',async()=>{
 const f=await fixture();try{
  await f.prepare();await f.accept(node('implement'));await f.accept(node('behavior'));await f.confirm(node('risk'));
  const reviewer=await f.spawn(node('blind')),guide=(await f.wait(reviewer)).instructions[0];
  assert.match(guide.instruction,/Freeze.*before exposing/);assert.match(guide.instruction,new RegExp('source_actor_id='+reviewer));
  assert.match(guide.instruction,/fresh complete blind/);assert.match(guide.instruction,/do not send an empty/);
  await f.confirm(node('blind'),{actor_id:reviewer,round:1});await f.confirm(node('reconciliation'));const accepted=await f.confirm(node('accept'));
  assert.match(accepted.instructions[0].instruction,/every admitted closure and required checks/);
  const nextFeature=accepted.instructions.find(g=>g.purpose==='feature-acceptance');assert.match(nextFeature.fullInstructions,/unproven_composition/);
  const feature=await f.confirm('business:accept');assert.equal(feature.instructions[0].fullInstructions,undefined);
  assert.match(feature.instructions[0].instruction,/cross-Feature interactions/);
 }finally{await f.cleanup();}
});

test('pending group names remaining IDs and preserves explicit diagnostic branch without result handling',async()=>{
 const f=await fixture();try{
  await f.prepare();const id=await f.spawn(node('implement'));f.tasks.get(id).status='running';const response=await f.wait(id);
  assert.deepEqual(response.remaining_ids,[id]);assert.deepEqual(response.instructions,[]);
  assert.match(response.instruction.instruction,/lack of progress.*abnormal exit/);assert.match(response.instruction.instruction,/sfd_subagent_observe/);
 }finally{await f.cleanup();}
});
