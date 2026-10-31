/** Thin graph/status wrapper: Main edits SFD-GRAPH.json; this module dispatches and records actual actor facts. */
import { randomUUID } from 'node:crypto';
import { compilePlan } from './compiler.js';
import {
  graphLocation, readGraph, writeGraph, backupGraph, buildGraph, structuralSame,
  validateGraph, readPlan, GraphError, reopenRecovery, missingPrerequisites, successfulRound,
} from './graph-store.js';
import { withSession, readSession, implementationCycle } from './session-store.js';
import {
  navigation, fullGuidance, waitInstruction, standing, compileInstruction,
  instructionKey, workflowNavigation, errorInstruction, pendingInstruction,
} from './guidance.js';

const terminal = new Set(['completed', 'failed', 'cancelled', 'timed_out', 'runtime_lost', 'result_invalid', 'closed']);
const nonempty = (value, label) => { if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`); return value; };
const actorOf = (state, id) => { const actor = state.actors[String(id)]; if (!actor) throw new Error(`unknown actor ${id}`); return actor; };
const roundOf = (actor) => actor?.rounds?.at(-1);
const isLive = (actor) => !terminal.has(roundOf(actor)?.status) || !!roundOf(actor)?.unresolved;
const successful = (actor) => successfulRound(roundOf(actor));

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
  return { graph: found.graph, file: found.file };
}

async function graphForRead(repo, session, state) {
  try {
    const text = await readPlan(repo);
    const base = compilePlan(text);
    const found = await readGraph(repo, session);
    if (!found.graph) return { graph: null, warning: 'call sfd_workflow_compile first', instruction: 'Call sfd_workflow_compile to restore the missing graph, reconcile valid evidence and user waivers, then continue. Actor results remain available.' };
    validateGraph(found.graph, base, state, { file: found.file });
    return { graph: found.graph, warning: null };
  } catch (error) {
    return { graph: null, warning: error.message, instruction: errorInstruction(error), recovery: error.recovery };
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
    const state = await readSession(repo, session);
    validateGraph(existing, base, state, { file: loc.file });
    const dynamic = workflowNavigation(existing, state);
    return {
      ok: true,
      upToDate: true,
      graphPath: loc.file,
      backupPath: loc.backup,
      reconciled: existing.reconciled === true,
      graph: existing,
      navigation: dynamic,
      instruction: compileInstruction({ upToDate: true, graphPath: loc.file, backupPath: loc.backup, reconciled: existing.reconciled === true }) + " " + dynamic.instruction,
    };
  }

  if (existing || invalid) await backupGraph(repo, session);
  const graph = buildGraph(base, { sessionId: session, repo: loc.root });
  graph.reconciled = !existing && !invalid;
  await writeGraph(repo, session, graph);
  const dynamic = workflowNavigation(graph, await readSession(repo, session));
  return {
    ok: true,
    upToDate: false,
    graphPath: loc.file,
    backupPath: existing || invalid ? loc.backup : null,
    reconciled: graph.reconciled,
    graph,
    navigation: dynamic,
    instruction: compileInstruction({
      upToDate: false,
      graphPath: loc.file,
      backupPath: existing || invalid ? loc.backup : null,
      reconciled: graph.reconciled,
    }) + ' ' + dynamic.instruction,
  };
}

function assertPending(graph, node, file) {
  if (!node) throw new Error(`${file}: unknown node`);
  if (node.kind === 'main') throw new Error(`${node.id} is a Main/graph decision, not a spawnable task`);
  if (node.status === 'done' || node.status === 'skipped_by_user') {
    const recovery = reopenRecovery(graph, [node.id]);
    throw new GraphError(`${node.id} is already ${node.status}; reopen it before another round`, { code: 'NODE_REOPEN_REQUIRED', recovery, instruction: recovery.instruction + (node.status === 'skipped_by_user' ? ' Only reopen this waived node if the user changes that decision.' : '') });
  }
  if (!['pending', 'failed'].includes(node.status)) throw new Error(`${node.id} has unsupported status ${node.status}`);
  const missing = missingPrerequisites(graph, node);
  if (missing.length) throw new Error(`${file}:${node.line}: ${node.id} requires ${missing.join(', ')}`);
}

function assertAvailable(state, node, prepared = []) {
  const live = Object.values(state.actors).filter(isLive);
  if (live.some((actor) => actor.node === node.id)) throw new Error(`${node.id} has a live actor; wait or cancel and wait`);
  const peers = [...live, ...prepared.map((item) => item.node)];
  if (peers.some((actor) => actor.kind === 'implementation' || node.kind === 'implementation')) throw new Error('shared workspace writer/reviewer overlap');
  if (node.section && peers.some((actor) => actor.section && actor.section !== node.section)) throw new Error('no parallel Sections: another Section has live work');
}

function implementationDispatch(state, node, task, selectedActor) {
  const purpose = task.purpose ?? node.purpose ?? 'implementation';
  if (!['implementation', 'repair'].includes(purpose)) throw new Error('implementation purpose must be implementation or repair');
  if (!node.unit) throw new Error('implementation work requires its owning unit');
  const uncertain = Object.values(state.groups).flatMap((group) => group.operations ?? [])
    .find((operation) => operation.unit === node.unit && operation.action === 'spawn' && ['pending', 'uncertain'].includes(operation.state) && !operation.agentId);
  if (uncertain) throw new GraphError('implementation spawn outcome is still unknown for ' + node.unit, { code: 'IMPL_DISPATCH_UNCERTAIN', instruction: 'Inspect the recorded group/operation and actual ES task identity before dispatching this unit again. Restore the real actor and cycle facts if it was created, or record operation.state=not_created only after confirming no task was created. Never blindly spawn another implementation or repair worker.' });
  if (purpose === 'implementation') {
    if (!['impl_std', 'impl_large'].includes(node.role)) throw new Error('new implementation requires impl_std or impl_large');
    if (selectedActor && (selectedActor.kind !== 'implementation' || selectedActor.unit !== node.unit || selectedActor.role !== node.role)) throw new Error('new implementation continuation must keep the owning unit and planned tier');
    return { purpose, role: node.role, actor: selectedActor, route: selectedActor ? null : validateRoute(task.route), repairRoute: task.repair_route ? validateRoute(task.repair_route) : null };
  }
  const cycle = implementationCycle(state, node.unit);
  if (!cycle.original) throw new GraphError('no original implementation for ' + node.unit, { code: 'IMPL_CYCLE_MISSING', instruction: 'Restore the original implementation actor facts, or dispatch purpose=implementation for genuinely new implementation. A skipped implementation has no repair session.' });
  if (selectedActor) return { purpose, role: selectedActor.role, actor: selectedActor, route: null, original: cycle.original, repairRoute: cycle.repairRoute };
  const route = task.route ?? task.repair_route ?? cycle.repairRoute;
  if (!route) throw new GraphError('repair spawn requires an impl_large route', { code: 'IMPL_ROUTE_REQUIRED', instruction: 'Supply route (or repair_route) for the configured impl_large implementer for this repair spawn. Canonical routing: an impl_std cycle repairs in one escalated impl_large session; an impl_large cycle prefers sfd_subagent_send to its original implementer session. A replacement spawn is the recorded-gap fallback when that session can no longer continue.' });
  return { purpose, role: 'impl_large', actor: null, route: validateRoute(route), original: cycle.original, repairRoute: cycle.repairRoute };
}

function recordImplementation(state, node, dispatch, actor) {
  if (node.kind !== 'implementation') return;
  state.implementationCycles ??= {};
  state.implementationCycles[node.unit] = dispatch.purpose === 'implementation'
    ? { original: actor.id, repair: actor.role === 'impl_large' ? actor.id : null, repairRoute: dispatch.repairRoute }
    : { original: dispatch.original.id, repair: actor.id, repairRoute: dispatch.repairRoute ?? actor.route };
}

async function dispatchBatch(state, repo, graph, file, tasks, rpc, checkpoint, selectedActor = null) {
  if (!Array.isArray(tasks) || !tasks.length || tasks.length > 16) throw new Error('tasks requires 1..16 entries');
  const prepared = [];
  for (const task of tasks) {
    const node = graph.nodes[task.node];
    assertPending(graph, node, file);
    assertAvailable(state, node, prepared);
    if (prepared.some((item) => item.node.id === node.id)) throw new Error('duplicate batch node');
    nonempty(task.assignment, 'assignment');
    if (task.mode !== undefined && !['queue', 'steer'].includes(task.mode)) throw new Error('mode must be queue or steer');
    const dispatch = node.kind === 'implementation' ? implementationDispatch(state, node, task, selectedActor)
      : { role: node.role, actor: selectedActor, route: selectedActor ? null : validateRoute(task.route) };
    if (dispatch.actor) {
      if (!dispatch.actor.sessionId) throw new Error('same-session continuation unavailable: original session identity UNKNOWN');
      if (isLive(dispatch.actor) || !state.groups[roundOf(dispatch.actor).group]?.settled) throw new Error('wait for the complete current dispatch group before continuation');
    }
    prepared.push({ ...dispatch, node, assignment: task.assignment, mode: task.mode ?? 'queue' });
  }
  const groupId = randomUUID();
  const group = state.groups[groupId] = { ids: [], settled: false, operations: prepared.map((item) => ({ node: item.node.id, unit: item.node.unit, purpose: item.purpose, action: item.actor ? 'send' : 'spawn', ...(item.actor ? { agentId: item.actor.id } : {}), state: 'not_attempted' })) };
  const failures = [];
  for (let index = 0; index < prepared.length; index++) {
    const item = prepared[index];
    const { node, route, role, purpose } = item;
    group.operations[index].state = 'pending';
    await checkpoint();
    try {
      let actor = item.actor;
      if (actor) {
        await continueActor(state, actor, node, item.assignment, item.mode, rpc, checkpoint, groupId, item);
      } else {
        const header = item.route?.profile ? '' : `${standing(node)}\n`;
        const prompt = `${header}Node: ${node.id}; logical role: ${role}; purpose: ${purpose ?? 'review'}.\n${item.assignment}`;
        const answer = await rpc('spawn', { repository: repo, prompt, ...route });
        const id = String(answer.agent_id);
        if (!/^\d{8}$/.test(id) || state.actors[id]) throw new Error('invalid/duplicate spawn identity; dispatch may have occurred, inspect before any retry');
        actor = state.actors[id] = {
          id, node: node.id, kind: node.kind, role,
          unit: node.unit ?? null, section: node.section ?? null, feature: node.feature ?? null,
          route, sessionId: answer.session_id ?? null, createdAt: Date.now(),
          rounds: [{ number: 1, node: node.id, role, purpose, status: answer.status ?? 'running', group: groupId, pages: [] }],
        };
        group.ids.push(id);
        recordImplementation(state, node, item, actor);
      }
      group.operations[index] = { node: node.id, state: 'created', action: item.actor ? 'send' : 'spawn', agentId: actor.id, sessionId: actor.sessionId, round: roundOf(actor).number, role, purpose };
      await checkpoint();
    } catch (error) {
      group.operations[index].state = error.code === 'TERMINAL_SEND_UNSUPPORTED' ? 'rejected' : 'uncertain';
      failures.push({ index, node: node.id, error: String(error.message), code: error.code ?? null, instruction: errorInstruction(error), dispatchUncertain: error.code !== 'TERMINAL_SEND_UNSUPPORTED' });
      for (let next = index + 1; next < prepared.length; next++) failures.push({ index: next, node: prepared[next].node.id, error: 'not attempted after dispatch failure', dispatchUncertain: false });
      break;
    }
  }
  group.failures = failures;
  return { ok: !failures.length, groupId, agent_ids: group.ids, operations: group.operations, failures,
    instruction: failures.length ? failures[0].instruction : waitInstruction(group.ids) };
}

export async function spawn(repo, session, args, rpc) {
  return withSession(repo, session, async (state, _root, { checkpoint }) => {
    const { graph, file } = await loadGraph(repo, session, state, { requireReconciled: true });
    return dispatchBatch(state, repo, graph, file, args.tasks, rpc, checkpoint);
  });
}

function checkIdentity(actor, task) {
  if (task?.agent_id !== undefined && String(task.agent_id) !== actor.id) throw new Error('actor identity changed');
  if (task?.session_id !== undefined && task.session_id !== null) {
    if (!actor.sessionId || actor.sessionId !== task.session_id) throw new Error('session identity unavailable or replaced');
  }
}

/** Records result facts; navigation follows next_offset and never revalidates transport arithmetic. */
function pageReceipt(actor, body, offset = 0) {
  checkIdentity(actor, body.task);
  const round = roundOf(actor);
  const result = body.result;
  if (!result) return;
  if (result.offset !== offset) throw new Error('result offset mismatch');
  if (round.pages.some((page) => page.offset === offset)) return;
  const next = result.next_offset ?? null;
  round.pages.push({ offset, nonempty: !!result.final_text?.trim() });
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
    if (!successful(actor)) continue;
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
    return { actors: structuredClone(allIds.map((id) => actorOf(state, id))), waitTime };
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
      recovery: graphInfo.recovery,
      instructions: complete ? await instructions(state, graphInfo.graph, all) : [],
      instruction: followupInstruction(all, remaining, graphInfo, state, errors),
    };
  });
}

function followupInstruction(actors, remaining, graphInfo, state, errors = []) {
  const requests = actors.flatMap((actor) => (roundOf(actor).pendingRequests ?? []).map((request) => ({ agent_id: actor.id, ...request })));
  if (requests.length) return pendingInstruction(requests, actors.map((actor) => actor.id));
  if (errors.length) return { tool: 'sfd_subagent_observe', arguments: { agent_id: actors[0].id }, agent_ids: actors.map((actor) => actor.id), errors, instruction: 'Inspect wait/identity/pagination errors for these actor IDs before retrying. Call sfd_subagent_observe separately with agent_id for each listed ID and preserve prior evidence; resolve identity/transport issues rather than blindly waiting or claiming completion.' };
  if (remaining.length) return waitInstruction(remaining);
  const unread = actors.find((actor) => roundOf(actor).nextOffset != null);
  if (unread) return { tool: 'sfd_subagent_result', arguments: { agent_id: unread.id, offset: roundOf(unread).nextOffset }, instruction: 'Read every remaining report page before recording this node done.' };
  const failed = actors.filter((actor) => !successful(actor));
  if (failed.length) return 'Inspect failure/partial/empty evidence for actors ' + failed.map((actor) => actor.id).join(', ') + '; use observe and choose the appropriate review dispatch or cycle repair. Terminal status is not completion evidence; keep their nodes pending/failed.';
  if (graphInfo.instruction) return graphInfo.instruction;
  return 'Read and record the returned authored reports before scheduling another round. COMPLETED is not CLEAN. Successor instructions describe what follows if these conclusions are accepted; do not redispatch the returned nodes merely because their graph status is still pending. ' + workflowNavigation(graphInfo.graph, state, { exclude: actors.map((actor) => actor.node) }).instruction;
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
      recovery: graphInfo.recovery,
      instruction: followupInstruction([actor], [], graphInfo, state),
    };
  });
}

/** Forward a response without fabricating request lifecycle or graph completion. */
export async function respond(repo, session, args, rpc) {
  return withSession(repo, session, async (state) => {
    const actor = actorOf(state, args.agent_id);
    nonempty(args.request_id, 'request_id');
    if (Buffer.byteLength(args.request_id) > 256 || args.request_id.includes('\0')) throw new Error('request_id must be at most 256 bytes without NUL');
    if (!['allow', 'deny', 'answer'].includes(args.decision)) throw new Error('decision must be allow, deny or answer');
    if (args.decision === 'answer' || args.content !== undefined) {
      nonempty(args.content, 'response content');
      if (Buffer.byteLength(args.content) > 16384 || args.content.includes('\0')) throw new Error('response content must be at most 16384 bytes without NUL');
    }
    const response = await rpc('respond', { agent_id: Number(actor.id), request_id: args.request_id, decision: args.decision, ...(args.content !== undefined ? { content: args.content } : {}) });
    return {
      ok: true, actor_id: actor.id, request_id: args.request_id, response,
      instruction: { ...waitInstruction([actor.id]), instruction: 'Response disposition: ' + response.disposition + '; effective decision: ' + response.effective_decision + '. Inspect policy_overrode/policy_reason_code; a requested allow is not proof of permission. Wait for fresh request and task state; do not resend an in-flight response or mark graph work done.' },
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

async function continueActor(state, actor, node, content, mode, rpc, checkpoint, groupId, dispatch) {
  const identity = await rpc('result', { agent_id: Number(actor.id), offset: 0 });
  checkIdentity(actor, identity.task);
  if (identity.task?.session_id !== actor.sessionId) throw new Error('same-session continuation cannot be verified');
  const messageId = randomUUID();
  actor.node = node.id;
  actor.unit = node.unit ?? null;
  actor.section = node.section ?? null;
  actor.feature = node.feature ?? null;
  actor.role = dispatch.role;
  const round = {
    number: actor.rounds.length + 1, node: node.id, role: dispatch.role, purpose: dispatch.purpose,
    status: 'dispatch_uncertain', messageId, previousResult: JSON.stringify(identity.result),
    group: groupId, pages: [], unresolved: true,
  };
  actor.rounds.push(round);
  state.groups[groupId].ids.push(actor.id);
  const previousCycle = state.implementationCycles?.[node.unit];
  recordImplementation(state, node, dispatch, actor);
  await checkpoint();
  try {
    const answer = await rpc('send', { agent_id: Number(actor.id), message_id: messageId, mode, content });
    if (answer.message_id !== messageId || !['queued', 'delivered', 'already_delivered'].includes(answer.disposition)) throw new Error('continuation receipt identity unavailable or changed');
    round.status = 'awaiting_message';
    round.unresolved = false;
    round.sendState = answer.disposition;
  } catch (error) {
    round.sendState = 'uncertain';
    round.error = { message: error.message, code: error.code ?? null };
    if (error.code === 'TERMINAL_SEND_UNSUPPORTED') {
      if (node.kind === 'implementation' && dispatch.purpose === 'implementation') {
        if (previousCycle) state.implementationCycles[node.unit] = previousCycle;
        else delete state.implementationCycles[node.unit];
      }
      round.sendState = 'rejected';
      round.unresolved = false;
      round.status = 'failed';
      round.blocked = false;
      state.groups[groupId].settled = true;
      error.instruction = node.kind === 'review'
        ? `This reviewer session cannot continue ${node.id}. Apply the canonical recorded-gap fallback: exactly one new same-route session (sfd_subagent_spawn or a chosen known reviewer) receives the frozen report/finding IDs and the complete current scope; record the lineage break in the graph note and preserve old reports. Never report different actual agents as one session.`
        : dispatch.purpose === 'implementation'
          ? `This session cannot start the requested new implementation. The previous repair cycle is preserved. Main may use sfd_subagent_spawn with purpose=implementation and its configured route for genuinely new work; no graph progress has changed.`
          : `The selected repair session ${actor.id} cannot continue. Apply the recorded-gap fallback: dispatch exactly one same-route replacement (sfd_subagent_spawn with purpose=repair and the configured impl_large route) carrying the frozen findings, and record the lineage break. A genuinely new implementation must be explicitly dispatched with purpose=implementation.`;
    }
    error.actorId = actor.id;
    error.messageId = messageId;
    throw error;
  } finally {
    await checkpoint();
  }
}

export async function send(repo, session, args, rpc) {
  return withSession(repo, session, async (state, _root, { checkpoint }) => {
    const { graph, file } = await loadGraph(repo, session, state, { requireReconciled: true });
    const actor = actorOf(state, args.agent_id);
    const node = graph.nodes[args.node ?? actor.node];
    if (!node) throw new Error(`${file}: unknown node ${args.node ?? actor.node}`);
    if (node.kind !== actor.kind) throw new Error('continuation must keep actor task kind');
    if (node.kind === 'implementation' && node.unit !== actor.unit) throw new Error('continuation must keep the owning unit for implementation work');
    const task = { node: node.id, assignment: args.content, route: args.route, repair_route: args.repair_route, mode: args.mode,
      ...(node.kind === 'implementation' ? { purpose: args.purpose ?? node.purpose ?? 'repair' } : {}) };
    const dispatched = await dispatchBatch(state, repo, graph, file, [task], rpc, checkpoint, actor);
    const actual = dispatched.agent_ids[0] ? actorOf(state, dispatched.agent_ids[0]) : null;
    return { ...dispatched, requested_actor_id: actor.id, actor_id: actual?.id ?? null, session_id: actual?.sessionId ?? null, round: actual ? roundOf(actual).number : null };
  });
}
