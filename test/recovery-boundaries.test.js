import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile,readFile,mkdtemp,mkdir,copyFile,rm } from 'node:fs/promises';
import { join,dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fixture } from './wrapper-fixtures.js';
import { section,label } from './plan-fixtures.js';
import * as execution from '../lib/execution.js';
import { withRun,location } from '../lib/run-store.js';
import { registerWorkflowTools } from '../lib/workflow-tools.js';
const producer=label(1),consumer=label(2),unrelated=label(3);
const gate=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
async function acceptSection(f,unit,{lenses=[]}={}){
 const implementer=await f.accept(unit+':implement'),reviewer=await f.accept(unit+':behavior');
 await f.confirm(unit+':risk',{action:'risks',lenses});
 for(const lens of lenses)await f.accept(unit+':specialist:'+lens);
 await f.confirm(unit+':risk');const blind=await f.accept(unit+':blind');await f.confirm(unit+':reconciliation');await f.confirm(unit+':accept');
 return {implementer,reviewer,blind};
}
async function recheckPlan(f){for(const node of ['plan:initial','plan:final']){const a=Object.values(f.run.actors).find(a=>a.node===node);await f.invoke('send',{agent_id:a.id,purpose:'recheck',content:'Recheck changed plan'});await f.wait(a.id);await f.confirm(node,{actor_id:a.id,round:a.rounds.length});}}
test('quiet invalidated predecessors can be reworked directly; dependents resume through ordinary graph order',async()=>{
 const text='# Plan\n'+section(1)+section(2,{deps:producer})+section(3),f=await fixture(text);
 try{
  await f.prepare();const original=await acceptSection(f,producer),downstream=await f.spawn(consumer+':implement');await f.wait(downstream);
  await writeFile(join(f.repo,'.agent-work','PLAN-FULL.md'),text.replace('Foundation','Changed foundation'));await execution.reload(f.run,f.repo);await recheckPlan(f);
  await assert.rejects(()=>f.spawn(unrelated+':implement'),/parallel Sections/);
  await assert.rejects(()=>f.invoke('send',{agent_id:downstream,content:'Premature dependent'}),/requires/);
  f.tasks.get(downstream).pending_requests=[{kind:'user_input',request_id:'needs-main'}];await f.wait(downstream);
  await assert.rejects(()=>f.invoke('send',{agent_id:original.implementer,content:'Blocked by pending input'}),/parallel Sections/);
  f.tasks.get(downstream).pending_requests=[];await f.wait(downstream);
  await f.invoke('send',{agent_id:original.implementer,content:'Rework predecessor'});await f.wait(original.implementer);await f.confirm(producer+':implement',{actor_id:original.implementer,round:2});
  await f.invoke('send',{agent_id:original.reviewer,content:'Recheck predecessor'});await f.wait(original.reviewer);await f.confirm(producer+':behavior',{actor_id:original.reviewer,round:2});
  await f.confirm(producer+':risk');await f.accept(producer+':blind');await f.confirm(producer+':reconciliation');await f.confirm(producer+':accept');
  await f.invoke('send',{agent_id:downstream,content:'Resume dependent'});await f.wait(downstream);await f.confirm(consumer+':implement',{actor_id:downstream,round:2});
  assert.equal(f.run.sectionRecovery,undefined);assert.equal(f.run.activeSection,undefined);assert.equal(f.calls.some(c=>c.command==='cancel'),false);
 }finally{await f.cleanup();}
});
test('effective specialist graph preserves no-op evidence and invalidates genuine scope changes',async()=>{
 const text='# Plan\n'+section(1),f=await fixture(text);try{
  await f.prepare();const {blind}=await acceptSection(f,producer,{lenses:['structure']});
  await writeFile(join(f.repo,'.agent-work','PLAN-FULL.md'),text+'\n');await execution.reload(f.run,f.repo);
  for(const suffix of ['specialist:structure','risk','blind','accept'])assert.equal(f.run.dispositions[producer+':'+suffix].decision,'accepted');
  assert.equal(f.run.actors[blind].invalidated,undefined);
  await writeFile(join(f.repo,'.agent-work','PLAN-FULL.md'),text.replace('Foundation','Changed scope'));await execution.reload(f.run,f.repo);
  for(const suffix of ['specialist:structure','risk','blind','accept'])assert.equal(f.run.dispositions[producer+':'+suffix].decision,'invalidated');
 }finally{await f.cleanup();}
});
test('same-node implementation continuation validates new plan prerequisites before any RPC',async()=>{
 const f=await fixture();try{
  await f.prepare();const id=await f.accept(producer+':implement');await writeFile(join(f.repo,'.agent-work','PLAN-FULL.md'),'# Updated plan\n'+section(1));
  const count=f.calls.length;await assert.rejects(()=>f.invoke('send',{agent_id:id,purpose:'recheck',content:'Premature rework'}),/requires/);assert.equal(f.calls.length,count);
 }finally{await f.cleanup();}
});
test('lost send reply has a known pending UUID, real receipt resolves delivery uncertainty without resending',async()=>{
 const f=await fixture();try{
  await f.prepare();const id=await f.accept(producer+':implement');let sends=0;
  const rpc=async(cmd,args)=>{const result=await f.rpc(cmd,args);if(cmd==='send'){sends++;throw Object.assign(new Error('reply lost after delivery'),{code:'ES_LAUNCH'});}return result;};
  await assert.rejects(()=>execution.send(f.run,f.repo,{agent_id:id,purpose:'recheck',content:'Continued bounded work'},rpc),/reply lost/);
  const round=f.run.actors[id].rounds.at(-1);assert.equal(round.number,2);assert.ok(round.messageId);assert.equal(round.unresolved,true);
  await f.wait(id);assert.equal(round.unresolved,false);assert.notEqual(f.run.dispositions[producer+':implement'].decision,'accepted');
  await f.confirm(producer+':implement',{actor_id:id,round:2});assert.equal(sends,1);
 }finally{await f.cleanup();}
});
test('known first spawn survives a persisted reload while the second non-idempotent mutation is suspended',async()=>{
 const f=await fixture();const suspended=gate(),release=gate();let pending;
 try{
  await f.prepare();await f.accept(producer+':implement');await f.accept(producer+':behavior');await f.confirm(producer+':risk',{action:'risks',lenses:['structure','scope']});
  await withRun(f.repo,'persistent',r=>Object.assign(r,structuredClone(f.run)));
  let count=0;const rpc=async(cmd,args)=>{if(cmd==='spawn'&&++count===2){suspended.resolve();await release.promise;}return f.rpc(cmd,args);};
  pending=withRun(f.repo,'persistent',(run,root,io)=>execution.spawn(run,root,{reviewIsolation:'immutable source; separate report sinks',tasks:['structure','scope'].map(l=>({node:producer+':specialist:'+l,assignment:'Frozen review',route:{profile:'selected'}}))},rpc,io));
  await suspended.promise;const persisted=JSON.parse(await readFile((await location(f.repo,'persistent')).file,'utf8'));
  const restarted=await import('../lib/run-store.js?restart-snapshot');const recovered=await restarted.withRun(f.repo,'persistent',run=>structuredClone(run));
  assert.deepEqual(recovered.actors,persisted.actors);assert.deepEqual(recovered.groups,persisted.groups);
  const created=Object.values(persisted.actors).find(a=>a.node===producer+':specialist:structure');assert.ok(created);assert.ok(created.sessionId);assert.equal(persisted.groups[created.rounds[0].group].operations[1].state,'pending');
  await assert.rejects(()=>execution.spawn(recovered,f.repo,{tasks:[{node:producer+':specialist:scope',assignment:'Unsafe restart retry',route:{profile:'selected'}}]},f.rpc),/dispatch.*unresolved|unresolved.*dispatch/);
 }finally{release.resolve();await pending;await f.cleanup();}
});
test('explicit observe/cencel overtake a gated wait without a cancellation shadow state',async()=>{
 const f=await fixture(),entered=gate(),release=gate();let waiting;
 try{
  await f.prepare();const id=await f.spawn(producer+':implement');f.tasks.get(id).status='running';await withRun(f.repo,'control',r=>Object.assign(r,structuredClone(f.run)));
  const observed=gate(),cancelled=gate();
  const events=[],rpc=async(cmd,args)=>{events.push(cmd);if(cmd==='observe')observed.resolve();if(cmd==='cancel')cancelled.resolve();if(cmd==='wait'){entered.resolve();await release.promise;}return f.rpc(cmd,args);};
  const defs=new Map();registerWorkflowTools({workingDirectory:{ensure:async()=>f.repo},tools:{register:d=>defs.set(d.name,d)}},{es:rpc});
  const call=(name,args)=>defs.get(name).execute(args,{agent:{session:{id:'control'}}});
  waiting=call('sfd_subagent_wait',{agent_ids:[id],wait_time:290});await entered.promise;
  const observation=call('sfd_subagent_observe',{agent_id:id}),cancellation=call('sfd_subagent_cencel',{agent_id:id});
  let timer;try{await Promise.race([Promise.all([observed.promise,cancelled.promise]),new Promise((_,reject)=>timer=setTimeout(()=>reject(new Error('control RPC blocked behind gated poll')),1000))]);}finally{clearTimeout(timer);}
  assert.ok(events.includes('observe'));assert.ok(events.includes('cancel'));
  assert.equal((await call('sfd_workflow_status',{})).ok,true); // Status must also overtake the remote poll.
   assert.equal((await observation).ok,true);assert.equal((await cancellation).ok,true);release.resolve();await waiting;
  const saved=await withRun(f.repo,'control',r=>structuredClone(r.actors[id]));assert.equal(saved.rounds.length,1);assert.equal(saved.rounds[0].cancelRequest,undefined);assert.equal(saved.rounds[0].status,'cancelled');
 }finally{release.resolve();await waiting;await f.cleanup();}
});
test('canonical verifier ignores only incidental metadata in both present and clean packaged resource sets',async()=>{
 const manifest=JSON.parse(await readFile('skills/SNAPSHOT.json','utf8'));
 assert.equal(Object.keys(manifest.files).filter(p=>p.endsWith('.DS_Store')).length,0);
 assert.equal(Object.keys(manifest.files).length,108);
 const root=await mkdtemp(join(tmpdir(),'sfd-snapshot-'));try{
  for(const path of ['scripts/verify-skill-snapshot.js','skills/SNAPSHOT.json',...Object.keys(manifest.files).map(p=>'skills/'+p)]){await mkdir(dirname(join(root,path)),{recursive:true});await copyFile(path,join(root,path));}
  await writeFile(join(root,'package.json'),'{"type":"module"}');
  for(const present of [false,true]){if(present)await writeFile(join(root,'skills/sectioned-feature-development/.DS_Store'),'incidental metadata');const output=execFileSync(process.execPath,['scripts/verify-skill-snapshot.js','--source',manifest.source],{cwd:root,encoding:'utf8'});assert.match(output,/Verified 108/);}
  const body=await readFile(join(root,'skills/sectioned-feature-development/SKILL.md'),'utf8');assert.ok(body.includes('../code-review/'));
 }finally{await rm(root,{recursive:true,force:true});}
});
test('lost-send reconciliation rejects failed delivery receipts and replaced sessions without new dispatch',async()=>{
 for(const invalid of ['receipt','identity']){
  const f=await fixture();try{
   await f.prepare();const id=await f.accept(producer+':implement');let sends=0;
   await assert.rejects(()=>execution.send(f.run,f.repo,{agent_id:id,purpose:'recheck',content:'Bounded continuation'},async(cmd,args)=>{const response=await f.rpc(cmd,args);if(cmd==='send'){sends++;throw Object.assign(new Error('lost reply'),{code:'ES_OUTPUT'});}return response;}),/lost reply/);
   if(invalid==='identity')f.tasks.get(id).session_id='different-session';
   await execution.wait(f.run,f.repo,{agent_ids:[id],wait_time:0},async(cmd,args)=>{const response=await f.rpc(cmd,args);if(cmd==='wait'&&invalid==='receipt')response.message_receipt={message_id:f.run.actors[id].rounds.at(-1).messageId,state:'delivered',failure_code:'DELIVERY_FAILED'};return response;});
   await assert.rejects(()=>f.confirm(producer+':implement',{actor_id:id,round:2}),/evidence/);assert.equal(sends,1);assert.equal(f.run.actors[id].rounds.at(-1).unresolved,true);
  }finally{await f.cleanup();}
 }
});
test('late cancellation response cannot overwrite an authoritative terminal wait update',async()=>{
 const f=await fixture(),waiting=gate(),releaseWait=gate(),cancelled=gate(),releaseCancel=gate();let poll,control;
 try{
  await f.prepare();const id=await f.spawn(producer+':implement');f.tasks.get(id).status='running';await withRun(f.repo,'late-control',r=>Object.assign(r,structuredClone(f.run)));
  const rpc=async(cmd,args)=>{if(cmd==='wait'){waiting.resolve();await releaseWait.promise;}const response=await f.rpc(cmd,args);if(cmd==='cancel'){cancelled.resolve();await releaseCancel.promise;}return response;};
  const defs=new Map();registerWorkflowTools({workingDirectory:{ensure:async()=>f.repo},tools:{register:d=>defs.set(d.name,d)}},{es:rpc});
  const call=(name,args)=>defs.get(name).execute(args,{agent:{session:{id:'late-control'}}});
  poll=call('sfd_subagent_wait',{agent_ids:[id],wait_time:290});await waiting.promise;control=call('sfd_subagent_cencel',{agent_id:id});await cancelled.promise;
  releaseWait.resolve();const result=await poll;assert.equal(result.complete,true);releaseCancel.resolve();assert.equal((await control).ok,true);
  const saved=await withRun(f.repo,'late-control',r=>structuredClone(r.actors[id].rounds.at(-1)));assert.equal(saved.status,'cancelled');assert.equal(saved.cancelRequest,undefined);assert.equal(saved.controlPending,undefined);
 }finally{releaseWait.resolve();releaseCancel.resolve();await poll;await control;await f.cleanup();}
});

