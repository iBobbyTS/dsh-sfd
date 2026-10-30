import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture } from './wrapper-fixtures.js';
import { label,plan,section } from './plan-fixtures.js';
import { reload } from '../lib/execution.js';
const own=label(1),node=suffix=>own+':'+suffix;
async function start(f){await f.prepare();const implementer=await f.accept(node('implement')),reviewer=await f.accept(node('behavior'));return {implementer,reviewer};}
const update=(f,obligations)=>f.invoke('update',{reason:'Main specified current evidence dependencies',obligations});

test('updating a declared obligation changes graph order without accepting old report on new prerequisites',async()=>{
 const f=await fixture();try{
  await start(f);
  await update(f,[{id:'consumer-proof',purpose:'focused-review',unit:own,before:[node('risk')]}]);const first=await f.accept('consumer-proof');
  await update(f,[{id:'finding-proof',purpose:'verify-finding',unit:own,before:['consumer-proof']}]);
  await update(f,[{id:'consumer-proof',purpose:'focused-review',unit:own,needs:['finding-proof'],before:[node('risk')]}]);
  await assert.rejects(()=>f.spawn('consumer-proof'),/finding-proof/);
  await f.accept('finding-proof');await assert.rejects(()=>f.confirm('consumer-proof',{actor_id:first,round:1}),/evidence/);
  assert.ok(await f.accept('consumer-proof'));
 }finally{await f.cleanup();}
});

test('adding obligations cannot drop unresolved retired mandatory plan nodes from delivery gates',async()=>{
 const f=await fixture(plan(2));try{
  await f.prepare();await writeFile(join(f.repo,'.agent-work','PLAN-FULL.md'),plan());await reload(f.run,f.repo);
  const retired=label(2)+':blind';assert.ok(f.run.graph.nodes.delivery.needs.includes(retired));
  await update(f,[{id:'remaining-composition',purpose:'integration',feature:'business',before:['business:accept']}]);
  assert.ok(f.run.graph.nodes.delivery.needs.includes(retired));assert.equal(f.run.dispositions[retired],undefined);
 }finally{await f.cleanup();}
});

test('predeclared standard-unit repairs resolve the one real escalated session at dispatch time',async()=>{
 const f=await fixture(plan().replace('impl_large','impl_std'));try{
  const {implementer,reviewer}=await start(f);
  const task=id=>({id,purpose:'repair',unit:own,implementation_actor_id:implementer,source_actor_id:reviewer,before:[node('blind')]});
  await update(f,[task('owner-correction'),task('followup-correction')]);
  const repair=await f.accept('owner-correction'),before=f.calls.length;
  await assert.rejects(()=>f.spawn('followup-correction'),/continue/);assert.equal(f.calls.length,before);
  await f.invoke('send',{agent_id:repair,node:'followup-correction',content:'Continue original escalated repair session'});await f.wait(repair);
 }finally{await f.cleanup();}
});

test('first independent Plan B cannot continue Plan A, and checkpoint discovery cannot replace parent R01',async()=>{
 const f=await fixture('# Plan\n'+section(1,{children:true}));try{
  await reload(f.run,f.repo,{compile:true});const initial=await f.accept('plan:initial');
  await assert.rejects(()=>f.invoke('send',{agent_id:initial,node:'plan:final',content:'Reusing plan reviewer for first B'}),/fresh/);
  await f.accept('plan:final');await f.accept(own+'.A:implement');const reviewer=await f.accept(own+'.A:checkpoint');await f.accept(own+'.B:implement');
  await assert.rejects(()=>f.spawn(own+'.B:checkpoint'),/continue/);
  await f.invoke('send',{agent_id:reviewer,node:own+'.B:checkpoint',content:'Actual continuing checkpoint'});await f.wait(reviewer);
 }finally{await f.cleanup();}
});

test('child repair-delta restores its checkpoint in the same parent reviewer session, not a fresh review',async()=>{
 const f=await fixture('# Plan\n'+section(1,{children:true}));try{
  await f.prepare();const child=own+'.A';await f.accept(child+':implement');const reviewer=await f.spawn(child+':checkpoint');await f.wait(reviewer);
  await update(f,[{id:'checkpoint-closure',purpose:'repair-delta',unit:child,source_actor_id:reviewer,before:[child+':checkpoint']}]);
  await assert.rejects(()=>f.spawn(own+'.B:implement'),/checkpoint/);
  await f.invoke('send',{agent_id:reviewer,node:'checkpoint-closure',content:'Verify repaired own IDs and invalidated safe intermediate invariants'});await f.wait(reviewer);
  await f.confirm('checkpoint-closure',{actor_id:reviewer,round:2});await f.confirm(child+':checkpoint',{actor_id:reviewer,round:2});
  assert.ok(await f.spawn(own+'.B:implement'));
 }finally{await f.cleanup();}
});

test('risk reselection preserves independent Main-declared specialist prerequisites',async()=>{
 const f=await fixture();try{
  await start(f);await update(f,[{id:'independent-risk-proof',purpose:'focused-review',unit:own,before:[node('risk')]}]);
  await f.confirm(node('risk'),{action:'risks',lenses:[]});assert.ok(f.run.graph.nodes[node('risk')].needs.includes('independent-risk-proof'));
  await assert.rejects(()=>f.confirm(node('risk')),/independent-risk-proof/);
  await f.accept('independent-risk-proof');await f.confirm(node('risk'));
 }finally{await f.cleanup();}
});

test('a restarted blind review rebinds reconciliation to the new actual B1 session, never the prior candidate',async()=>{
 const f=await fixture();try{
  await start(f);await f.confirm(node('risk'));const original=await f.accept(node('blind'));
  const reconciliation=source=>({id:'repair-impact-proof',purpose:'repair-reconciliation',unit:own,source_actor_id:source,before:[node('reconciliation')]});
  await update(f,[reconciliation(original)]);await f.invoke('send',{agent_id:original,node:'repair-impact-proof',content:'Reconcile original candidate'});await f.wait(original);await f.confirm('repair-impact-proof',{actor_id:original,round:2});
  await f.confirm(node('blind'),{action:'hold'});const fresh=await f.accept(node('blind'));
  const guide=(await f.wait(fresh)).instructions[0];assert.equal(guide.successors.find(s=>s.node==='repair-impact-proof').next.source_actor_id,fresh);
  await assert.rejects(()=>f.invoke('send',{agent_id:original,node:'repair-impact-proof',content:'Wrong old B1 session'}),/current fresh blind reviewer/);
  await update(f,[reconciliation(fresh)]);await f.invoke('send',{agent_id:fresh,node:'repair-impact-proof',content:'Reconcile new frozen candidate'});await f.wait(fresh);
  await f.confirm('repair-impact-proof',{actor_id:fresh,round:2});assert.equal(f.run.actors[original].rounds.length,2);
 }finally{await f.cleanup();}
});
