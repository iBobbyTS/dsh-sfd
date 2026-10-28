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
  'state.esMissing': 'es missing', 'state.esProfileMissing': 'es profiles missing: {names}',
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

function makeCtx(cwd) {
  let definition;
  const agent = { id: 'a1' };
  return {
    agent,
    getCtx: () => ({
      tools: { register: (d) => { definition = d; } },
      workingDirectory: { ensure: async () => cwd },
    }),
    async call(args) {
      const exec = { agent, signal: undefined };
      return definition.execute(args, exec);
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
    registerSfdTools(c.getCtx(), { t: async () => t });
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
    registerSfdTools(c.getCtx(), { t: async () => t });
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
    registerSfdTools(c.getCtx(), { t: async () => t });
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
    registerSfdTools(c.getCtx(), { t: async () => t });
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
