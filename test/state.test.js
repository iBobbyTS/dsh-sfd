import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initialState, transition, loadState, detectWork, gate, renderBrief, AGENT_WORK } from '../lib/state.js';
import { createFlow } from '../lib/flow.js';

const withRepo = async (fn) => {
  const dir = await mkdtemp(join(tmpdir(), 'sfd-state-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

test('initialState shape', () => {
  const s = initialState('/repo');
  assert.equal(s.schema, 1);
  assert.equal(s.phase, 'CLEANUP');
  assert.equal(s.seq, 0);
  assert.equal(s.hold, null);
  assert.ok(Array.isArray(s.journal));
});

test('transition bumps seq, appends journal, writes atomically', async () => {
  await withRepo(async (repo) => {
    let s = initialState(repo);
    s = await transition(s, 'start', { phase: 'PLAN' }, 'hello');
    assert.equal(s.seq, 1);
    assert.equal(s.phase, 'PLAN');
    assert.equal(s.journal.at(-1).kind, 'start');
    s = await transition(s, 'hold', { hold: { kind: 'BLOCKED', reason: 'x', since: 't' } });
    assert.equal(s.seq, 2);
    assert.equal(s.journal.length, 2);
    // persisted
    const loaded = await loadState(repo);
    assert.equal(loaded.seq, 2);
    assert.equal(loaded.hold.kind, 'BLOCKED');
  });
});

test('loadState returns null when absent, throws on bad json/schema', async () => {
  await withRepo(async (repo) => {
    assert.equal(await loadState(repo), null);
    await mkdir(join(repo, AGENT_WORK), { recursive: true });
    await writeFile(join(repo, AGENT_WORK, 'sfd-state.json'), '{oops', 'utf8');
    await assert.rejects(() => loadState(repo), /not valid JSON/);
    await writeFile(join(repo, AGENT_WORK, 'sfd-state.json'), JSON.stringify({ schema: 99 }), 'utf8');
    await assert.rejects(() => loadState(repo), /Unsupported/);
  });
});

test('detectWork: absent / legacy markers / state', async () => {
  await withRepo(async (repo) => {
    let d = await detectWork(repo);
    assert.equal(d.present, false);
    await mkdir(join(repo, AGENT_WORK), { recursive: true });
    await writeFile(join(repo, AGENT_WORK, 'PLAN-FULL.md'), '# plan', 'utf8');
    d = await detectWork(repo);
    assert.equal(d.present, true);
    assert.equal(d.kind, 'legacy-markers');
    await writeFile(join(repo, AGENT_WORK, 'sfd-state.json'), JSON.stringify(initialState(repo)), 'utf8');
    d = await detectWork(repo);
    assert.equal(d.kind, 'state');
  });
});

test('gate: DONE and holds block, otherwise allowed', () => {
  const s = initialState('/repo');
  assert.equal(gate(s).allowed, true);
  const done = { ...s, phase: 'DONE' };
  assert.equal(gate(done).allowed, false);
  const held = { ...s, hold: { kind: 'WAITING_USER', reason: 'r' } };
  assert.equal(gate(held).allowed, false);
});

test('renderBrief reflects dynamic graph and current obligations', () => {
  const s = initialState('/repo');
  s.phase = 'ACTIVE';
  s.task = { summary: 'Add test coverage' };
  s.flow = createFlow([{ id: 'S01', subsections: ['A'] }]);
  const brief = renderBrief(s, (k) => '[' + k + ']');
  assert.match(brief, /Phase: ACTIVE/);
  assert.match(brief, /Workflow revision: 1/);
  assert.match(brief, /S01\/A:checkpoint/);
  assert.match(brief, /plan:A/);
  assert.match(brief, /state\.readSkillFirst/);
});
