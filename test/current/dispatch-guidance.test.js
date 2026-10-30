import test from 'node:test';
import assert from 'node:assert/strict';
import { rm, readFile } from 'node:fs/promises';
import { compilePlan } from '../../lib/compiler.js';
import { validateGraph } from '../../lib/graph-store.js';
import { fixture, plan, section, label, planDone, spawnWaitDone, markDone, markMain, markUserSkip } from './fixtures.js';

const owner = label(1);
const id = suffix => owner + ':' + suffix;
const task = node => ({ node, assignment: 'bounded current obligation', route: { subagent: 'fake', model: 'configured-reviewer' } });
async function setup(t, text) {
  const f = await fixture(text); t.after(() => rm(f.repo, { recursive: true, force: true })); await f.compile(); return f;
}
async function validate(f) { return validateGraph(await f.graph(), compilePlan(await readFile(f.repo + '/.agent-work/PLAN-FULL.md', 'utf8')), await f.state()); }
async function baseline(f) {
  await planDone(f);
  const impl = await spawnWaitDone(f, id('implement')); await markDone(f, id('implement'), impl.id, 1);
  const review = await spawnWaitDone(f, id('behavior')); await markDone(f, id('behavior'), review.id, 1);
  return { impl, review };
}

test('arbitrary review, implementation and Main process steps share one skip mechanism', async (t) => {
  const f = await setup(t);
  await markUserSkip(f, id('risk'));
  await assert.rejects(() => f.spawn([task(id('blind'))]), /behavior/);
  for (const node of ['plan:initial', 'plan:final', id('implement'), id('behavior')]) await markUserSkip(f, node);
  await validate(f);
  const review = await f.spawn([task(id('blind'))]);
  assert.equal(review.ok, true);
  assert.equal(f.calls.filter(call => call.command === 'spawn').length, 1);
  const next = (await f.compile()).navigation;
  assert.equal(next.skipped.length, 5);
  assert.ok(!next.next.some(item => next.skipped.some(skip => skip.node === item.node)));
});

test('removing implementation scope requires PLAN-FULL and compile rather than graph-only removal', async (t) => {
  const f = await setup(t, plan(2));
  const removed = label(2);
  const g = await f.graph();
  for (const node of Object.values(g.nodes).filter(item => item.section === removed)) delete g.nodes[node.id];
  g.nodes['business:accept'].needs = [id('accept')];
  await f.save(g);
  await assert.rejects(() => f.spawn([task('plan:initial')]), /required node/);
  await f.setPlan(plan());
  await assert.rejects(() => f.spawn([task('plan:initial')]), /PLAN-FULL changed/);
  const compiled = await f.compile();
  assert.equal(compiled.reconciled, false);
  assert.ok(!Object.values(compiled.graph.nodes).some(item => item.section === removed));
  assert.match(compiled.instruction, /edit PLAN-FULL first/);
  compiled.graph.reconciled = true; await f.save(compiled.graph);
  assert.equal((await f.spawn([task('plan:initial')])).ok, true);
});

test('fresh review spawn and Main-selected send are not inferred from custom names, roles or former scopes', async (t) => {
  const f = await setup(t); const { review } = await baseline(f);
  await markMain(f, id('risk'));
  const blind = await spawnWaitDone(f, id('blind')); await markDone(f, id('blind'), blind.id, 1);
  const g = await f.graph();
  for (const name of ['independent-discovery', 'integration-check']) {
    g.nodes[name] = { id: name, kind: 'review', role: name === 'independent-discovery' ? 'final-review' : 'integration-review',
      section: null, feature: 'business', mandatory: false, status: 'pending', needs: [id('blind')] };
  }
  await f.save(g);
  const fresh = await f.spawn([task('independent-discovery')]);
  assert.equal(fresh.ok, true); assert.notEqual(fresh.agent_ids[0], blind.id); await f.wait(fresh.agent_ids[0]);
  const selected = await f.send(review.id, 'integration-check', 'Main selected this known review context');
  assert.equal(selected.ok, true); assert.equal(selected.actor_id, review.id);
  const actual = f.calls.filter(call => call.command === 'send').at(-1);
  assert.equal(String(actual.args.agent_id), review.id);
});

