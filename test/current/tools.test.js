import test from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { registerWorkflowTools } from '../../lib/workflow-tools.js';
import { fixture } from './fixtures.js';

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
