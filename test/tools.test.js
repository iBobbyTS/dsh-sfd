/**
 * sfd_start / sfd_finish tool tests with a stubbed ctx and a real tmp git
 * repo. Neither tool performs git operations or dispatch; they anchor and
 * close the observed run ledger.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { registerSfdTools } from '../lib/tools.js';
import { loadRun, flush, RUN_FILE, AGENT_WORK } from '../lib/ledger.js';

const run = promisify(execFile);
const git = (cwd, ...args) => run('git', ['-C', cwd, ...args]);

const t = (key, params = {}) => ({
  'state.noCwd': 'no cwd', 'state.notGit': 'not git',
  'state.nextPlan': 'next: plan',
  'tool.existingRun': 'existing run',
  'tool.started': `started on ${params.branch} (${params.slug})`,
  'tool.startedDirty': 'started dirty',
  'tool.finished': 'finished',
  'tool.finishOpen': `open actors ${params.ids}`,
  'tool.finishArchive': 'archive',
  'tool.finishNoRun': 'no run',
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

test('sfd_start is registered with sfd_finish and nothing else', () => {
  const c = makeCtx('/tmp');
  registerSfdTools(c.getCtx(), { t: async () => t });
  assert.deepEqual([...c.definitions.keys()].sort(), ['sfd_finish', 'sfd_start']);
});

test('sfd_start records git facts into the ledger, no git ops, no dispatch fields', async () => {
  const dir = await makeRepo();
  try {
    await git(dir, 'switch', '-c', 'sfd/dark-mode');
    const before = (await git(dir, 'rev-parse', 'HEAD')).stdout.trim();
    const c = makeCtx(dir);
    registerSfdTools(c.getCtx(), { t: async () => t });
    const r = await c.call({ taskSummary: 'Add dark mode toggle support' });
    assert.equal(r.ok, true);
    assert.equal(r.run.branch, 'sfd/dark-mode');
    assert.equal(r.run.slug, 'dark-mode-toggle-support');
    assert.equal((await git(dir, 'rev-parse', 'HEAD')).stdout.trim(), before, 'no commit/rewrite may happen');
    assert.equal((await git(dir, 'rev-parse', '--abbrev-ref', 'HEAD')).stdout.trim(), 'sfd/dark-mode', 'branch unchanged');
    const run = await loadRun(dir);
    assert.equal(run.run.status, 'active');
    assert.equal(run.run.branch, 'sfd/dark-mode');
    assert.equal(run.run.base, 'sfd/dark-mode');
    assert.equal(run.run.dirtyAtStart, false);
    assert.equal(run.run.taskSummary, 'Add dark mode toggle support');
    assert.deepEqual(run.counts, {});
    assert.deepEqual(run.actors, {});
    assert.match(r.brief, /started on sfd\/dark-mode/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('sfd_start honors explicit branch and slug; second call returns the observed brief', async () => {
  const dir = await makeRepo();
  try {
    const c = makeCtx(dir);
    registerSfdTools(c.getCtx(), { t: async () => t });
    const r = await c.call({ taskSummary: 'x', branch: 'sfd/explicit-name', slug: 'explicit' });
    assert.equal(r.ok, true);
    assert.equal(r.run.slug, 'explicit');
    const run = await loadRun(dir);
    assert.equal(run.run.branch, 'sfd/explicit-name');
    assert.equal(run.run.base, 'main', 'observed branch stays separate from the reported one');
    const again = await c.call({ taskSummary: 'another' });
    assert.equal(again.ok, false);
    assert.equal(again.error, 'already-running');
    assert.match(again.message, /existing run/);
    assert.ok(typeof again.brief === 'string' && again.brief.length > 0, 'the observed brief comes back');
    const unchanged = JSON.parse(await readFile(join(dir, AGENT_WORK, RUN_FILE), 'utf8'));
    assert.equal(unchanged.run.taskSummary, 'x', 'the ledger is not restarted');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('sfd_start refuses non-repositories and missing cwd', async () => {
  const outside = await mkdtemp(join(tmpdir(), 'sfd-norepo-'));
  try {
    const c = makeCtx(outside);
    registerSfdTools(c.getCtx(), { t: async () => t });
    const r = await c.call({ taskSummary: 'x' });
    assert.equal(r.ok, false);
    assert.equal(r.error, 'not-git');
    const c2 = makeCtx(undefined);
    registerSfdTools(c2.getCtx(), { t: async () => t });
    const r2 = await c2.call({ taskSummary: 'x' });
    assert.equal(r2.error, 'no-cwd');
  } finally {
    await rm(outside, { recursive: true, force: true });
  }
});

test('sfd_finish closes the run and names unreconciled actors', async () => {
  const dir = await makeRepo();
  try {
    const c = makeCtx(dir);
    registerSfdTools(c.getCtx(), { t: async () => t });
    await c.call({ taskSummary: 'x' });
    let run = await loadRun(dir);
    // simulate observed actors: one terminal+closed, one terminal not closed, one running
    run = { ...run, actors: {
      '1': { role: 'plan-review', status: 'terminal', outcome: 'COMPLETED', closed: true },
      '2': { role: 'plan-review', status: 'terminal', outcome: 'COMPLETED', closed: false },
      '3': { role: 'impl', status: 'running', outcome: null, closed: false },
    } };
    await flush(run);
    const finished = await c.call({}, 'sfd_finish');
    assert.equal(finished.ok, true);
    assert.match(finished.brief, /open actors 2 3/);
    const after = await loadRun(dir);
    assert.equal(after.run.status, 'closed');
    const again = await c.call({}, 'sfd_finish');
    assert.equal(again.ok, true, 'closing twice is idempotent');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('sfd_finish without a run fails politely', async () => {
  const dir = await makeRepo();
  try {
    const c = makeCtx(dir);
    registerSfdTools(c.getCtx(), { t: async () => t });
    const r = await c.call({}, 'sfd_finish');
    assert.equal(r.ok, false);
    assert.equal(r.error, 'no-run');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
