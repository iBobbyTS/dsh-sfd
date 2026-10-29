import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {candidate,es,collect,spawnRequest} from '../lib/actors.js';
const run=promisify(execFile);
const git=(dir,...args)=>run('git',['-C',dir,...args]);
test('ES CLI validates output envelope',async()=>{
 const fake=async(_bin,args)=>({stdout:JSON.stringify({ok:true,product:'external-subagent',command:args[0],result:{agent_id:12345678}})});
 assert.equal((await es('spawn',{repository:'/x',prompt:'foo'},fake)).agent_id,12345678);
 await assert.rejects(()=>es('spawn',{},async()=>({stdout:'{"ok":false,"error":{"code":"DENIED"}}'})),/failed/);
});
test('terminal ES collection retrieves all pages and rejects incomplete outcomes',async()=>{
 const x=await collect('/tmp',12345678,async(cmd,args)=>{
  if(cmd==='wait')return{task:{status:'completed'}};
  return{task:{status:'completed'},result:{outcome:'COMPLETED',partial:false,final_text:args.offset===0?'first ':'second',next_offset:args.offset===0?6:null}};
 });
 assert.equal(x.status,'completed');assert.equal(x.reportText,'first second');
 await assert.rejects(()=>collect('/tmp',12345678,async(cmd)=>cmd==='wait'?{task:{status:'completed'}}:{result:{outcome:'COMPLETED',partial:true,final_text:'incomplete'}}),/partial/);
});
test('independent reviewer uses ES profile; implementer uses writable build route',()=>{
 const review=spawnRequest('/tmp',{id:'S01:B1',type:'review',route:'codeB'},'Review final diff');
 assert.equal(review.profile,'sfd-codex-code-review');assert.match(review.prompt,/Blind B1/);
 assert.equal(review.write_manifest,undefined);
 const impl=spawnRequest('/tmp',{id:'S01:impl',type:'impl',route:'implStd'},'Implement');
 assert.equal(impl.permission_mode,'build');assert.equal(impl.model,'deepseek/deepseek-flash');
});
test('candidate fingerprint ignores workflow bookkeeping, detects real edits',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'sfd-candidate-'));
 try{
  await git(dir,'init','-b','main');await git(dir,'config','user.email','t@example.com');await git(dir,'config','user.name','t');
  await writeFile(join(dir,'file.js'),'export const x=1;\n');
  await git(dir,'add','.');await git(dir,'commit','-m','base');
  const a=await candidate(dir,'S01:A');await mkdir(join(dir,'.agent-work'));
  await writeFile(join(dir,'.agent-work','sfd-state.json'),'one');
  assert.equal(await candidate(dir,'S01:A'),a);
  await writeFile(join(dir,'file.js'),'export const x=2;\n');
  assert.notEqual(await candidate(dir,'S01:A'),a);
  await writeFile(join(dir,'.agent-work','PLAN-FULL.md'),'plan-1');
  const p=await candidate(dir,'plan:A');
  await writeFile(join(dir,'.agent-work','PLAN-FULL.md'),'plan-2');
  assert.notEqual(await candidate(dir,'plan:A'),p);
 }finally{await rm(dir,{recursive:true,force:true});}
});