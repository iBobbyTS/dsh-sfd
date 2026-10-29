/** Mutable SFD task DAG. Structure is mechanical; semantic judgments stay with Main. */
const ID = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const done = task => task?.status === 'done' || task?.status === 'waived';
const unique = xs => [...new Set(xs)];
const requireId = id => { if (typeof id !== 'string' || !ID.test(id)) throw new Error(`invalid ID: ${id}`); return id; };
const requireSection = (flow, id) => { const s = flow.sections.find(x => x.id === id); if (!s) throw new Error(`unknown section: ${id}`); return s; };
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

export function buildGraph(sections, extras = []) {
  const tasks = {};
  const add = (id, type, deps = [], extra = {}) => {
    if (own(tasks, id)) throw new Error(`duplicate task: ${id}`);
    tasks[id] = { id, type, deps: unique(deps), status: 'pending', ...extra };
  };
  add('plan:A', 'review', [], { route: 'planA' });
  add('plan:B', 'review', ['plan:A'], { route: 'planB' });
  for (const s of sections) {
    requireId(s.id);
    const firstDeps = ['plan:B', ...(s.dependsOn ?? []).map(x => `${x}:accept`)];
    let previous = firstDeps;
    for (const child of s.subsections ?? []) {
      requireId(child);
      add(`${s.id}/${child}:impl`, 'impl', previous, { section: s.id, subsection: child, route: s.profile });
      add(`${s.id}/${child}:checkpoint`, 'review', [`${s.id}/${child}:impl`], { section: s.id, subsection: child, route: 'codeA', checkpoint: true });
      previous = [`${s.id}/${child}:checkpoint`];
    }
    add(`${s.id}:impl`, (s.subsections ?? []).length ? 'reconcile' : 'impl', previous, { section: s.id, route: s.profile });
    add(`${s.id}:A`, 'review', [`${s.id}:impl`], { section: s.id, route: 'codeA', lenses: unique(['R01', ...(s.lenses ?? [])]) });
    add(`${s.id}:B1`, 'review', [`${s.id}:A`], { section: s.id, route: 'codeB' });
    add(`${s.id}:B2`, 'reconcile', [`${s.id}:B1`], { section: s.id });
    add(`${s.id}:accept`, 'accept', [`${s.id}:A`, `${s.id}:B2`], { section: s.id });
  }
  for (const e of extras) {
    requireId(e.id);
    add(`extra:${e.id}`, 'custom', e.dependsOn ?? []);
  }
  add('deliver', 'deliver', sections.map(s => `${s.id}:accept`));
  for (const e of extras) for (const before of e.before ?? []) {
    if (!own(tasks, before)) throw new Error(`unknown before target: ${before}`);
    tasks[before].deps = unique([...tasks[before].deps, `extra:${e.id}`]);
  }
  validateGraph(tasks);
  return tasks;
}

