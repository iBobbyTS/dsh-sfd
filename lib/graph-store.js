/** One editable graph file per session: mandatory base nodes plus model-managed status. */
import { readFile, writeFile, mkdir, rename, copyFile, realpath } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { digest } from './compiler.js';

export const GRAPH_FILE = 'SFD-GRAPH.json';
export const PREV_FILE = 'SFD-GRAPH.prev.json';
export const STATE_FILE = 'ACTORS.json';

export class GraphError extends Error {
  constructor(message, { code = 'GRAPH_INVALID', locations = [], instruction, recovery } = {}) {
    super(message);
    this.name = 'GraphError';
    this.code = code;
    this.locations = locations;
    this.instruction = instruction;
    this.recovery = recovery;
  }
}

export function sessionDigest(sessionId) {
  return digest(String(sessionId)).slice(0, 32);
}

export async function graphLocation(repo, sessionId) {
  if (typeof sessionId !== 'string' || !sessionId) throw new GraphError('real session ID required', { code: 'SESSION_REQUIRED' });
  const root = await realpath(repo);
  const dir = join(root, '.agent-work', 'sfd-graphs', sessionDigest(sessionId));
  return { root, dir, file: join(dir, GRAPH_FILE), backup: join(dir, PREV_FILE), stateFile: join(dir, STATE_FILE) };
}

export async function readPlan(repo) {
  return readFile(join(repo, '.agent-work', 'PLAN-FULL.md'), 'utf8');
}

export function buildGraph(base, { sessionId, repo, planPath = '.agent-work/PLAN-FULL.md' } = {}) {
  const nodes = {};
  for (const [id, node] of Object.entries(base.nodes)) {
    nodes[id] = {
      ...node,
      mandatory: true,
      status: 'pending',
      evidence: null,
      note: '',
    };
  }
  return {
    schema: 1,
    sessionId,
    repo,
    plan: { path: planPath, digest: base.digest },
    reconciled: true,
    nodes,
  };
}

export async function readGraph(repo, sessionId) {
  const loc = await graphLocation(repo, sessionId);
  let raw;
  try { raw = await readFile(loc.file, 'utf8'); }
  catch (error) { if (error?.code === 'ENOENT') return { graph: null, ...loc }; throw error; }
  let graph;
  try { graph = JSON.parse(raw); }
  catch (error) { throw new GraphError(`graph is not valid JSON: ${error.message}`, { code: 'GRAPH_PARSE', locations: [loc.file] }); }
  if (!graph || graph.schema !== 1 || graph.sessionId !== sessionId || graph.repo !== loc.root) {
    throw new GraphError('graph identity/schema mismatch; refusing to treat it as this session', { code: 'GRAPH_IDENTITY', locations: [loc.file] });
  }
  return { graph, ...loc };
}

export async function writeGraph(repo, sessionId, graph) {
  const loc = await graphLocation(repo, sessionId);
  await mkdir(dirname(loc.file), { recursive: true });
  const temp = `${loc.file}.${randomUUID()}.tmp`;
  await writeFile(temp, `${JSON.stringify(graph, null, 2)}\n`, { mode: 0o600 });
  await rename(temp, loc.file);
  return loc;
}

export async function backupGraph(repo, sessionId) {
  const loc = await graphLocation(repo, sessionId);
  try { await copyFile(loc.file, loc.backup); }
  catch (error) { if (error?.code === 'ENOENT') return null; throw error; }
  return loc.backup;
}

/** The single owner of canonical plan-to-graph structure comparison. */
function canonicalIssue(graph, base) {
  for (const [id, source] of Object.entries(base.nodes)) {
    const node = graph.nodes?.[id];
    if (!node) return { node: { id, line: source.line }, message: `required node ${id} is missing` };
    if (node.mandatory !== true) return { node, message: `${id} must remain mandatory` };
    for (const key of ['kind', 'role', 'unit', 'section', 'feature']) {
      if ((node[key] ?? null) !== (source[key] ?? null)) return { node, message: `${id} ${key === 'feature' ? 'Feature' : key} was changed` };
    }
    if (!Array.isArray(node.needs) || !source.needs.every(need => node.needs.includes(need))) {
      return { node, message: `${id} removed a required prerequisite; add custom gates instead` };
    }
  }
  return null;
}

