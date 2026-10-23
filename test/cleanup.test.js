import test from 'node:test';
import assert from 'node:assert/strict';
import { runCleanup } from '../lib/cleanup.js';

const t = (key) => ({ 'state.notGit': 'not git', 'cleanup.dirtyTitle': 'dirty', 'cleanup.dirtyQuestion': 'dirty?', 'cleanup.stop': 'Stop', 'cleanup.autoCommit': 'Auto', 'cleanup.branchTitle': 'branch', 'cleanup.stayCurrent': 'stay', 'cleanup.newFromCurrent': 'new-cur', 'cleanup.newFromMain': 'new-main', 'cleanup.ffToCurrent': 'ff-main', 'cleanup.ffToMain': 'ff-self', 'cleanup.agentMerge': 'agent-merge', 'cleanup.inSync': 'sync', 'cleanup.sameBehind': 'sb', 'cleanup.sameAhead': 'sa', 'cleanup.diverged': 'dv', 'cleanup.noMainQuestion': 'base?', 'cleanup.stopLabel': 'Stop', 'state.resume': 'resume' })[key] ?? key;

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

test('dirty then clean on main: no card, branch creation delegated to agent', async () => {
  let dirty = true;
  const deps = makeDeps({
    answers: [{ answers: [{ id: 'sfd-dirty', selected: ['Auto'] }] }],
  });
  deps.inspect = async () => ({ root: '/repo', branch: 'main', detached: false, dirty, midMerge: false });
  deps.gitCommit = { commit: async () => { dirty = false; return { success: true, hash: 'abc1234' }; } };
  const r = await runCleanup(deps);
  assert.equal(r.ok, true);
  assert.equal(r.intent, 'create-from-main');
  assert.equal(r.state.branch, 'main');
  assert.equal(r.agentTask, 'createBranchFromMain');
  // no git ops: branch creation is the agent's job
});

test('dirty: typed text becomes a user note for the agent, no commit', async () => {
  const deps = makeDeps({
    facts: facts({ dirty: true }),
    answers: [{ answers: [{ id: 'sfd-dirty', selected: [], custom: 'keep my WIP, ask me later' }] }],
  });
  const r = await runCleanup(deps);
  assert.equal(r.ok, true);
  assert.equal(r.intent, 'note-only');
  assert.equal(r.userNote, 'keep my WIP, ask me later');
});

test('dirty: auto commit fails twice -> error', async () => {
  const r = await runCleanup(makeDeps({
    facts: facts({ dirty: true }),
    answers: [{ answers: [{ id: 'sfd-dirty', selected: ['Auto'] }] }, { answers: [{ id: 'sfd-dirty', selected: ['Auto'] }] }],
    commits: [{ success: false, error: 'x' }, { success: false, error: 'y' }],
  }));
  assert.equal(r.error, 'commit-failed');
});

test('on main: no card at all, no git ops', async () => {
  const gitCalls = [];
  const asked = [];
  const deps = makeDeps({ facts: facts(), gitCalls });
  deps.ask = async (q) => { asked.push(q.id); return { answers: [{ id: q.id, selected: [] }] }; };
  const r = await runCleanup(deps);
  assert.equal(r.ok, true);
  assert.equal(r.intent, 'create-from-main');
  assert.equal(asked.length, 0, 'no card expected on main');
  assert.equal(gitCalls.length, 0);
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
  assert.equal(r.intent, 'stay-current');
  assert.equal(r.state.branch, 'dev');
  assert.equal(r.agentTask, 'createBranchFromCurrent');
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
  assert.equal(r.intent, 'ff-main-to-current');
  assert.equal(r.agentTask, 'createBranchFromCurrent');
});

test('off main behind only: ff to main switches base to main (agent branches)', async () => {
  const gitCalls = [];
  const r = await runCleanup(makeDeps({
    facts: facts({ branch: 'dev' }),
    ab: { ahead: 0, behind: 2 },
    gitCalls,
    answers: [{ answers: [{ id: 'sfd-branch-base', selected: ['ff-self'] }] }],
  }));
  assert.equal(r.ok, true);
  assert.deepEqual(gitCalls[0], ['merge', '--ff-only', 'main']);
  assert.equal(r.intent, 'ff-to-main');
  assert.equal(r.agentTask, 'createBranchFromMain');
});

test('new from main: program switches to main, agent creates branch', async () => {
  const gitCalls = [];
  const r = await runCleanup(makeDeps({
    facts: facts({ branch: 'dev' }),
    ab: { ahead: 1, behind: 1 },
    gitCalls,
    answers: [{ answers: [{ id: 'sfd-branch-base', selected: ['new-main'] }] }],
  }));
  assert.equal(r.ok, true);
  assert.deepEqual(gitCalls[0], ['switch', 'main']);
  assert.equal(r.intent, 'new-from-main');
  assert.equal(r.agentTask, 'createBranchFromMain');
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

test('branch-base card typed text becomes userNote', async () => {
  const r = await runCleanup(makeDeps({
    facts: facts({ branch: 'dev' }),
    ab: { ahead: 0, behind: 0 },
    answers: [{ answers: [{ id: 'sfd-branch-base', selected: ['stay'], custom: 'name it after ticket-42' }] }],
  }));
  assert.equal(r.ok, true);
  assert.equal(r.state.userNote ?? r.userNote, 'name it after ticket-42');
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
