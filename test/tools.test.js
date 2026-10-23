/**
 * sfd_start tool integration test with a stubbed ctx and real git repo.
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
  'state.noCwd': 'no cwd', 'state.notGit': 'not git', 'state.stopped': 'stopped',
  'state.fresh': 'fresh', 'state.cleanupDone': `Branch: ${params.branch} (base ${params.base})`,
  'state.nextPlan': 'next: plan', 'tool.existingRun': 'existing run',
  'tool.agentMergeTask': 'agent merge task', 'state.esMissing': 'es missing',
  'state.esProfileMissing': 'es profiles missing: {names}',
  'cleanup.dirtyTitle': 'dirty', 'cleanup.dirtyQuestion': 'dirty?',
  'cleanup.stop': 'Stop', 'cleanup.autoCommit': 'Auto', 'cleanup.customCommit': 'Custom',
  'cleanup.branchTitle': 'branch', 'cleanup.branchName': 'name', 'cleanup.branchNameQuestion': 'name?',
  'cleanup.onMain': 'on main', 'cleanup.stayCurrent': 'stay', 'cleanup.stopLabel': 'Stop',
  'cleanup.detachedHead': 'detached', 'cleanup.midMerge': 'mid-merge',
  'cleanup.noMainQuestion': 'base?',
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
      gitCommit: null,
    }),
    async call(args) {
      const exec = { agent, signal: undefined };
      return definition.execute(args, exec);
    },
  };
}

test('sfd_start runs cleanup, derives branch from taskSummary, writes state', async () => {
  const dir = await makeRepo();
  try {
    const c = makeCtx(dir);
    const mod = await import('../lib/es.js');
    // monkey-patch preflight via module cache is not possible; instead the tool
    // calls preflight() from es.js — for the test we point ES_* env to a stub.
    // Simplest: temporarily replace the module's exported function is not supported,
    // so this test runs preflight against the real ES daemon check. Skip if absent.
    const es = await mod.preflight();
    if (!es.ok) return; // environment lacks ES; skip silently
    registerSfdTools(c.getCtx(), { askCard: async () => ({ answers: [{ selected: [] }] }), t: async () => t });
    const r = await c.call({ taskSummary: 'Add dark mode toggle support' });
    assert.equal(r.ok, true);
    // on a clean main repo: no card, no branch — creation delegated to the agent
    assert.equal(r.intent ?? r.state?.intent, 'create-from-main');
    const branch = (await run('git', ['-C', dir, 'rev-parse', '--abbrev-ref', 'HEAD'])).stdout.trim();
    assert.equal(branch, 'main');
    const st = await loadState(dir);
    assert.equal(st.phase, 'PLAN');
    assert.equal(st.git.authority.intent, 'create-from-main');
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
    registerSfdTools(c.getCtx(), { askCard: async () => { throw new Error('must not ask'); }, t: async () => t });
    const r = await c.call({ taskSummary: 'another task' });
    assert.equal(r.ok, false);
    assert.equal(r.error, 'already-running');
    const branch = (await run('git', ['-C', dir, 'rev-parse', '--abbrev-ref', 'HEAD'])).stdout.trim();
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
