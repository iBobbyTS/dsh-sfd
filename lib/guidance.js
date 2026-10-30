/** State-specific instructions; Main supplies findings, invalidations and acceptance. */
import { readFile } from 'node:fs/promises';
import { purposeOf } from './obligations.js';
const done=(run,id)=>['accepted','waived'].includes(run.dispositions[id]?.decision);
const actorRef=a=>a?{agent_id:a.id,session_id:a.sessionId??'UNKNOWN'}:null;
const continued=(run,a)=>a?(Object.values(run.actors).find(candidate=>candidate.replacementFor===a.id)??a):null;
function unitContext(run,node){
  const unit=run.graph.units.find(u=>u.id===node.unit);
  const original=Object.values(run.actors).find(a=>a.kind==='implementation'&&a.unit===node.unit&&!a.repairFor&&!a.replacementFor&&a.rounds.some(r=>r.status==='completed'&&r.outcome==='COMPLETED'&&r.reportComplete));
  const repair=continued(run,original&&Object.values(run.actors).find(a=>a.repairFor===original.id));
  return {unit,original,repair};
}
export function nextAction(run,node){
  if(node.kind==='main')return {tool:'sfd_workflow_confirm',node:node.id,action:'accept'};
  let target=node.continueActor;
  const purpose=purposeOf(node);
  const currentBlind=node.section?run.dispositions[node.section+':blind']:null;
  if(purpose==='repair-reconciliation'&&currentBlind?.decision==='accepted'&&node.sourceActor!==currentBlind.actorId)return {tool:'sfd_workflow_update',node:node.id,source_actor_id:currentBlind.actorId,instruction:'Bind reconciliation to the current frozen blind reviewer, not a prior candidate’s session.'};
  if(!target&&['checkpoint','parent-reconciliation'].includes(purpose))target=Object.values(run.actors).find(a=>a.section===node.section&&a.role==='behavior-review')?.id;
  if(!target&&['initial-plan-review','final-plan-review'].includes(purpose))target=Object.values(run.actors).find(a=>a.originNode===node.id||a.node===node.id||a.rounds.some(r=>r.node===node.id))?.id;
  if(target)target=continued(run,run.actors[target]).id;
  return target?{tool:'sfd_subagent_send',node:node.id,...actorRef(run.actors[target])}:{tool:'sfd_subagent_spawn',node:node.id,fresh_session:true,role:node.role};
}
export function navigation(run,a){
  const node=run.graph.nodes[a.node],purpose=purposeOf(node??a),round=a.rounds.at(-1),{unit,original,repair}=unitContext(run,node??a);
  const source=node?.sourceActor?run.actors[node.sourceActor]:null;
  const successors=Object.values(run.graph.nodes).filter(n=>n.needs.some(id=>(round.covers??[a.node]).includes(id))&&!done(run,n.id)).map(n=>({node:n.id,missing:n.needs.filter(id=>!done(run,id)),next:nextAction(run,n)}));
  const common='Read the actual report/diff/check evidence. Main admits findings and confirms each obligation; COMPLETED is not CLEAN. ';
  const repairHint=(original?.role??unit?.implementer)==='impl_std'
    ?repair?`For admitted repairs reuse escalated implementer ${repair.id} (session ${repair.sessionId??'UNKNOWN'}).`:`For the first admitted repair of this impl_std unit, declare repair with implementation_actor_id=${original?.id??'UNKNOWN'} and spawn one impl_large repair session on Main’s selected route; reuse it thereafter.`
    :original?`For admitted repairs continue ${continued(run,original).replacementFor?'recorded-gap replacement '+continued(run,original).id+' for original implementer '+original.id:'original implementer '+original.id} (session ${continued(run,original).sessionId??'UNKNOWN'}).`:'Identify the actual owning implementer before repair; do not invent a session.';
  let hint;
  switch(purpose){
    case 'implementation':hint=`Inspect the handoff and real consumer interface; Main runs required checks before review. ${repairHint} ${unit?.parent?'Release the child only after its real R01 checkpoint, not Section acceptance.':'Complete Section Code A before fresh blind complete Code B.'}`;break;
    case 'initial-plan-review':hint='Finish admitted Plan A corrections in the original reviewer session, then spawn unprimed Plan B over the complete current plan. No implementation before both required plan coverages close.';break;
    case 'final-plan-review':hint='If Plan B corrections invalidate A, continue the affected original Plan A reviewer, then continue this Plan B session for its complete final review. Use Main hold/retain dispositions for affected/unaffected evidence, not a fresh replacement labelled as continuity.';break;
    case 'plan-delta':hint=`Recheck only the invalidated plan cone in discovering reviewer ${source?.id??a.id}; carry unaffected evidence explicitly. If this is A, the current continuing Plan B review must still close before implementation.`;break;
    case 'checkpoint':hint=`Inspect safe intermediate state, real SUBSECTION_DELTA and required checks. ${repairHint} Close its own IDs through REPAIR_DELTA in parent R01 ${a.id}; independent focused findings close in their discovering sessions. No next child while admitted findings or invalidated coverage remain. Continue this same parent R01 session for subsequent children and cumulative reconciliation.`;break;
    case 'parent-reconciliation':hint=`Confirm cumulative child coverage, joint oracles, consumers, deferrals and closures. ${repairHint} This completes the parent R01 baseline, not another per-child A/B pair. Reroute final risks, reuse valid independent specialists, then obtain independent complete blind Section B.`;break;
    case 'blind-review':hint=`Freeze this blind complete B1 report before exposing A findings or repair history. ${repairHint} An admitted B1/B2 defect requires owning-session repair, risk rerouting, closure by discovering reviewer ${a.id} (session ${a.sessionId??'UNKNOWN'}), then a fresh complete blind B1. If this candidate has repair/actions/invalidations to reconcile, declare repair-reconciliation with source_actor_id=${a.id} and continue this same session as B2 on the same head. Otherwise record no B2 obligation; do not send an empty follow-up.`;break;
    case 'repair':hint=`Inspect repair scope and reroute genuinely uncovered risks; Main runs affected consumer/oracle checks. Continue discovering reviewer ${source?.id??'UNKNOWN'} for its own IDs and invalidated evidence through an explicit closure/repair-delta obligation. ${source?.role==='final-review'?'This was B-driven: after closure obtain a fresh blind complete B1 and necessary same-head B2, never reuse the discovering session as new blind discovery.':'Restore affected Code A evidence before independent blind complete B.'}`;break;
    case 'closure':case 'repair-delta':hint=`Main checks each admitted ID against its actual closure evidence from discovering session ${a.id}. STILL_OPEN, regression or insufficient evidence is not closure. ${source?.role==='final-review'?'After B-driven repair, use fresh blind complete discovery and its own necessary B2; this continuation is not new blind B1.':'Restore invalidated baseline/risks; then complete fresh blind Section review.'}`;break;
    case 'repair-reconciliation':hint=`This continuation reconciles repair impact in its own frozen B1 session ${a.id}, not a new independent review. If it finds an admitted defect: owning-session repair, discovering-session closure, fresh complete blind B1 and necessary same-head B2; current A, checks and all closures must hold before acceptance.`;break;
    case 'integration':hint='Prove only the declared unproven_composition on the delivered candidate and original Feature journey, including required failure/cancellation/lifetime interactions. This is not a third full Section review or a Feature A/B pair. Main admits findings, assigns causal-owner repairs and restores only affected evidence before Feature/cross-Feature acceptance.';break;
    default:hint=`Reconcile this bounded evidence with complete Section behavior baseline and genuinely required risk faces. ${repairHint} Close admitted IDs in this discovering reviewer’s session; focused CLEAN is not full Section acceptance.`;
  }
  return {actor_id:a.id,session_id:a.sessionId??'UNKNOWN',continuity_gap:a.recordedGap??null,node:a.node,purpose,round:round.number,
    scope:{unit:node?.unit??a.unit,section:node?.section??a.section,feature:node?.feature??a.feature},
    sessions:{original_implementer:actorRef(original),escalated_repair:actorRef(repair),finding_reviewer:actorRef(source)},successors,instruction:common+hint};
}
export async function fullGuidance(node){
  const purpose=purposeOf(node),refs=new Set();
  if(node.kind==='implementation')refs.add('assets/SECTION-HANDOFF.template.md');
  if(!['integration','feature-acceptance','delivery'].includes(purpose))refs.add('references/reviewer-orchestration.md');
  if(node.unit&&node.unit!==node.section)refs.add('references/subsections.md');
  if(purpose==='parent-reconciliation')refs.add('references/subsections.md');
  if(['integration','feature-acceptance','delivery'].includes(purpose)||node.kind==='implementation')refs.add('references/integration-and-testing.md');
  const chunks=[];
  for(const name of ['SKILL.md',...refs])chunks.push(`Authority: ${name}\n${await readFile(new URL('../skills/sectioned-feature-development/'+name,import.meta.url),'utf8')}`);
  return chunks.join('\n\n');
}
export async function mainGuidance(run,node){
  const purpose=purposeOf(node),key='main:'+purpose;
  const instruction=purpose==='feature-acceptance'||purpose==='delivery'
    ?'Main verifies the original Feature journey and required cross-Feature interactions on one delivered candidate, with exact check/evidence pointers. Accepted Sections alone do not prove composition. Declare integration obligations only for actual residual unproven_composition; do not add an automatic review pair. Missing required evidence prohibits readiness.'
    :purpose==='risk-selection'?'Main reroutes actual frozen diff and original intent, retains valid risk evidence and declares only genuinely required specialist gaps. No automatic reviewer roster or repair dispatch.'
    :purpose==='section-acceptance'?'Accept only current Section A, complete independent blind B1, necessary same-head B2, every admitted closure and required checks. Main determines evidence meaning; dependent Sections also await producer integration.'
    :'Main confirms whether same-head B2 is actually necessary. When repairs/actions/invalidations remain, declare repair-reconciliation and continue the real B1 session before accepting this slot; no empty continuation otherwise.';
  const output={node:node.id,purpose,instruction,successors:Object.values(run.graph.nodes).filter(n=>n.needs.includes(node.id)).map(n=>nextAction(run,n))};
  if(!run.instructionRoles.includes(key)){output.fullInstructions=await fullGuidance(node);run.instructionRoles.push(key);}
  return output;
}
export function waitInstruction(ids){return {tool:'sfd_subagent_wait',arguments:{agent_ids:ids,wait_time:290},instruction:'Continue waiting for every remaining ID. If a loop, lack of progress or abnormal exit is suspected, use sfd_subagent_observe and inspect terminal failure evidence; do not blindly poll or claim success. Main decides cancellation or process changes.'};}
