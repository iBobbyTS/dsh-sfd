import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {initialState,flush,loadState} from '../lib/state.js';
import {registerWorkflowTools} from '../lib/workflow-tools.js';
const run=promisify(execFile);
test('tool integration: real actor result gates transitions; waiver permits acceptance without reset',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'sfd-flow-integration-'));
 try{
  await run('git',['init','-b','main',dir]);
  await run('git',['-C',dir,'config','user.name','test']);
  await run('git',['-C',dir,'config','user.email','test@example.com']);
  await writeFile(join(dir,'a.txt'),'base');
  await run('git',['-C',dir,'add','.']);
  await run('git',['-C',dir,'commit','-m','base']);
  await mkdir(join(dir,'.agent-work'));
  await writeFile(join(dir,'.agent-work','PLAN-FULL.md'),'# Plan');
  const st=initialState(dir);st.phase='PLAN';await flush(st);
  const tools=new Map();
  const ctx={workingDirectory:{ensure:async()=>dir},tools:{register:def=>tools.set(def.name,def)}};
  let seq=10000000;
  const rpc=async(cmd)=>{
   if(cmd==='spawn')return{agent_id:++seq,status:'running'};
   if(cmd==='wait')return{task:{status:'completed'}};
   if(cmd==='result')return{task:{status:'completed'},result:{outcome:'COMPLETED',partial:false,final_text:'# review / handoff',next_offset:null}};
   if(cmd==='close')return{task:{status:'closed'}};
   if(cmd==='cancel')return{task:{status:'cancelled'}};
   throw Error(cmd);
  };
  registerWorkflowTools(ctx,{es:rpc,preflight:async()=>({ok:true}),
    candidate:async(_repo,task)=>task.startsWith('plan:')?'plan:1':'code:1',
    writeReport:async(_repo,t,id)=>'.agent-work/reviews/'+t.id+'-'+id+'.md'});
  const call=(name,args={})=>tools.get(name).execute(args,{agent:{id:'main'}});
  assert.equal((await call('sfd_flow_init',{sections:[{id:'S01',subsections:['A']}]})).ok,true);
  assert.equal((await call('sfd_actor_start',{taskId:'S01/A:impl',assignment:'implement'})).ok,false);
  const review=async id=>{
   const start=await call('sfd_actor_start',{taskId:id,assignment:'independent review'});
   assert.equal(start.ok,true,JSON.stringify(start));
   assert.equal((await call('sfd_actor_collect',{actorId:start.actorId})).status,'completed');
   const admit=await call('sfd_review_admit',{taskId:id,actorId:start.actorId,verdict:'clean'});
   assert.equal(admit.ok,true,JSON.stringify(admit));
  };
  await review('plan:A');await review('plan:B');
  const impl=await call('sfd_actor_start',{taskId:'S01/A:impl',assignment:'implement child'});
  assert.equal(impl.ok,true,JSON.stringify(impl));
  await call('sfd_actor_collect',{actorId:impl.actorId});
  assert.equal((await call('sfd_task_finish',{taskId:'S01/A:impl',actorId:impl.actorId,explanation:'unit tests passed'})).ok,true);
  assert.equal((await call('sfd_actor_start',{taskId:'S01:B1',assignment:'premature B'})).ok,false);
  await review('S01/A:checkpoint');
  assert.equal((await call('sfd_task_finish',{taskId:'S01:impl',explanation:'joint checks passed'})).ok,true);
  await review('S01:A');
  assert.equal((await call('sfd_flow_revise',{action:'waive_code_b',authorization:'user',reason:'user requests no B'})).ok,true);
  assert.equal((await call('sfd_section_accept',{section:'S01',explanation:'Feature tested'})).status,'ACCEPTED_WITH_WAIVER');
  assert.equal((await call('sfd_flow_complete',{explanation:'final integration tested'})).ok,true);
  const saved=await loadState(dir);
  assert.equal(saved.phase,'DONE');
  assert.equal(saved.flow.revision,2);
  assert.equal(saved.flow.tasks['S01:accept'].status,'done');
 }finally{await rm(dir,{recursive:true,force:true});}
});