/** Unchanged compile preserves progress; canonical ownership/prerequisites still match the plan. */
export function structuralSame(graph, base) {
  return graph?.plan?.digest === base.digest && !canonicalIssue(graph, base);
}

function locationOf(node, file) {
  return `${file}:${node?.line ?? 1}`;
}

function fail(node, message, file) {
  throw new GraphError(`${locationOf(node, file)}: ${message}`, {
    code: 'GRAPH_INVALID',
    locations: [locationOf(node, file)],
  });
}

/** A round is usable success evidence: settled, COMPLETED, with its authored report fully received. */
export function successfulRound(round) {
  return !!round && round.status === 'completed' && round.outcome === 'COMPLETED'
    && round.reportComplete && !round.blocked && !round.unresolved;
}

function validateActorEvidence(node, state, file) {
  const evidence = node.evidence;
  if (!evidence || typeof evidence !== 'object') fail(node, `${node.id} is done but has no evidence`, file);
  if (typeof evidence.report !== 'string' || !evidence.report.trim()) fail(node, `${node.id} is done without a report reference`, file);
  if (!Number.isInteger(evidence.round) || evidence.round < 1) fail(node, `${node.id} is done without a real round`, file);
  const actor = state?.actors?.[String(evidence.actor_id)];
  if (!actor) fail(node, `${node.id} evidence names an unknown actor`, file);
  const round = actor.rounds?.find((item) => item.number === evidence.round);
  if (!successfulRound(round)) fail(node, `${node.id} evidence is not a settled successful authored report`, file);
  if (actor.kind !== node.kind) fail(node, `${node.id} evidence has a different task kind`, file);
  if (round.node !== node.id && (typeof evidence.conclusion !== 'string' || !evidence.conclusion.trim())) {
    fail(node, `${node.id} shares a report from ${round.node}; record its separately authored conclusion in evidence.conclusion`, file);
  }
}

function validateSkippedByUser(node, file) {
  const evidence = node.evidence;
  if (!evidence || typeof evidence !== 'object') fail(node, `${node.id} is skipped_by_user without provenance`, file);
  if (typeof evidence.user_source !== 'string' || !evidence.user_source.trim()) fail(node, `${node.id} is skipped_by_user without user_source`, file);
  if (typeof evidence.reason !== 'string' || !evidence.reason.trim()) fail(node, `${node.id} is skipped_by_user without a reason`, file);
}

/** A waiver removes that task, not its unfinished upstream work. */
export function missingPrerequisites(graph, node) {
  const missing = new Set(), seen = new Set();
  const visit = (id) => {
    if (seen.has(id)) return;
    seen.add(id);
    const need = graph.nodes[id];
    if (need?.status === 'skipped_by_user') need.needs.forEach(visit);
    else if (need?.status !== 'done') missing.add(id);
  };
  node.needs.forEach(visit);
  return [...missing];
}

/** Describe graph edits for a reopen; Main decides and applies them, never this helper. */
export function reopenRecovery(graph, changedIds) {
  const reached = new Set(changedIds);
  let changed;
  do {
    changed = false;
    for (const node of Object.values(graph.nodes)) {
      if (!reached.has(node.id) && node.needs.some((id) => reached.has(id))) {
        reached.add(node.id);
        changed = true;
      }
    }
  } while (changed);
  const reset = [...reached].filter((id) => graph.nodes[id]?.status === 'done');
  return {
    changed_nodes: [...new Set(changedIds)],
    reset_nodes: reset,
    preserve_skips: [...reached].filter((id) => graph.nodes[id]?.status === 'skipped_by_user'),
    instruction: 'Review the affected evidence, then edit the listed reset_nodes together: set status=pending and evidence=null before retrying. Keep user-authorized skipped_by_user decisions unless the user changes them. No graph statuses are changed automatically.',
  };
}

