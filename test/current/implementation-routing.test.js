import test from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { send, spawn } from '../../lib/execution.js';
import { readSession, withSession } from '../../lib/session-store.js';
import { fixture, plan, section, label, planDone, markDone, markUserSkip } from './fixtures.js';

const owner = label(1);
const implement = owner + ':implement';
const standard = { subagent: 'fake', model: 'configured-standard' };
const large = { subagent: 'fake', model: 'configured-large' };
const task = (node, extra = {}) => ({ node, assignment: 'bounded owner implementation', route: standard, ...extra });
async function setup(t, text = plan().replaceAll('impl_large', 'impl_std')) {
  const f = await fixture(text);
  t.after(() => rm(f.repo, { recursive: true, force: true }));
  await f.compile(); await planDone(f); return f;
}
async function dispatchAndWait(f, entry) {
  const dispatched = await f.spawn([entry]); assert.equal(dispatched.ok, true);
  const id = dispatched.agent_ids[0]; assert.equal((await f.wait(id)).complete, true);
  return { id, dispatched };
}

test('std repairs spawn large once and reuse its exact session through spawn and send entry points', async (t) => {
  const f = await setup(t);
  const original = await dispatchAndWait(f, task(implement));
  const first = await dispatchAndWait(f, task(implement, { purpose: 'repair', route: large }));
  assert.notEqual(first.id, original.id);
  assert.equal(first.dispatched.operations[0].action, 'spawn');
  assert.equal(first.dispatched.operations[0].role, 'impl_large');
  const fresh = await f.state();
  for (const actor of Object.values(fresh.actors)) {
    assert.equal(Object.hasOwn(actor, 'originNode'), false);
    assert.equal(Object.hasOwn(actor, 'ordinal'), false);
    assert.equal(typeof actor.createdAt, 'number');
    assert.ok(actor.rounds[0].node);
  }
  for (const group of Object.values(fresh.groups)) assert.equal(Object.hasOwn(group, 'dispatchComplete'), false);
  // Existing records may still contain these fields; do not migrate or depend on them.
  await withSession(f.repo, f.session, async state => {
    Object.assign(state.actors[first.id], { originNode: implement, ordinal: 1 });
    state.groups[first.dispatched.groupId].dispatchComplete = false;
  });
  const second = await dispatchAndWait(f, task(implement, { purpose: 'repair', route: standard }));
  assert.equal(second.id, first.id);
  assert.equal(second.dispatched.operations[0].action, 'send');
  const third = await send(f.repo, f.session, { agent_id: original.id, content: 'another admitted repair', route: standard }, f.rpc);
  assert.equal(third.ok, true);
  assert.equal(third.requested_actor_id, original.id);
  assert.equal(third.actor_id, first.id);
  await f.wait(third.actor_id);
  const state = await f.state();
  assert.deepEqual(state.implementationCycles[owner], { original: original.id, repair: first.id, repairRoute: { ...large, permission_mode: 'yolo' } });
  assert.equal(state.actors[original.id].rounds.length, 1);
  assert.equal(state.actors[first.id].rounds.length, 3);
  assert.equal(state.actors[first.id].originNode, implement);
  assert.equal(state.actors[first.id].ordinal, 1);
  assert.equal(state.groups[first.dispatched.groupId].dispatchComplete, false);
  assert.equal(Object.hasOwn(state.groups[second.dispatched.groupId], 'dispatchComplete'), false);
  assert.equal(Object.hasOwn(state.groups[third.groupId], 'dispatchComplete'), false);
  const latest = state.actors[first.id].rounds.at(-1);
  assert.equal(latest.receipt.message_id, latest.messageId);
  assert.ok(latest.pages.length > 0);
  const implementationSpawns = f.calls.filter((item) => item.command === 'spawn' && item.args.prompt.includes('logical role: impl_'));
  assert.deepEqual(implementationSpawns.map((item) => item.args.model), [standard.model, large.model]);
  const sentIds = f.calls.filter((item) => item.command === 'send').map((item) => String(item.args.agent_id));
  assert.deepEqual(sentIds, [first.id, first.id]);
});

