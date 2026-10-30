/** Structural graph gates plus ES transport; workflow decisions belong to Main. */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { withRun, readRun } from './run-store.js';
import { createEsTransport } from './es-cli.js';
import * as execution from './execution.js';
const str=(description,required=false)=>({type:'string',description,...(required?{required:true}:{})});
const number=(description,required=false)=>({type:'number',description,...(required?{required:true}:{})});
const list=(description,required=false)=>({type:'array',items:{type:'string'},description,...(required?{required:true}:{})});
export function registerWorkflowTools(ctx,{es=createEsTransport(),host}={}){
  const add=(name,description,parameters,handler)=>ctx.tools.register(defineTool({name,description,parameters,
    output:{schema:{type:'json'},render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]},
    async execute(args,exec){try{
      if(!exec.agent?.session?.id)throw new Error('real current host session required');
      await host?.assertActive(exec.agent);
      const repo=await ctx.workingDirectory.ensure(exec.agent);if(!repo)throw new Error('no working directory');
      const session=exec.agent.session.id,rpc=(command,payload)=>es(command,payload,{signal:exec.signal});
      if(name==='sfd_subagent_wait'){
        const poll=await withRun(repo,session,(run,root)=>execution.prepareWait(run,root,args));
        const result=await execution.pollWait(poll,rpc);
        return await withRun(repo,session,(run,root)=>execution.finishWait(run,root,poll,result));
      }
      if(['sfd_subagent_observe','sfd_subagent_cancel','sfd_subagent_cencel','sfd_cancel'].includes(name)){
        const snapshot=await readRun(repo,session);let graphWarning=null;
        try{await execution.reload(snapshot,repo);}catch(e){graphWarning=e.message;}
        return {...await handler(snapshot,repo,args,rpc),graphWarning};
      }
      return await withRun(repo,session,(run,root,io)=>handler(run,root,args,rpc,io));
    }catch(error){return {ok:false,error:error.message,code:error.code??'SFD_CONTRACT',locations:error.locations??[],...(error.actorId?{actor_id:error.actorId,message_id:error.messageId}: {})};}},
  }));
  add('sfd_compile_workflow','Compile the latest PLAN-FULL into an execution graph with located errors.',{},async(run,repo)=>{await execution.reload(run,repo,{compile:true});return {ok:true,...execution.summary(run),graph:run.graph};});
  add('sfd_workflow_status','Read the current graph, task rounds and Main dispositions.',{},async(run,repo)=>{await execution.reload(run,repo);return {ok:true,...execution.summary(run),graph:run.graph,actors:run.actors,dispositions:run.dispositions,groups:run.groups,lenses:run.lenses};});
  add('sfd_workflow_update','Main explicitly adds bounded current obligations; validates graph/session structure without interpreting findings or dispatching work.',{
    reason:str('Main admission/scope and reason',true),
    obligations:{type:'array',required:true,items:{type:'object',additionalProperties:true},description:'1..16 entries: {id:semantic-name, purpose:integration|focused-review|verify-finding|repair|closure|repair-delta|plan-delta|repair-reconciliation, unit?,feature?,needs?:nodeIds,before:nodeIds,source_actor_id?:discovering reviewer,source_round?:actual historical report round,implementation_actor_id?:original implementer,review_node?:real prior checkpoint}. Continuations reuse actual source sessions; repair follows original tier. Main names all required predecessor/closure obligations.'},
  },execution.update);
  add('sfd_subagent_spawn','Dispatch a prevalidated batch. Return known IDs and partial failures without retrying.',{
    tasks:{type:'array',required:true,items:{type:'object',additionalProperties:true},description:'1..16 entries: {node, assignment, route:{profile} OR {subagent,model?,effort?,developer_instructions?}, covers?:[parent reconciliation node],continuity_gap?:{actor_id,reason,evidence}}. Only one explicit same-route recorded-gap replacement is allowed when the required actor cannot continue; original actual identities remain distinct. Only a final child checkpoint may also author parent reconciliation; Main confirms both conclusions separately.'},reviewIsolation:str('Required for overlapping reviewers: immutable candidate and isolated report/test effects'),
  },execution.spawn);
  add('sfd_subagent_wait','Wait for requested actors and their batch peers; return results, pending IDs and stage guidance.',{agent_ids:list('1..16 distinct ES IDs',true),wait_time:number('0..290 seconds; default 290')},execution.wait);
  add('sfd_subagent_result','Read the next report page for the current actor round.',{agent_id:str('ES actor ID',true),offset:number('Next result offset'),limit:number('Result page size')},execution.result);
  add('sfd_subagent_observe','Read actor diagnostics without changing workflow state.',{agent_id:str('ES actor ID',true)},(run,_repo,args,rpc)=>execution.observe(run,args,rpc));
  add('sfd_subagent_cancel','Request cancellation of this actor only. Does not change the graph, cancel peers, roll back edits or count as completion; wait for the real outcome.',{agent_id:str('ES actor ID',true)},(run,_repo,args,rpc)=>execution.cancel(run,args,rpc));
  add('sfd_cancel','Main-selected process change: request cancellation only for the explicitly listed actors. Main decides timing, graph revisions and treatment of existing edits. No automatic peer cancellation, rollback or extra confirmation.',{agent_ids:list('1..16 explicit ES IDs',true),reason:str('Main decision under user request and skill',true)},(run,_repo,args,rpc)=>execution.cancelSelected(run,args,rpc));
  add('sfd_subagent_cencel','Deprecated spelling alias for sfd_subagent_cancel; cancel only this explicitly named actor and wait for its real outcome.',{agent_id:str('ES actor ID',true)},(run,_repo,args,rpc)=>execution.cancel(run,args,rpc));
  add('sfd_subagent_send','Continue the same actor/session. Invalidates this node and downstream acceptance; never spawns or selects a replacement.',{
    agent_id:str('Existing ES actor ID',true),node:str('Optional next node of the same kind and owning Section/Feature; declared continuations require their recorded actor'),content:str('Main-selected bounded follow-up',true),mode:str('queue (default) or steer'),covers:list('Only a final child checkpoint may also cover its parent reconciliation'),reviewIsolation:str('Required for overlapping reviewers: immutable candidate and isolated effects'),
  },execution.send);
  add('sfd_workflow_confirm','Record Main decisions. Reports are never interpreted as CLEAN; skill procedures remain Main-owned.',{
    node:str('Graph node ID',true),action:str('accept | hold | risks | resolve | retain | waive; retain explicitly preserves unaffected previously accepted plan coverage using its actual actor/round and reason',true),reason:str('Decision and evidence; resolve requires checking uncertain dispatch before any retry',true),actor_id:str('Successful actor required to accept a non-Main node'),round:number('Its current round'),lenses:list('For risks: Main-selected specialist labels; [] means none'),group_id:str('For resolve: uncertain dispatch group'),user_source:str('For waive: explicit user authorization provenance'),
  },execution.confirm);
}
