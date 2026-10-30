import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './wrapper-fixtures.js';
import { plan,label } from './plan-fixtures.js';
import { reload } from '../lib/execution.js';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const owner=label(1),node=suffix=>owner+':'+suffix;
async function baseline(f){
 await f.prepare();const implementer=await f.accept(node('implement')),reviewer=await f.accept(node('behavior'));
 await f.confirm(node('risk'),{action:'risks',lenses:[]});await f.confirm(node('risk'));
 return {implementer,reviewer};
}
const add=(f,obligation)=>f.invoke('update',{reason:'Main admitted a concrete obligation',obligations:[obligation]});

test('Main adds residual Feature integration review without reopening accepted Sections; graph survives reload',async()=>{
 const f=await fixture();try{
  await baseline(f);await f.accept(node('blind'));await f.confirm(node('reconciliation'));await f.confirm(node('accept'));
  await add(f,{id:'composition-proof',purpose:'integration',feature:'business',needs:[node('accept')],before:['business:accept']});
  await assert.rejects(()=>f.confirm('business:accept'),/composition-proof/);
  await writeFile(join(f.repo,'.agent-work','PLAN-FULL.md'),plan()+'\n');await reload(f.run,f.repo);
  assert.ok(f.run.graph.nodes['composition-proof']);assert.equal(f.run.dispositions[node('accept')].decision,'accepted');
  const id=await f.spawn('composition-proof');const response=await f.wait(id);
  assert.equal(response.instructions[0].session_id,'session-'+id);
  assert.match(response.instructions[0].fullInstructions,/unproven_composition/);
  await f.confirm('composition-proof',{actor_id:id,round:1});await f.confirm('business:accept');
 }finally{await f.cleanup();}
});

test('dynamic declarations are atomic and reject cycles, unknown owners and weakening prerequisite attempts',async()=>{
 const f=await fixture();try{
  await f.prepare();const before=structuredClone(f.run.graph);
  await assert.rejects(()=>add(f,{id:'cycle-proof',purpose:'integration',feature:'business',needs:['business:accept'],before:['business:accept']}),/cycle/);
  assert.deepEqual(f.run.graph,before);
  await assert.rejects(()=>add(f,{id:'unknown-owner',purpose:'integration',feature:'absent',before:['delivery']}),/Feature/);
  await assert.rejects(()=>add(f,{id:'plan:initial',purpose:'focused-review',unit:owner,before:[node('accept')]}),/reserved|exists/);
  assert.equal(f.calls.filter(c=>c.command==='spawn').length,2);
 }finally{await f.cleanup();}
});

test('large-unit repair continues original implementer and closure continues finding author before fresh blind review',async()=>{
 const f=await fixture();try{
  const {implementer}=await baseline(f),reviewer=await f.spawn(node('blind'));await f.wait(reviewer);
  await add(f,{id:'owner-repair',purpose:'repair',unit:owner,implementation_actor_id:implementer,source_actor_id:reviewer,before:[node('blind')]});
  await assert.rejects(()=>f.spawn('owner-repair'),/continue|session/);
  await f.invoke('send',{agent_id:implementer,node:'owner-repair',content:'Repair admitted finding'});await f.wait(implementer);await f.confirm('owner-repair',{actor_id:implementer,round:2});
  await add(f,{id:'finding-closure',purpose:'closure',unit:owner,source_actor_id:reviewer,needs:['owner-repair'],before:[node('blind')]});
  await assert.rejects(()=>f.spawn(node('blind')),/finding-closure/);
  await assert.rejects(()=>f.spawn('finding-closure'),/continue|session/);
  await f.invoke('send',{agent_id:reviewer,node:'finding-closure',content:'Close your own finding on repaired head'});
  const result=await f.wait(reviewer);assert.equal(result.instructions[0].session_id,'session-'+reviewer);
  assert.match(result.instructions[0].instruction,/fresh|blind/);
  await f.confirm('finding-closure',{actor_id:reviewer,round:2});
  await assert.rejects(()=>f.invoke('send',{agent_id:reviewer,node:node('blind'),content:'Not a fresh blind session'}),/fresh/);
  const fresh=await f.accept(node('blind'));assert.notEqual(fresh,reviewer);
 }finally{await f.cleanup();}
});

test('standard-unit repair opens one large logical repair session then reuses it without selecting model routes',async()=>{
 const f=await fixture(plan().replace('impl_large','impl_std'));try{
  const {implementer,reviewer}=await baseline(f);
  const declare=id=>add(f,{id,purpose:'repair',unit:owner,implementation_actor_id:implementer,source_actor_id:reviewer,before:[node('blind')]});
  await declare('initial-repair');
  assert.equal(f.run.graph.nodes['initial-repair'].role,'impl_large');
  assert.equal(f.run.graph.nodes['initial-repair'].continueActor,null);
  const repair=await f.spawn('initial-repair');await f.wait(repair);await f.confirm('initial-repair',{actor_id:repair,round:1});
  await declare('subsequent-repair');assert.equal(f.run.graph.nodes['subsequent-repair'].continueActor,repair);
  await assert.rejects(()=>f.invoke('send',{agent_id:implementer,node:'subsequent-repair',content:'Wrong standard implementer'}),/session|continue/);
  await f.invoke('send',{agent_id:repair,node:'subsequent-repair',content:'Bounded subsequent repair'});await f.wait(repair);
  const dispatch=f.calls.find(c=>c.command==='spawn'&&c.args.prompt.includes('initial-repair'));
  assert.deepEqual(dispatch.args.profile,'caller-selected-profile');assert.equal(dispatch.args.model,undefined);
 }finally{await f.cleanup();}
});

test('same-head repair reconciliation continues its own blind reviewer, not an arbitrary review session',async()=>{
 const f=await fixture();try{
  const {reviewer:behavior}=await baseline(f),blind=await f.accept(node('blind'));
  await add(f,{id:'repair-impact',purpose:'repair-reconciliation',unit:owner,source_actor_id:blind,before:[node('reconciliation')]});
  await assert.rejects(()=>f.invoke('send',{agent_id:behavior,node:'repair-impact',content:'Wrong reviewer'}),/session|continue/);
  await f.invoke('send',{agent_id:blind,node:'repair-impact',content:'Frozen blind report now receives repair history'});await f.wait(blind);
  await f.confirm('repair-impact',{actor_id:blind,round:2});await f.confirm(node('reconciliation'));
 }finally{await f.cleanup();}
});
