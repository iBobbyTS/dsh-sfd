import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm,readFile,writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withRun,location } from '../lib/run-store.js';
test('serialized atomic per-session writes persist successful partial effects even when the operation throws',async()=>{
 const repo=await mkdtemp(join(tmpdir(),'sfd-record-'));try{
  const results=await Promise.all(Array.from({length:8},()=>withRun(repo,'session',async r=>{const previous=r.revision;await new Promise(resolve=>setImmediate(resolve));r.revision=previous+1;return r.revision;})));
  assert.deepEqual(results.sort((a,b)=>a-b),[1,2,3,4,5,6,7,8]);
  await assert.rejects(()=>withRun(repo,'session',r=>{r.actors.created={id:'real-id'};throw new Error('later spawn failed');}),/later spawn/);
  const loaded=await withRun(repo,'session',r=>r);assert.ok(loaded.actors.created);assert.equal(loaded.revision,8);
  const different=await withRun(repo,'another-session',r=>r);assert.notEqual(loaded.id,different.id);
  const file=(await location(repo,'session')).file;assert.ok(!file.includes('session.json'));assert.equal(JSON.parse(await readFile(file,'utf8')).sessionId,'session');
 }finally{await rm(repo,{recursive:true,force:true});}
});
test('unknown schema/identity and corrupt records fail instead of being treated as a fresh run',async()=>{
 const repo=await mkdtemp(join(tmpdir(),'sfd-record-'));try{
  await assert.rejects(()=>withRun(repo,'',()=>{}),/session ID/);
  await withRun(repo,'session',()=>{});const {file}=await location(repo,'session');await writeFile(file,'not json');await assert.rejects(()=>withRun(repo,'session',()=>{}),SyntaxError);
  await writeFile(file,JSON.stringify({schema:1,repo,sessionId:'session'}));await assert.rejects(()=>withRun(repo,'session',()=>{}),/schema mismatch/);
 }finally{await rm(repo,{recursive:true,force:true});}
});
