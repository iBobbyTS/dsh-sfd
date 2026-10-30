/** Main-authored additions to the compiled graph. No report interpretation or dispatch. */
const purposes=new Set(['integration','focused-review','verify-finding','repair','closure','repair-delta','plan-delta','repair-reconciliation']);
const continuationPurposes=new Set(['closure','repair-delta','plan-delta','repair-reconciliation']);
const text=(value,label)=>{if(typeof value!=='string'||!value.trim())throw new Error(`${label} is required`);return value;};
const ids=(value,label)=>{if(!Array.isArray(value)||value.some(v=>typeof v!=='string'||!v)||new Set(value).size!==value.length)throw new Error(`${label} must contain distinct node IDs`);return value;};
function reportActor(run,id,label,{historical=false,number}={}){
  const actor=run.actors[String(id)],round=number!==undefined?actor?.rounds.find(r=>r.number===number):historical?actor?.rounds.find(r=>r.status==='completed'&&r.outcome==='COMPLETED'&&r.reportComplete):actor?.rounds.at(-1),group=run.groups[round?.group];
  if(!actor||!round||round.status!=='completed'||round.outcome!=='COMPLETED'||!round.reportComplete||round.blocked||round.unresolved||actor.continuityGap&&!historical&&number===undefined||!group?.settled||!group.dispatchComplete)throw new Error(`${label} requires a real settled successful report/session`);
  return actor;
}
export function validateGraph(graph){
  const visiting=new Set(),visited=new Set();
  function walk(id){
    if(visiting.has(id))throw new Error(`obligation dependency cycle at ${id}`);
    if(visited.has(id))return;
    const node=graph.nodes[id];if(!node)throw new Error(`unknown prerequisite ${id}`);
    visiting.add(id);node.needs.forEach(walk);visiting.delete(id);visited.add(id);
  }
  Object.keys(graph.nodes).forEach(walk);
}
export function declaration(run,input){
  const {id,purpose}=input;text(id,'obligation id');
  if(!/^[a-z][a-z0-9-]{0,79}$/.test(id)||run.graph.nodes[id]&&!run.obligations?.[id])throw new Error('obligation ID is reserved or already exists in the compiled plan');
  if(!purposes.has(purpose))throw new Error('unsupported obligation purpose');
  const unit=input.unit?run.graph.units.find(u=>u.id===input.unit):null;
  if(input.unit&&!unit)throw new Error('unknown owning unit');
  const feature=input.feature??unit?.feature??null;
  if(feature&&!run.graph.features.some(f=>f.id===feature))throw new Error('unknown owning Feature');
  if(unit&&feature!==unit.feature)throw new Error('unit and Feature ownership disagree');
  const section=unit?(unit.parent??unit.id):null;
  let role=purpose==='integration'?'integration-review':'specialist-review',kind='review',continueActor=null,implementationActor=null;
  let source=null;
  if(input.source_actor_id!==undefined){source=reportActor(run,input.source_actor_id,'source_actor_id',{number:input.source_round});if(source.kind!=='review')throw new Error('source_actor_id must name the discovering reviewer');}
  if(continuationPurposes.has(purpose)){
    if(!source)throw new Error('source_actor_id is required for reviewer continuation');
    if(source.section!==section||source.feature!==feature)throw new Error('reviewer continuation must preserve owner/Feature');
    if(purpose==='plan-delta'&&source.role!=='plan-review')throw new Error('plan-delta requires the original plan reviewer');
    if(purpose==='repair-reconciliation'){
      const blind=run.dispositions[section+':blind'];
      if(source.role!=='final-review'||!section||blind?.decision!=='accepted'||blind.actorId!==source.id||!source.rounds.some(r=>r.number===blind.round&&r.reportComplete&&r.outcome==='COMPLETED'))throw new Error('repair reconciliation requires its own current Main-confirmed frozen blind report');
    }
    if(purpose==='repair-delta'&&source.role!=='behavior-review')throw new Error('repair-delta requires the continuing parent behavior reviewer');
    role=source.role;continueActor=source.id;
  }
  if(purpose==='repair'){
    if(!unit)throw new Error('repair requires an owning unit');
    const implementer=reportActor(run,input.implementation_actor_id,'implementation_actor_id',{historical:true});
    if(implementer.kind!=='implementation'||implementer.unit!==unit.id||implementer.repairFor)throw new Error('implementation_actor_id must name the original owning implementer');
    implementationActor=implementer.id;kind='implementation';role='impl_large';
    if(implementer.role==='impl_large')continueActor=implementer.id;
    else continueActor=Object.values(run.actors).find(a=>a.repairFor===implementer.id)?.id??null;
  }
  if(!section&&!feature&&purpose!=='plan-delta'&&purpose!=='integration')throw new Error('an owning unit or Feature is required');
  const needs=ids(input.needs??[],'needs'),before=ids(input.before??[],'before');
  if(!before.length)throw new Error('before must name at least one obligation this work blocks');
  for(const ref of [...needs,...before])if(!run.graph.nodes[ref]&&ref!==id)throw new Error(`unknown graph node ${ref}`);
  const defaults=purpose==='integration'
    ?run.graph.units.filter(u=>!u.parent&&(!feature||u.feature===feature)).map(u=>u.id+':accept')
    :purpose==='plan-delta'?[]:purpose==='repair-reconciliation'?['plan:final',section+':blind']:['plan:final'];
  const planFor=purpose==='plan-delta'?(source.originNode?.startsWith('plan:')?source.originNode:source.rounds.find(r=>r.node?.startsWith('plan:'))?.node??(source.node.startsWith('plan:')?source.node:null)):null;
  if(purpose==='plan-delta'&&!planFor)throw new Error('original plan review node cannot be identified');
  const reviewFor=purpose==='repair-delta'?(input.review_node??run.graph.nodes[source.node]?.reviewFor??source.node):null;
  if(reviewFor&&(!(/:(checkpoint|reconcile)$/.test(reviewFor))||run.graph.nodes[reviewFor]?.section!==section||!source.rounds.some(r=>(r.covers??[r.node??source.node]).includes(reviewFor))))throw new Error('repair-delta requires a real checkpoint/parent reconciliation from this reviewer lineage; use closure for Section findings');
  const gates=purpose==='plan-delta'?[planFor]:purpose==='verify-finding'||purpose==='focused-review'?[]:section?[section+':accept']:feature?[feature+':accept']:['delivery'];
  if(reviewFor)gates.push(reviewFor);
  // Declaring a code repair/closure makes the missing obligation a predecessor
  // of the current full blind review. Main still decides whether it is needed.
  if(section&&['repair','closure','repair-delta'].includes(purpose))gates.push(section+':blind');
  const prior=run.obligations?.[id];
  if(prior&&['purpose','kind','role','unit','section','feature'].some(key=>prior[key]!==({purpose,kind,role,unit:unit?.id??null,section,feature})[key]))throw new Error('use a new semantic ID for a different purpose or owner; existing actor evidence is preserved');
  return {id,kind,purpose,role,unit:unit?.id??null,section,feature,line:unit?.line??1,
    needs:[...new Set([...defaults,...needs])],before:[...new Set([...gates,...before])],
    continueActor,sourceActor:source?.id??null,implementationActor,planFor,reviewFor};
}
export function applyObligations(graph,run){
  const entries=Object.values(run.obligations??{}),available=new Set([...Object.keys(graph.nodes),...entries.map(n=>n.id)]);
  for(const entry of entries){
    const ownerMissing=entry.unit&&!graph.units.some(u=>u.id===entry.unit)||entry.feature&&!graph.features.some(f=>f.id===entry.feature);
    const missing=[...entry.needs,...entry.before].some(id=>!available.has(id));
    if(ownerMissing||missing){
      graph.nodes[entry.id]={...entry,retired:true,needs:[]};
      continue;
    }
    graph.nodes[entry.id]=structuredClone(entry);
  }
  for(const entry of entries){
    const node=graph.nodes[entry.id];if(!node)continue;
    if(node.retired){graph.nodes.delivery.needs.push(node.id);continue;}
    for(const id of entry.before){
      const target=graph.nodes[id];if(!target)throw new Error(`unknown obligation successor ${id}`);
      target.needs=[...new Set([...target.needs,entry.id])];
    }
  }
  validateGraph(graph);
}
export function purposeOf(node){
  if(node.purpose)return node.purpose;
  if(node.id==='plan:initial')return 'initial-plan-review';
  if(node.id==='plan:final')return 'final-plan-review';
  if(node.id.endsWith(':checkpoint'))return 'checkpoint';
  if(node.id.endsWith(':reconcile'))return 'parent-reconciliation';
  if(node.id.endsWith(':blind'))return 'blind-review';
  if(node.kind==='implementation')return 'implementation';
  if(node.kind==='review')return node.role==='specialist-review'?'focused-review':'behavior-review';
  if(node.id==='delivery')return 'delivery';
  if(node.id.endsWith(':risk'))return 'risk-selection';
  if(node.id.endsWith(':reconciliation'))return 'repair-reconciliation';
  return node.section?'section-acceptance':'feature-acceptance';
}
export function coverage(run,node,covers=[]){
  ids(covers,'covers');
  for(const id of covers){
    const target=run.graph.nodes[id];
    if(!node.id.endsWith(':checkpoint')||id!==node.section+':reconcile'||target?.kind!=='review'||!target.needs.includes(node.id))throw new Error('only the final child checkpoint may also cover parent reconciliation');
  }
  return [...new Set([node.id,...covers,...(node.planFor?[node.planFor]:[]),...(node.reviewFor?[node.reviewFor]:[])])];
}
