import test from 'node:test';
import assert from 'node:assert/strict';
import { PHASE_HINT, createStageContext, renderStageContext } from '../lib/context.js';
import { PHASES } from '../lib/state.js';

const t = (key, params = {}) => ({
  'ctx.header': `[SFD] ${params.phase} · ${params.root}`,
  'ctx.task': `task: ${params.summary}`,
  'ctx.plan': `plan: ${params.file} · A ${params.a} / B ${params.b}`,
  'ctx.units': `units: ${params.items}`,
  'ctx.actors': `actors: ${params.items}`,
  'ctx.hold': `hold: ${params.kind} — ${params.reason}`,
  'ctx.next': `next: ${params.hint}`,
  'ctx.tools': 'tools: sfd_spawn_stage / external_subagent_wait',
  'ctx.skill': `skill: ${params.skill}`,
  'ctx.none': 'not started',
  'ctx.counts': `review rounds: ${params.items}`,
  'ctx.hintPlan': 'hint-plan',
  'ctx.hintPlanReview': 'hint-planReview',
  'ctx.hintCodeReview': 'hint-code-review',
})[key] ?? key;

const state = (overrides = {}) => ({
  phase: 'PLAN_REVIEW',
  repoRoot: '/example/repo',
  task: { summary: 'Add a settings page' },
  plan: { file: '.agent-work/PLAN-FULL.md', review: { A: { state: 'done' } } },
  units: { settings: { status: 'pending', wavesUsed: 1 } },
  counts: { planReviewA: 2, 'codeReviewA@section-auth': 1 },
  actors: { 10001485: { role: 'planReviewA', route: { subagent: 'codex', model: 'gpt-6.1-sol' }, spawnedAt: '2026-10-29T10:00:00.000Z' } },
  hold: null,
  ...overrides,
});

test('every phase has a hint, and the block names the phase, the run and the next step', () => {
  for (const phase of PHASES) assert.ok(PHASE_HINT[phase], `missing hint for ${phase}`);
  const text = renderStageContext(state(), t, { now: Date.parse('2026-10-29T10:03:00.000Z') });
  assert.match(text, /^\[SFD\] PLAN_REVIEW · \/example\/repo/);
  assert.match(text, /task: Add a settings page/);
  assert.match(text, /plan: .*A done \/ B not started/);
  assert.match(text, /units: settings: pending waves 1\/5/);
  assert.match(text, /actors: 10001485 codex\/gpt-6.1-sol \(planReviewA, 3m\)/);
  assert.match(text, /review rounds: codeReviewA@section-auth 1 · planReviewA 2/);
  assert.match(text, /next: hint-planReview/);
  assert.match(text, /tools: sfd_spawn_stage/);
  assert.match(text, /skill: sectioned-feature-development/);
});

test('a hold is visible and stays one line', () => {
  const text = renderStageContext(state({ hold: { kind: 'BLOCKED', reason: 'advisor pending' } }), t);
  assert.match(text, /hold: BLOCKED — advisor pending/);
});

test('the block never claims to know an actor result', () => {
  const text = renderStageContext(state(), t);
  assert.doesNotMatch(text, /report|result:|completed/i);
});

test('the injector speaks once per revision, and again after a plugin state write', async () => {
  let reads = 0;
  const context = createStageContext({
    resolveRoot: async () => '/example/repo',
    readState: async () => { reads += 1; return state(); },
  });
  assert.equal(typeof (await context.textFor({ sessionId: 's1', cwd: '/example/repo', t })), 'string');
  assert.equal(await context.textFor({ sessionId: 's1', cwd: '/example/repo', t }), null);
  assert.equal(reads, 1, 'a steady step reads nothing');
  context.noteStateChange();
  assert.match(await context.textFor({ sessionId: 's1', cwd: '/example/repo', t }), /PLAN_REVIEW/);
  // Another session has its own budget.
  assert.match(await context.textFor({ sessionId: 's2', cwd: '/example/repo', t }), /PLAN_REVIEW/);
});

test('no cwd, no repository and no run each stay silent without leaking reads', async () => {
  let reads = 0;
  const context = createStageContext({
    resolveRoot: async (cwd) => (cwd === '/repo' ? '/repo' : null),
    readState: async () => { reads += 1; return null; },
  });
  assert.equal(await context.textFor({ sessionId: 's1', cwd: undefined, t }), null);
  assert.equal(await context.textFor({ sessionId: 's1', cwd: '/plain', t }), null);
  assert.equal(await context.textFor({ sessionId: 's1', cwd: '/repo', t }), null, 'no run yet');
  assert.equal(reads, 1);
  assert.equal(await context.textFor({ sessionId: 's1', cwd: '/repo', t }), null, 'still silent without a revision change');
  assert.equal(reads, 1);
});

test('a run that starts later injects after the state write', async () => {
  let present = false;
  const context = createStageContext({
    resolveRoot: async () => '/repo',
    readState: async () => (present ? state() : null),
  });
  assert.equal(await context.textFor({ sessionId: 's1', cwd: '/repo', t }), null);
  present = true;
  context.noteStateChange();
  assert.match(await context.textFor({ sessionId: 's1', cwd: '/repo', t }), /SFD/);
});

test('an unknown phase falls back to the planning hint rather than an empty next step', () => {
  const text = renderStageContext(state({ phase: 'SOMETHING_NEW' }), t);
  assert.match(text, /next: hint-plan/);
});
