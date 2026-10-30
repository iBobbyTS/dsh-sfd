import test from 'node:test';
import assert from 'node:assert/strict';
import { rm, readFile } from 'node:fs/promises';
import { compilePlan } from '../../lib/compiler.js';
import { validateGraph, reopenRecovery } from '../../lib/graph-store.js';
import { navigation, workflowNavigation } from '../../lib/guidance.js';
import { send, respond } from '../../lib/execution.js';
import { registerWorkflowTools } from '../../lib/workflow-tools.js';
import { createEsTransport } from '../../lib/es-cli.js';
import { fixture, plan, section, label, planDone, markDone, markMain, markUserSkip, spawnWaitDone } from './fixtures.js';

const owner = label(1);
const node = (suffix) => owner + ':' + suffix;
const task = (id, extra = {}) => ({ node: id, assignment: 'complete current contract and closure scope', route: { subagent: 'fake', model: 'caller/model' }, ...extra });
async function setup(t, text) {
  const f = await fixture(text);
  t.after(() => rm(f.repo, { recursive: true, force: true }));
  await f.compile();
  return f;
}
function toolsFor(f) {
  const definitions = new Map();
  registerWorkflowTools({ tools: { register: (tool) => definitions.set(tool.name, tool) }, workingDirectory: { ensure: async () => f.repo } }, { es: f.rpc });
  const exec = { agent: { session: { id: f.session } }, signal: new AbortController().signal };
  return { definitions, call: (name, args) => definitions.get(name).execute(args, exec) };
}
async function baseFor(f) { return compilePlan(await readFile(f.repo + '/.agent-work/PLAN-FULL.md', 'utf8')); }
async function completeOwner(f) {
  await planDone(f);
  const implementation = await spawnWaitDone(f, node('implement'));
  await markDone(f, node('implement'), implementation.id, 1);
  const behavior = await spawnWaitDone(f, node('behavior'));
  await markDone(f, node('behavior'), behavior.id, 1);
  await markMain(f, node('risk'));
  await markUserSkip(f, node('blind'));
  for (const id of [node('reconciliation'), node('accept'), 'business:accept', 'delivery']) await markMain(f, id);
  return { implementation, behavior };
}

test('all future review waivers can be recorded before planning without releasing implementation early', async (t) => {
  const f = await setup(t, plan(2));
  const g = await f.graph();
  const blind = Object.values(g.nodes).filter((item) => item.id.endsWith(':blind'));
  for (const item of blind) { item.status = 'skipped_by_user'; item.evidence = { user_source: 'current user request', reason: 'skip every blind review' }; }
  await f.save(g);
  validateGraph(g, await baseFor(f), await f.state());
  assert.ok(!workflowNavigation(g, await f.state()).next.some((item) => item.node.endsWith(':reconciliation')));
  await assert.rejects(() => f.spawn([task(node('implement'))]), /plan:final/);
  await planDone(f);
  assert.equal((await f.spawn([task(node('implement'))])).ok, true);
  assert.deepEqual((await f.compile()).navigation.skipped.map((item) => item.node), blind.map((item) => item.id));
  const invalid = await f.graph(); invalid.nodes[blind[0].id].evidence = { reason: 'no user source' };
  const base = await baseFor(f); const state = await f.state();
  assert.throws(() => validateGraph(invalid, base, state), /user_source/);
});

