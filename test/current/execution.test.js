import test from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { fixture, plan, section, planDone, spawnWaitDone, markDone, markMain } from './fixtures.js';

const cleanup = async (f) => rm(f.repo, { recursive: true, force: true });
const route = { subagent: 'fake', model: 'caller/model' };
const task = (node) => ({ node, assignment: 'bounded assignment', route });

async function addCustomReview(f, id, needs, role = 'specialist-review') {
  const graph = await f.graph();
  graph.nodes[id] = { id, kind: 'review', role, needs, mandatory: false, status: 'pending', evidence: null, note: '' };
  await f.save(graph);
}

test('multi spawn/wait holds result instructions until every batch peer ends; progress is not auto-marked', async () => {
  const f = await fixture();
  try {
    await f.compile();
    await planDone(f);
    const impl = await spawnWaitDone(f, 'S01:implement');
    await markDone(f, 'S01:implement', impl.id, 1);
    const behavior = await spawnWaitDone(f, 'S01:behavior');
    await markDone(f, 'S01:behavior', behavior.id, 1);
    await markMain(f, 'S01:risk');
    await addCustomReview(f, 'custom-a', ['S01:behavior']);
    await addCustomReview(f, 'custom-b', ['S01:behavior']);
    const response = await f.spawn([task('custom-a'), task('custom-b')]);
    assert.equal(response.ok, true);
    assert.equal(response.agent_ids.length, 2);
    const [first, second] = response.agent_ids;
    f.tasks.get(second).status = 'running';
    let waited = await f.wait(first);
    assert.deepEqual(waited.remaining_ids, [second]);
    assert.deepEqual(waited.instructions, []);
    assert.match(waited.instruction.instruction, /Continue waiting/);
    f.tasks.get(second).status = 'completed';
    waited = await f.wait(response.agent_ids);
    assert.equal(waited.complete, true);
    assert.ok(waited.instructions.length >= 1);
    const graph = await f.graph();
    assert.equal(graph.nodes['custom-a'].status, 'pending');
    assert.equal(graph.nodes['custom-b'].status, 'pending');
  } finally { await cleanup(f); }
});

test('partial spawn preserves actual IDs and never retries or auto-cancels', async () => {
  const f = await fixture();
  try {
    await f.compile();
    await planDone(f);
    await addCustomReview(f, 'custom-a', ['plan:final']);
    await addCustomReview(f, 'custom-b', ['plan:final']);
    let count = 0;
    const { spawn } = await import('../../lib/execution.js');
    const rpc = async (command, args) => {
      if (command === 'spawn' && ++count === 2) throw new Error('transport lost after dispatch');
      return f.rpc(command, args);
    };
    const partial = await spawn(f.repo, f.session, { tasks: [task('custom-a'), task('custom-b')] }, rpc);
    assert.equal(partial.ok, false);
    assert.equal(partial.agent_ids.length, 1);
    assert.equal(partial.failures[0].node, 'custom-b');
    assert.equal(partial.failures[0].dispatchUncertain, true);
    assert.equal(f.calls.some((call) => call.command === 'cancel'), false);
    const known = partial.agent_ids[0];
    await f.wait(known);
    await markDone(f, 'custom-a', known, 1);
    assert.equal((await f.graph()).nodes['custom-a'].status, 'done');
    assert.equal((await f.graph()).nodes['custom-b'].status, 'pending');
  } finally { await cleanup(f); }
});

test('continuation keeps the owning implementation unit and rejects blind/plan first-pass reuse', async () => {
  const f = await fixture('# Plan\n\n' + section(1, { children: true }));
  try {
    await f.compile();
    await planDone(f);
    const child = await spawnWaitDone(f, 'S01.A:implement');
    await markDone(f, 'S01.A:implement', child.id, 1);
    const checkpoint = await spawnWaitDone(f, 'S01.A:checkpoint');
    await markDone(f, 'S01.A:checkpoint', checkpoint.id, 1);
    await assert.rejects(
      () => f.send(child.id, 'S01.B:implement', 'do the wrong child'),
      /owning unit/,
    );
  } finally { await cleanup(f); }

  const planTest = await fixture();
  try {
    await planTest.compile();
    const planA = await spawnWaitDone(planTest, 'plan:initial');
    await markDone(planTest, 'plan:initial', planA.id, 1);
    await assert.rejects(
      () => planTest.send(planA.id, 'plan:final', 'pretend to be independent Plan B'),
      /first-pass plan review requires a fresh spawn/,
    );
  } finally { await cleanup(planTest); }

  const blindTest = await fixture();
  try {
    await blindTest.compile();
    await planDone(blindTest);
    const impl = await spawnWaitDone(blindTest, 'S01:implement');
    await markDone(blindTest, 'S01:implement', impl.id, 1);
    const behavior = await spawnWaitDone(blindTest, 'S01:behavior');
    await markDone(blindTest, 'S01:behavior', behavior.id, 1);
    await markMain(blindTest, 'S01:risk');
    const blind = await spawnWaitDone(blindTest, 'S01:blind');
    await assert.rejects(
      () => blindTest.send(blind.id, 'S01:blind', 'reuse blind session for a new first pass'),
      /fresh spawn/,
    );
  } finally { await cleanup(blindTest); }
});

test('cancel and observe never mark graph progress', async () => {
  const f = await fixture();
  try {
    await f.compile();
    const spawned = await f.spawn([task('plan:initial')]);
    const id = spawned.agent_ids[0];
    f.tasks.get(id).status = 'running';
    const observation = await f.observe(id);
    assert.equal(observation.ok, true);
    const cancellation = await f.cancel(id);
    assert.equal(cancellation.ok, true);
    await f.wait(id);
    const graph = await f.graph();
    assert.equal(graph.nodes['plan:initial'].status, 'pending');
    assert.equal(graph.nodes['plan:initial'].evidence, null);
  } finally { await cleanup(f); }
});
test('a custom same-head B2 node can continue the frozen B1 session', async () => {
  const f = await fixture();
  try {
    await f.compile();
    await planDone(f);
    const impl = await spawnWaitDone(f, 'S01:implement');
    await markDone(f, 'S01:implement', impl.id, 1);
    const behavior = await spawnWaitDone(f, 'S01:behavior');
    await markDone(f, 'S01:behavior', behavior.id, 1);
    await markMain(f, 'S01:risk');
    const blind = await spawnWaitDone(f, 'S01:blind');
    await markDone(f, 'S01:blind', blind.id, 1);
    const graph = await f.graph();
    graph.nodes['custom-b2'] = { id: 'custom-b2', kind: 'review', role: 'final-review', needs: ['S01:blind'], unit: 'S01', section: 'S01', feature: 'business', mandatory: false, status: 'pending', evidence: null, note: '' };
    graph.nodes['S01:reconciliation'].needs.push('custom-b2');
    await f.save(graph);
    const sent = await f.send(blind.id, 'custom-b2', 'Reconcile repair impact on the same head');
    assert.equal(sent.actor_id, blind.id);
    assert.equal(sent.round, 2);
    await f.wait(blind.id);
    await markDone(f, 'custom-b2', blind.id, 2);
    await markMain(f, 'S01:reconciliation');
    await markMain(f, 'S01:accept');
  } finally { await cleanup(f); }
});