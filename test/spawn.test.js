import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ModelSettingsStore } from '../lib/models.js';
import { ROLES } from '../lib/roles.js';
import { StageConfigError, assertSpawnable, createStageSpawner, resolveStageTarget, spawnRequest } from '../lib/spawn.js';
import { EsError } from '../lib/es-cli.js';

const ROOT = '/example/repo';

async function store() {
  return new ModelSettingsStore(join(await mkdtemp(join(tmpdir(), 'sfd-spawn-')), 'dsh-sfd.json'));
}

const codex = { subagent: 'codex', model: 'gpt-6.1-sol' };

/** ES caller stub: records argv and answers the two commands a spawn uses. */
function fakeRun({ subagents = [{ subagent: 'codex', enabled: true, spawn_supported: true }], create = { ok: true, result: { agent_id: 10000001, session_id: 'session-1', status: 'running' } }, onCreate } = {}) {
  const calls = [];
  const run = async (args, options) => {
    calls.push({ args, options });
    if (args[0] === 'subagents') return { ok: true, subagents };
    if (args[0] === 'create') {
      if (onCreate !== undefined) return onCreate(args, options);
      return create;
    }
    throw new Error(`unexpected ES command ${args[0]}`);
  };
  return { run, calls };
}

test('a configured global stage resolves to a role, its mode, its effort and its project fallback', async () => {
  const settings = await store();
  await settings.save(null, 'global', 'planReviewA', codex);
  const target = await resolveStageTarget(settings, ROOT, 'planReviewA');
  assert.equal(target.role, 'planReview');
  assert.equal(target.subagent, 'codex');
  assert.equal(target.model, 'gpt-6.1-sol');
  assert.equal(target.permissionMode, 'plan');
  assert.equal(target.effort, 'xhigh');
  assert.equal(target.source, 'global');
  assert.equal(target.instructions, ROLES.planReview.instructions);
});

test('a project override wins over the global choice for the same stage', async () => {
  const settings = await store();
  await settings.save(null, 'global', 'implementationStandard', codex);
  await settings.save(ROOT, 'project', 'implementationStandard', { subagent: 'agy', model: 'gemini-3.8-flash' });
  const target = await resolveStageTarget(settings, ROOT, 'implementationStandard');
  assert.equal(target.subagent, 'agy');
  assert.equal(target.model, 'gemini-3.8-flash');
  assert.equal(target.permissionMode, 'build');
  assert.equal(target.effort, 'high');
  assert.equal(target.source, 'project');
  // Another repository still sees the global choice.
  const other = await resolveStageTarget(settings, '/example/other', 'implementationStandard');
  assert.equal(other.subagent, 'codex');
  assert.equal(other.source, 'global');
});

test('an unconfigured stage and an unknown stage are distinct refusals', async () => {
  const settings = await store();
  await assert.rejects(
    () => resolveStageTarget(settings, ROOT, 'planReviewB'),
    (error) => error instanceof StageConfigError && error.code === 'not-configured',
  );
  await assert.rejects(
    () => resolveStageTarget(settings, ROOT, 'planReviewC'),
    (error) => error.code === 'unknown-stage',
  );
});

test('the ES request carries the role text inline and never a profile', async () => {
  const settings = await store();
  await settings.save(null, 'global', 'codeReviewA', codex);
  const target = await resolveStageTarget(settings, ROOT, 'codeReviewA');
  const request = spawnRequest({ repository: ROOT, target, prompt: 'review the diff' });
  assert.equal(request.subagent, 'codex');
  assert.equal(request.model, 'gpt-6.1-sol');
  assert.equal(request.permission_mode, 'plan');
  assert.equal(request.effort, 'high');
  assert.equal(request.developer_instructions, ROLES.codeReview.instructions);
  assert.equal(Object.hasOwn(request, 'profile'), false);
  assert.equal(request.prompt, 'review the diff');
});

test('an unknown subagent gets no effort instead of an invented one', async () => {
  const settings = await store();
  await settings.save(null, 'global', 'planReviewA', { subagent: 'future-agent', model: 'm1' });
  const target = await resolveStageTarget(settings, ROOT, 'planReviewA');
  assert.equal(target.effort, null);
  const request = spawnRequest({ repository: ROOT, target, prompt: 'x' });
  assert.equal(Object.hasOwn(request, 'effort'), false);
});

test('a subagent ES cannot spawn is refused before any task is created', async () => {
  const { run, calls } = fakeRun({ subagents: [{ subagent: 'codex', enabled: false, spawn_supported: true }] });
  await assert.rejects(
    () => assertSpawnable('codex', { run }),
    (error) => error.code === 'subagent-unavailable' && error.detail.subagent === 'codex',
  );
  await assert.rejects(
    () => assertSpawnable('agy', { run }),
    (error) => error.code === 'subagent-unknown',
  );
  assert.deepEqual(calls.map((call) => call.args[0]), ['subagents', 'subagents']);
});

test('a spawn sends exactly one create call and returns the agent id the agent must wait on', async () => {
  const settings = await store();
  await settings.save(ROOT, 'project', 'implementationLarge', { subagent: 'codex', model: 'gpt-6-astra' });
  const { run, calls } = fakeRun();
  const spawner = createStageSpawner({ store: settings, run });
  const spawned = await spawner.spawn({ repository: ROOT, stage: 'implementationLarge', prompt: 'implement the section' });
  assert.equal(spawned.agentId, 10000001);
  assert.equal(spawned.sessionId, 'session-1');
  assert.equal(spawned.target.role, 'implementation');
  assert.equal(calls.length, 2);
  assert.equal(calls[1].args[0], 'create');
  assert.equal(calls[1].args[1], '--json');
  const payload = JSON.parse(calls[1].args[2]);
  assert.deepEqual(payload, {
    repository: ROOT,
    prompt: 'implement the section',
    subagent: 'codex',
    model: 'gpt-6-astra',
    permission_mode: 'build',
    developer_instructions: ROLES.implementation.instructions,
    effort: 'high',
  });
  assert.equal(calls[1].options.timeoutMs, 60_000);
});

test('configuration refusals happen before the CLI is asked anything', async () => {
  const settings = await store();
  const { run, calls } = fakeRun();
  const spawner = createStageSpawner({ store: settings, run });
  await assert.rejects(
    () => spawner.spawn({ repository: ROOT, stage: 'codeReviewB', prompt: 'x' }),
    (error) => error.code === 'not-configured',
  );
  await assert.rejects(
    () => spawner.spawn({ repository: ROOT, stage: 'codeReviewB', prompt: '   ' }),
    (error) => error.code === 'empty-prompt',
  );
  assert.deepEqual(calls, []);
});

test('a refused create surfaces the ES error and never a fake success', async () => {
  const settings = await store();
  await settings.save(ROOT, 'project', 'planReviewA', codex);
  const failing = fakeRun({
    onCreate: () => { throw new EsError('subagent is not enabled', { code: 'SUBAGENT_DISABLED' }); },
  });
  await assert.rejects(
    () => createStageSpawner({ store: settings, run: failing.run }).spawn({ repository: ROOT, stage: 'planReviewA', prompt: 'x' }),
    (error) => error.code === 'SUBAGENT_DISABLED',
  );
  const missing = fakeRun({ create: { ok: true, result: { status: 'running' } } });
  await assert.rejects(
    () => createStageSpawner({ store: settings, run: missing.run }).spawn({ repository: ROOT, stage: 'planReviewA', prompt: 'x' }),
    (error) => error.code === 'ES_OUTPUT',
  );
});
