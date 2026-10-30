import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture } from './wrapper-fixtures.js';
import { plan, section, label } from './plan-fixtures.js';
import { reload, summary } from '../lib/execution.js';

async function acceptSection(f,id){
  await f.accept(id+':implement');await f.accept(id+':behavior');
  await f.confirm(id+':risk',{action:'risks',lenses:[]});await f.confirm(id+':risk');
  await f.accept(id+':blind');await f.confirm(id+':reconciliation');await f.confirm(id+':accept');
}

test('removing an accepted Section preserves history without ghost scheduling occupancy',async()=>{
  const f=await fixture(plan(2));try{
    await f.prepare();await acceptSection(f,label(1));
    const accepted=structuredClone(f.run.dispositions[label(1)+':accept']);
    await writeFile(join(f.repo,'.agent-work','PLAN-FULL.md'),'# Plan\n'+section(2));await reload(f.run,f.repo);
    for(const node of ['plan:initial','plan:final']){
      const reviewer=Object.values(f.run.actors).find(a=>a.node===node);
      await f.invoke('send',{agent_id:reviewer.id,content:'Recheck changed plan in original session'});await f.wait(reviewer.id);
      await f.confirm(node,{actor_id:reviewer.id,round:2});
    }
    assert.deepEqual(f.run.dispositions[label(1)+':accept'],accepted);
    assert.deepEqual(summary(f.run).openSections,[]);
    assert.ok(await f.spawn(label(2)+':implement'));
  }finally{await f.cleanup();}
});

test('removing live work never erases actors or permits overlapping writers',async()=>{
  const f=await fixture(plan(2));try{
    await f.prepare();const id=await f.spawn(label(1)+':implement');f.tasks.get(id).status='running';
    await writeFile(join(f.repo,'.agent-work','PLAN-FULL.md'),'# Plan\n'+section(2));await reload(f.run,f.repo);
    for(const node of ['plan:initial','plan:final'])await f.confirm(node,{action:'waive',user_source:'Explicit test user waiver of changed-plan review'});
    assert.ok(f.run.actors[id]);
    await assert.rejects(()=>f.spawn(label(2)+':implement'),/parallel Sections|overlap/);
    assert.equal(f.calls.some(c=>c.command==='cancel'),false);
  }finally{await f.cleanup();}
});