test('reopening completed work returns every completed descendant, preserves waivers and can resume after one edit', async (t) => {
  const f = await setup(t);
  const { implementation } = await completeOwner(f);
  const api = toolsFor(f);
  const before = await f.graph();
  const closed = await api.call('sfd_subagent_send', { agent_id: implementation.id, node: node('implement'), content: 'change the implementation' });
  assert.equal(closed.code, 'NODE_REOPEN_REQUIRED');
  assert.ok(closed.recovery.reset_nodes.includes('delivery'));
  assert.ok(closed.recovery.reset_nodes.includes(node('implement')));
  assert.ok(closed.recovery.preserve_skips.includes(node('blind')));
  assert.deepEqual(await f.graph(), before);
  const g = await f.graph(); g.nodes[node('implement')].status = 'pending'; g.nodes[node('implement')].evidence = null; await f.save(g);
  const blocked = await api.call('sfd_subagent_send', { agent_id: implementation.id, content: 'change the implementation' });
  assert.equal(blocked.code, 'GRAPH_REOPEN_REQUIRED');
  assert.deepEqual(new Set(blocked.recovery.reset_nodes), new Set([node('behavior'), node('risk'), node('reconciliation'), node('accept'), 'business:accept', 'delivery']));
  assert.match(blocked.instruction, /status=pending and evidence=null/);
  for (const id of blocked.recovery.reset_nodes) { g.nodes[id].status = 'pending'; g.nodes[id].evidence = null; }
  await f.save(g);
  const reopened = (await f.compile()).navigation.next.find((item) => item.node === node('implement'));
  assert.equal(reopened.action, 'dispatch-implementation');
  assert.equal(reopened.repair.agent_id, implementation.id);
  assert.match(reopened.instruction, /program selects the cycle repair actor/);
  assert.equal((await f.send(implementation.id, node('implement'), 'change the implementation')).ok, true);
  assert.equal((await f.graph()).nodes[node('blind')].status, 'skipped_by_user');
});

test('reopen traversal includes transitive dependents and custom gates without touching an independent owner', async (t) => {
  const f = await setup(t, plan(2));
  const g = await f.graph();
  const custom = 'consumer-check';
  g.nodes[custom] = { id: custom, kind: 'main', mandatory: false, needs: [node('accept')], status: 'done', evidence: { reason: 'checked' } };
  g.nodes['delivery'].needs.push(custom); g.nodes['delivery'].status = 'done';
  g.nodes[label(2) + ':accept'].status = 'done';
  const recovery = reopenRecovery(g, [node('implement')]);
  assert.ok(recovery.reset_nodes.includes(custom));
  assert.ok(recovery.reset_nodes.includes('delivery'));
  assert.ok(!recovery.reset_nodes.includes(label(2) + ':accept'));
});

test('unavailable reviewers can be freshly spawned without replacement declarations and old actors remain selectable', async (t) => {
  const f = await setup(t);
  const prior = await spawnWaitDone(f, 'plan:initial');
  const rpc = async (command, args) => {
    if (command === 'send') { const error = new Error('cannot continue'); error.code = 'TERMINAL_SEND_UNSUPPORTED'; throw error; }
    return f.rpc(command, args);
  };
  const failed = await send(f.repo, f.session, { agent_id: prior.id, node: 'plan:initial', content: 'recheck changes' }, rpc);
  assert.equal(failed.ok, false);
  assert.match(failed.instruction, /No replacement declaration/);
  const fresh = await f.spawn([task('plan:initial')]);
  const id = fresh.agent_ids[0];
  assert.notEqual(id, prior.id);
  await f.wait(id);
  const state = await f.state();
  assert.equal(state.actors[prior.id].rounds.length, 2);
  const next = workflowNavigation(await f.graph(), state).next.find((item) => item.node === 'plan:initial');
  assert.equal(next.action, 'choose-review-dispatch');
  assert.deepEqual(new Set(next.actor_candidates.map((item) => item.agent_id)), new Set([prior.id, id]));
  assert.equal((await f.send(prior.id, 'plan:initial', 'Main retries its selected original reviewer')).ok, true);
});

test('dynamic reviewer decisions retain live-work protection but do not require reviewer identity continuity', async (t) => {
  const f = await setup(t);
  const first = await f.spawn([task('plan:initial')]);
  await assert.rejects(() => f.spawn([task('plan:initial')]), /live/);
  await f.wait(first.agent_ids[0]);
  const fresh = await f.spawn([task('plan:initial')]);
  assert.notEqual(fresh.agent_ids[0], first.agent_ids[0]);
  await f.wait(fresh.agent_ids[0]);
  await markDone(f, 'plan:initial', fresh.agent_ids[0], 1);
  assert.equal((await f.send(first.agent_ids[0], 'plan:final', 'Main-selected plan reviewer')).ok, true);
});

