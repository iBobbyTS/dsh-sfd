import test from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { registerWorkflowTools } from '../../lib/workflow-tools.js';
import { fixture, plan, planDone } from './fixtures.js';

const cleanup = async (f) => rm(f.repo, { recursive: true, force: true });

test('tool surface is exactly compile plus seven subagent tools and no confirm/status/update', async () => {
  const f = await fixture();
  try {
    const definitions = new Map();
    registerWorkflowTools({ tools: { register: (tool) => definitions.set(tool.name, tool) }, workingDirectory: { ensure: async () => f.repo } });
    assert.deepEqual([...definitions.keys()].sort(), [
      'sfd_subagent_cancel',
      'sfd_subagent_observe',
      'sfd_subagent_respond',
      'sfd_subagent_result',
      'sfd_subagent_send',
      'sfd_subagent_spawn',
      'sfd_subagent_wait',
      'sfd_workflow_compile',
    ]);
    for (const removed of ['sfd_workflow_confirm', 'sfd_workflow_update', 'sfd_workflow_status', 'sfd_cancel', 'sfd_subagent_cencel']) {
      assert.equal(definitions.has(removed), false);
    }
    const exec = { agent: { session: { id: f.session } }, signal: new AbortController().signal };
    const compiled = await definitions.get('sfd_workflow_compile').execute({}, exec);
    assert.equal(compiled.ok, true);
    assert.equal(compiled.upToDate, false);
    assert.match(compiled.instruction, /Previous graph|Compare the previous graph/);
    const again = await definitions.get('sfd_workflow_compile').execute({}, exec);
    assert.equal(again.upToDate, true);
    assert.match(again.instruction, /already up to date, do not compile again/);
  } finally { await cleanup(f); }
});

test('public tool schemas preserve configured routes and return the redirected repair actor', async () => {
  const f = await fixture(plan().replaceAll('impl_large', 'impl_std'));
  try {
    const definitions = new Map();
    registerWorkflowTools({ tools: { register: tool => definitions.set(tool.name, tool) }, workingDirectory: { ensure: async () => f.repo } }, { es: f.rpc });
    const exec = { agent: { session: { id: f.session } }, signal: new AbortController().signal };
    const call = (name, args) => definitions.get(name).execute(args, exec);
    const compiled = await call('sfd_workflow_compile', {});
    assert.equal(compiled.navigation.next[0].action, 'choose-review-dispatch');
    await planDone(f);
    const node = Object.values(compiled.graph.nodes).find(item => item.kind === 'implementation').id;
    const original = await call('sfd_subagent_spawn', { tasks: [{ node, assignment: 'new implementation', route: { profile: 'configured-standard' }, repair_route: { profile: 'configured-large' } }] });
    await call('sfd_subagent_wait', { agent_ids: original.agent_ids, wait_time: 0 });
    const first = await call('sfd_subagent_send', { agent_id: original.agent_ids[0], node, content: 'repair current implementation', purpose: 'repair' });
    assert.equal(first.ok, true);
    assert.notEqual(first.actor_id, original.agent_ids[0]);
    assert.equal(f.calls.at(-1).args.profile, 'configured-large');
    await call('sfd_subagent_wait', { agent_ids: first.agent_ids, wait_time: 0 });
    const later = await call('sfd_subagent_spawn', { tasks: [{ node, assignment: 'another repair', purpose: 'repair' }] });
    assert.equal(later.ok, true);
    assert.equal(later.operations[0].action, 'send');
    assert.deepEqual(later.agent_ids, first.agent_ids);
  } finally { await cleanup(f); }
});
