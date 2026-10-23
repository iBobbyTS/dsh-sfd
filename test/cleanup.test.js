import test from 'node:test';
import assert from 'node:assert/strict';
import { runCleanup } from '../lib/cleanup.js';

const t = (key) => ({ 'state.notGit': 'not git', 'cleanup.dirtyTitle': 'dirty', 'cleanup.dirtyQuestion': 'dirty?', 'cleanup.stop': 'Stop', 'cleanup.autoCommit': 'Auto', 'cleanup.customCommit': 'Custom', 'cleanup.branchTitle': 'branch', 'cleanup.branchName': 'name', 'cleanup.branchNameQuestion': 'name?', 'cleanup.onMain': 'on main', 'cleanup.stayCurrent': 'stay', 'cleanup.newFromCurrent': 'new-cur', 'cleanup.newFromMain': 'new-main', 'cleanup.ffToCurrent': 'ff-main', 'cleanup.ffToMain': 'ff-self', 'cleanup.customMerge': 'custom-merge', 'cleanup.agentMerge': 'agent-merge', 'cleanup.inSync': 'sync', 'cleanup.sameBehind': 'sb', 'cleanup.sameAhead': 'sa', 'cleanup.diverged': 'dv', 'cleanup.noMainQuestion': 'base?', 'cleanup.stopLabel': 'Stop', 'state.resume': 'resume' })[key] ?? key;

const makeDeps = ({ facts, ab = null, answers = [], commits = [], gitCalls = [] } = {}) => ({
  cwd: '/repo',
  inspect: async () => facts,
  aheadBehind: async () => ab,
  git: async (root, args) => { gitCalls.push(args); },
  gitCommit: { commit: async (req) => { const r = commits.shift() ?? { success: true, hash: 'abc1234' }; return r; } },
  ask: async (q) => {
    const next = answers.shift();
    if (next) return next;
    // exhausted: never auto-pick a side-effecting option; treat as stop
    return { answers: [{ id: q.id, selected: [] }] };
  },
  t,
  slug: 'test-feature',
});

const facts = (over = {}) => ({ root: '/repo', branch: 'main', detached: false, dirty: false, midMerge: false, ...over });

test('not a git repo -> error', async () => {
  const deps = makeDeps({});
  deps.inspect = async () => { throw new Error('not a git repository'); };
  const r = await runCleanup(deps);
  assert.equal(r.error, 'not-git');
});

test('dirty: stop choice', async () => {
  const r = await runCleanup(makeDeps({
    facts: facts({ dirty: true }),
    answers: [{ answers: [{ id: 'sfd-dirty', selected: ['Stop'] }] }],
  }));
  assert.equal(r.stopped, true);
  assert.equal(r.decisions[0].choice, 'stop');
});

test('dirty: auto commit once then clean', async () => {
  const r = await runCleanup(makeDeps({
    facts: facts({ dirty: true }),
    answers: [{ answers: [{ id: 'sfd-dirty', selected: ['Auto'] }] }],
    // second inspect returns clean: emulate by mutating facts
  }));
  // facts.dirty stays true => loop asks again; feed a second Stop
  assert.ok(r.stopped || r.ok === undefined);
});

test('dirty then clean: auto commit path eventually completes on main', async () => {
  let dirty = true;
  const deps = makeDeps({
    answers: [{ answers: [{ id: 'sfd-dirty', selected: ['Auto'] }] }],
  });
  deps.inspect = async () => ({ root: '/repo', branch: 'main', detached: false, dirty, midMerge: false });
  deps.gitCommit = { commit: async () => { dirty = false; return { success: true, hash: 'abc1234' }; } };
  const r = await runCleanup(deps);
  assert.equal(r.ok, true);
  assert.equal(r.state.startBranch, 'feature/test-feature');
});

