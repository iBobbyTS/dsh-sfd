/** Thin order/evidence wrapper. Main supplies every semantic disposition. */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { compilePlan, digest } from './compiler.js';
import { legacyFiles } from './run-store.js';
import { applyObligations, declaration, purposeOf, coverage } from './obligations.js';
import { navigation, fullGuidance, mainGuidance, waitInstruction } from './guidance.js';
const terminal=new Set(['completed','failed','cancelled','timed_out','runtime_lost','result_invalid','closed']);
const nonempty=(v,label)=>{if(typeof v!=='string'||!v.trim())throw new Error(`${label} is required`);return v;};
const actorOf=(run,id)=>{const a=run.actors[String(id)];if(!a)throw new Error(`unknown actor ${id}`);return a;};
const roundOf=a=>a.rounds.at(-1);
const done=(run,id)=>['accepted','waived'].includes(run.dispositions[id]?.decision);
const isLive=a=>!terminal.has(roundOf(a).status)||!!roundOf(a).unresolved;
const unitOf=(run,id)=>run.graph.units.find(u=>u.id===id);
const continuationOf=(run,id)=>Object.values(run.actors).find(a=>a.replacementFor===id)?.id??id;
export function missing(run,node){return node.needs.filter(id=>!done(run,id));}
export function readyNodes(run){return Object.values(run.graph?.nodes??{}).filter(n=>!done(run,n.id)&&!missing(run,n).length).map(n=>n.id);}
export function summary(run){return {runId:run.id,revision:run.revision,stale:run.stale??null,ready:readyNodes(run),openSections:openSections(run)};}
function invalidate(run,ids,reason,{actors=true,preserve=[],cascade=true}={}){
  const affected=new Set(ids);let more=true;
  while(more&&cascade){more=false;for(const n of Object.values(run.graph.nodes))if(!affected.has(n.id)&&n.needs.some(x=>affected.has(x))){affected.add(n.id);more=true;}}
  const historical=new Set(preserve);
  for(const id of affected)if(run.dispositions[id]&&!historical.has(id)){run.dispositions[id].invalidated=reason;run.dispositions[id].decision='invalidated';}
  for(const a of Object.values(run.actors))if(actors&&affected.has(a.node)&&!historical.has(a.node))a.invalidated=reason;
  return [...affected];
}
function invalidateWork(run,ids,reason){
  const planId=id=>id.startsWith('plan:')||run.graph.nodes[id]?.purpose==='plan-delta';
  invalidate(run,ids.filter(id=>!planId(id)),reason);
  invalidate(run,ids.filter(planId),reason,{cascade:false});
}
function applySpecialists(graph,section,lenses){
  const risk=graph.nodes[`${section}:risk`];if(!risk)return;
  for(const id of Object.keys(graph.nodes))if(id.startsWith(`${section}:specialist:`))delete graph.nodes[id];
  for(const lens of lenses){const id=`${section}:specialist:${lens}`;graph.nodes[id]={...graph.nodes[`${section}:behavior`],id,kind:'review',role:'specialist-review',needs:[`${section}:behavior`]};}
  risk.needs=[`${section}:behavior`,...lenses.map(l=>`${section}:specialist:${l}`)];
}
export async function reload(run,repo,{compile=false}={}) {
  const legacy=await legacyFiles(repo);if(legacy.length)throw new Error(`legacy state requires Main disposition outside wrapper: ${legacy.join(', ')}; files unchanged`);
  let graph;
  try{graph=compilePlan(await readFile(join(repo,'.agent-work','PLAN-FULL.md'),'utf8'));}
  catch(e){run.stale=String(e.message);throw e;}
  if(!run.graph&&!compile)throw new Error('call sfd_compile_workflow first');
  if(run.graph?.digest===graph.digest){run.stale=null;return;}
  if(run.graph?.evidenceDigest&&run.graph.evidenceDigest===graph.evidenceDigest){run.graph.digest=graph.digest;run.stale=null;return;}
  for(const [section,lenses] of Object.entries(run.lenses??{}))applySpecialists(graph,section,lenses);
  applyObligations(graph,run);
  const old=run.graph;
  if(old){
    // Whole-plan evidence must be rechecked in its original sessions. Code evidence
    // survives only when its unit, Feature contract and dependencies are unchanged.
    const changed=old.units.filter(u=>!graph.units.some(v=>v.id===u.id&&v.fingerprint===u.fingerprint&&v.feature===u.feature)).map(u=>u.parent??u.id);
    for(const f of old.features)if(!graph.features.some(v=>v.id===f.id&&v.fingerprint===f.fingerprint))for(const u of old.units.filter(u=>u.feature===f.id))changed.push(u.parent??u.id);
    if(old.commonFingerprint!==graph.commonFingerprint)changed.push(...old.units.filter(u=>!u.parent).map(u=>u.id));
    const ids=Object.values(old.nodes).filter(n=>changed.includes(n.section)||graph.nodes[n.id]&&JSON.stringify(n.needs)!==JSON.stringify(graph.nodes[n.id].needs)).map(n=>n.id);
    for(const [id,node] of Object.entries(old.nodes))if(!graph.nodes[id]&&!done(run,id)){graph.nodes[id]={...node,retired:true,needs:[]};}
    // Plan confirmation is deliberately separate from code invalidation cones.
    for(const id of ['plan:initial','plan:final'])if(run.dispositions[id])run.dispositions[id].decision='invalidated';
    const historical=Object.keys(old.nodes).filter(id=>(!graph.nodes[id]||graph.nodes[id].retired)&&done(run,id));
    invalidate(run,ids,'plan unit/contract changed',{preserve:historical});
    for(const a of Object.values(run.actors))if(a.role==='plan-review'||a.node.startsWith('plan:'))a.invalidated='plan changed';
    if(run.dispositions.delivery)run.dispositions.delivery.decision='invalidated';
    for(const id of Object.keys(run.dispositions))if(!graph.nodes[id]&&!done(run,id))run.dispositions[id].decision='invalidated';
  }
  graph.nodes.delivery.needs.push(...Object.values(graph.nodes).filter(n=>n.retired).map(n=>n.id));
  run.graph=graph;run.revision++;run.stale=null;

}
async function checkOrder(run,repo,nodeId) {
  const check=()=>{
    const n=run.graph.nodes[nodeId];if(!n)throw new Error(`unknown node ${nodeId}`);
    if(n.purpose==='repair-reconciliation'&&done(run,n.section+':blind')&&run.dispositions[n.section+':blind'].actorId!==n.sourceActor)throw new Error('update repair-reconciliation to the current fresh blind reviewer before continuation');
    if(n.purpose==='repair'){
      const original=run.actors[n.implementationActor];
      n.continueActor=original?.role==='impl_large'?original.id:Object.values(run.actors).find(a=>a.repairFor===n.implementationActor)?.id??null;
    }else if(['checkpoint','parent-reconciliation'].includes(purposeOf(n))){
      n.continueActor=Object.values(run.actors).find(a=>a.section===n.section&&a.role==='behavior-review')?.id??null;
    }else if(n.id.startsWith('plan:')){
      n.continueActor=Object.values(run.actors).find(a=>a.role==='plan-review'&&(a.originNode===n.id||a.rounds.some(r=>r.node===n.id)||a.node===n.id)&&a.rounds.some(r=>r.reportComplete&&r.outcome==='COMPLETED'))?.id??null;
    }
    if(n.continueActor)n.continueActor=continuationOf(run,n.continueActor);
    const absent=missing(run,n);if(absent.length)throw new Error(`${run.graph.path}:${n.line}: ${nodeId} requires ${absent.join(', ')}`);return n;
  };
  try{return check();}catch{await reload(run,repo);return check();}
}
function openSections(run){return [...new Set(Object.values(run.actors).map(a=>a.section).filter(id=>id&&!done(run,id+':accept')))];}
function dependsOnSection(run,dependent,upstream,seen=new Set()){
  if(seen.has(dependent))return false;seen.add(dependent);
  return (unitOf(run,dependent)?.dependsOn??[]).some(id=>id===upstream||dependsOnSection(run,id,upstream,seen));
}
function assertSection(run,node){
  if(!node.section)return;
  for(const other of openSections(run).filter(id=>id!==node.section)){
    const upstream=dependsOnSection(run,other,node.section)&&run.dispositions[node.section+':accept']?.decision==='invalidated';
    if(!upstream||Object.values(run.actors).some(a=>a.section===other&&(isLive(a)||roundOf(a).blocked||!run.groups[roundOf(a).group]?.settled)))throw new Error('no parallel Sections: '+other+' is not accepted');
  }
}
function unresolvedDispatch(run){return Object.values(run.groups).some(g=>!g.dispatchComplete&&g.operations?.some(o=>o.state==='pending'||o.state==='uncertain'));}
function ensureSerial(run,node,{reviewIsolation}={},extra=[]) {
  assertSection(run,node);
  if(node.section&&extra.some(n=>n.section&&n.section!==node.section))throw new Error('no parallel Sections in a reviewer batch');
  const others=[...Object.values(run.actors).filter(isLive).map(a=>run.graph.nodes[a.node]??{kind:a.kind}),...extra];
  if(others.length&&(node.kind==='implementation'||others.some(n=>n.kind==='implementation')))throw new Error('shared workspace writer/reviewer overlap');
  if(others.length&&!nonempty(reviewIsolation,'enforced immutable source and isolated report/test effects declaration'))throw new Error('review isolation required');
}
function validateRoute(route){
  if(!route||typeof route!=='object'||Array.isArray(route))throw new Error('Main must select profile or inline route');
  const keys=Object.keys(route), allowed=['profile','subagent','model','effort','permission_mode','developer_instructions'];
  for(const k of keys)if(!allowed.includes(k))throw new Error(`unsupported route field ${k}`);
  if(route.profile!==undefined){nonempty(route.profile,'profile');if(keys.some(k=>k!=='profile'))throw new Error('profile and inline route fields are mutually exclusive');}
  else {nonempty(route.subagent,'inline subagent');if(route.permission_mode!==undefined&&route.permission_mode!=='yolo')throw new Error('inline permission_mode must be yolo');}
  for(const key of keys)nonempty(route[key],key);
  return route.profile?{...route}:{...route,permission_mode:'yolo'};
}
const standing=node=>node.kind==='implementation'
  ? 'Implement only the assigned owner/write boundary and regression tests. You are not alone: preserve others’ edits. Do not commit, manage branches, review or accept your work. Return the dispatched SECTION-HANDOFF report.'
  : 'Independent reviewer: read the frozen candidate and actual contract, never edit product/tests or accept work. Main owns official tests and semantic dispositions. Return your authored report. Final review is blind complete discovery: do not receive peer findings or repair history before freezing it.';
