/** Portable reader of the canonical section_plan.py Markdown grammar. No semantic verdicts. */
import { createHash } from 'node:crypto';
export const digest = text => createHash('sha256').update(text).digest('hex');
const unitPattern = 'S\\d{2,}(?:[.\\-][A-Z0-9]+)?';
const heading = new RegExp(`^(#{2,3})\\s+(${unitPattern})\\s*(?:[—–:\\-]\\s*|\\s+)(\\S.*)$`);
const field = /^\s*(?:[-*]\s*)?(Implementer|Profile|实现者|实现代理|Depends on|Dependencies|依赖|Feature|所属 Feature)\s*[:：]\s*(.*?)\s*$/i;
export class PlanError extends Error { constructor(errors) { super(errors.join('\n')); this.code='PLAN_INVALID'; this.locations=errors; } }
export function compilePlan(text, path='.agent-work/PLAN-FULL.md') {
  const lines=text.split(/\r?\n/), units=[], features=[], errors=[];
  const error=(line,message)=>errors.push(`${path}:${line}: ${message}`);
  let active, parent, fence;
  for(let index=0;index<lines.length;index++) {
    const line=lines[index], mark=/^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if(mark){if(!fence)fence=mark;else if(mark[0]===fence[0]&&mark.length>=fence.length)fence=undefined;continue;}
    if(fence)continue;
    if(/^###\s+Feature\b/.test(line)) {
      const match=/^###\s+Feature\s+(F\d{2,})\s*(?:[—–:\-]\s*|\s+)(\S.*)$/.exec(line);
      if(!match)error(index+1,'malformed Feature heading');
      else if(units.length)error(index+1,'Feature contracts must precede executable Sections');
      else features.push({id:match[1],title:match[2],line:index+1});
      continue;
    }
    const match=heading.exec(line);
    if(match) {
      const [,level,id,title]=match, child=/[.\-]/.test(id), owner=child?id.split(/[.\-]/)[0]:null;
      if((level==='##')===child)error(index+1,'use ## for Sections and ### for children');
      if(child&&owner!==parent)error(index+1,`${id} must be nested below ${owner}`);
      if(!child)parent=id;
      active={id,title,parent:owner,line:index+1,dependsOn:[],fields:{}};units.push(active);continue;
    }
    if(/^#{2,3}\s+S\d/.test(line))error(index+1,'malformed executable heading');
    if(/^##\s+/.test(line)){active=undefined;parent=undefined;continue;}
    if(!active)continue;
    const metadata=field.exec(line);if(!metadata)continue;
    const label=metadata[1].toLowerCase(), value=metadata[2].trim().replace(/^`|`$/g,'');
    const key=['implementer','profile','实现者','实现代理'].includes(label)?'implementer':['feature','所属 feature'].includes(label)?'feature':'dependsOn';
    if(active.fields[key])error(index+1,`duplicate ${key} field`);active.fields[key]=index+1;
    if(key==='implementer'){active.implementer=value;if(!['impl_std','impl_large'].includes(value))error(index+1,'explicit impl_std or impl_large required');}
    else if(key==='feature'){if(active.parent)error(index+1,'child inherits its Feature');active.feature=value;}
    else {active.dependsOn=['none','无','—','-','[]','无依赖'].includes(value.toLowerCase())?[]:value.split(/[,，、]/).map(x=>x.trim().replace(/^`|`$/g,''));}
  }
  if(!units.length)error(1,'no executable Sections');
  const byId=new Map(),featureIds=new Set();
  for(const f of features){if(featureIds.has(f.id))error(f.line,`duplicate Feature ${f.id}`);featureIds.add(f.id);}
  for(const u of units){if(byId.has(u.id))error(u.line,`duplicate unit ${u.id}`);byId.set(u.id,u);for(const key of ['implementer','dependsOn'])if(!u.fields[key])error(u.line,`missing ${key}`);}
  for(const u of units){
    if(u.parent&&!byId.has(u.parent))error(u.line,`missing parent ${u.parent}`);
    if(new Set(u.dependsOn).size!==u.dependsOn.length)error(u.line,'repeated dependency');
    for(const dep of u.dependsOn){const other=byId.get(dep);if(!other)error(u.line,`unknown dependency ${dep}`);else if(u.parent?other.parent!==u.parent:other.parent)error(u.line,'external dependencies must name accepted Sections; children depend on siblings only');}
    if(features.length){if(u.parent)u.feature=byId.get(u.parent)?.feature;else if(!featureIds.has(u.feature))error(u.line,'missing or unknown Feature binding');}
    else u.feature='business';
  }
  const visiting=new Set(),done=new Set();
  function visit(id,path=[]){if(visiting.has(id)){error(byId.get(id).line,`dependency cycle: ${[...path,id].join(' → ')}`);return;}if(done.has(id))return;visiting.add(id);for(const dep of byId.get(id).dependsOn)if(byId.has(dep))visit(dep,[...path,id]);visiting.delete(id);done.add(id);}
  for(const id of byId.keys())visit(id);
  if(errors.length)throw new PlanError(errors);
  if(!features.length)features.push({id:'business',title:'Business outcome',line:1});
  const nodes={};
  const add=(id,kind,needs,unit,extra={})=>nodes[id]={id,kind,needs,unit:unit?.id??null,section:unit?(unit.parent??unit.id):null,feature:unit?.feature??null,line:unit?.line??1,...extra};
  add('plan:initial','review',[],null,{role:'plan-review'});add('plan:final','review',['plan:initial'],null,{role:'plan-review'});
  const ordered=list=>{const output=[],seen=new Set();function walk(u){if(seen.has(u.id))return;seen.add(u.id);for(const dep of u.dependsOn){const d=list.find(x=>x.id===dep);if(d)walk(d);}output.push(u);}list.forEach(walk);return output;};
  for(const section of ordered(units.filter(u=>!u.parent))) {
    const start=['plan:final',...section.dependsOn.map(id=>`${id}:accept`)];let previous=start;
    for(const child of ordered(units.filter(u=>u.parent===section.id))) {
      add(`${child.id}:implement`,'implementation',[...new Set([...previous,...child.dependsOn.map(id=>`${id}:checkpoint`)])],child,{role:child.implementer});
      add(`${child.id}:checkpoint`,'review',[`${child.id}:implement`],child,{role:'behavior-review'});previous=[`${child.id}:checkpoint`];
    }
    if(previous===start){add(`${section.id}:implement`,'implementation',start,section,{role:section.implementer});previous=[`${section.id}:implement`];}
    else {add(`${section.id}:reconcile`,'review',previous,section,{role:'behavior-review'});previous=[`${section.id}:reconcile`];}
    add(`${section.id}:behavior`,nodes[`${section.id}:reconcile`]?'main':'review',previous,section,{role:'behavior-review'});
    add(`${section.id}:risk`,'main',[`${section.id}:behavior`],section);
    add(`${section.id}:blind`,'review',[`${section.id}:risk`],section,{role:'final-review'});
    add(`${section.id}:reconciliation`,'main',[`${section.id}:blind`],section);
    add(`${section.id}:accept`,'main',[`${section.id}:reconciliation`],section);
  }
  for(const f of features)add(`${f.id}:accept`,'main',units.filter(u=>!u.parent&&u.feature===f.id).map(u=>`${u.id}:accept`),null,{feature:f.id,line:f.line});
  add('delivery','main',features.map(f=>`${f.id}:accept`));
  return {digest:digest(text),path,units,features,nodes};
}
