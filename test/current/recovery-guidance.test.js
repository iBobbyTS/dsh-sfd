import test from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { result } from '../../lib/execution.js';
import { fixture, label, section, planDone, markDone, markUserSkip } from './fixtures.js';

const owner = label(1);
const task = (node) => ({ node, assignment: 'bounded current contract', route: { subagent: 'fake', model: 'caller/model' } });
async function setup(t, text) {
  const f = await fixture(text); t.after(() => rm(f.repo, { recursive: true, force: true }));
  await f.compile(); return f;
}

for (const problem of ['identity', 'pagination', 'transport']) {
  test('wait diagnostics take precedence over waiting after ' + problem + ' errors', async (t) => {
    const f = await setup(t);
    const response = await f.spawn([task('plan:initial')]); const id = response.agent_ids[0];
    const runtime = f.tasks.get(id);
    if (problem === 'identity') runtime.session_id = 'replaced-session';
    if (problem === 'pagination') runtime.next_offset = 2;
    let waited;
    if (problem === 'transport') {
      const { wait } = await import('../../lib/execution.js');
      waited = await wait(f.repo, f.session, { agent_ids: [id], wait_time: 0 }, async () => { throw new Error('transport unavailable'); });
    } else waited = await f.wait(id);
    assert.equal(waited.complete, false);
    assert.equal(waited.instruction.tool, 'sfd_subagent_observe');
    assert.ok(waited.instruction.agent_ids.includes(id));
    assert.match(waited.instruction.instruction, /rather than blindly waiting/);
    assert.equal((await f.graph()).nodes['plan:initial'].status, 'pending');
  });
}

for (const children of [false, true]) {
  test('implementation guidance respects an upfront ' + (children ? 'checkpoint' : 'behavior') + ' waiver', async (t) => {
    const f = await setup(t, '# Plan\n\n' + section(1, { children }));
    await planDone(f);
    const unit = children ? owner + '.A' : owner;
    const waived = unit + (children ? ':checkpoint' : ':behavior');
    await markUserSkip(f, waived);
    const spawned = await f.spawn([task(unit + ':implement')]); const id = spawned.agent_ids[0];
    const waited = await f.wait(id);
    assert.equal(waited.instructions.length, 1);
    const guide = waited.instructions[0];
    assert.ok(guide.skipped.some((item) => item.node === waived));
    assert.match(guide.instruction, /do not reinstate any user-waived/);
    assert.doesNotMatch(guide.instruction, /next required review is Code A|requires its real R01 checkpoint/);
    assert.ok(!guide.next.some((item) => item.node === waived));
    await markDone(f, unit + ':implement', id, 1);
    const next = (await f.compile()).navigation.next;
    assert.ok(next.some((item) => item.node === (children ? owner + '.B:implement' : owner + ':risk')));
  });
}

test('paginated reports direct the next page before any completion or successor guidance', async (t) => {
  const f = await setup(t);
  const spawned = await f.spawn([task('plan:initial')]); const id = spawned.agent_ids[0];
  const offset = Buffer.byteLength('authored report 1'); f.tasks.get(id).next_offset = offset;
  const waited = await f.wait(id);
  assert.equal(waited.instruction.tool, 'sfd_subagent_result');
  assert.equal(waited.instruction.arguments.offset, offset);
  assert.deepEqual(waited.instructions, []);
  const page = await result(f.repo, f.session, { agent_id: id, offset }, f.rpc);
  assert.ok(page.instructions.length);
  assert.equal((await f.graph()).nodes['plan:initial'].status, 'pending');
  await markDone(f, 'plan:initial', id, 1);
  assert.equal((await f.spawn([task('plan:final')])).ok, true);
});

test('failed terminal work gives failure recovery, not successful-report progression', async (t) => {
  const f = await setup(t);
  const spawned = await f.spawn([task('plan:initial')]); const id = spawned.agent_ids[0];
  f.tasks.get(id).status = 'failed'; f.tasks.get(id).outcome = 'FAILED';
  const waited = await f.wait(id);
  assert.match(waited.instruction, /failure\/partial\/empty evidence/);
  assert.deepEqual(waited.instructions, []);
  assert.equal((await f.graph()).nodes['plan:initial'].status, 'pending');
});

test('unavailable repair sessions preserve their cycle and report a capability gap rather than silently spawning', async (t) => {
  const f = await setup(t); await planDone(f);
  const current = owner + ':implement';
  const spawned = await f.spawn([task(current)]); const id = spawned.agent_ids[0]; await f.wait(id);
  const { send } = await import('../../lib/execution.js');
  const rpc = async (command, args) => {
    if (command === 'send') { const error = new Error('cannot resume'); error.code = 'TERMINAL_SEND_UNSUPPORTED'; throw error; }
    return f.rpc(command, args);
  };
  const failed = await send(f.repo, f.session, { agent_id: id, content: 'repair the bounded implementation' }, rpc);
  assert.equal(failed.ok, false);
  assert.match(failed.instruction, /capability gap/);
  assert.equal((await f.state()).implementationCycles[owner].repair, id);
  const next = (await f.compile()).navigation.next.find((item) => item.node === current);
  assert.equal(next.repair.agent_id, id);
  assert.equal(f.calls.filter((item) => item.command === 'spawn').length, 3);
  // An explicitly declared new implementation is a different cycle, not an automatic repair fallback.
  const fresh = await f.spawn([{ ...task(current), purpose: 'implementation' }]);
  assert.equal(fresh.ok, true);
  assert.notEqual((await f.state()).implementationCycles[owner].original, id);
});