/**
 * Validate editable graph topology and status without interpreting review quality.
 * Canonical nodes may gain extra prerequisites (model-added review/repair gates) but may not lose canonical ones.
 */
export function validateGraph(graph, base, state, { requireReconciled = false, file = '.agent-work/SFD-GRAPH.json' } = {}) {
  if (!graph || graph.schema !== 1) fail(null, 'graph schema must be 1', file);
  if (graph.plan?.digest !== base.digest) fail(null, 'PLAN-FULL changed or graph belongs to another plan; call sfd_workflow_compile first', file);
  if (requireReconciled && graph.reconciled !== true) fail(null, 'graph is not reconciled; compare it with SFD-GRAPH.prev.json and PLAN-FULL, then set reconciled=true', file);

  const nodes = graph.nodes;
  if (!nodes || typeof nodes !== 'object' || Array.isArray(nodes)) fail(null, 'graph.nodes must be an object', file);

  const issue = canonicalIssue(graph, base);
  if (issue) fail(issue.node, issue.message, file);

  for (const [id, node] of Object.entries(nodes)) {
    if (!node || node.id !== id) fail(node, `node ${id} has a different id`, file);
    if (!Array.isArray(node.needs) || node.needs.some((need) => typeof need !== 'string')) fail(node, `${id} has invalid needs`, file);
    if (new Set(node.needs).size !== node.needs.length) fail(node, `${id} has duplicate needs`, file);
    if (!['pending', 'done', 'skipped_by_user', 'failed'].includes(node.status)) fail(node, `${id} has unsupported status ${node.status}`, file);
    for (const need of node.needs) {
      if (!nodes[need]) fail(node, `${id} depends on unknown node ${need}`, file);
      if (need === id) fail(node, `${id} depends on itself`, file);
    }
    if (!base.nodes[id] && node.mandatory !== false) fail(node, `custom node ${id} must set mandatory=false`, file);
    if (!base.nodes[id]) {
      if (node.unit && !base.units.some((unit) => unit.id === node.unit)) fail(node, `custom node ${id} names unknown unit ${node.unit}`, file);
      if (node.section && !base.units.some((unit) => unit.id === node.section)) fail(node, `custom node ${id} names unknown section ${node.section}`, file);
      if (node.feature && !base.features.some((feature) => feature.id === node.feature)) fail(node, `custom node ${id} names unknown Feature ${node.feature}`, file);
    }
  }

  const visiting = new Set(), visited = new Set();
  const visit = (id) => {
    if (visiting.has(id)) fail(nodes[id], `dependency cycle at ${id}`, file);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const need of nodes[id].needs) visit(need);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of Object.keys(nodes)) visit(id);

  const missingNeeds = (node) => missingPrerequisites(graph, node);
  const premature = Object.values(nodes).filter((node) => node.status === 'done' && missingNeeds(node).length);
  if (premature.length) {
    const recovery = reopenRecovery(graph, premature.flatMap(missingNeeds));
    throw new GraphError(
      `${file}: completed nodes have unsatisfied prerequisites: ${premature.map((node) => node.id + ' requires ' + missingNeeds(node).join(', ')).join('; ')}`,
      { code: 'GRAPH_REOPEN_REQUIRED', locations: [file], recovery, instruction: recovery.instruction },
    );
  }
  for (const node of Object.values(nodes)) {
    if (node.status === 'done') {
      if (node.kind === 'review' || node.kind === 'implementation') validateActorEvidence(node, state, file);
      else if (node.kind === 'main') {
        if (typeof node.evidence?.reason !== 'string' || !node.evidence.reason.trim()) fail(node, `${node.id} main confirmation needs a reason`, file);
      } else fail(node, `${node.id} has unsupported kind ${node.kind}`, file);
    }
    if (node.status === 'skipped_by_user') validateSkippedByUser(node, file);
  }
  return graph;
}