test('late polls cannot roll back terminal state or overwrite a newer continuation round',async()=>{
 const f=await fixture();try{
  await f.prepare();const id=await f.spawn(producer+':implement');f.tasks.get(id).status='running';
  const poll=await execution.prepareWait(f.run,f.repo,{agent_ids:[id],wait_time:0}),stale=await execution.pollWait(poll,f.rpc);
  f.tasks.get(id).status='completed';await f.wait(id);
  await execution.finishWait(f.run,f.repo,poll,structuredClone(stale));assert.equal(f.run.actors[id].rounds.at(-1).status,'completed');
  await f.invoke('send',{agent_id:id,content:'New explicit round'});
  const before=structuredClone(f.run.actors[id].rounds.at(-1)),late=await execution.finishWait(f.run,f.repo,poll,stale);
  assert.equal(late.ok,false);assert.match(late.errors[0].error,/older round/);assert.deepEqual(f.run.actors[id].rounds.at(-1),before);
 }finally{await f.cleanup();}
});
test('removed semantic actions are unavailable and never dispatch remote work',async()=>{
 const f=await fixture();try{
  await f.prepare();const count=f.calls.length;
  for(const action of ['repair','closure','recover_predecessor','resume_dependent','reconcile_continuation'])await assert.rejects(()=>f.confirm(producer+':implement',{action}),/unknown Main disposition/);
  assert.equal(f.calls.length,count);
 }finally{await f.cleanup();}
});
