/** Session/repository records. Transactions serialize writes, never remote polls. */
import { readFile, writeFile, mkdir, rename, realpath } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { digest } from './compiler.js';
const queues=new Map();
export async function location(repo,sessionId) {
  if(typeof sessionId!=='string'||!sessionId)throw new Error('real host session ID required');
  const root=await realpath(repo);
  return {root,file:join(root,'.agent-work','sfd-runs',digest(sessionId)+'.json')};
}
export async function legacyFiles(repo){const found=[];for(const name of ['sfd-run.json','sfd-state.json'])try{await readFile(join(repo,'.agent-work',name));found.push(name);}catch(e){if(e.code!=='ENOENT')throw e;}return found;}
export async function readRun(repo,sessionId){
  const {root,file}=await location(repo,sessionId);
  let run;try{run=JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
  if(!run)return {schema:3,id:randomUUID(),repo:root,sessionId,graph:null,revision:0,actors:{},dispositions:{},lenses:{},instructionRoles:[],groups:{}};
  if(run.schema!==3||run.repo!==root||run.sessionId!==sessionId)throw new Error('run identity/schema mismatch; prior records are preserved, use a new session');
  return run;
}
export async function withRun(repo,sessionId,fn){
  const {root,file}=await location(repo,sessionId),prior=queues.get(file)??Promise.resolve();
  const work=prior.catch(()=>{}).then(async()=>{
    const run=await readRun(root,sessionId);
    const checkpoint=async()=>{
      await mkdir(dirname(file),{recursive:true});const temp=`${file}.${randomUUID()}.tmp`;
      await writeFile(temp,JSON.stringify(run,null,2)+'\n',{mode:0o600});await rename(temp,file);
    };
    try{return await fn(run,root,{checkpoint});}finally{await checkpoint();}
  });
  queues.set(file,work);try{return await work;}finally{if(queues.get(file)===work)queues.delete(file);}
}