test('checkpoint reviewers can be freshly spawned after cancellation or selected for later checkpoints', async (t) => {
  const f = await setup(t, '# Plan\n\n' + section(1, { children: true }));
  await planDone(f);
  const child = owner + '.A'; const nextChild = owner + '.B';
  const impl = await spawnWaitDone(f, child + ':implement'); await markDone(f, child + ':implement', impl.id, 1);
  const review = await f.spawn([task(child + ':checkpoint')]); const prior = review.agent_ids[0];
  await f.cancel(prior); await f.wait(prior);
  const fresh = await f.spawn([task(child + ':checkpoint')]);
  const id = fresh.agent_ids[0]; await f.wait(id); await markDone(f, child + ':checkpoint', id, 1);
  const laterImpl = await spawnWaitDone(f, nextChild + ':implement'); await markDone(f, nextChild + ':implement', laterImpl.id, 1);
  const next = workflowNavigation(await f.graph(), await f.state()).next.find((item) => item.node === nextChild + ':checkpoint');
  assert.equal(next.action, 'choose-review-dispatch');
  assert.ok(next.actor_candidates.some((item) => item.agent_id === id));
  assert.equal((await f.send(id, nextChild + ':checkpoint', 'review the next bounded increment')).ok, true);
});

test('navigation acknowledges waived reviews instead of restoring default mandatory reminders', async (t) => {
  const f = await setup(t);
  await markUserSkip(f, 'plan:final'); await markUserSkip(f, node('blind'));
  const g = await f.graph(); const state = await f.state();
  for (const suffix of ['behavior', 'risk', 'reconcile']) {
    const current = g.nodes[node(suffix)] ?? { id: node(suffix), kind: 'review', role: 'behavior-review', section: owner, needs: [] };
    const text = navigation(current, { id: '10000001', node: current.id, rounds: [{ number: 1, node: current.id }] }, g, state).instruction;
    assert.match(text, /User-authorized skipped nodes/);
    assert.ok(text.includes(node('blind')));
    assert.doesNotMatch(text, /Code B.*mandatory|Code B still apply/);
  }
  const compiled = await f.compile();
  assert.ok(compiled.instruction.includes('plan:final'));
  assert.ok(!compiled.navigation.next.some((item) => item.node === 'plan:final'));
});

test('plan changes produce compile and reconciliation instructions without blocking request handling', async (t) => {
  const f = await setup(t);
  const api = toolsFor(f);
  const live = await f.spawn([task('plan:initial')]);
  const id = live.agent_ids[0];
  f.tasks.get(id).status = 'running';
  f.tasks.get(id).pending_requests = [{ request_id: 'permission', kind: 'permission' }];
  await f.wait(id);
  await f.setPlan(plan().replace('Foundation', 'Revised contract'));
  assert.equal((await api.call('sfd_subagent_respond', { agent_id: id, request_id: 'permission', decision: 'deny' })).ok, true);
  const blocked = await api.call('sfd_subagent_spawn', { tasks: [task('plan:initial')] });
  assert.match(blocked.instruction, /sfd_workflow_compile/);
  const compiled = await api.call('sfd_workflow_compile', {});
  assert.equal(compiled.reconciled, false);
  const again = await api.call('sfd_subagent_spawn', { tasks: [task('plan:initial')] });
  assert.match(again.instruction + again.error, /reconciled=true/);
});

test('pending questions direct Main to respond and only fresh wait can unblock actor evidence', async (t) => {
  const f = await setup(t); const api = toolsFor(f);
  const spawned = await f.spawn([task('plan:initial')]); const id = spawned.agent_ids[0]; const runtime = f.tasks.get(id);
  runtime.status = 'running'; runtime.pending_requests = [{ request_id: 'question', kind: 'user_input', tool_name: null, operation: 'user_input', summary: null, question: { text: 'Which behavior?', truncated: false } }];
  const waiting = await f.wait(id);
  assert.equal(waiting.instruction.tool, 'sfd_subagent_respond');
  assert.equal(waiting.instruction.requests[0].agent_id, id);
  assert.equal(waiting.instruction.requests[0].question.text, 'Which behavior?');
  const answer = await api.call('sfd_subagent_respond', { agent_id: id, request_id: 'question', decision: 'answer', content: 'Keep the requested behavior' });
  assert.equal(answer.response.effective_decision, 'answer');
  assert.equal(answer.instruction.tool, 'sfd_subagent_wait');
  assert.equal((await f.state()).actors[id].rounds[0].blocked, true);
  assert.equal((await f.graph()).nodes['plan:initial'].status, 'pending');
  runtime.status = 'completed';
  assert.equal((await f.wait(id)).complete, true);
  await markDone(f, 'plan:initial', id, 1);
  assert.equal((await f.spawn([task('plan:final')])).ok, true);
});