test('one physical final checkpoint report can explicitly support cumulative parent reconciliation', async (t) => {
  const f = await setup(t, '# Plan\n\n' + section(1, { children: true })); await planDone(f);
  const child = owner + '.A'; const finalChild = owner + '.B';
  const first = await spawnWaitDone(f, child + ':implement'); await markDone(f, child + ':implement', first.id, 1);
  const reviewer = await spawnWaitDone(f, child + ':checkpoint'); await markDone(f, child + ':checkpoint', reviewer.id, 1);
  const last = await spawnWaitDone(f, finalChild + ':implement'); await markDone(f, finalChild + ':implement', last.id, 1);
  const sent = await f.send(reviewer.id, finalChild + ':checkpoint', 'Author both final child checkpoint and cumulative reconciliation conclusions');
  assert.equal(sent.ok, true); await f.wait(reviewer.id);
  await markDone(f, finalChild + ':checkpoint', reviewer.id, 2, 'joint-authored-report');
  await markDone(f, id('reconcile'), reviewer.id, 2, 'joint-authored-report');
  await assert.rejects(() => validate(f), /separately authored conclusion/);
  const g = await f.graph();
  g.nodes[id('reconcile')].evidence.conclusion = 'Cumulative child coverage, joint oracles, consumers and admitted closures verified';
  await f.save(g); await validate(f);
  assert.equal((await f.state()).actors[reviewer.id].rounds.length, 2);
  const next = (await f.compile()).navigation.next.find(item => item.node === id('behavior'));
  assert.equal(next.purpose, 'section-a-confirmation');
  assert.match(next.instruction, /complete current Section behavior baseline/);
  // A reviewer report must never stand in for a writer's implementation evidence.
  const invalid = await f.graph();
  invalid.nodes[finalChild + ':implement'].evidence = { actor_id: reviewer.id, round: 2, report: 'joint-authored-report', conclusion: 'pretend implementation' };
  const base = compilePlan(await readFile(f.repo + '/.agent-work/PLAN-FULL.md', 'utf8'));
  const state = await f.state();
  assert.throws(() => validateGraph(invalid, base, state), /different task kind/);
});

test('actual ready Main actions describe risk, repair reconciliation, Section, Feature and delivery checks', async (t) => {
  const f = await setup(t); const { review } = await baseline(f);
  const handoff = review.waited.instructions[0].successors.find(item => item.node === id('risk'));
  assert.match(handoff.next.instruction, /specialist review nodes/);
  let next = (await f.compile()).navigation.next.find(item => item.node === id('risk'));
  assert.match(next.instruction, /Freeze.*source\/test\/config/);
  assert.match(next.instruction, /specialist review nodes/);
  await markMain(f, id('risk')); await markUserSkip(f, id('blind'));
  next = (await f.compile()).navigation.next.find(item => item.node === id('reconciliation'));
  assert.match(next.instruction, /same-head B2/);
  assert.match(next.instruction, /without an empty review call/);
  await markMain(f, id('reconciliation'));
  next = (await f.compile()).navigation.next.find(item => item.node === id('accept'));
  assert.match(next.instruction, /finding closure.*test outputs.*producer integration/);
  await markMain(f, id('accept'));
  next = (await f.compile()).navigation.next.find(item => item.node === 'business:accept');
  assert.match(next.instruction, /Feature journey.*composition/);
  assert.match(next.instruction, /residual composition gaps/);
  await markMain(f, 'business:accept');
  next = (await f.compile()).navigation.next.find(item => item.node === 'delivery');
  assert.match(next.instruction, /final candidate/);
  assert.match(next.instruction, /close owned actors and archive/);
});

test('successful reports first request inspection and recording instead of redispatching the same pending node', async (t) => {
  const f = await setup(t);
  const current = await spawnWaitDone(f, 'plan:initial');
  const returned = current.waited;
  assert.match(returned.instruction, /Read and record the returned authored reports/);
  assert.doesNotMatch(returned.instruction, /Next ready actions:.*plan:initial/);
  assert.equal(returned.instructions[0].report_action.action, 'inspect-and-record-report');
  assert.equal(returned.instructions[0].report_action.agent_id, current.id);
  assert.equal(returned.instructions[0].report_action.round, 1);
  assert.ok(returned.instructions[0].successors.some(item => item.node === 'plan:final' && item.next.action === 'choose-review-dispatch'));
});
