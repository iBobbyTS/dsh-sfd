/**
 * sfd_start tool integration test with a stubbed ctx and real git repo.
 * sfd_start performs no git operations: it probes read-only, records git
 * facts, and persists the initial state (phase PLAN).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { promisify } from 'node:util';
import { registerSfdTools } from '../lib/tools.js';
import { loadState } from '../lib/state.js';

const run = promisify(execFile);
const git = (cwd, ...args) => run('git', ['-C', cwd, ...args]);

const t = (key, params = {}) => ({
  'state.noCwd': 'no cwd', 'state.notGit': 'not git', 'state.fresh': 'fresh',
  'state.nextPlan': 'next: plan', 'tool.existingRun': 'existing run',
  'tool.started': `started on ${params.branch}`,
  'tool.startedDirty': 'started dirty',
  'state.esMissing': 'es missing', 'state.esNoSpawnable': 'no spawnable subagent',
  'tool.spawnNoRun': 'no run', 'tool.spawnNoModel': `no model for ${params.stage}`,
  'tool.spawnSubagent': `cannot spawn ${params.subagent} for ${params.stage}`,
  'tool.spawnUnknownStage': `unknown stage ${params.stage}`,
  'tool.spawnUnavailable': 'spawn unavailable', 'tool.spawnEmptyPrompt': 'empty prompt',
  'tool.spawnFailed': `spawn failed: ${params.reason}`,
  'tool.spawned': `spawned ${params.stage} on ${params.subagent} / ${params.model} (${params.mode}, ${params.source}) id ${params.id}`,
  'tool.spawnNext': `wait on ${params.id}`,
  'tool.spawnCount': `count ${params.key} = ${params.value}`,
  'tool.spawnBadUnit': `bad unit: ${params.reason}`,
})[key] ?? key;

async function makeRepo() {
  const dir = await mkdtemp(join(tmpdir(), 'sfd-tool-'));
  await git(dir, 'init', '-b', 'main');
  await git(dir, 'config', 'user.email', 't@t');
  await git(dir, 'config', 'user.name', 't');
  await writeFile(join(dir, 'a.txt'), 'a\n');
  await git(dir, 'add', '.');
  await git(dir, 'commit', '-m', 'init');
  return dir;
}

// The spawn tool is exercised separately; sfd_start never touches either.
const STUB_STORE = { get: async () => ({ root: null, global: { stages: {} }, project: null }) };
const STUB_SPAWNER = { spawn: async () => { throw new Error('the spawner is not used by sfd_start'); } };
const STUB_CONTEXT = { noteStateChange() {} };

function makeCtx(cwd) {
  const definitions = new Map();
  const agent = { id: 'a1' };
  return {
    agent,
    definitions,
    getCtx: () => ({
      tools: { register: (definition) => { definitions.set(definition.name, definition); } },
      workingDirectory: { ensure: async () => cwd },
    }),
    async call(args, name = 'sfd_start') {
      const definition = definitions.get(name);
      assert.ok(definition, `tool ${name} was not registered`);
      return definition.execute(args, { agent, signal: undefined });
    },
  };
}

test('sfd_start records git facts and writes state, no git ops', async () => {
  const dir = await makeRepo();
  try {
    // emulate the agent's own preparation: it created and switched to a feature branch
    await git(dir, 'switch', '-c', 'sfd/dark-mode');
    const before = (await git(dir, 'rev-parse', 'HEAD')).stdout.trim();
    const c = makeCtx(dir);
    const mod = await import('../lib/es.js');
    // The tool calls preflight() from es.js against the real ES daemon.
    // Skip silently when the environment lacks ES.
    const es = await mod.preflight();
    if (!es.ok) return;
    registerSfdTools(c.getCtx(), { t: async () => t, store: STUB_STORE, spawner: STUB_SPAWNER });
    const r = await c.call({ taskSummary: 'Add dark mode toggle support' });
    assert.equal(r.ok, true);
    assert.equal(r.state.branch, 'sfd/dark-mode');
    const after = (await git(dir, 'rev-parse', 'HEAD')).stdout.trim();
    assert.equal(after, before, 'no commit/rewrite may happen');
    const branch = (await git(dir, 'rev-parse', '--abbrev-ref', 'HEAD')).stdout.trim();
    assert.equal(branch, 'sfd/dark-mode', 'branch unchanged');
    const st = await loadState(dir);
    assert.equal(st.phase, 'PLAN');
    assert.equal(st.git.authority.intent, 'agent-managed');
    assert.equal(st.git.authority.branch, 'sfd/dark-mode');
    assert.equal(st.git.authority.base, 'sfd/dark-mode');
    assert.equal(st.git.authority.facts.dirty, false);
    assert.equal(st.task.summary, 'Add dark mode toggle support');
    assert.match(r.brief, /started on sfd\/dark-mode/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('sfd_start records explicit branch argument over observed branch', async () => {
  const dir = await makeRepo();
  try {
    const mod = await import('../lib/es.js');
    const es = await mod.preflight();
    if (!es.ok) return;
    const c = makeCtx(dir);
    registerSfdTools(c.getCtx(), { t: async () => t, store: STUB_STORE, spawner: STUB_SPAWNER });
    const r = await c.call({ taskSummary: 'x', branch: 'sfd/explicit-name' });
    assert.equal(r.ok, true);
    assert.equal(r.state.branch, 'sfd/explicit-name');
    const st = await loadState(dir);
    assert.equal(st.git.authority.branch, 'sfd/explicit-name');
    // observed fact stays separate from the reported branch
    assert.equal(st.git.authority.base, 'main');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('sfd_start flags a dirty workspace in facts and brief', async () => {
  const dir = await makeRepo();
  try {
    const mod = await import('../lib/es.js');
    const es = await mod.preflight();
    if (!es.ok) return;
    await writeFile(join(dir, 'b.txt'), 'dirty\n');
    const c = makeCtx(dir);
    registerSfdTools(c.getCtx(), { t: async () => t, store: STUB_STORE, spawner: STUB_SPAWNER });
    const r = await c.call({ taskSummary: 'x' });
    assert.equal(r.ok, true);
    const st = await loadState(dir);
    assert.equal(st.git.authority.facts.dirty, true);
    assert.match(r.brief, /started dirty/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('sfd_start returns brief without touching repo when a run exists', async () => {
  const dir = await makeRepo();
  try {
    const mod = await import('../lib/es.js');
    const es = await mod.preflight();
    if (!es.ok) return;
    await mkdirWrite(dir);
    const c = makeCtx(dir);
    registerSfdTools(c.getCtx(), { t: async () => t, store: STUB_STORE, spawner: STUB_SPAWNER });
    const r = await c.call({ taskSummary: 'another task' });
    assert.equal(r.ok, false);
    assert.equal(r.error, 'already-running');
    const branch = (await git(dir, 'rev-parse', '--abbrev-ref', 'HEAD')).stdout.trim();
    assert.equal(branch, 'main');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

async function mkdirWrite(dir) {
  const { mkdir } = await import('node:fs/promises');
  await mkdir(join(dir, '.agent-work'), { recursive: true });
  const { initialState, flush } = await import('../lib/state.js');
  await flush(initialState(dir));
}

/**
 * sfd_spawn_stage: the plugin owns target/role/permission, the agent owns
 * waiting. These tests pin the split, the refusals and the actor record.
 */
