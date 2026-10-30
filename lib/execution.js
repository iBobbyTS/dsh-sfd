/** Thin graph/status wrapper: Main edits SFD-GRAPH.json; this module dispatches and records actual actor facts. */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { compilePlan } from './compiler.js';
import {
  graphLocation, readGraph, writeGraph, backupGraph, buildGraph, structuralSame,
  validateGraph, readPlan, GraphError,
} from './graph-store.js';
import { withSession } from './session-store.js';
import {
  navigation, fullGuidance, waitInstruction, spawnInstruction, standing, compileInstruction,
  instructionKey,
} from './guidance.js';

const terminal = new Set(['completed', 'failed', 'cancelled', 'timed_out', 'runtime_lost', 'result_invalid', 'closed']);
const nonempty = (value, label) => { if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`); return value; };
const actorOf = (state, id) => { const actor = state.actors[String(id)]; if (!actor) throw new Error(`unknown actor ${id}`); return actor; };
const roundOf = (actor) => actor?.rounds?.at(-1);
const doneStatus = (node) => node && ['done', 'skipped_by_user'].includes(node.status);
const isLive = (actor) => !terminal.has(roundOf(actor)?.status) || !!roundOf(actor)?.unresolved;
const successful = (state, actor) => {
  const round = roundOf(actor);
  const group = round ? state.groups[round.group] : null;
  return round?.status === 'completed' && round.outcome === 'COMPLETED' && round.reportComplete
    && !round.blocked && !round.unresolved && !!group?.settled;
};

function validateRoute(route) {
  if (!route || typeof route !== 'object' || Array.isArray(route)) throw new Error('Main must select profile or inline route');
  const allowed = ['profile', 'subagent', 'model', 'effort', 'permission_mode', 'developer_instructions'];
  const keys = Object.keys(route);
  for (const key of keys) if (!allowed.includes(key)) throw new Error(`unsupported route field ${key}`);
  if (route.profile !== undefined) {
    nonempty(route.profile, 'profile');
    if (keys.some((key) => key !== 'profile')) throw new Error('profile and inline route fields are mutually exclusive');
  } else {
    nonempty(route.subagent, 'inline subagent');
    if (route.permission_mode !== undefined && route.permission_mode !== 'yolo') throw new Error('inline permission_mode must be yolo');
  }
  for (const key of keys) nonempty(route[key], key);
  return route.profile ? { ...route } : { ...route, permission_mode: 'yolo' };
}

async function loadGraph(repo, session, state, { requireReconciled = false } = {}) {
  const text = await readPlan(repo);
  const base = compilePlan(text);
  const found = await readGraph(repo, session);
  if (!found.graph) throw new GraphError('call sfd_workflow_compile first', { code: 'GRAPH_MISSING', locations: [found.file] });
  validateGraph(found.graph, base, state, { requireReconciled, file: found.file });
  return { graph: found.graph, base, file: found.file, backup: found.backup, graphWarning: null };
}

async function graphForRead(repo, session, state) {
  try {
    const text = await readPlan(repo);
    const base = compilePlan(text);
    const found = await readGraph(repo, session);
    if (!found.graph) return { graph: null, file: found.file, warning: 'call sfd_workflow_compile first' };
    validateGraph(found.graph, base, state, { file: found.file });
    return { graph: found.graph, file: found.file, warning: null };
  } catch (error) {
    return { graph: null, file: null, warning: error.message };
  }
}

export async function compileWorkflow(repo, session) {
  const text = await readPlan(repo);
  const base = compilePlan(text);
  const loc = await graphLocation(repo, session);
  let existing = null;
  let invalid = false;
  try {
    const found = await readGraph(repo, session);
    existing = found.graph;
  } catch (error) {
    if (error instanceof GraphError && ['GRAPH_PARSE', 'GRAPH_IDENTITY'].includes(error.code)) invalid = true;
    else throw error;
  }

  if (existing && structuralSame(existing, base)) {
    return {
      ok: true,
      upToDate: true,
      graphPath: loc.file,
      backupPath: loc.backup,
      reconciled: existing.reconciled === true,
      graph: existing,
      instruction: compileInstruction({ upToDate: true, graphPath: loc.file, backupPath: loc.backup, reconciled: existing.reconciled === true }),
    };
  }

  if (existing || invalid) await backupGraph(repo, session);
  const graph = buildGraph(base, { sessionId: session, repo: loc.root });
  graph.reconciled = !existing && !invalid;
  await writeGraph(repo, session, graph);
  return {
    ok: true,
    upToDate: false,
    graphPath: loc.file,
    backupPath: existing || invalid ? loc.backup : null,
    reconciled: graph.reconciled,
    graph,
    instruction: compileInstruction({
      upToDate: false,
      graphPath: loc.file,
      backupPath: existing || invalid ? loc.backup : null,
      reconciled: graph.reconciled,
    }),
  };
}

export async function spawn(repo, session, args, rpc, { checkpoint = async () => {} } = {}) {
  return withSession(repo, session, async (state) => {
    const { graph, file } = await loadGraph(repo, session, state, { requireReconciled: true });
    if (!Array.isArray(args.tasks) || !args.tasks.length || args.tasks.length > 16) throw new Error('tasks requires 1..16 entries');
    const prepared = [];
    const seen = new Set();
    const batchSections = new Set();
    for (const task of args.tasks) {
      const node = graph.nodes[task.node];
      if (!node) throw new Error(`${file}: unknown node ${task.node}`);
      if (node.section) {
        if (batchSections.size && !batchSections.has(node.section)) throw new Error('no parallel Sections in a reviewer/worker batch');
        batchSections.add(node.section);
        if (Object.values(state.actors).some((actor) => actor.section && actor.section !== node.section && isLive(actor))) {
          throw new Error('no parallel Sections: ' + node.section + ' cannot start while another Section has live work');
        }
        const liveHere = Object.values(state.actors).filter((actor) => actor.section === node.section && isLive(actor));
        if (node.kind === 'implementation' && (liveHere.length || prepared.some((item) => item.node.kind === 'implementation'))) throw new Error('shared workspace writer overlap in ' + node.section);
        if (node.kind === 'review' && liveHere.some((actor) => actor.kind === 'implementation')) throw new Error('shared workspace writer/reviewer overlap in ' + node.section);
        if (prepared.some((item) => item.node.section === node.section && item.node.kind !== node.kind)) throw new Error('shared workspace writer/reviewer overlap in ' + node.section);
      }
      if (node.kind === 'main') throw new Error(`${file}:${node.line}: ${node.id} is a Main/graph decision, not a spawnable task`);
      if (node.status === 'done' || node.status === 'skipped_by_user') throw new Error(`${node.id} is already ${node.status}`);
      if (node.status !== 'pending' && node.status !== 'failed') throw new Error(`${node.id} has unsupported status ${node.status}`);
      if (node.id.startsWith('plan:') && Object.values(state.actors).some((actor) => actor.rounds?.some((round) => round.node === node.id))) {
        throw new Error('continue the original plan reviewer with sfd_subagent_send, not a new spawn');
      }
      if ((node.id.endsWith(':checkpoint') || node.id.endsWith(':reconcile')) && Object.values(state.actors).some((actor) => actor.section === node.section && actor.role === 'behavior-review')) {
        throw new Error('continue the parent R01 reviewer with sfd_subagent_send, not a new spawn');
      }
      if (node.role === 'final-review' && !node.id.endsWith(':blind') && Object.values(state.actors).some((actor) => actor.section === node.section && actor.role === 'final-review')) {
        throw new Error('continue the frozen B1 reviewer with sfd_subagent_send for B2/closure, not a new spawn');
      }
      const missing = node.needs.filter((need) => !doneStatus(graph.nodes[need]));
      if (missing.length) throw new Error(`${file}:${node.line}: ${node.id} requires ${missing.join(', ')}`);
      if (Object.values(state.actors).some((actor) => actor.node === node.id && isLive(actor))) throw new Error(`${node.id} has a live actor; continue it or wait`);
      if (seen.has(node.id)) throw new Error('duplicate batch node');
      seen.add(node.id);
      const route = validateRoute(task.route);
      nonempty(task.assignment, 'assignment');
      prepared.push({ node, route, prompt: `${standing(node)}\nNode: ${node.id}; logical role: ${node.role}; purpose: ${node.section ? 'section work' : 'workflow'}.${node.mandatory ? ' This is a mandatory graph obligation.' : ''}\n${task.assignment}` });
    }
    const groupId = randomUUID();
    const group = state.groups[groupId] = {
      ids: [],
      settled: false,
      dispatchComplete: false,
      operations: prepared.map((item) => ({ node: item.node.id, state: 'not_attempted' })),
    };
    const failures = [];
    for (let index = 0; index < prepared.length; index++) {
      const { node, route, prompt } = prepared[index];
      group.operations[index].state = 'pending';
      await checkpoint();
      try {
        const answer = await rpc('spawn', { repository: repo, prompt, ...route });
        const id = String(answer.agent_id);
        if (!/^\d{8}$/.test(id) || state.actors[id]) throw new Error('invalid/duplicate spawn identity; dispatch may have occurred, inspect before any retry');
        state.actors[id] = {
          id,
          node: node.id,
          originNode: node.id,
          kind: node.kind,
          role: node.role,
          unit: node.unit ?? null,
          section: node.section ?? null,
          feature: node.feature ?? null,
          route,
          sessionId: answer.session_id ?? null,
          ordinal: Object.keys(state.actors).length + 1,
          createdAt: Date.now(),
          rounds: [{ number: 1, node: node.id, status: answer.status ?? 'running', group: groupId, pages: [] }],
        };
        group.ids.push(id);
        group.operations[index] = { node: node.id, state: 'created', agentId: id, sessionId: answer.session_id ?? null };
        await checkpoint();
      } catch (error) {
        if (group.operations[index].state !== 'created') group.operations[index].state = 'uncertain';
        failures.push({ index, node: node.id, error: String(error.message), code: error.code ?? null, dispatchUncertain: true });
        for (let next = index + 1; next < prepared.length; next++) failures.push({ index: next, node: prepared[next].node.id, error: 'not attempted after dispatch failure', dispatchUncertain: false });
        break;
      }
    }
    group.dispatchComplete = failures.length === 0;
    group.failures = failures;
    return {
      ok: !failures.length,
      groupId,
      agent_ids: group.ids,
      failures,
      instruction: group.ids.length ? waitInstruction(group.ids) : 'Inspect dispatch failure; do not retry a non-idempotent spawn blindly.',
    };
  });
}

function checkIdentity(actor, task) {
  if (task?.agent_id !== undefined && String(task.agent_id) !== actor.id) throw new Error('actor identity changed');
  if (task?.session_id !== undefined && task.session_id !== null) {
    if (!actor.sessionId || actor.sessionId !== task.session_id) throw new Error('session identity unavailable or replaced');
  }
}

function pageReceipt(actor, body, offset = 0) {
  checkIdentity(actor, body.task);
  const round = roundOf(actor);
  const result = body.result;
  if (!result) return;
  if (result.offset !== offset) throw new Error('result offset mismatch');
  if (round.pages.length && round.outcome !== result.outcome) throw new Error('result outcome changed across pages');
  const end = offset + Buffer.byteLength(result.final_text ?? '');
  const next = result.next_offset ?? null;
  if (!Number.isSafeInteger(result.total_bytes) || result.total_bytes < end) throw new Error('invalid total result bytes');
  if (next !== null && (next !== end || next <= offset)) throw new Error('result pagination did not advance contiguously');
  if (next === null && result.total_bytes !== end) throw new Error('result ended before total bytes');
  const existing = round.pages.find((page) => page.offset === offset);
  if (existing) return;
  round.pages.push({ offset, nonempty: !!result.final_text?.trim(), bytes: Buffer.byteLength(result.final_text ?? '') });
  round.outcome = result.outcome;
  round.partial = result.partial;
  round.nextOffset = next;
  round.reportComplete = next === null && !result.partial && round.pages.some((page) => page.nonempty);
  round.failure = result.failure_message ?? null;
}

function settle(state) {
  for (const [key, group] of Object.entries(state.groups)) {
    group.settled = group.ids.length > 0 && group.ids.every((id) => {
      const round = state.actors[id]?.rounds.find((item) => item.group === key);
      return round && terminal.has(round.status) && !round.blocked && !round.unresolved;
    });
  }
}

async function instructions(state, graph, actors) {
  if (!graph) return [];
  const output = [];
  for (const actor of actors) {
    if (!successful(state, actor)) continue;
    const node = graph.nodes[actor.node];
    if (!node) continue;
    const guide = navigation(node, actor, graph, state);
    const key = instructionKey(node, actor);
    if (roundOf(actor).number === 1 && !state.instructionRoles.includes(key)) {
      guide.fullInstructions = await fullGuidance(node);
      state.instructionRoles.push(key);
    }
    output.push(guide);
  }
  return output;
}

export async function prepareWait(repo, session, args) {
  return withSession(repo, session, async (state) => {
    const ids = args.agent_ids?.map(String);
    const waitTime = args.wait_time ?? 290;
    if (!ids?.length || ids.length > 16 || new Set(ids).size !== ids.length) throw new Error('wait requires 1..16 distinct actor IDs');
    if (!Number.isInteger(waitTime) || waitTime < 0 || waitTime > 290) throw new Error('wait_time must be 0..290');
    const allIds = [...new Set(ids.flatMap((id) => state.groups[roundOf(actorOf(state, id)).group].ids))];
    return { actors: structuredClone(allIds.map((id) => actorOf(state, id))), waitTime, graph: await graphForRead(repo, session, state) };
  });
}

export async function pollWait(poll, rpc) {
  const { actors, waitTime } = poll;
  const bodies = {};
  const identities = {};
  const errors = [];
  const initial = actors.filter((actor) => !roundOf(actor).messageId);
  for (let offset = 0; offset < initial.length; offset += 16) {
    const chunk = initial.slice(offset, offset + 16);
    try {
      const response = await rpc('wait', { agent_id: chunk.map((actor) => Number(actor.id)), wait_time: waitTime });
      for (const actor of chunk) bodies[actor.id] = response[actor.id];
      if (response.error) errors.push(response.error);
    } catch (error) {
      errors.push({ error: error.message });
    }
  }
  await Promise.all(actors.filter((actor) => roundOf(actor).messageId).map(async (actor) => {
    try {
      const messageId = roundOf(actor).messageId;
      const body = bodies[actor.id] = await rpc('wait', { agent_id: Number(actor.id), wait_time: waitTime, message_id: messageId });
      if (body.message_receipt?.message_id === messageId && body.message_receipt.state === 'delivered' && !body.message_receipt.failure_code) {
        identities[actor.id] = await rpc('result', { agent_id: Number(actor.id), offset: 0 });
      }
    } catch (error) {
      errors.push({ actor_id: actor.id, error: error.message });
    }
  }));
  return { bodies, identities, errors };
}

export async function finishWait(repo, session, poll, { bodies, identities, errors }) {
  return withSession(repo, session, async (state) => {
    for (const prior of poll.actors) {
      const actor = actorOf(state, prior.id);
      const round = roundOf(actor);
      const expected = roundOf(prior);
      const body = bodies[actor.id];
      if (round.number !== expected.number || round.group !== expected.group) {
        errors.push({ actor_id: actor.id, error: 'stale wait response for an older round' });
        continue;
      }
      if (!body) {
        errors.push({ actor_id: actor.id, error: 'missing wait body' });
        continue;
      }
      try {
        checkIdentity(actor, body.task);
        if (terminal.has(round.status) && (!terminal.has(body.task?.status) || round.status !== body.task.status)) continue;
        round.blocked = (body.pending_requests ?? []).length > 0;
        round.pendingRequests = body.pending_requests ?? [];
        if (round.messageId) {
          const receipt = body.message_receipt;
          round.receipt = receipt ?? null;
          if (receipt?.message_id !== round.messageId || receipt.state !== 'delivered' || receipt.failure_code) {
            round.status = 'awaiting_message';
            round.blocked = true;
            continue;
          }
          const identity = identities[actor.id];
          checkIdentity(actor, identity?.task);
          if (identity?.task?.session_id !== actor.sessionId) throw new Error('continued session identity unavailable or replaced');
          round.unresolved = false;
          round.sendState = 'delivered';
        }
        round.status = body.task?.status ?? 'unknown';
        if (!terminal.has(round.status)) round.sawRunning = true;
        if (round.messageId && terminal.has(round.status) && !round.sawRunning && JSON.stringify(body.result) === round.previousResult) {
          round.status = 'awaiting_new_result';
          round.blocked = true;
          continue;
        }
        if (terminal.has(round.status) && body.result) pageReceipt(actor, body, 0);
      } catch (error) {
        round.blocked = true;
        errors.push({ actor_id: actor.id, error: error.message });
      }
    }
    settle(state);
    const all = poll.actors.map((actor) => actorOf(state, actor.id));
    const remaining = all.filter((actor) => !terminal.has(roundOf(actor).status) || roundOf(actor).blocked || roundOf(actor).unresolved).map((actor) => actor.id);
    const graphInfo = await graphForRead(repo, session, state);
    const complete = !remaining.length && !errors.length;
    return {
      ok: !errors.length,
      agent_ids: all.map((actor) => actor.id),
      remaining_ids: remaining,
      complete,
      results: bodies,
      errors,
      graphWarning: graphInfo.warning,
      instructions: complete ? await instructions(state, graphInfo.graph, all) : [],
      instruction: remaining.length
        ? waitInstruction(remaining)
        : 'Read all reports and update SFD-GRAPH.json: review nodes are done only with actor/round/report; use skipped_by_user only with explicit user provenance. Then process the next ready mandatory review.',
    };
  });
}

export async function wait(repo, session, args, rpc) {
  const poll = await prepareWait(repo, session, args);
  return finishWait(repo, session, poll, await pollWait(poll, rpc));
}

export async function result(repo, session, args, rpc) {
  return withSession(repo, session, async (state) => {
    const actor = actorOf(state, args.agent_id);
    const round = roundOf(actor);
    if (!terminal.has(round.status) || round.blocked) throw new Error('wait for the current round and its message receipt first');
    const offset = args.offset ?? round.nextOffset ?? 0;
    if (offset !== 0 && offset !== round.nextOffset) throw new Error('read result pages in order');
    if (offset === 0 && round.pages.length) throw new Error('use next_offset; first page already received');
    const body = await rpc('result', { agent_id: Number(actor.id), offset, ...(args.limit !== undefined ? { limit: args.limit } : {}) });
    pageReceipt(actor, body, offset);
    settle(state);
    const graphInfo = await graphForRead(repo, session, state);
    return {
      ok: true,
      actor_id: actor.id,
      round: round.number,
      ...body,
      graphWarning: graphInfo.warning,
      instructions: await instructions(state, graphInfo.graph, [actor]),
    };
  });
}

export async function observe(repo, session, args, rpc) {
  return withSession(repo, session, async (state) => {
    const actor = actorOf(state, args.agent_id);
    return { ok: true, actor_id: actor.id, observation: await rpc('observe', { agent_id: Number(actor.id) }), instruction: 'Main diagnoses liveness; observation does not change graph progress or release a successor.' };
  });
}

export async function cancel(repo, session, args, rpc) {
  return withSession(repo, session, async (state) => {
    const actor = actorOf(state, args.agent_id);
    const response = await rpc('cancel', { agent_id: Number(actor.id) });
    return { ok: true, actor_id: actor.id, response, instruction: waitInstruction([actor.id]) };
  });
}

export async function send(repo, session, args, rpc, { checkpoint = async () => {} } = {}) {
  return withSession(repo, session, async (state) => {
    nonempty(args.content, 'bounded continuation content');
    if (args.mode !== undefined && !['queue', 'steer'].includes(args.mode)) throw new Error('mode must be queue or steer');
    const { graph, file } = await loadGraph(repo, session, state, { requireReconciled: true });
    const actor = actorOf(state, args.agent_id);
    const node = graph.nodes[args.node ?? actor.node];
    if (!node) throw new Error(`${file}: unknown node ${args.node ?? actor.node}`);
    if (node.kind === 'main') throw new Error('Main/graph decisions are not continued as subagent work');
    if (node.status === 'done' || node.status === 'skipped_by_user') throw new Error(`${node.id} is already ${node.status}; set it pending before another review/repair round`);
    const missing = node.needs.filter((need) => !doneStatus(graph.nodes[need]));
    if (missing.length) throw new Error(`${file}:${node.line}: ${node.id} requires ${missing.join(', ')}`);
    if (!actor.sessionId) throw new Error('same-session continuation unavailable: original session identity UNKNOWN');
    if (isLive(actor) || !state.groups[roundOf(actor).group]?.settled) throw new Error('wait for the complete current dispatch group before continuation');
    if (node.id.endsWith(':blind')) throw new Error('first-pass blind Code B requires a fresh spawn; add an explicit B2 review node for same-head reconciliation');
    if (node.id.startsWith('plan:') && !actor.rounds.some((round) => round.node === node.id)) throw new Error('first-pass plan review requires a fresh spawn; only its original reviewer may recheck it');
    if (node.section && Object.values(state.actors).some((candidate) => candidate.section && candidate.section !== node.section && isLive(candidate))) throw new Error('no parallel Sections: another Section has live work');
    if (node.section && node.kind === 'implementation' && Object.values(state.actors).some((candidate) => candidate.section === node.section && isLive(candidate))) throw new Error('shared workspace writer overlap in ' + node.section);
    if (node.section && node.kind === 'review' && Object.values(state.actors).some((candidate) => candidate.section === node.section && candidate.kind === 'implementation' && isLive(candidate))) throw new Error('shared workspace writer/reviewer overlap in ' + node.section);
    if (node.kind !== actor.kind || node.role !== actor.role) throw new Error('continuation must keep actor kind and role');
    if (node.kind === 'implementation' && node.unit !== actor.unit) throw new Error('continuation must keep the owning unit for implementation work');
    if (node.kind === 'review' && (node.section !== actor.section || node.feature !== actor.feature)) throw new Error('review continuation must keep the owning Section/Feature');
    const identity = await rpc('result', { agent_id: Number(actor.id), offset: 0 });
    checkIdentity(actor, identity.task);
    if (identity.task?.session_id !== actor.sessionId) throw new Error('same-session continuation cannot be verified');
    const messageId = randomUUID();
    const group = randomUUID();
    state.groups[group] = { ids: [actor.id], settled: false, dispatchComplete: true };
    actor.originNode ??= actor.rounds.find((round) => round.node)?.node ?? actor.node;
    actor.node = node.id;
    actor.unit = node.unit ?? null;
    const round = {
      number: actor.rounds.length + 1,
      node: node.id,
      status: 'dispatch_uncertain',
      messageId,
      previousResult: JSON.stringify(identity.result),
      group,
      pages: [],
      unresolved: true,
    };
    actor.rounds.push(round);
    await checkpoint();
    try {
      const answer = await rpc('send', { agent_id: Number(actor.id), message_id: messageId, mode: args.mode ?? 'queue', content: args.content });
      if (answer.message_id !== messageId || !['queued', 'delivered', 'already_delivered'].includes(answer.disposition)) throw new Error('continuation receipt identity unavailable or changed');
      round.status = 'awaiting_message';
      round.unresolved = false;
      round.sendState = answer.disposition;
    } catch (error) {
      round.sendState = 'uncertain';
      round.error = { message: error.message, code: error.code ?? null };
      if (error.code === 'TERMINAL_SEND_UNSUPPORTED') {
        round.sendState = 'rejected';
        round.unresolved = false;
        round.status = 'failed';
        round.blocked = true;
        state.groups[group].settled = true;
      }
      await checkpoint();
      error.actorId = actor.id;
      error.messageId = messageId;
      throw error;
    }
    await checkpoint();
    return { ok: true, actor_id: actor.id, session_id: actor.sessionId, round: round.number, instruction: waitInstruction([actor.id]) };
  });
}