test('response validation, permission idempotency and policy overrides preserve authoritative outcomes', async (t) => {
  const f = await setup(t); const api = toolsFor(f);
  const initial = await f.spawn([task('plan:initial')]); const id = initial.agent_ids[0];
  f.tasks.get(id).pending_requests = [{ request_id: 'permission', kind: 'permission' }];
  for (const args of [{ decision: 'answer' }, { decision: 'answer', content: ' ' }, { decision: 'answer', content: 'x'.repeat(16385) }]) {
    assert.equal((await api.call('sfd_subagent_respond', { agent_id: id, request_id: 'permission', ...args })).ok, false);
  }
  await assert.rejects(() => api.call('sfd_subagent_respond', { agent_id: id, request_id: 'permission', decision: 'invalid' }), /decision/);
  await assert.rejects(() => api.call('sfd_subagent_respond', { agent_id: id, request_id: 'permission', decision: 'deny', content: null }), /content/);
  assert.equal(f.calls.filter((call) => call.command === 'respond').length, 0);
  const response = await api.call('sfd_subagent_respond', { agent_id: id, request_id: 'permission', decision: 'deny' });
  assert.equal(response.response.disposition, 'responded');
  assert.ok(!Object.hasOwn(f.calls.at(-1).args, 'content'));
  const repeated = await api.call('sfd_subagent_respond', { agent_id: id, request_id: 'permission', decision: 'allow' });
  assert.equal(repeated.response.disposition, 'already_responded');
  assert.equal(repeated.response.effective_decision, 'deny');
  const policy = { disposition: 'in_flight', requested_decision: 'allow', effective_decision: 'deny', policy_overrode: true, policy_reason_code: 'policy_denied' };
  const rpc = async () => policy;
  const overridden = await respond(f.repo, f.session, { agent_id: id, request_id: 'permission', decision: 'allow' }, rpc);
  assert.deepEqual(overridden.response, policy);
  assert.match(overridden.instruction.instruction, /effective decision: deny/);
});

test('respond transport errors retain pending requests and return a usable instruction', async (t) => {
  const f = await setup(t); const api = toolsFor(f);
  const initial = await f.spawn([task('plan:initial')]); const id = initial.agent_ids[0];
  f.tasks.get(id).pending_requests = [{ request_id: 'permission', kind: 'permission' }];
  await f.wait(id);
  const before = await f.state();
  const failure = await api.call('sfd_subagent_respond', { agent_id: id, request_id: 'missing', decision: 'allow' });
  assert.equal(failure.ok, false); assert.ok(failure.instruction);
  assert.deepEqual(await f.state(), before);
});

test('CLI respond preserves exact payload and policy outcome, rejects ES failure envelopes', async () => {
  const args = { agent_id: 10000001, request_id: 'permission', decision: 'deny' };
  const response = { disposition: 'responded', requested_decision: 'deny', effective_decision: 'deny', policy_overrode: false, policy_reason_code: null };
  let invoked;
  const transport = createEsTransport({ run: async (argv, options) => { invoked = { argv, options }; return JSON.stringify({ ok: true, result: response }); } });
  assert.deepEqual(await transport('respond', args), response);
  assert.deepEqual(invoked.argv, ['respond', '--json', JSON.stringify(args)]);
  assert.equal(invoked.options.timeoutMs, 30000);
  const rejected = createEsTransport({ run: async () => JSON.stringify({ ok: false, error: { code: 'REQUEST_STALE', message: 'request no longer pending' } }) });
  await assert.rejects(() => rejected('respond', args), (error) => error.code === 'REQUEST_STALE');
});