export async function update(run,repo,args){
  await reload(run,repo);nonempty(args.reason,'Main obligation reason');
  if(!Array.isArray(args.obligations)||!args.obligations.length||args.obligations.length>16)throw new Error('obligations requires 1..16 Main declarations');
  const draft=structuredClone(run),added=[],seen=new Set();
  draft.obligations??={};
  for(const input of args.obligations){
    if(seen.has(input.id))throw new Error('duplicate obligation in update');seen.add(input.id);
    const node=declaration(draft,input);node.reason=args.reason;
    draft.obligations[node.id]=node;draft.graph.nodes[node.id]=node;added.push(node.id);
  }
  // Rebuild from the plan so edges stay canonical and declarations are atomic.
  const graph=compilePlan(await readFile(join(repo,'.agent-work','PLAN-FULL.md'),'utf8'));
  for(const [section,lenses] of Object.entries(draft.lenses??{}))applySpecialists(graph,section,lenses);
  for(const [id,node] of Object.entries(run.graph.nodes))if(node.retired&&!graph.nodes[id])graph.nodes[id]=structuredClone(node);
  applyObligations(graph,draft);
  graph.nodes.delivery.needs=[...new Set([...graph.nodes.delivery.needs,...Object.values(graph.nodes).filter(n=>n.retired).map(n=>n.id)])];
  for(const id of added){
    const targets=[id,...(run.obligations?.[id]?.before??[]),...graph.nodes[id].before],reason='Main declared prerequisite '+id;
    invalidateWork(run,targets,reason);
  }
  run.obligations=draft.obligations;run.graph=graph;
  return {ok:true,added,...summary(run),instruction:'Main declared these obligations; nothing was spawned, repaired or semantically accepted.',next:added.map(id=>({node:id,continue_actor_id:graph.nodes[id].continueActor,role:graph.nodes[id].role}))};
}
export async function spawn(run,repo,args,rpc,{checkpoint=async()=>{}}={}){
  await reload(run,repo);
  if(unresolvedDispatch(run))throw new Error('unresolved dispatch requires explicit Main reconciliation before another spawn');
  if(!Array.isArray(args.tasks)||!args.tasks.length||args.tasks.length>16)throw new Error('tasks requires 1..16 entries');
  const prepared=[],seen=new Set();
  for(const task of args.tasks){
    const node=await checkOrder(run,repo,task.node);
    if(node.retired)throw new Error('removed plan obligation requires explicit user waiver, not dispatch');
    if(node.kind==='main')throw new Error('Main node is confirmed, not dispatched');
    const gap=task.continuity_gap;
    if(node.continueActor&&!gap)throw new Error(`continue established session ${node.continueActor} with sfd_subagent_send, or explicitly record the skill's same-route continuity gap`);
    if(gap){
      if(!node.continueActor||String(gap.actor_id)!==node.continueActor)throw new Error('continuity gap must name the required unavailable session');
      nonempty(gap.reason,'Main continuity gap reason');nonempty(gap.evidence,'frozen report/finding IDs or failed-attempt evidence');
      const prior=actorOf(run,node.continueActor);
      if(isLive(prior))throw new Error('wait for the unavailable actor to terminate before replacing its session');
      if(prepared.some(p=>p.gap&&String(p.gap.actor_id)===prior.id))throw new Error('one replacement per unavailable session in a batch');
      if(prior.replacementFor||Object.values(run.actors).some(a=>a.replacementFor===prior.id))throw new Error('one recorded same-route replacement is already used');
    }
    if(done(run,node.id))throw new Error('node already accepted');
    if(seen.has(node.id))throw new Error('duplicate batch node');seen.add(node.id);
    if(Object.values(run.actors).some(a=>a.node===node.id&&isLive(a)))throw new Error('node has a live actor');
    ensureSerial(run,node,args,prepared.map(x=>x.node));
    const route=validateRoute(task.route);nonempty(task.assignment,'assignment');
    if(gap){const prior=actorOf(run,node.continueActor);if(['profile','subagent','model','effort','permission_mode'].some(key=>route[key]!==prior.route[key]))throw new Error('continuity gap replacement must use the same recorded route');}
    const covers=coverage(run,node,task.covers);
    prepared.push({node,route,covers,gap,prompt:`${standing(node)}\n${gap?'Recorded continuity break from '+gap.actor_id+': '+gap.reason+'; frozen evidence: '+gap.evidence+'. This is a new actual session, not uninterrupted continuity.\n':''}Node: ${node.id}; logical role: ${node.role}; purpose: ${purposeOf(node)}.\n${covers.length>1?'Author separate conclusions for: '+covers.join(', ')+'.\n':''}${task.assignment}`});
  }
  const groupId=randomUUID(), group=run.groups[groupId]={ids:[],settled:false,dispatchComplete:false,operations:prepared.map(p=>({node:p.node.id,state:'not_attempted',...(p.gap?{continuityGap:p.gap}:{})}))};
  const failures=[];
  for(let index=0;index<prepared.length;index++){
    const {node,route,prompt,covers,gap}=prepared[index];
    group.operations[index].state='pending';await checkpoint();
    try{
      const answer=await rpc('spawn',{repository:repo,prompt,...route});
      const id=String(answer.agent_id);
      if(!/^\d{8}$/.test(id)||run.actors[id])throw new Error('invalid/duplicate spawn identity; dispatch may have occurred, inspect before any retry');
      run.actors[id]={id,node:node.id,originNode:node.id,replacementFor:gap?String(gap.actor_id):null,recordedGap:gap??null,kind:node.kind,role:node.role,unit:node.unit,section:node.section,feature:node.feature,repairFor:node.purpose==='repair'?node.implementationActor:null,route,sessionId:answer.session_id??null,observedIdentity:'UNKNOWN',ordinal:Object.keys(run.actors).length+1,createdAt:Date.now(),createdRevision:run.revision,rounds:[{number:1,node:node.id,purpose:purposeOf(node),covers,status:answer.status??'running',revision:run.revision,group:groupId,pages:[]} ]};
      group.ids.push(id);group.operations[index]={node:node.id,state:'created',agentId:id,sessionId:answer.session_id??null};
      if(!answer.session_id||Object.values(run.actors).some(a=>a.id!==id&&a.sessionId===answer.session_id)){run.actors[id].continuityGap='fresh independent session identity unavailable or reused';}
      await checkpoint();
    }catch(error){group.operations[index].state=group.operations[index].state==='created'?'created':'uncertain';failures.push({index,node:node.id,error:String(error.message),code:error.code??null,dispatchUncertain:true});for(let i=index+1;i<prepared.length;i++)failures.push({index:i,node:prepared[i].node.id,error:'not attempted after dispatch failure',dispatchUncertain:false});break;}
  }
  group.dispatchComplete=failures.length===0;group.failures=failures;
  return {ok:!failures.length,groupId,agent_ids:group.ids,failures,instruction:group.ids.length?waitInstruction(group.ids):'Inspect dispatch failure; do not retry a non-idempotent spawn blindly.'};
}
function checkIdentity(a,task){
  if(task?.agent_id!==undefined&&String(task.agent_id)!==a.id)throw new Error('actor identity changed');
  if(task?.session_id!==undefined&&task.session_id!==null){if(!a.sessionId||a.sessionId!==task.session_id){a.continuityGap='session identity unavailable or replaced';throw new Error(a.continuityGap);}}
  if(task?.input_identity)a.observedIdentity=task.input_identity;
}
function pageReceipt(a,body,offset=0){
  checkIdentity(a,body.task);const round=roundOf(a), result=body.result;
  if(!result)return;
  if(result.offset!==offset)throw new Error('result offset mismatch');
  if(round.pages.length&&round.outcome!==result.outcome)throw new Error('result outcome changed across pages');
  const end=offset+Buffer.byteLength(result.final_text??''),next=result.next_offset??null;
  if(!Number.isSafeInteger(result.total_bytes)||result.total_bytes<end)throw new Error('invalid total result bytes');
  if(next!==null&&(next!==end||next<=offset))throw new Error('result pagination did not advance contiguously');
  if(next===null&&result.total_bytes!==end)throw new Error('result ended before total bytes');
  const existing=round.pages.find(p=>p.offset===offset);if(existing&&existing.digest!==digest(result.final_text??''))throw new Error('result page changed');
  if(existing)return;
  round.pages.push({offset,digest:digest(result.final_text??''),nonempty:!!result.final_text?.trim(),bytes:Buffer.byteLength(result.final_text??'')});
  round.outcome=result.outcome;round.partial=result.partial;round.nextOffset=next;
  round.reportComplete=next===null&&!result.partial&&round.pages.some(p=>p.nonempty);
  round.failure=result.failure_message??null;
}
function successful(run,a){const r=roundOf(a),g=run.groups[r.group];return r.status==='completed'&&r.outcome==='COMPLETED'&&r.reportComplete&&!r.blocked&&!r.unresolved&&!a.continuityGap&&g?.settled&&g.dispatchComplete;}
function settle(run){for(const [key,group] of Object.entries(run.groups))group.settled=group.ids.length>0&&group.ids.every(id=>{const r=run.actors[id].rounds.find(x=>x.group===key);return r&&terminal.has(r.status)&&!r.blocked&&!r.unresolved;});}
async function instructions(run,actors){
  const output=[];
  for(const a of actors){
    if(!successful(run,a))continue;
    const node=run.graph.nodes[a.node]??{...a,purpose:roundOf(a).purpose},key=a.role+':'+(a.unit&&a.unit!==a.section?'child':'owner');
    const instruction=navigation(run,a);
    if(roundOf(a).number===1&&!run.instructionRoles.includes(key)){
      instruction.fullInstructions=await fullGuidance(node);run.instructionRoles.push(key);
    }
    output.push(instruction);
  }
  return output;
}
export async function prepareWait(run,repo,args){
  await reload(run,repo);const ids=args.agent_ids?.map(String),waitTime=args.wait_time??290;
  if(!ids?.length||ids.length>16||new Set(ids).size!==ids.length)throw new Error('wait requires 1..16 distinct actor IDs');
  if(!Number.isInteger(waitTime)||waitTime<0||waitTime>290)throw new Error('wait_time must be 0..290');
  const allIds=[...new Set(ids.flatMap(id=>run.groups[roundOf(actorOf(run,id)).group].ids))];
  return {actors:structuredClone(allIds.map(id=>actorOf(run,id))),waitTime};
}
// Poll outside the transaction; commit only to the exact actor round requested.
export async function pollWait(poll,rpc){
  const {actors,waitTime}=poll,bodies={},identities={},errors=[];
  const initial=actors.filter(a=>!roundOf(a).messageId);
  for(let offset=0;offset<initial.length;offset+=16){const chunk=initial.slice(offset,offset+16);try{
    const response=await rpc('wait',{agent_id:chunk.map(a=>Number(a.id)),wait_time:waitTime});
    for(const a of chunk)bodies[a.id]=response[a.id];if(response.error)errors.push(response.error);
  }catch(e){errors.push({error:e.message});}}
  await Promise.all(actors.filter(a=>roundOf(a).messageId).map(async a=>{try{
    const messageId=roundOf(a).messageId;
    const body=bodies[a.id]=await rpc('wait',{agent_id:Number(a.id),wait_time:waitTime,message_id:messageId});
    if(body.message_receipt?.message_id===messageId&&body.message_receipt.state==='delivered'&&!body.message_receipt.failure_code)
      identities[a.id]=await rpc('result',{agent_id:Number(a.id),offset:0});
  }catch(e){errors.push({actor_id:a.id,error:e.message});}}));
  return {bodies,identities,errors};
}
export async function finishWait(run,repo,poll,{bodies,identities,errors}){
  await reload(run,repo);
  for(const prior of poll.actors){const a=actorOf(run,prior.id),r=roundOf(a),expected=roundOf(prior),body=bodies[a.id];
    if(r.number!==expected.number||r.group!==expected.group){errors.push({actor_id:a.id,error:'stale wait response for an older round'});continue;}
    if(!body){errors.push({actor_id:a.id,error:'missing wait body'});continue;}
    try{
      checkIdentity(a,body.task);
      if(terminal.has(r.status)&&(!terminal.has(body.task?.status)||r.status!==body.task.status))continue;
      r.blocked=(body.pending_requests??[]).length>0;r.pendingRequests=body.pending_requests??[];
      if(r.messageId){
        const receipt=body.message_receipt;r.receipt=receipt??null;
        if(receipt?.message_id!==r.messageId||receipt.state!=='delivered'||receipt.failure_code){r.status='awaiting_message';r.blocked=true;continue;}
        const identity=identities[a.id];checkIdentity(a,identity?.task);
        if(identity?.task?.session_id!==a.sessionId){a.continuityGap='continued session identity unavailable or replaced';throw new Error(a.continuityGap);}
        // Proven transport delivery resolves uncertainty, never semantic acceptance.
        r.unresolved=false;r.sendState='delivered';if(r.revision===run.revision)a.invalidated=null;
      }
      r.status=body.task?.status??'unknown';
      if(!terminal.has(r.status))r.sawRunning=true;
      if(r.messageId&&terminal.has(r.status)&&!r.sawRunning&&digest(JSON.stringify(body.result))===r.previousResult){r.status='awaiting_new_result';r.blocked=true;continue;}
      if(terminal.has(r.status)&&body.result)pageReceipt(a,body,0);
    }catch(e){r.blocked=true;errors.push({actor_id:a.id,error:e.message});}
  }
  settle(run);const all=poll.actors.map(a=>actorOf(run,a.id));
  const remaining=all.filter(a=>!terminal.has(roundOf(a).status)||roundOf(a).blocked||roundOf(a).unresolved).map(a=>a.id);
  const complete=!remaining.length&&!errors.length;
  return {ok:!errors.length,agent_ids:all.map(a=>a.id),remaining_ids:remaining,complete,results:bodies,errors,
    instructions:complete?await instructions(run,all):[],instruction:remaining.length?waitInstruction(remaining):'Read all results and finish pagination before Main dispositions.'};
}
export async function wait(run,repo,args,rpc){const poll=await prepareWait(run,repo,args);return finishWait(run,repo,poll,await pollWait(poll,rpc));}
export async function result(run,repo,args,rpc){
  await reload(run,repo);const a=actorOf(run,args.agent_id),r=roundOf(a);
  if(!terminal.has(r.status)||r.blocked)throw new Error('wait for the current round and its message receipt first');
  const offset=args.offset??r.nextOffset??0;
  if(offset!==0&&offset!==r.nextOffset)throw new Error('read result pages in order');
  if(offset===0&&r.pages.length)throw new Error('use next_offset; first page already received');
  const body=await rpc('result',{agent_id:Number(a.id),offset,...(args.limit!==undefined?{limit:args.limit}:{})});pageReceipt(a,body,offset);settle(run);
  return {ok:true,actor_id:a.id,round:r.number,...body,instructions:await instructions(run,[a])};
}
export async function observe(run,args,rpc){const a=actorOf(run,args.agent_id);return {ok:true,actor_id:a.id,observation:await rpc('observe',{agent_id:Number(a.id)}),instruction:'Main diagnoses liveness; observation never releases a successor.'};}
export async function cancel(run,args,rpc){const a=actorOf(run,args.agent_id);const response=await rpc('cancel',{agent_id:Number(a.id)});return {ok:true,actor_id:a.id,response,instruction:waitInstruction([a.id])};}
export const cencel=cancel; // Compatibility with already-seen tool names; never the canonical spelling.
export async function cancelSelected(run,args,rpc){
  nonempty(args.reason,'Main cancellation reason');
  if(!Array.isArray(args.agent_ids)||!args.agent_ids.length||args.agent_ids.length>16||new Set(args.agent_ids.map(String)).size!==args.agent_ids.length)throw new Error('cancel requires 1..16 explicit distinct IDs');
  const ids=args.agent_ids.map(id=>actorOf(run,id).id),results=[],errors=[];
  for(const id of ids){try{results.push(await cancel(run,{agent_id:id},rpc));}catch(e){errors.push({actor_id:id,error:e.message});}}
  return {ok:!errors.length,agent_ids:ids,results,errors,instruction:waitInstruction(ids),note:'Only Main-selected actors received cancellation requests. No acceptance, graph change, automatic peer cancellation or rollback occurred.'};
}
function evidence(run,node,args,{retain=false}={}){
  const a=actorOf(run,args.actor_id),r=roundOf(a);
  const prior=run.dispositions[node.id],carried=retain&&node.id.startsWith('plan:')&&a.invalidated==='plan changed'&&prior?.actorId===a.id&&prior?.round===r.number;
  if(!(r.covers??[a.node]).includes(node.id)||!successful(run,a)||a.invalidated&&!carried||node.id.startsWith('plan:')&&r.revision!==run.revision&&!carried)throw new Error('matching current successful actor/report evidence required');
  if(args.round!==r.number)throw new Error('explicit current round required');return a;
}
export async function confirm(run,repo,args){
  await reload(run,repo);nonempty(args.reason,'Main reason/evidence');
  const node=run.graph.nodes[args.node];if(!node)throw new Error('unknown node');
  if(node.retired&&args.action!=='waive')throw new Error('removed mandatory obligation requires explicit user waiver');
  if(args.action==='resolve'){
    const group=run.groups[args.group_id];if(!group||group.dispatchComplete)throw new Error('unresolved dispatch group required');
    if(group.ids.some(id=>isLive(actorOf(run,id))))throw new Error('wait for known actors before resolving dispatch');
    for(const op of group.operations??[])if(['pending','uncertain'].includes(op.state))op.state='resolved';
    group.dispatchComplete=true;group.mainDisposition=args.reason;return {ok:true,group_id:args.group_id,agent_ids:group.ids,instruction:'Main recorded dispatch resolution. Missing tasks remain required; nothing was retried or accepted.'};
  }
  if(args.action==='waive'){
    nonempty(args.user_source,'explicit user authorization source');run.dispositions[node.id]={decision:'waived',reason:args.reason,userSource:args.user_source,revision:run.revision};return {ok:true,...summary(run),instruction:'User authorization recorded as prompt-level provenance, not authentication or CLEAN.'};
  }
  if(args.action==='risks'){
    if(!node.section||node.id!==`${node.section}:risk`)throw new Error('select risks on the Section risk slot');
    if(!Array.isArray(args.lenses)||args.lenses.some(l=>!/^[-a-zA-Z0-9_]+$/.test(l))||new Set(args.lenses).size!==args.lenses.length)throw new Error('distinct semantic lenses required');
    run.lenses??={};
    if(JSON.stringify(run.lenses[node.section])!==JSON.stringify(args.lenses))invalidate(run,[node.id],'Main revised risk selection',{actors:false});
    run.lenses[node.section]=args.lenses;
    applySpecialists(run.graph,node.section,args.lenses);
    applyObligations(run.graph,run);
    run.dispositions[node.id]={decision:'selected',reason:args.reason};return {ok:true,...summary(run)};
  }
  if(args.action==='hold'){
    invalidate(run,[node.id],args.reason);run.dispositions[node.id]={decision:'held',reason:args.reason,revision:run.revision};return {ok:true,...summary(run)};
  }
  if(args.action==='retain'){
    if(!node.id.startsWith('plan:'))throw new Error('retain is only for Main-confirmed unaffected plan evidence');
    await checkOrder(run,repo,node.id);const a=evidence(run,node,args,{retain:true});
    a.invalidated=null;
    run.dispositions[node.id]={decision:'accepted',reason:args.reason,revision:run.revision,actorId:a.id,round:roundOf(a).number,retained:true};
    return {ok:true,node:node.id,...summary(run),instruction:'Main explicitly retained unaffected plan coverage; no reviewer call, semantic approval or new report was fabricated.'};
  }
  if(args.action!=='accept')throw new Error('unknown Main disposition');
  if((node.id.endsWith(':accept')||node.id==='delivery')&&unresolvedDispatch(run))throw new Error('unresolved dispatch prevents acceptance');
  if((node.id.endsWith(':accept')||node.id==='delivery')&&Object.values(run.actors).some(a=>isLive(a)&&(!node.section||a.section===node.section)))throw new Error('live actors remain; Main must wait or explicitly request cancellation');
  await checkOrder(run,repo,node.id);
  assertSection(run,node);
  const actor=node.kind==='main'?null:evidence(run,node,args);
  run.dispositions[node.id]={decision:'accepted',reason:args.reason,revision:run.revision,...(actor?{actorId:actor.id,round:roundOf(actor).number}:{})};
  const guidance=[];
  if(node.kind==='main')guidance.push(await mainGuidance(run,node));
  for(const next of Object.values(run.graph.nodes).filter(n=>n.kind==='main'&&n.needs.includes(node.id)&&!done(run,n.id)&&!missing(run,n).length))guidance.push(await mainGuidance(run,next));
  return {ok:true,node:node.id,...summary(run),...(guidance.length?{instructions:guidance}:{})};
}
export async function send(run,repo,args,rpc,{checkpoint=async()=>{}}={}){
  await reload(run,repo);nonempty(args.content,'bounded continuation content');
  if(unresolvedDispatch(run))throw new Error('resolve uncertain dispatch before continuation');
  if(args.mode!==undefined&&!['queue','steer'].includes(args.mode))throw new Error('mode must be queue or steer');
  const a=actorOf(run,args.agent_id),node=await checkOrder(run,repo,args.node??a.node);
  if(!a.sessionId)throw new Error('same-session continuation unavailable: original session identity UNKNOWN');
  if(node.continueActor&&node.continueActor!==a.id)throw new Error(`continue required session ${node.continueActor}, not ${a.id}`);
  if(isLive(a)||!run.groups[roundOf(a).group]?.settled)throw new Error('wait for the complete current dispatch group before continuation');
  if(purposeOf(node)==='blind-review'||node.id.startsWith('plan:')&&!node.continueActor)throw new Error('first-pass independent review requires a fresh session; declare closure or repair-reconciliation for code continuations');
  if(node.purpose==='repair'&&!node.continueActor)throw new Error('first escalated repair requires a fresh impl_large session');
  if(node.retired||node.kind!==a.kind||node.role!==a.role||node.section!==a.section||node.feature!==a.feature)throw new Error('continuation must keep actor kind, role and owning Section/Feature');
  const covers=coverage(run,node,args.covers);
  ensureSerial(run,node,args);
  const identity=await rpc('result',{agent_id:Number(a.id),offset:0});checkIdentity(a,identity.task);
  if(identity.task?.session_id!==a.sessionId)throw new Error('same-session continuation cannot be verified');
  const messageId=randomUUID(),group=randomUUID();
  run.groups[group]={ids:[a.id],settled:false,dispatchComplete:true};
  a.originNode??=a.rounds.find(r=>r.node)?.node??a.node;
  invalidateWork(run,covers,'Main continued this node');a.node=node.id;a.unit=node.unit;
  const round={number:a.rounds.length+1,node:node.id,purpose:purposeOf(node),covers,status:'dispatch_uncertain',revision:run.revision,messageId,previousResult:digest(JSON.stringify(identity.result)),group,pages:[],unresolved:true};
  a.rounds.push(round);await checkpoint();
  try{
    const answer=await rpc('send',{agent_id:Number(a.id),message_id:messageId,mode:args.mode??'queue',content:args.content});
    if(answer.message_id!==messageId||!['queued','delivered','already_delivered'].includes(answer.disposition))throw new Error('continuation receipt identity unavailable or changed');
    round.status='awaiting_message';round.unresolved=false;round.sendState=answer.disposition;a.invalidated=null;
  }catch(error){
    round.sendState='uncertain';round.error={message:error.message,code:error.code??null};
    if(error.code==='TERMINAL_SEND_UNSUPPORTED'){round.sendState='rejected';round.unresolved=false;round.status='failed';round.blocked=true;run.groups[group].settled=true;}
    await checkpoint();error.actorId=a.id;error.messageId=messageId;throw error;
  }
  await checkpoint();return {ok:true,actor_id:a.id,session_id:a.sessionId,round:round.number,instruction:waitInstruction([a.id])};
}
