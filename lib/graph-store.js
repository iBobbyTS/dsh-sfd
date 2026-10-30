/** One editable graph file per session: mandatory base nodes plus model-managed status. */
import { readFile, writeFile, mkdir, rename, copyFile, realpath } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { digest, compilePlan } from './compiler.js';

export const GRAPH_FILE = 'SFD-GRAPH.json';
export const PREV_FILE = 'SFD-GRAPH.prev.json';
export const STATE_FILE = 'ACTORS.json';
export const STATUSES = new Set(['pending', 'done', 'skipped_by_user', 'failed']);

export class GraphError extends Error {
  constructor(message, { code = 'GRAPH_INVALID', locations = [], node = null } = {}) {
    super(message);
    this.name = 'GraphError';
    this.code = code;
    this.locations = locations;
    this.node = node;
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

function sameSet(a = [], b = []) {
  return a.length === b.length && a.every((value) => b.includes(value));
}

/** True when the editable target still has every canonical base node and no canonical prerequisite removed. */
export function structuralSame(graph, base) {
  if (!graph?.plan || graph.plan.digest !== base.digest) return false;
  for (const [id, source] of Object.entries(base.nodes)) {
    const target = graph.nodes?.[id];
    if (!target || target.mandatory !== true) return false;
    if (target.kind !== source.kind) return false;
    if ((target.role ?? null) !== (source.role ?? null)) return false;
    if ((target.unit ?? null) !== (source.unit ?? null)) return false;
    if ((target.section ?? null) !== (source.section ?? null)) return false;
    if ((target.feature ?? null) !== (source.feature ?? null)) return false;
    if (!Array.isArray(target.needs) || !source.needs.every((need) => target.needs.includes(need))) return false;
  }
  return true;
}

function locationOf(node, file) {
  return `${file}:${node?.line ?? 1}`;
}

function fail(node, message, file) {
  throw new GraphError(`${locationOf(node, file)}: ${message}`, {
    code: 'GRAPH_INVALID',
    locations: [locationOf(node, file)],
    node: node?.id ?? null,
  });
}

function validateActorEvidence(node, state, file) {
  const evidence = node.evidence;
  if (!evidence || typeof evidence !== 'object') fail(node, `${node.id} is done but has no evidence`, file);
  if (typeof evidence.report !== 'string' || !evidence.report.trim()) fail(node, `${node.id} is done without a report reference`, file);
  if (!Number.isInteger(evidence.round) || evidence.round < 1) fail(node, `${node.id} is done without a real round`, file);
  const actor = state?.actors?.[String(evidence.actor_id)];
  if (!actor) fail(node, `${node.id} evidence names an unknown actor`, file);
  const round = actor.rounds?.find((item) => item.number === evidence.round);
  const group = round ? state.groups?.[round.group] : null;
  if (!round || round.status !== 'completed' || round.outcome !== 'COMPLETED' || !round.reportComplete || round.blocked || round.unresolved) {
    fail(node, `${node.id} evidence is not a settled successful authored report`, file);
  }
  if (round.node !== node.id) fail(node, `${node.id} evidence belongs to ${round.node}`, file);
  if (!group?.settled) fail(node, `${node.id} evidence group is not settled`, file);
}

function validateSkippedByUser(node, file) {
  const evidence = node.evidence;
  if (!evidence || typeof evidence !== 'object') fail(node, `${node.id} is skipped_by_user without provenance`, file);
  if (typeof evidence.user_source !== 'string' || !evidence.user_source.trim()) fail(node, `${node.id} is skipped_by_user without user_source`, file);
  if (typeof evidence.reason !== 'string' || !evidence.reason.trim()) fail(node, `${node.id} is skipped_by_user without a reason`, file);
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

  for (const [id, source] of Object.entries(base.nodes)) {
    const node = nodes[id];
    if (!node) fail({ id, line: source.line }, `required node ${id} is missing`, file);
    if (node.mandatory !== true) fail(node, `${id} must remain mandatory`, file);
    if (node.kind !== source.kind) fail(node, `${id} kind was changed`, file);
    if ((node.role ?? null) !== (source.role ?? null)) fail(node, `${id} role was changed`, file);
    if ((node.unit ?? null) !== (source.unit ?? null)) fail(node, `${id} unit was changed`, file);
    if ((node.section ?? null) !== (source.section ?? null)) fail(node, `${id} section was changed`, file);
    if ((node.feature ?? null) !== (source.feature ?? null)) fail(node, `${id} Feature was changed`, file);
    if (!Array.isArray(node.needs) || !source.needs.every((need) => node.needs.includes(need))) {
      fail(node, `${id} removed a required prerequisite; add custom gates instead`, file);
    }
  }

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
    if (base.nodes[id] && node.mandatory !== true) fail(node, `canonical node ${id} must remain mandatory`, file);
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

  const missingNeeds = (node) => node.needs.filter((need) => !['done', 'skipped_by_user'].includes(nodes[need].status));
  for (const node of Object.values(nodes)) {
    const missing = missingNeeds(node);
    if (['done', 'skipped_by_user'].includes(node.status) && missing.length) {
      fail(node, `${node.id} is ${node.status} before prerequisites ${missing.join(', ')} are satisfied`, file);
    }
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

/** Compile PLAN-FULL and validate it structurally; never semantic approval. */
export async function compileForRepo(repo) {
  const text = await readPlan(repo);
  return compilePlan(text);
}
