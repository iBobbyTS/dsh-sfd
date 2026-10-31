import test from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { registerWorkflowTools } from '../../lib/workflow-tools.js';
import { fixture, plan, planDone } from './fixtures.js';
import { Context } from '@deepseek-ai/cordis';
import { ToolRuntime } from '@deepseek-ai/dsh-tools';
import { SkillRegistry } from '@deepseek-ai/dsh-skill';
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection';
import { createScope } from '@deepseek-ai/dsh-scope';
import { apply, inject } from '../../index.js';

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

test('public tool schemas preserve configured routes and continue exactly the named actor', async () => {
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
    const continued = await call('sfd_subagent_send', { agent_id: original.agent_ids[0], node, content: 'repair current implementation', purpose: 'repair' });
    assert.equal(continued.ok, true);
    assert.equal(continued.actor_id, original.agent_ids[0]);
    assert.equal(continued.operations[0].action, 'send');
    await call('sfd_subagent_wait', { agent_ids: continued.agent_ids, wait_time: 0 });
    const escalated = await call('sfd_subagent_spawn', { tasks: [{ node, assignment: 'escalated repair', purpose: 'repair' }] });
    assert.equal(escalated.ok, true);
    assert.equal(escalated.operations[0].action, 'spawn');
    assert.equal(f.calls.at(-1).args.profile, 'configured-large');
    assert.notDeepEqual(escalated.agent_ids, original.agent_ids);
  } finally { await cleanup(f); }
});

test('entry registers the current tool surface and its command never touches the repository', async () => {
  const ctx = new Context();
  ctx.provide('systemPrompt', { tools: () => () => {}, section: () => () => {} });
  new ToolRuntime(ctx); new SkillRegistry(ctx); new SessionProjectionRegistry(ctx);
  ctx.provide('agents', { list: () => [] });
  ctx.provide('workingDirectory', { ensure: async () => { throw new Error('command must not touch repository'); } });
  const commands = [];
  ctx.provide('commands', { register: command => commands.push(command) });
  const key = {};
  const plugin = createScope(ctx, key);
  try {
    apply(plugin.ctx);
    const names = ctx.tools.schemas(key).map(tool => tool.name);
    assert.equal(inject.includes('gitCommit'), false);
    assert.equal(names.length, 8);
    assert.ok(names.includes('sfd_workflow_compile'));
    assert.ok(names.includes('sfd_subagent_respond'));
    assert.ok(!names.includes('sfd_start'));
    let queued;
    const result = await commands[0].handler({ agent: { followup: message => { queued = message; } }, signal: new AbortController().signal });
    assert.equal(result.kind, 'success');
    assert.equal(queued.source.kind, 'skill-invocation');
    assert.equal(queued.source.name, 'sectioned-feature-development');
  } finally { await plugin.dispose(); }
});