test('large repairs always return to the original actor without spawning another implementer', async (t) => {
  const f = await setup(t, plan());
  const original = await dispatchAndWait(f, task(implement, { route: large }));
  const first = await dispatchAndWait(f, task(implement, { purpose: 'repair', route: standard }));
  const second = await send(f.repo, f.session, { agent_id: original.id, content: 'repair again' }, f.rpc);
  assert.equal(first.id, original.id);
  assert.equal(second.actor_id, original.id);
  assert.equal(first.dispatched.operations[0].action, 'send');
  assert.equal(f.calls.filter((item) => item.command === 'spawn').length, 3);
  await f.wait(second.actor_id);
  assert.equal((await f.state()).actors[original.id].rounds.length, 3);
});

test('first std repair through send can spawn large from a saved route and reports the actual actor ID', async (t) => {
  const f = await setup(t);
  const original = await dispatchAndWait(f, task(implement, { repair_route: large }));
  const repaired = await f.send(original.id, implement, 'repair the standard implementation');
  assert.equal(repaired.ok, true);
  assert.notEqual(repaired.actor_id, original.id);
  assert.equal(repaired.operations[0].action, 'spawn');
  assert.equal(f.calls.at(-1).args.model, large.model);
  assert.equal((await f.state()).actors[repaired.actor_id].role, 'impl_large');
});

test('a new implementation starts a new cycle and never inherits the prior escalated repair actor', async (t) => {
  const f = await setup(t);
  const original = await dispatchAndWait(f, task(implement, { repair_route: large }));
  const oldRepair = await dispatchAndWait(f, task(implement, { purpose: 'repair' }));
  const next = await dispatchAndWait(f, task(implement, { purpose: 'implementation', repair_route: large }));
  const nextRepair = await dispatchAndWait(f, task(implement, { purpose: 'repair' }));
  assert.notEqual(next.id, original.id);
  assert.notEqual(nextRepair.id, oldRepair.id);
  assert.equal((await f.state()).implementationCycles[owner].original, next.id);
  assert.equal((await f.state()).implementationCycles[owner].repair, nextRepair.id);
  assert.ok((await f.state()).actors[oldRepair.id]);
});

test('explicit new implementation through send resets the cycle before its next repair', async (t) => {
  const f = await setup(t);
  const original = await dispatchAndWait(f, task(implement, { repair_route: large }));
  const oldRepair = await dispatchAndWait(f, task(implement, { purpose: 'repair' }));
  const next = await send(f.repo, f.session, { agent_id: original.id, content: 'new implementation increment', purpose: 'implementation', repair_route: large }, f.rpc);
  assert.equal(next.ok, true); await f.wait(next.actor_id);
  assert.equal((await f.state()).implementationCycles[owner].repair, null);
  const repair = await dispatchAndWait(f, task(implement, { purpose: 'repair' }));
  assert.notEqual(repair.id, oldRepair.id);
});

test('missing large route or original implementation is actionable and makes no dispatch', async (t) => {
  const f = await setup(t);
  const before = f.calls.length;
  await assert.rejects(() => f.spawn([task(implement, { purpose: 'repair', route: large })]), (error) => error.code === 'IMPL_CYCLE_MISSING');
  assert.equal(f.calls.length, before);
  const original = await dispatchAndWait(f, task(implement));
  const after = f.calls.length;
  await assert.rejects(() => f.send(original.id, implement, 'repair without configured large route'), (error) => error.code === 'IMPL_ROUTE_REQUIRED' && /impl_large/.test(error.instruction));
  assert.equal(f.calls.length, after);
  const fixed = await send(f.repo, f.session, { agent_id: original.id, content: 'repair with configured large route', route: large }, f.rpc);
  assert.equal(fixed.ok, true);
  assert.notEqual(fixed.actor_id, original.id);
});

test('child owning units keep separate repair cycles even inside the same Section', async (t) => {
  const f = await setup(t, ('# Plan\n\n' + section(1, { children: true })).replaceAll('impl_large', 'impl_std'));
  const child = owner + '.A'; const consumer = owner + '.B';
  const producer = await dispatchAndWait(f, task(child + ':implement')); await markDone(f, child + ':implement', producer.id, 1);
  await markUserSkip(f, child + ':checkpoint');
  const next = await dispatchAndWait(f, task(consumer + ':implement'));
  const graph = await f.graph();
  graph.nodes['repair-producer'] = { id: 'repair-producer', kind: 'implementation', role: 'impl_large', purpose: 'repair', unit: child, section: owner, feature: 'business', mandatory: false, status: 'pending', needs: ['plan:final'] };
  await f.save(graph);
  const repairedProducer = await dispatchAndWait(f, task('repair-producer', { route: large }));
  const repairedConsumer = await dispatchAndWait(f, task(consumer + ':implement', { purpose: 'repair', route: large }));
  assert.notEqual(repairedProducer.id, repairedConsumer.id);
  const cycles = (await f.state()).implementationCycles;
  assert.equal(cycles[child].original, producer.id);
  assert.equal(cycles[consumer].original, next.id);
  assert.equal(cycles[child].repair, repairedProducer.id);
  assert.equal(cycles[consumer].repair, repairedConsumer.id);
});

