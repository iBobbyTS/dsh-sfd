import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as execution from '../../lib/execution.js';
import { compilePlan } from '../../lib/compiler.js';
import { graphLocation, readGraph, writeGraph } from '../../lib/graph-store.js';
import { readSession } from '../../lib/session-store.js';

export const label = (n) => 'S' + String(n).padStart(2, '0');
export const section = (n, { deps = 'none', children = false } = {}) =>
  '## ' + label(n) + ' — ' + (n === 1 ? 'Foundation' : 'Composition') + '\n- Implementer: impl_large\n- Depends on: ' + deps + '\n' +
  (children ? ['A', 'B'].map((child, index) =>
    '### ' + label(n) + '.' + child + ' — ' + (index ? 'Composition' : 'Representation') + '\n- Implementer: impl_large\n- Depends on: ' + (index ? label(n) + '.A' : 'none') + '\n').join('') : '');
export const plan = (count = 1) => '# Plan\n\n' + Array.from({ length: count }, (_, index) => section(index + 1)).join('\n');

export async function fixture(text = plan()) {
  const repo = await mkdtemp(join(tmpdir(), 'sfd-graph-'));
  await mkdir(join(repo, '.agent-work'), { recursive: true });
  await writeFile(join(repo, '.agent-work', 'PLAN-FULL.md'), text);
  const session = 'session-' + Math.random().toString(36).slice(2);
  const calls = [];
  const tasks = new Map();
  let sequence = 10000000;
  const body = (id) => {
    const task = tasks.get(String(id));
    if (!task) throw new Error('unknown fake actor');
    const text = task.final_text ?? 'authored report ' + task.turn;
    return {
      pending_requests: task.pending_requests ?? [],
      timed_out: task.status === 'running',
      message_receipt: task.message_id ? { message_id: task.message_id, state: task.receipt ?? 'delivered' } : null,
      task: { agent_id: Number(id), status: task.status, session_id: task.session_id },
      activity: { latest_text_tail: '' },
      result: task.status === 'running' ? null : {
        outcome: task.outcome ?? 'COMPLETED',
        final_text: text,
        partial: task.partial ?? false,
        offset: task.offset ?? 0,
        next_offset: task.next_offset ?? null,
        total_bytes: Buffer.byteLength(text) + (task.next_offset ? 14 : 0),
      },
    };
  };
  const rpc = async (command, args) => {
    calls.push({ command, args });
    if (command === 'spawn') {
      const id = String(++sequence);
      tasks.set(id, { session_id: 'session-' + id, status: 'completed', turn: 1 });
      return { agent_id: Number(id), session_id: 'session-' + id, status: 'running' };
    }
    if (command === 'wait') {
      if (Array.isArray(args.agent_id)) return Object.fromEntries(args.agent_id.map((id) => [String(id), body(id)]));
      return body(args.agent_id);
    }
    const task = tasks.get(String(args.agent_id));
    if (!task) throw new Error('unknown fake actor');
    if (command === 'result') {
      return {
        ...body(args.agent_id),
        task: { agent_id: args.agent_id, status: task.status, session_id: task.session_id },
        ...(args.offset ? { result: { outcome: 'COMPLETED', final_text: 'continued page', partial: false, offset: args.offset, next_offset: null, total_bytes: 31 } } : {}),
      };
    }
    if (command === 'send') { task.message_id = args.message_id; task.turn++; return { message_id: args.message_id, disposition: 'delivered' }; }
    if (command === 'respond') {
      task.responses ??= new Map();
      const prior = task.responses.get(args.request_id);
      if (prior) return { ...prior, requested_decision: args.decision, disposition: 'already_responded' };
      const request = task.pending_requests?.find((item) => item.request_id === args.request_id);
      if (!request) throw new Error('unknown pending request');
      if (request.kind === 'permission' ? !['allow', 'deny'].includes(args.decision) : args.decision !== 'answer') throw new Error('wrong request decision');
      const response = { disposition: 'responded', requested_decision: args.decision, effective_decision: args.decision, policy_overrode: false, policy_reason_code: null };
      task.responses.set(args.request_id, response);
      task.pending_requests = task.pending_requests.filter((item) => item.request_id !== args.request_id);
      return response;
    }
    if (command === 'observe') return { coverage: { tools: 'available' }, reasoning: null };
    if (command === 'cancel') { task.status = 'cancelled'; task.outcome = 'CANCELLED'; return { task: { agent_id: args.agent_id, status: 'cancelled' } }; }
    throw new Error(command);
  };
  const compile = () => execution.compileWorkflow(repo, session);
  const spawn = (tasksArg) => execution.spawn(repo, session, { tasks: tasksArg }, rpc);
  const wait = (ids) => execution.wait(repo, session, { agent_ids: Array.isArray(ids) ? ids : [ids], wait_time: 0 }, rpc);
  const send = (agent_id, node, content) => execution.send(repo, session, { agent_id, node, content }, rpc);
  const cancel = (agent_id) => execution.cancel(repo, session, { agent_id }, rpc);
  const observe = (agent_id) => execution.observe(repo, session, { agent_id }, rpc);
  const graph = async () => (await readGraph(repo, session)).graph;
  const save = async (value) => writeGraph(repo, session, value);
  const state = () => readSession(repo, session);
  const setPlan = async (value) => writeFile(join(repo, '.agent-work', 'PLAN-FULL.md'), value);
  const loc = await graphLocation(repo, session);
  return { repo, session, calls, tasks, rpc, compile, spawn, wait, send, cancel, observe, graph, save, state, setPlan, loc };
}

export async function markDone(f, id, actorId, round, report = 'report') {
  const graph = await f.graph();
  graph.nodes[id].status = 'done';
  graph.nodes[id].evidence = { actor_id: String(actorId), round, report };
  await f.save(graph);
  return graph;
}

export async function markMain(f, id, reason = 'Main inspected actual evidence') {
  const graph = await f.graph();
  graph.nodes[id].status = 'done';
  graph.nodes[id].evidence = { reason };
  await f.save(graph);
  return graph;
}

export async function markUserSkip(f, id, reason = 'user explicitly skipped this obligation') {
  const graph = await f.graph();
  graph.nodes[id].status = 'skipped_by_user';
  graph.nodes[id].evidence = { user_source: 'user message', reason };
  await f.save(graph);
  return graph;
}

export async function spawnWaitDone(f, node) {
  const response = await f.spawn([{ node, assignment: 'bounded assignment', route: { subagent: 'fake', model: 'caller/model' } }]);
  const id = response.agent_ids[0];
  const waited = await f.wait(id);
  return { id, waited, round: 1 };
}

export async function planDone(f) {
  for (const node of ['plan:initial', 'plan:final']) {
    const { id } = await spawnWaitDone(f, node);
    await markDone(f, node, id, 1);
  }
}
