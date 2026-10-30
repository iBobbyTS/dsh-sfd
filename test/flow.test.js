/** Current graph revision / Main-disposition regressions, replacing the retired controller surface. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture } from './wrapper-fixtures.js';
import { label,section,plan } from './plan-fixtures.js';
import { reload } from '../lib/execution.js';
const unit=label(1),node=s=>unit+':'+s;
test('plan changes preserve unaffected Section evidence, invalidate changed/downstream units and keep live actors',async()=>{
 const text='# Plan\n'+section(1)+section(2,{deps:label(1)})+section(3);
 const f=await fixture(text);try{
  await f.prepare();const id=await f.accept(node('implement'));await f.accept(node('behavior'));
  await f.confirm(node('risk'),{action:'risks',lenses:['structure']});const live=await f.spawn(node('specialist:structure'));
  await writeFile(join(f.repo,'.agent-work','PLAN-FULL.md'),text.replace('Consumer','Changed consumer contract'));await reload(f.run,f.repo);
  assert.equal(f.run.dispositions[node('implement')].decision,'accepted');assert.ok(f.run.actors[live]);assert.equal(f.run.actors[live].rounds[0].status,'running');assert.equal(f.run.actors[id].invalidated,undefined);
  await writeFile(join(f.repo,'.agent-work','PLAN-FULL.md'),text.replace('Foundation','Changed foundation contract'));await reload(f.run,f.repo);
  assert.equal(f.run.dispositions[node('implement')].decision,'invalidated');assert.ok(f.run.actors[id].invalidated);assert.equal(f.calls.some(c=>c.command==='cancel'),false);
 }finally{await f.cleanup();}
});
test('ordinary deletion keeps unmet obligations; explicit user waiver has source/reason and never claims CLEAN',async()=>{
 const f=await fixture(plan(2));try{
  await f.prepare();await writeFile(join(f.repo,'.agent-work','PLAN-FULL.md'),plan());await reload(f.run,f.repo);
  const retired=label(2)+':blind';assert.ok(f.run.graph.nodes[retired].retired);assert.ok(f.run.graph.nodes.delivery.needs.includes(retired));
  await assert.rejects(()=>f.confirm(retired,{action:'accept'}),/user waiver/);
  await assert.rejects(()=>f.confirm(retired,{action:'waive'}),/authorization source/);
  await f.confirm(retired,{action:'waive',user_source:'User message explicitly omits removed unit'});
  assert.equal(f.run.dispositions[retired].decision,'waived');assert.equal(f.run.dispositions[retired].userSource,'User message explicitly omits removed unit');
  await assert.rejects(()=>f.confirm('delivery'),/requires/);
 }finally{await f.cleanup();}
});
test('missing, partial or empty terminal reports and identity reuse cannot release implementation',async()=>{
 for(const kind of ['missing','partial','empty','identity']){
  const f=await fixture();try{
   await f.prepare();const id=await f.spawn(node('implement'));
   const original=f.rpc;const {wait}=await import('../lib/execution.js');
   const rpc=async(cmd,args)=>{const response=await original(cmd,args);if(cmd==='wait'){
    const body=response[id];if(kind==='missing')body.result=null;if(kind==='partial')body.result.partial=true;if(kind==='empty'){body.result.final_text='';body.result.total_bytes=0;}if(kind==='identity')body.task.agent_id=99999999;
   }return response;};
   await wait(f.run,f.repo,{agent_ids:[id],wait_time:0},rpc);await assert.rejects(()=>f.confirm(node('implement'),{actor_id:id,round:1}),/evidence/);
  }finally{await f.cleanup();}
 }
});
test('adding a real child preserves prior checkpoint evidence but reopens parent reconciliation and acceptance',async()=>{
 const f=await fixture('# Plan\n'+section(1,{children:true}));try{
  await f.prepare();await f.accept(unit+'.A:implement');const reviewer=await f.accept(unit+'.A:checkpoint');await f.accept(unit+'.B:implement');
  await f.invoke('send',{agent_id:reviewer,node:unit+'.B:checkpoint',purpose:'recheck',content:'Second actual child checkpoint'});await f.wait(reviewer);await f.confirm(unit+'.B:checkpoint',{actor_id:reviewer,round:2});
  await f.invoke('send',{agent_id:reviewer,node:node('reconcile'),purpose:'recheck',content:'Actual parent cumulative coverage'});await f.wait(reviewer);await f.confirm(node('reconcile'),{actor_id:reviewer,round:3});await f.confirm(node('behavior'));
  const child='### '+unit+'.C — Final consumer\n- Implementer: impl_large\n- Depends on: '+unit+'.B\n';
  await writeFile(join(f.repo,'.agent-work','PLAN-FULL.md'),'# Plan\n'+section(1,{children:true})+child);await reload(f.run,f.repo);
  assert.equal(f.run.dispositions[unit+'.A:checkpoint'].decision,'accepted');assert.equal(f.run.dispositions[node('reconcile')].decision,'invalidated');
  await assert.rejects(()=>f.confirm(node('behavior')),/reconcile/);
 }finally{await f.cleanup();}
});
test('dynamic specialist nodes remain actor-backed after plan reload for a decomposed parent',async()=>{
 const f=await fixture('# Plan\n'+section(1,{children:true}));try{
  await f.prepare();await f.confirm(node('risk'),{action:'risks',lenses:['structure']});
  await writeFile(join(f.repo,'.agent-work','PLAN-FULL.md'),'# Plan\n'+section(1,{children:true})+'\n## Shared validation\nMain checks final consumers.\n');await reload(f.run,f.repo);
  assert.equal(f.run.graph.nodes[node('specialist:structure')].kind,'review');
  await assert.rejects(()=>f.confirm(node('specialist:structure')),/requires|evidence/);
 }finally{await f.cleanup();}
});