export function validateGraph(tasks) {
  const visited = new Set(), visiting = new Set();
  const visit = id => {
    if (!own(tasks, id)) throw new Error(`unknown dependency: ${id}`);
    if (visiting.has(id)) throw new Error(`cyclic dependency at ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dep of tasks[id].deps) visit(dep);
    visiting.delete(id); visited.add(id);
  };
  Object.keys(tasks).forEach(visit);
}

export function createFlow(sections) {
  if (!Array.isArray(sections) || sections.length === 0) throw new Error('at least one section required');
  const clean = sections.map(s => ({
    id: requireId(s.id), profile: s.profile === 'impl_large' ? 'implLarge' : 'implStd',
    dependsOn: unique(s.dependsOn ?? []), subsections: unique(s.subsections ?? []),
    lenses: unique(s.lenses ?? []),
  }));
  if (unique(clean.map(s => s.id)).length !== clean.length) throw new Error('duplicate section ID');
  for (const s of clean) for (const d of s.dependsOn) {
    if (d === s.id || !clean.some(x => x.id === d)) throw new Error(`invalid section dependency ${s.id} -> ${d}`);
  }
  return { revision: 1, sections: clean, extras: [], waivers: {}, repairWaves: {}, tasks: buildGraph(clean), actors: {}, findings: {}, changes: [] };
}

export function status(flow) {
  return {
    revision: flow.revision,
    tasks: Object.values(flow.tasks).map(t => ({ id: t.id, type: t.type, status: t.status,
      missing: t.deps.filter(d => !done(flow.tasks[d])),
      ...(t.evidence ? { evidence: t.evidence } : {}),
    })),
    openFindings: Object.entries(flow.findings).filter(([,v]) => v.status === 'open').map(([id])=>id),
    activeActors: Object.values(flow.actors).filter(a => ['running','cancelling'].includes(a.status)).map(a=>({id:a.id,task:a.task})),
    waivers: flow.waivers,
    repairWaves: flow.repairWaves ?? {},
  };
}

export function ready(flow, id) {
  const t = flow.tasks[id];
  if (!t) throw new Error(`unknown task: ${id}`);
  if (done(t)) throw new Error(`${id}: already closed`);
  const missing = t.deps.filter(d => !done(flow.tasks[d]));
  if (missing.length) throw new Error(`${id}: prerequisites missing: ${missing.join(', ')}`);
  if (Object.values(flow.actors).some(a => a.task === id && ['running','cancelling'].includes(a.status))) throw new Error(`${id}: actor already running`);
  return t;
}

function hasActiveActor(flow, task) {
  return Object.values(flow.actors).some(a => a.task === task && ['running','cancelling'].includes(a.status));
}

function invalidate(flow, taskIds) {
  const invalid = new Set(taskIds);
  const forced = new Set(taskIds);
  const accepted = new Set(flow.sections.filter(s => flow.tasks[`${s.id}:accept`]?.status === 'done').map(s => s.id));
  let changed;
  do {
    changed = false;
    for (const t of Object.values(flow.tasks)) {
      if (invalid.has(t.id) || !t.deps.some(d => invalid.has(d))) continue;
      // Revisions to remaining work must not silently reopen an accepted peer.
      if (t.section && accepted.has(t.section) && !forced.has(t.id)) continue;
      invalid.add(t.id); changed = true;
    }
  } while(changed);
  for (const id of invalid) {
    if (hasActiveActor(flow,id)) throw new Error(`cannot invalidate ${id}: actor still running`);
    const t = flow.tasks[id];
    if (t && t.status !== 'waived') {t.status='pending'; delete t.evidence; delete t.review; }
  }
}

export function recheckCandidate(flow, current, plan) {
  const invalid = [];
  for (const t of Object.values(flow.tasks)) {
    if (t.status !== 'done' || !t.evidence?.candidate) continue;
    if (t.type !== 'review' && t.type !== 'reconcile') continue;
    const expected = t.id.startsWith('plan:') ? plan : current;
    if (t.section && flow.tasks[`${t.section}:accept`]?.status === 'done') continue;
    if (expected && t.evidence.candidate !== expected) invalid.push(t.id);
  }
  if (invalid.length) invalidate(flow, invalid);
  return invalid;
}

export function revise(flow, change) {
  const next=structuredClone(flow);
  const op=change.action;
  if (op === 'add_section') {
    const s = {id:requireId(change.section), profile: change.profile === 'impl_large' ? 'implLarge' : 'implStd', dependsOn:unique(change.dependsOn ?? []), subsections:[], lenses:[]};
    if(next.sections.some(x=>x.id===s.id))throw new Error('section already exists');
    next.sections.push(s);
  } else if (op === 'add_subsection') {
    const s=requireSection(next, change.section);
    const child=requireId(change.subsection);
    if(s.subsections.includes(child))throw new Error('subsection already exists');
    if(next.tasks[`${s.id}:accept`]?.status === 'done')throw new Error('accepted section cannot be silently reopened');
    const index=change.before ? s.subsections.indexOf(change.before) : s.subsections.length;
    if(index<0)throw new Error('before subsection not found');
    s.subsections.splice(index,0,child);
  } else if (op === 'set_lenses') {
    const s=requireSection(next, change.section);
    if(next.tasks[`${s.id}:accept`]?.status === 'done')throw new Error('accepted section cannot be silently reopened');
    s.lenses=unique(['R01',...(change.lenses ?? [])]);
  } else if (op === 'add_task') {
    if(next.extras.some(x=>x.id===change.id))throw new Error('custom task already exists');
    next.extras.push({id:requireId(change.id),dependsOn:unique(change.dependsOn ?? []),before:unique(change.before ?? [])});
  } else if (op === 'waive_code_b' || op === 'restore_code_b') {
    if(change.authorization !== 'user' || !String(change.reason??'').trim())throw new Error('user-authorized change and reason required');
    const affected = change.section ? [requireSection(next,change.section).id] : next.sections.filter(s=>next.tasks[`${s.id}:accept`]?.status!=='done').map(s=>s.id);
    if(op==='waive_code_b' && change.section && next.tasks[`${change.section}:accept`]?.status==='done')throw new Error('accepted section is historical; no retrospective waiver');
    for(const id of affected){
      for(const suffix of ['B1','B2']) if(hasActiveActor(next,`${id}:${suffix}`))throw new Error(`cancel active ${id}:${suffix} reviewer first`);
      if(op==='waive_code_b') {
        next.waivers[id] = {by:'user',reason:change.reason,revision:next.revision+1};
        for(const suffix of ['B1','B2']) {const t=next.tasks[`${id}:${suffix}`];t.status='waived';t.evidence={waiver:change.reason};}
      } else {
        delete next.waivers[id];
        for(const suffix of ['B1','B2']) {const t=next.tasks[`${id}:${suffix}`];t.status='pending'; delete t.evidence;}
        invalidate(next,[`${id}:accept`]);
      }
    }
  } else throw new Error(`unsupported revision: ${op}`);
  if(!['waive_code_b','restore_code_b'].includes(op)){
    const fresh=buildGraph(next.sections,next.extras);
    const changed=[];
    for(const [id,t] of Object.entries(fresh)) {
      const prev=next.tasks[id];
      if(prev && JSON.stringify(prev.deps) === JSON.stringify(t.deps)
        && JSON.stringify(prev.lenses??[]) === JSON.stringify(t.lenses??[])) {
        fresh[id]={...t,status:prev.status,...(prev.evidence?{evidence:prev.evidence}:{}),...(prev.review?{review:prev.review}:{})};
      } else if(prev)changed.push(id);
      if(t.section && next.waivers[t.section] && ['B1','B2'].includes(id.split(':').at(-1))){fresh[id].status='waived';fresh[id].evidence={waiver:next.waivers[t.section].reason};}
    }
    next.tasks=fresh;
    invalidate(next,changed);
  }
  next.revision++;
  next.changes.push({revision:next.revision,action:op,reason:change.reason??null,at:new Date().toISOString()});
  return next;
}

export function mark(flow, id, evidence, current) {
  const next=structuredClone(flow), t=ready(next,id);
  if(t.type==='review' || t.type==='accept')throw new Error(`use review/accept admission for ${id}`);
  if(t.type==='impl' && !evidence?.actorId)throw new Error(`${id}: terminal implementer actor required`);
  if(t.type==='reconcile' && (!evidence?.explanation || !evidence?.candidate || evidence.candidate!==current))throw new Error(`${id}: same-candidate reconciliation evidence required`);
  if(t.type==='deliver' && (!evidence?.explanation || !String(evidence.explanation).trim()))throw new Error('delivery outcome required');
  if(t.type==='impl'){
    const actor=next.actors[evidence.actorId];
    if(!actor || actor.task!==id || actor.status!=='completed' || !actor.report)throw new Error('no successful terminal implementer report');
  }
  t.status='done';t.evidence={...evidence,candidate:current};
  return next;
}

export function addFinding(flow, id, task, description) {
  if(!ID.test(id) || flow.findings[id])throw new Error(`finding ID invalid/duplicate: ${id}`);
  flow.findings[id]={status:'open',task,description};
}

export function closeFindings(flow, ids, explanation, candidate) {
  if(!explanation?.trim() || !candidate)throw new Error('closure requires repair/verification evidence and candidate');
  const next=structuredClone(flow);
  for(const id of ids){const f=next.findings[id];if(!f || f.status!=='open')throw new Error(`finding not open: ${id}`);f.status='closed';f.closure={explanation,candidate};}
  return next;
}

export function admitReview(flow, taskId, actorId, verdict, lens, current, findings=[]) {
  const next=structuredClone(flow);
  const t=next.tasks[taskId];if(!t || t.type!=='review')throw new Error('not a review task');
  const a=next.actors[actorId];if(!a||a.task!==taskId||a.status!=='completed'||!a.report)throw new Error('no terminal authored review report');
  if(a.candidate!==current)throw new Error('reviewed candidate drifted');
  if(!['clean','material'].includes(verdict))throw new Error('review verdict must be clean or material');
  if(verdict==='material' && !findings.length)throw new Error('material verdict requires finding IDs');
  if(verdict==='clean' && findings.length)throw new Error('clean verdict cannot have material findings');
  const key=taskId.endsWith(':A')?lens??'R01':'default';
  if(t.lenses && !t.lenses.includes(key))throw new Error(`lens not selected: ${key}`);
  if(verdict==='material')for(const f of findings)addFinding(next,f.id,taskId,f.description);
  t.review ??={};t.review[key]={actorId,verdict,candidate:current,report:a.report};
  const open=Object.values(next.findings).some(f=>f.task===taskId&&f.status==='open');
  const required=t.lenses??[key];
  if(!open && required.every(l=>t.review[l]?.verdict==='clean' && t.review[l]?.candidate===current)) {
    t.status='done';t.evidence={actorId,report:a.report,candidate:current,lenses:required};
  } else t.status='pending';
  return next;
}

export function acceptSection(flow, section, current, explanation) {
  const next=structuredClone(flow), id=`${section}:accept`, t=ready(next,id);
  if(!explanation?.trim())throw new Error('acceptance needs concrete checks/feature evidence');
  if(Object.values(next.findings).some(f=>f.status==='open' && f.task.startsWith(`${section}:`)))throw new Error('material findings remain open');
  t.status='done';t.evidence={candidate:current,explanation, ...(next.waivers[section]?{waiver:next.waivers[section]}:{})};
  return next;
}