async function makeRun(cwd, { spawner, context } = {}) {
  const c = makeCtx(cwd);
  registerSfdTools(c.getCtx(), {
    t: async () => t,
    store: STUB_STORE,
    spawner: spawner ?? STUB_SPAWNER,
    context: context ?? STUB_CONTEXT,
  });
  return c;
}

const spawnResult = (overrides = {}) => ({
  agentId: 10000001,
  sessionId: 'session-1',
  status: 'running',
  target: {
    stage: 'planReviewA',
    role: 'planReview',
    subagent: 'codex',
    model: 'gpt-6.1-sol',
    permissionMode: 'plan',
    effort: 'xhigh',
    instructions: 'role text',
    source: 'project',
    ...overrides,
  },
  request: {},
});

test('sfd_spawn_stage needs an existing SFD run', async () => {
  const dir = await makeRepo();
  try {
    const c = await makeRun(dir);
    const r = await c.call({ stage: 'planReviewA', prompt: 'review it' }, 'sfd_spawn_stage');
    assert.equal(r.ok, false);
    assert.equal(r.error, 'no-run');
    assert.match(r.message, /no run/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('sfd_spawn_stage declares exactly the configured stages in its schema', async () => {
  const { STAGES } = await import('../lib/models.js');
  const c = await makeRun(process.cwd());
  assert.deepEqual(c.definitions.get('sfd_spawn_stage').parameters.properties.stage.enum, [...STAGES]);
  await assert.rejects(
    () => c.call({ stage: 'planReviewC', prompt: 'x' }, 'sfd_spawn_stage'),
    (error) => error.code === 'INVALID_ARGS',
  );
});

test('sfd_spawn_stage explains a stage with no configured model', async () => {
  const { StageConfigError } = await import('../lib/spawn.js');
  const dir = await makeRepo();
  try {
    await mkdirWrite(dir);
    const c = await makeRun(dir, {
      spawner: { spawn: async () => { throw new StageConfigError('not-configured', 'No model is configured'); } },
    });
    const r = await c.call({ stage: 'planReviewA', prompt: 'review it' }, 'sfd_spawn_stage');
    assert.equal(r.ok, false);
    assert.equal(r.error, 'not-configured');
    assert.match(r.message, /no model for planReviewA/);
    const st = await loadState(dir);
    assert.deepEqual(st.actors, {}, 'a refused spawn records nothing');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('sfd_spawn_stage records the actor and returns the id the agent must wait on', async () => {
  const dir = await makeRepo();
  try {
    await mkdirWrite(dir);
    const seen = [];
    const spawner = { spawn: async (options) => { seen.push(options); return spawnResult(); } };
    let notes = 0;
    const c = await makeRun(dir, { spawner, context: { noteStateChange() { notes += 1; } } });
    const r = await c.call({ stage: 'planReviewA', prompt: 'review the plan' }, 'sfd_spawn_stage');
    assert.equal(r.ok, true);
    assert.equal(r.agentId, 10000001);
    assert.equal(r.route.subagent, 'codex');
    assert.equal(r.route.permissionMode, 'plan');
    assert.match(r.brief, /wait on 10000001/);
    assert.equal(seen.length, 1);
    // Git reports the resolved work-tree path (/private/var on macOS).
    assert.equal(seen[0].repository, realpathSync(dir));
    assert.equal(seen[0].stage, 'planReviewA');
    assert.equal(seen[0].prompt, 'review the plan');
    const st = await loadState(dir);
    const actor = st.actors['10000001'];
    assert.equal(actor.role, 'planReviewA');
    assert.equal(actor.unit, null);
    assert.equal(actor.state, 'running');
    assert.deepEqual(actor.route, {
      subagent: 'codex', model: 'gpt-6.1-sol', permissionMode: 'plan', effort: 'xhigh', source: 'project',
    });
    assert.equal(notes, 1, 'the actor write tells the context injector to re-inject');
    assert.equal(st.journal.at(-1).kind, 'spawn');
    assert.match(st.journal.at(-1).detail, /spawned planReviewA on codex\/gpt-6.1-sol/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('sfd_spawn_stage refuses a gated run', async () => {
  const dir = await makeRepo();
  try {
    await mkdirWrite(dir);
    const { loadState } = await import('../lib/state.js');
    const state = await loadState(dir);
    const { transition } = await import('../lib/state.js');
    await transition(state, 'archive', { phase: 'DONE' }, 'test');
    const c = await makeRun(dir, { spawner: { spawn: async () => spawnResult() } });
    const r = await c.call({ stage: 'codeReviewA', prompt: 'x' }, 'sfd_spawn_stage');
    assert.equal(r.ok, false);
    assert.equal(r.error, 'gated');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('every spawn increments the plugin-owned review counter', async () => {
  const dir = await makeRepo();
  try {
    await mkdirWrite(dir);
    let nextId = 10000000;
    const c = await makeRun(dir, {
      spawner: { spawn: async () => { nextId += 1; return { ...spawnResult(), agentId: nextId }; } },
    });

    const first = await c.call({ stage: 'planReviewA', prompt: 'review the plan' }, 'sfd_spawn_stage');
    assert.equal(first.ok, true);
    assert.deepEqual(first.counts, { key: 'planReviewA', value: 1 });
    assert.match(first.brief, /count planReviewA = 1/);

    const second = await c.call({ stage: 'planReviewA', prompt: 'round two', unit: 'settings' }, 'sfd_spawn_stage');
    assert.deepEqual(second.counts, { key: 'planReviewA@settings', value: 1 });

    const third = await c.call({ stage: 'planReviewA', prompt: 'round three', unit: ' settings ' }, 'sfd_spawn_stage');
    assert.deepEqual(third.counts, { key: 'planReviewA@settings', value: 2 });
    assert.match(third.brief, /count planReviewA@settings = 2/);

    const st = await loadState(dir);
    assert.deepEqual(st.counts, { planReviewA: 1, 'planReviewA@settings': 2 });
    assert.equal(Object.keys(st.actors).length, 3, 'the count never replaces the actor ledger');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a malformed unit is refused before any spawn', async () => {
  const dir = await makeRepo();
  try {
    await mkdirWrite(dir);
    let spawned = 0;
    const c = await makeRun(dir, { spawner: { spawn: async () => { spawned += 1; return spawnResult(); } } });
    const r = await c.call({ stage: 'planReviewA', prompt: 'x', unit: 'bad@unit' }, 'sfd_spawn_stage');
    assert.equal(r.ok, false);
    assert.equal(r.error, 'invalid-unit');
    assert.match(r.message, /bad unit:/);
    assert.equal(spawned, 0);
    const st = await loadState(dir);
    assert.deepEqual(st.actors, {});
    assert.equal(st.counts, undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