test('uncertain repair send preserves the selected actor and cannot silently start a replacement', async (t) => {
  const f = await setup(t);
  await dispatchAndWait(f, task(implement, { repair_route: large }));
  const repair = await dispatchAndWait(f, task(implement, { purpose: 'repair' }));
  const rpc = async (command, args) => {
    if (command === 'send') throw new Error('lost receipt');
    return f.rpc(command, args);
  };
  const failed = await spawn(f.repo, f.session, { tasks: [task(implement, { purpose: 'repair' })] }, rpc);
  assert.equal(failed.ok, false);
  assert.equal(failed.agent_ids[0], repair.id);
  const state = await f.state();
  assert.equal(state.actors[repair.id].rounds.at(-1).unresolved, true);
  assert.equal(state.implementationCycles[owner].repair, repair.id);
  await assert.rejects(() => f.spawn([task(implement, { purpose: 'repair', route: large })]), /live|wait/);
});

test('an unknown first repair spawn blocks duplicates until its actual outcome is reconciled', async (t) => {
  const f = await setup(t);
  await dispatchAndWait(f, task(implement, { repair_route: large }));
  const rpc = async () => { throw new Error('spawn receipt lost'); };
  const failed = await spawn(f.repo, f.session, { tasks: [task(implement, { purpose: 'repair' })] }, rpc);
  assert.equal(failed.ok, false);
  assert.deepEqual(failed.agent_ids, []);
  await assert.rejects(() => f.spawn([task(implement, { purpose: 'repair', route: large })]), (error) => error.code === 'IMPL_DISPATCH_UNCERTAIN' && /actual ES task identity/.test(error.instruction));
  await withSession(f.repo, f.session, async state => { state.groups[failed.groupId].operations[0].state = 'pending'; });
  await assert.rejects(() => f.spawn([task(implement, { purpose: 'repair', route: large })]), (error) => error.code === 'IMPL_DISPATCH_UNCERTAIN');
});

test('a definitively rejected new implementation send does not end the prior repair cycle', async (t) => {
  const f = await setup(t);
  const original = await dispatchAndWait(f, task(implement, { repair_route: large }));
  const repair = await dispatchAndWait(f, task(implement, { purpose: 'repair' }));
  const rpc = async (command, args) => {
    if (command === 'send') { const error = new Error('cannot resume'); error.code = 'TERMINAL_SEND_UNSUPPORTED'; throw error; }
    return f.rpc(command, args);
  };
  const failed = await send(f.repo, f.session, { agent_id: original.id, content: 'new implementation', purpose: 'implementation' }, rpc);
  assert.equal(failed.ok, false);
  assert.equal((await f.state()).implementationCycles[owner].repair, repair.id);
  assert.match(failed.instruction, /previous repair cycle is preserved/);
  assert.match(failed.instruction, /sfd_subagent_spawn with purpose=implementation/);
});

test('known actor IDs and cycle choices are checkpointed before the next irreversible batch call', async (t) => {
  const f = await setup(t);
  const rpc = async (command, args) => {
    if (command === 'send') {
      const durable = await readSession(f.repo, f.session);
      const actor = durable.actors[String(args.agent_id)];
      assert.equal(actor.rounds.at(-1).messageId, args.message_id);
      assert.equal(durable.implementationCycles[owner].repair, actor.id);
    }
    return f.rpc(command, args);
  };
  const original = await dispatchAndWait(f, task(implement, { repair_route: large }));
  const repaired = await send(f.repo, f.session, { agent_id: original.id, content: 'first repair' }, rpc);
  await f.wait(repaired.actor_id);
  const continued = await send(f.repo, f.session, { agent_id: original.id, content: 'later repair' }, rpc);
  assert.equal(continued.ok, true);
});
