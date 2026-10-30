import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './wrapper-fixtures.js';
import { label } from './plan-fixtures.js';
import { send } from '../lib/execution.js';
const own=label(1),node=suffix=>own+':'+suffix;

test('uncontinuable original reviewer permits one explicit same-route gap replacement without fake session continuity',async()=>{
 const f=await fixture();try{
  await f.prepare();const original=Object.values(f.run.actors).find(a=>a.node==='plan:initial').id;
  await f.confirm('plan:initial',{action:'hold'});
  await assert.rejects(()=>send(f.run,f.repo,{agent_id:original,content:'Original-session recheck'},async(command,args)=>{
   if(command==='send')throw Object.assign(new Error('terminal continuation unavailable'),{code:'TERMINAL_SEND_UNSUPPORTED'});return f.rpc(command,args);
  }),/unavailable/);
  const gap={actor_id:original,reason:'Main verified this harness cannot continue the terminal session',evidence:'Frozen original report and exact invalidated plan cone'};
  const replacement=await f.spawn('plan:initial',{continuity_gap:gap});assert.notEqual(replacement,original);
  const response=await f.wait(replacement),guide=response.instructions[0];assert.equal(guide.session_id,'session-'+replacement);assert.deepEqual(guide.continuity_gap,gap);
  assert.equal(f.run.actors[replacement].replacementFor,original);assert.equal(f.run.actors[original].rounds.at(-1).status,'failed');
  await f.confirm('plan:initial',{actor_id:replacement,round:1});
  await assert.rejects(()=>f.invoke('send',{agent_id:original,content:'Not the real replacement'}),/required session/);
  await f.invoke('send',{agent_id:replacement,content:'Actual continuing replacement'});await f.wait(replacement);
  await assert.rejects(()=>f.spawn('plan:initial',{continuity_gap:{...gap,actor_id:replacement}}),/one recorded/);
  assert.equal(f.calls.filter(c=>c.command==='spawn').length,3);
 }finally{await f.cleanup();}
});

test('recorded gap cannot change routes or silently replace an active actor',async()=>{
 const f=await fixture();try{
  await f.prepare();const original=Object.values(f.run.actors).find(a=>a.node==='plan:initial').id;
  await f.confirm('plan:initial',{action:'hold'});const before=f.calls.length;
  const gap={actor_id:original,reason:'Main reports provider session unavailable',evidence:'Frozen authored report'};
  await assert.rejects(()=>f.spawn('plan:initial',{continuity_gap:gap,route:{profile:'different-route'}}),/same recorded route/);assert.equal(f.calls.length,before);
  await f.invoke('send',{agent_id:original,content:'Running review'});
  await assert.rejects(()=>f.spawn('plan:initial',{continuity_gap:gap}),/terminate/);
 }finally{await f.cleanup();}
});

test('failed repair round does not erase the original implementer or require a new repair identity',async()=>{
 const f=await fixture();try{
  await f.prepare();const implementer=await f.accept(node('implement')),reviewer=await f.accept(node('behavior'));
  const repair={id:'owner-correction',purpose:'repair',unit:own,implementation_actor_id:implementer,source_actor_id:reviewer,before:[node('blind')]};
  const declare=()=>f.invoke('update',{reason:'Main owns the repair and runtime-failure diagnosis',obligations:[repair]});
  await declare();await f.invoke('send',{agent_id:implementer,node:repair.id,content:'Original repair attempt'});f.tasks.get(implementer).status='failed';f.tasks.get(implementer).outcome='FAILED';await f.wait(implementer);
  await assert.rejects(()=>f.confirm(repair.id,{actor_id:implementer,round:2}),/evidence/);
  await declare();assert.equal(f.run.graph.nodes[repair.id].continueActor,implementer);
  await f.invoke('send',{agent_id:implementer,node:repair.id,content:'Bounded diagnosed follow-up in original session'});f.tasks.get(implementer).status='completed';f.tasks.get(implementer).outcome='COMPLETED';await f.wait(implementer);
  await f.confirm(repair.id,{actor_id:implementer,round:3});assert.equal(f.run.actors[implementer].rounds[1].outcome,'FAILED');
 }finally{await f.cleanup();}
});