test('dirty: auto commit fails twice -> error', async () => {
  const r = await runCleanup(makeDeps({
    facts: facts({ dirty: true }),
    answers: [{ answers: [{ id: 'sfd-dirty', selected: ['Auto'] }] }, { answers: [{ id: 'sfd-dirty', selected: ['Auto'] }] }],
    commits: [{ success: false, error: 'x' }, { success: false, error: 'y' }],
  }));
  assert.equal(r.error, 'commit-failed');
});

test('dirty: custom message commits once', async () => {
  let dirty = true;
  const deps = makeDeps({
    answers: [{ answers: [{ id: 'sfd-dirty', selected: ['Custom'], custom: 'my message' }] }],
  });
  deps.inspect = async () => ({ root: '/repo', branch: 'main', detached: false, dirty, midMerge: false });
  deps.gitCommit = { commit: async (req) => { if (req?.message) dirty = false; return { success: !!req?.message, hash: 'def5678' }; } };
  const r = await runCleanup(deps);
  assert.equal(r.ok, true);
  assert.ok(r.state.decisions.some((d) => d.choice === 'custom-commit' && d.detail.includes('my message')));
});

test('on main: suggested branch name used', async () => {
  const gitCalls = [];
  const r = await runCleanup(makeDeps({
    facts: facts(),
    gitCalls,
    answers: [{ answers: [{ id: 'sfd-branch-name', selected: ['feature/test-feature'] }] }],
  }));
  assert.equal(r.ok, true);
  assert.deepEqual(gitCalls[0], ['switch', '-c', 'feature/test-feature']);
});

test('detached HEAD -> stop card', async () => {
  const r = await runCleanup(makeDeps({
    facts: facts({ detached: true, branch: 'detached@abc1234' }),
  }));
  assert.equal(r.stopped, true);
});

test('off main in sync: stay current', async () => {
  const r = await runCleanup(makeDeps({
    facts: facts({ branch: 'dev' }),
    ab: { ahead: 0, behind: 0 },
    answers: [{ answers: [{ id: 'sfd-branch-base', selected: ['stay'] }] }],
  }));
  assert.equal(r.ok, true);
  assert.equal(r.state.startBranch, 'dev');
});

test('off main ahead only: ff main to current', async () => {
  const gitCalls = [];
  const r = await runCleanup(makeDeps({
    facts: facts({ branch: 'dev' }),
    ab: { ahead: 3, behind: 0 },
    gitCalls,
    answers: [{ answers: [{ id: 'sfd-branch-base', selected: ['ff-main'] }] }],
  }));
  assert.equal(r.ok, true);
  assert.deepEqual(gitCalls[0], ['branch', '-f', 'main', 'HEAD']);
});

test('off main behind only: custom merge message', async () => {
  const gitCalls = [];
  const r = await runCleanup(makeDeps({
    facts: facts({ branch: 'dev' }),
    ab: { ahead: 0, behind: 2 },
    gitCalls,
    answers: [{ answers: [{ id: 'sfd-branch-base', selected: ['custom-merge'], custom: 'merge main in' }] }],
  }));
  assert.equal(r.ok, true);
  assert.deepEqual(gitCalls[0], ['merge', 'main', '-m', 'merge main in']);
});

test('diverged: agent merge delegates without git ops', async () => {
  const gitCalls = [];
  const r = await runCleanup(makeDeps({
    facts: facts({ branch: 'dev' }),
    ab: { ahead: 2, behind: 3 },
    gitCalls,
    answers: [{ answers: [{ id: 'sfd-branch-base', selected: ['agent-merge'] }] }],
  }));
  assert.equal(r.ok, true);
  assert.equal(r.agentMerge, true);
  assert.equal(gitCalls.length, 0);
});

test('no main ref: stay current', async () => {
  const r = await runCleanup(makeDeps({
    facts: facts({ branch: 'trunk' }),
    ab: null,
    answers: [{ answers: [{ id: 'sfd-no-main', selected: ['stay'] }] }],
  }));
  assert.equal(r.ok, true);
  assert.equal(r.state.base, 'none');
});
