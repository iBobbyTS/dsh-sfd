/** Small DSH tool facade. Main decides scope, findings and when to invoke tools. */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { inspect } from './cleanup.js';
import { loadState, mutateState } from './state.js';
import { createFlow, status, revise, ready, recheckCandidate, mark, admitReview, acceptSection, closeFindings } from './flow.js';
import { candidate, spawnRequest, es, collect, writeReport } from './actors.js';
import { preflight } from './es.js';

const str = (description,required=false)=>({type:'string',description,...(required?{required:true}:{})});
const list=(description)=>({type:'array',items:{type:'string'},description});

export function registerWorkflowTools(ctx, deps={}) {
  const rpc=deps.es??es;
  const snapshot=deps.candidate??candidate;
  const reportWriter=deps.writeReport??writeReport;
  const checkRole=deps.preflight??preflight;
  const repoOf=async exec=>{
    const cwd=await ctx.workingDirectory?.ensure(exec.agent);
    if(!cwd)throw new Error('no workspace');
    return (await inspect(cwd)).root;
  };
  const withFlow=async(exec,kind,fn)=>{
    const repo=await repoOf(exec);
    const {result,state}=await mutateState(repo,kind,async st=>{
      if(!st.flow)throw new Error('workflow not initialized: call sfd_flow_init');
      if(st.phase==='DONE')throw new Error('workflow already completed');
      const answer=await fn(st.flow,st,repo);
      return answer;
    });
    return {ok:true,...(result??{}),revision:state.flow?.revision};
  };
  const add=(name,description,parameters,handler)=>ctx.tools.register(defineTool({
    name,description,parameters,
    output:{schema:{type:'json'},render:(_args,v)=>[{type:'text',text:JSON.stringify(v)}]},
    async execute(args,exec){try{return await handler(args,exec);}catch(error){return{ok:false,error:String(error?.message??error)}}},
  }));

  add('sfd_flow_init','Create SFD task graph from approved PLAN-FULL sections; does not execute anything.',{
    sections:{type:'array',required:true,items:{type:'object',additionalProperties:true},description:'[{id,profile:impl_std|impl_large,dependsOn?:string[],subsections?:string[],lenses?:string[]}]'},
  },async(args,exec)=>{
    const repo=await repoOf(exec);
    const {state}=await mutateState(repo,'flow-init',st=>{
      if(st.flow)throw new Error('flow already exists; use sfd_flow_revise');
      st.flow=createFlow(args.sections);st.phase='ACTIVE';
    });
    return{ok:true,workflow:status(state.flow)};
  });

  add('sfd_flow_status','Show current actual SFD graph, prerequisites, live actors and waivers.',{},async(_args,exec)=>{
    const repo=await repoOf(exec),st=await loadState(repo);
    if(!st?.flow)return{ok:false,error:'SFD workflow not initialized'};
    return{ok:true,...status(st.flow)};
  });

  add('sfd_flow_revise','Revise unfinished task graph while running; only USER instructions may waive Code B (soft authority, recorded).',{
    action:{type:'string',required:true,enum:['add_section','add_subsection','set_lenses','add_task','waive_code_b','restore_code_b']},
    section:str('Section ID'),subsection:str('Subsection ID'),before:{type:'json',description:'For add_task: string[] before targets; for add_subsection: string target'},
    id:str('Custom task ID'),profile:str('impl_std or impl_large'),dependsOn:list('Dependencies'),lenses:list('Code A required risk lenses'),
    authorization:str('For waivers: user'),reason:str('Human-readable revision reason'),
  },async(args,exec)=>withFlow(exec,'flow-revise',(flow,st)=>{
    st.flow=revise(flow,args);return{change:args.action,workflow:status(st.flow)};
  }));

  add('sfd_actor_start','Dispatch an actual ES implementer or independent reviewer only when its workflow prerequisites are met.',{
    taskId:str('Implementation or review task ID',true),assignment:str('Bounded TASK / independent review instructions (no prior A findings in B1)',true),lens:str('For Code A: R01/R02/... or CLOSURE_VERIFY'),
  },async(args,exec)=>withFlow(exec,'actor-start',async(flow,_st,repo)=>{
    const code=await snapshot(repo,'deliver'),plan=await snapshot(repo,'plan:A');
    recheckCandidate(flow,code,plan);
    const current=args.taskId.startsWith('plan:')?plan:code;
    // Repair is an on-demand action, not another static DAG phase.
    // The original Section lineage keeps its cumulative five-wave limit.
    const repair=/^([A-Za-z][A-Za-z0-9_-]*):repair$/.exec(args.taskId);
    let task;
    if(repair){
      const section=flow.sections.find(s=>s.id===repair[1]);
      if(!section)throw new Error('unknown repair Section');
      if(!Object.values(flow.findings).some(f=>f.status==='open' && f.task.startsWith(section.id+':')))
        throw new Error('no admitted open material finding for repair');
      if((flow.repairWaves?.[section.id]??0)>=5)throw new Error('five repair waves exhausted; seek Advisor/user decision');
      if(Object.values(flow.actors).some(a=>['running','cancelling'].includes(a.status)))
        throw new Error('finish live actors before shared worktree repair');
      task={id:args.taskId,type:'impl',route:section.profile,section:section.id};
    } else task=ready(flow,args.taskId);
    if(!['impl','review'].includes(task.type))throw new Error('task is not an ES actor task');
    if(task.type==='review' && task.lenses && !task.lenses.includes(args.lens??'R01') && args.lens!=='CLOSURE_VERIFY')throw new Error('unselected review lens');
    if(task.type==='impl' && Object.values(flow.actors).some(a=>['running','cancelling'].includes(a.status)))throw new Error('shared worktree: wait for other actors before writing');
    if(task.type==='review' && Object.values(flow.actors).some(a=>['running','cancelling'].includes(a.status) && flow.tasks[a.task]?.type==='impl'))throw new Error('writer active: cannot review mutable candidate');
    const availability=await checkRole([task.route]);
    if(!availability.ok)throw new Error('ES route unavailable: '+(availability.problems??[availability.blocking]).join('; '));
    const payload=spawnRequest(repo,task,args.assignment,args.lens);
    const spawned=await rpc('spawn',payload);
    const id=String(spawned.agent_id);
    if(!/^\d{8}$/.test(id))throw new Error('ES spawn did not return a valid actor ID (do not retry blindly)');
    if(repair){flow.repairWaves??={};flow.repairWaves[repair[1]]=(flow.repairWaves[repair[1]]??0)+1;}
    flow.actors[id]={id,task:task.id,lens:args.lens??(task.lenses?'R01':null),status:'running',candidate:current,
      kind:repair?'repair':task.type,startedAt:new Date().toISOString()};
    return{actorId:id,taskId:task.id,candidate:current,status:spawned.status};
  }));

  add('sfd_actor_collect','Read terminal ES result, persist verbatim authored report and close actor. Running/pending-input is not review evidence.',{
    actorId:str('ES task id',true),
  },async(args,exec)=>withFlow(exec,'actor-collect',async(flow,_st,repo)=>{
    const actor=flow.actors[args.actorId];
    if(!actor)throw new Error('unknown actor');
    if(!['running','cancelling'].includes(actor.status))return{actorId:actor.id,status:actor.status,report:actor.report};
    if(actor.status==='cancelling'){
      const wait=await rpc('wait',{agent_id:Number(actor.id),wait_time:0});
      const terminal=['completed','failed','cancelled','timed_out','runtime_lost','result_invalid','closed'].includes(wait.task?.status);
      if(!terminal)return{actorId:actor.id,status:'cancelling',pendingRequests:wait.pending_requests??[]};
      actor.status='cancelled';
      try{await rpc('close',{agent_id:Number(actor.id)});}catch(e){actor.closeWarning=String(e?.message??e);}
      return{actorId:actor.id,status:'cancelled'};
    }
    const result=await collect(repo,args.actorId,rpc);
    if(!result.finished)return{actorId:actor.id,status:result.status,pendingRequests:result.pendingRequests};
    const task=flow.tasks[actor.task]??{id:actor.task,type:'impl'};
    const report=await reportWriter(repo,task,actor.id,result.reportText);
    actor.report=report;actor.status=actor.status==='cancelling'?'cancelled':result.status;actor.outcome=result.outcome;
    if(task.type==='review' && actor.candidate!==await snapshot(repo,task.id)){
      actor.status='drifted';
    }
    try{await rpc('close',{agent_id:Number(actor.id)});}catch(e){actor.closeWarning=String(e?.message??e);}
    return{actorId:actor.id,status:actor.status,report, ...(actor.closeWarning?{closeWarning:actor.closeWarning}:{})};
  }));

  add('sfd_actor_cancel','Cancel a live actor before revising a running review.',{
    actorId:str('ES actor id',true),reason:str('Why cancelled'),
  },async(args,exec)=>withFlow(exec,'actor-cancel',async(flow)=>{
    const actor=flow.actors[args.actorId];if(!actor||!['running','cancelling'].includes(actor.status))throw new Error('no such live actor');
    await rpc('cancel',{agent_id:Number(actor.id)});
    actor.status='cancelling';actor.cancelReason=args.reason??'user workflow revision';
    return{actorId:actor.id,status:actor.status};
  }));

  add('sfd_review_admit','Main evaluates real reviewer report; no call success or textual CLEAN can substitute for terminal evidence.',{
    taskId:str('Review task',true),actorId:str('ES actor from sfd_actor_collect',true),verdict:{type:'string',required:true,enum:['clean','material']},
    findings:{type:'array',items:{type:'object',additionalProperties:true},description:'Material [{id,description}]'},
  },async(args,exec)=>withFlow(exec,'review-admit',async(flow,st,repo)=>{
    const code=await snapshot(repo,'deliver'),plan=await snapshot(repo,'plan:A');
    recheckCandidate(flow,code,plan);
    const cur=args.taskId.startsWith('plan:')?plan:code;
    const actor=flow.actors[args.actorId];
    if(!actor || actor.task!==args.taskId)throw new Error('actor not assigned to this review');
    if(actor.lens==='CLOSURE_VERIFY')throw new Error('closure reviewer is only for sfd_findings_close');
    const next=admitReview(flow,args.taskId,args.actorId,args.verdict,actor.lens,cur,args.findings??[]);
    st.flow=next;return{taskId:args.taskId,status:next.tasks[args.taskId].status,openFindings:status(next).openFindings};
  }));

  add('sfd_findings_close','Close material finding IDs only after independent CLOSURE_VERIFY actor on current repaired candidate.',{
    actorId:str('Terminal ES CLOSURE_VERIFY actor ID',true),ids:list('Finding IDs to close'),explanation:str('Main reason/evidence for closure',true),
  },async(args,exec)=>withFlow(exec,'finding-close',async(flow,st,repo)=>{
    const actor=flow.actors[args.actorId];
    if(!actor||actor.lens!=='CLOSURE_VERIFY'||actor.status!=='completed'||!actor.report)throw new Error('independent terminal CLOSURE_VERIFY report required');
    const current=await snapshot(repo,actor.task);
    if(current!==actor.candidate)throw new Error('closure review candidate drifted');
    for(const id of args.ids??[]){const f=flow.findings[id];if(!f || f.status!=='open'||(f.task.split(':')[0]!==actor.task.split(':')[0] && f.task!==actor.task))throw new Error(`closure actor does not cover finding ${id}`);}
    st.flow=closeFindings(flow,args.ids??[],`${args.explanation} (${actor.report})`,current);
    return{closed:args.ids,openFindings:status(st.flow).openFindings};
  }));

  add('sfd_task_finish','Complete a verified implementation, parent reconciliation or custom step. Reviews must use sfd_review_admit.',{
    taskId:str('Task ID',true),actorId:str('Terminal implementation actor ID'),explanation:str('Evidence, tests or reconciliation summary',true),
  },async(args,exec)=>withFlow(exec,'task-finish',async(flow,st,repo)=>{
    const current=await snapshot(repo,args.taskId),plan=await snapshot(repo,'plan:A');
    recheckCandidate(flow,current,plan);
    const next=mark(flow,args.taskId,{actorId:args.actorId,explanation:args.explanation,candidate:current},current);
    st.flow=next;return{taskId:args.taskId,status:'done',candidate:current};
  }));

  add('sfd_section_accept','Accept Section only with valid A, B1/B2 or explicit user B waiver and real business/test evidence.',{
    section:str('Section ID',true),explanation:str('Tests and Feature journey evidence (or missing limitations)',true),
  },async(args,exec)=>withFlow(exec,'section-accept',async(flow,st,repo)=>{
    const current=await snapshot(repo,`${args.section}:accept`),plan=await snapshot(repo,'plan:A');
    recheckCandidate(flow,current,plan);
    st.flow=acceptSection(flow,args.section,current,args.explanation);
    return{section:args.section,status:flow.waivers[args.section]?'ACCEPTED_WITH_WAIVER':'ACCEPTED',candidate:current};
  }));

  add('sfd_flow_complete','Finish delivery only after all accepted Sections; no skipped gates or unclosed findings.',{
    explanation:str('Observed Feature-level integrated behavior and final tests',true),
  },async(args,exec)=>withFlow(exec,'flow-complete',async(flow,st,repo)=>{
    const current=await snapshot(repo,'deliver');
    if(Object.values(flow.actors).some(a=>['running','cancelling'].includes(a.status)))throw new Error('live ES actors remain');
    if(status(flow).openFindings.length)throw new Error('open material findings remain');
    const final=mark(flow,'deliver',{explanation:args.explanation},current);
    st.flow=final;st.phase='DONE';
    return{status:'DONE',waivers:final.waivers};
  }));
}
