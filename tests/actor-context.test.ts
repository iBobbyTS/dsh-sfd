import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { outputSchemaFor } from '../src/core/contracts.js';
import type { ActorTask } from '../src/core/types.js';
import { prepareActorPrompt } from '../src/workspace/actor-context.js';

function task(input: Record<string, unknown>, kind: ActorTask['kind'] = 'adjudicator'): ActorTask {
  return { id: 'bounded-actor', runId: 'long-run', kind, controlEpoch: 2, inputContractVersion: 7,
    workspace: { path: '/immutable/candidate', branch: 'sfd/long-run', baseCommit: 'base' },
    input: { goal: 'Keep the original user goal and every acceptance obligation.', phase: 'adjudicating-a', ...input },
    outputSchema: outputSchemaFor(kind), timeoutMs: 60_000 };
}

test('long-run evidence is indexed within a fixed prompt budget and remains exactly retrievable', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'sfd-context-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const reviews = Array.from({ length: 80 }, (_, index) => ({ id: `review-${index}`, candidateId: `candidate-${index}`, output: { summary: `Exact review ${index}: ${'source evidence '.repeat(1_000)}` } }));
  const result = await prepareActorPrompt(task({ reviews, userDecisions: ['The original ownership constraint remains required.'] }), { directory, maxCharacters: 32_000 });
  assert.ok(result.prompt.length <= 32_000);
  assert.match(result.prompt, /Keep the original user goal and every acceptance obligation/);
  assert.match(result.prompt, /original ownership constraint remains required/);
  assert.match(result.prompt, /paginate long files/);
  assert.ok(result.artifactRefs.length >= 80);
  const original = JSON.parse(await readFile(result.artifactRefs.find(file => file.includes('reviews-79-'))!, 'utf8'));
  assert.deepEqual(original, reviews[79]);
  assert.equal((await stat(result.artifactRefs[0])).mode & 0o222, 0);
});

test('blind B filtering happens before both presentation and immutable artifact persistence', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'sfd-blind-context-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const result = await prepareActorPrompt(task({
    candidate: { id: 'candidate', workspacePath: '/snapshot', head: 'base', treeHash: 'tree', diff: 'actual change\n'.repeat(20_000), changedFiles: ['actual.ts'] },
    reviews: [{ summary: 'HIDDEN_A_VERDICT' }], instructions: 'HIDDEN_REPAIR_STORY',
    upstream: [{ id: 'S00', contract: { objective: 'Preserve integrated behavior.' } }],
  }, 'reviewer-b'), { directory, maxCharacters: 32_000 });
  assert.ok(result.prompt.length <= 32_000);
  assert.match(result.prompt, /Preserve integrated behavior/);
  assert.ok(!result.prompt.includes('HIDDEN_'));
  assert.ok(result.artifactRefs.length > 0);
  for (const file of result.artifactRefs) assert.ok(!(await readFile(file, 'utf8')).includes('HIDDEN_'));
});

test('an oversized user goal is rejected explicitly rather than silently shortened', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'sfd-goal-context-')); t.after(() => rm(directory, { recursive: true, force: true }));
  await assert.rejects(prepareActorPrompt(task({ goal: 'Do not delete this requirement. '.repeat(2_000) }), { directory, maxCharacters: 16_000 }), /goal was not truncated/);
});
