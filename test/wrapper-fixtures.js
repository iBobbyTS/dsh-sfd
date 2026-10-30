import { mkdtemp,mkdir,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as api from '../lib/execution.js';
import { plan } from './plan-fixtures.js';
export async function fixture(text=plan()){
  const repo=await mkdtemp(join(tmpdir(),'sfd-wrapper-'));await mkdir(join(repo,'.agent-work'));await writeFile(join(repo,'.agent-work','PLAN-FULL.md'),text);
  const run={id:'isolated-run',revision:0,graph:null,actors:{},dispositions:{},lenses:{},instructionRoles:[],groups:{}};
  let sequence=10000000;const tasks=new Map(),calls=[];
  const rpc=async(command,args)=>{
    calls.push({command,args});
    if(command==='spawn'){const id=String(++sequence);tasks.set(id,{session_id:'session-'+id,status:'completed',turn:1});return {agent_id:Number(id),session_id:'session-'+id,status:'running'};}
    const body=id=>{const t=tasks.get(String(id));if(!t)throw new Error('unknown fake actor');return {pending_requests:t.pending_requests??[],timed_out:t.status==='running',message_receipt:t.message_id?{message_id:t.message_id,state:t.receipt??'delivered'}:null,task:{agent_id:Number(id),status:t.status},activity:{latest_text_tail:''},result:t.status==='running'?null:{outcome:t.outcome??'COMPLETED',final_text:'authored report '+t.turn,partial:t.partial??false,offset:0,next_offset:t.next_offset??null,total_bytes:t.next_offset?31:17}};};
    if(command==='wait')return Array.isArray(args.agent_id)?Object.fromEntries(args.agent_id.map(id=>[String(id),body(id)])):body(args.agent_id);
    const t=tasks.get(String(args.agent_id));
    if(command==='result')return {...body(args.agent_id),task:{agent_id:args.agent_id,status:t.status,session_id:t.session_id},...(args.offset?{result:{outcome:'COMPLETED',final_text:'continued page',partial:false,offset:args.offset,next_offset:null,total_bytes:31}}:{})};
    if(command==='send'){t.message_id=args.message_id;t.turn++;return {message_id:args.message_id,disposition:'delivered'};}
    if(command==='observe')return {coverage:{tools:'available'},reasoning:null};
    if(command==='cancel'){t.status='cancelled';t.outcome='CANCELLED';return {task:{agent_id:args.agent_id,status:'cancelled'}};}
    throw new Error(command);
  };
  const invoke=(name,args={})=>['observe','cencel'].includes(name)?api[name](run,args,rpc):api[name](run,repo,args,rpc);
  const spawn=async(node,extra={})=>{const response=await invoke('spawn',{tasks:[{node,assignment:'Bounded task and report path',route:{profile:'caller-selected-profile'},...extra}]});return response.agent_ids[0];};
  const wait=ids=>invoke('wait',{agent_ids:Array.isArray(ids)?ids:[ids],wait_time:0});
  const confirm=(node,extra={})=>invoke('confirm',{node,action:'accept',reason:'Main inspected actual evidence',...extra});
  const accept=async node=>{const id=await spawn(node);await wait(id);await confirm(node,{actor_id:id,round:run.actors[id].rounds.length});return id;};
  const prepare=async()=>{await api.reload(run,repo,{compile:true});await accept('plan:initial');await accept('plan:final');};
  return {repo,run,rpc,calls,tasks,invoke,spawn,wait,confirm,accept,prepare,cleanup:()=>rm(repo,{recursive:true,force:true})};
}
