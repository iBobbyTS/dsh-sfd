import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture } from './wrapper-fixtures.js';
import { label,plan } from './plan-fixtures.js';
const unit=label(1),node=suffix=>unit+':'+suffix;
async function upToFinal(f){
 await f.prepare();const implementer=await f.accept(node('implement'));await f.accept(node('behavior'));
 await f.confirm(node('risk'),{action:'risks',lenses:[]});await f.confirm(node('risk'));return implementer;
}
test('Main holds affected work and chooses repair and review sessions without plugin closure machinery',async()=>{
 const f=await fixture();try{
  const implementer=await upToFinal(f),reviewer=await f.spawn(node('blind'));await f.wait(reviewer);
  await f.confirm(node('implement'),{action:'hold'});
  await assert.rejects(()=>f.invoke('send',{agent_id:reviewer,content:'Too early'}),/requires/);
  const count=f.calls.filter(c=>c.command==='spawn').length;
  await f.invoke('send',{agent_id:implementer,content:'Main-selected repair'});await f.wait(implementer);
  await f.confirm(node('implement'),{actor_id:implementer,round:2});
  assert.equal(f.calls.filter(c=>c.command==='spawn').length,count);
  await f.accept(node('behavior'));await f.confirm(node('risk'));
  await f.invoke('update',{reason:'Main admitted finding-author closure',obligations:[{id:'reviewer-closure',purpose:'closure',unit,source_actor_id:reviewer,before:[node('blind')]}]});
  await f.invoke('send',{agent_id:reviewer,node:'reviewer-closure',content:'Verify the authored finding'});await f.wait(reviewer);
  await f.confirm('reviewer-closure',{actor_id:reviewer,round:2});
  // Main—not a finding ledger—decides what the follow-up means and requests a fresh review.
  const fresh=await f.accept(node('blind'));assert.notEqual(fresh,reviewer);
  await f.confirm(node('reconciliation'));await f.confirm(node('accept'));
  for(const key of ['repairSessions','repairWaves','findings','sectionRecovery'])assert.equal(f.run[key],undefined);
 }finally{await f.cleanup();}
});
test('clean final review needs only Main confirmation, not an empty follow-up',async()=>{
 const f=await fixture();try{
  await upToFinal(f);const reviewer=await f.accept(node('blind'));const before=f.calls.length;
  await f.confirm(node('reconciliation'));assert.equal(f.calls.length,before);assert.equal(f.run.actors[reviewer].rounds.length,1);
 }finally{await f.cleanup();}
});
test('changed plan invalidates acceptance and Main may continue original reviewers in graph order',async()=>{
 const f=await fixture();try{
  await f.prepare();const initial=Object.values(f.run.actors).find(a=>a.node==='plan:initial').id,final=Object.values(f.run.actors).find(a=>a.node==='plan:final').id;
  await writeFile(join(f.repo,'.agent-work','PLAN-FULL.md'),plan().replace('Foundation','Corrected contract'));
  await assert.rejects(()=>f.invoke('send',{agent_id:final,content:'Final first is invalid'}),/requires/);
  await f.invoke('send',{agent_id:initial,content:'Recheck initial plan evidence'});await f.wait(initial);await f.confirm('plan:initial',{actor_id:initial,round:2});
  await f.invoke('send',{agent_id:final,content:'Verify correction and complete review'});await f.wait(final);await f.confirm('plan:final',{actor_id:final,round:2});
 }finally{await f.cleanup();}
});
test('send never escalates or replaces an implementer and imposes no repair-wave counter',async()=>{
 const f=await fixture(plan().replace('impl_large','impl_std'));try{
  await f.prepare();const id=await f.accept(node('implement')),count=f.calls.filter(c=>c.command==='spawn').length;
  for(let round=2;round<=7;round++){
   const sent=await f.invoke('send',{agent_id:id,content:'Explicit bounded follow-up '+round});assert.equal(sent.actor_id,id);await f.wait(id);await f.confirm(node('implement'),{actor_id:id,round});
  }
  assert.equal(f.run.actors[id].role,'impl_std');assert.equal(f.calls.filter(c=>c.command==='spawn').length,count);
 }finally{await f.cleanup();}
});
test('same completed bytes or unsupported terminal send cannot pretend a new round completed',async()=>{
 const f=await fixture();try{
  await f.prepare();const id=await f.accept(node('implement'));const reviewer=await f.accept(node('behavior'));
  await f.confirm(node('behavior'),{action:'hold'});
  await f.invoke('send',{agent_id:id,purpose:'repair',content:'Repair'});f.tasks.get(id).turn=1;
  const response=await f.wait(id);assert.deepEqual(response.remaining_ids,[id]);assert.deepEqual(response.instructions,[]);
  f.tasks.get(id).status='running';await f.wait(id);f.tasks.get(id).status='completed';await f.wait(id);assert.equal(f.run.actors[id].rounds.at(-1).reportComplete,true);
  const { send }=await import('../lib/execution.js');await assert.rejects(()=>send(f.run,f.repo,{agent_id:id,purpose:'repair',content:'Unsupported'},async(cmd,args)=>{if(cmd==='send')throw Object.assign(new Error('TERMINAL_SEND_UNSUPPORTED'),{code:'TERMINAL_SEND_UNSUPPORTED'});return f.rpc(cmd,args);}),/UNSUPPORTED/);
  assert.equal(f.run.actors[id].rounds.length,3);assert.equal(f.run.actors[id].rounds.at(-1).sendState,'rejected');
  await assert.rejects(()=>f.confirm(node('implement'),{actor_id:id,round:3}),/evidence/);
 }finally{await f.cleanup();}
});
test('identity replacement during resumed execution is detected even when wait omits session metadata',async()=>{
 const f=await fixture();try{
  await f.prepare();const id=await f.accept(node('implement')),reviewer=await f.accept(node('behavior'));
  await f.confirm(node('behavior'),{action:'hold'});
  await f.invoke('send',{agent_id:id,purpose:'repair',content:'Actual repair continuation'});f.tasks.get(id).session_id='replacement-after-send';
  const response=await f.wait(id);assert.equal(response.complete,false);assert.deepEqual(response.remaining_ids,[id]);assert.match(f.run.actors[id].continuityGap,/identity/);
 }finally{await f.cleanup();}
});
