/**
 * The injector: revision-gated `[SFD]` blocks, warn nudge, closed-run silence.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderObligationBlock, renderResumeBrief, createRunInjector, WARN_NUDGE_STEPS } from '../lib/context.js';
import { initialRun, recordSpawn, recordEvent, recordArtifact, closeRun } from '../lib/ledger.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const t = (key, params = {}) => ({
  'ctx.header': `[SFD] ${params.slug}@${params.branch} rev ${params.rev} ${params.phase}`,
  'ctx.actorsSummary': `actors ${params.total}`,
  'ctx.actorLine': `  - #${params.id} ${params.role} ${params.outcome}${params.extra}`,
  'ctx.counts': `counts ${params.items}`,
  'ctx.reports': `reports ${params.count}`,
  'ctx.obligations': 'obligations:',
  'ctx.none': 'none',
  'ctx.pointer': 'pointer',
  'phase.starting': 'starting', 'phase.plan-review': 'plan-review', 'phase.implement': 'implement',
  'phase.code-review': 'code-review', 'phase.closed': 'closed',
  'obl.await-actors': `await ${params.ids}`,
  'obl.close-actors': `close ${params.ids}`,
  'obl.plan-coverage': `plan coverage ${params.dispatched}/${params.done}`,
  'obl.plan-skip-warn': `WARN impl ${params.impl} done ${params.done}`,
  'obl.freeze-before-review': 'freeze first',
  'obl.code-coverage': `code coverage ${params.dispatched}`,
  'state.resume': 'resume',
  'state.readSkillFirst': 'read skill first',
})[key] ?? key;

async function freshRoot() {
  return mkdtemp(join(tmpdir(), 'sfd-ctx-'));
}

test('renderObligationBlock lists facts and obligations compactly', async () => {
  const root = await freshRoot();
  try {
    let run = initialRun(root, { slug: 'dark', branch: 'sfd/dark', taskSummary: 'dark mode' });
    run = await recordArtifact(run, '.agent-work/PLAN-FULL.md', 'plan');
    run = await recordSpawn(run, { agentId: '1', role: 'plan-review', reportHint: '.agent-work/reviews/plan-a.md' });
    const text = renderObligationBlock(run, t);
    assert.match(text, /\[SFD\] dark@sfd\/dark rev \d+ plan-review/);
    assert.match(text, /counts plan-review 1/);
    assert.match(text, /plan coverage 1\/0/);
    assert.match(text, /await 1/);
    assert.match(text, /pointer/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('injector: one block per revision, silence on steady steps, nudge on lingering warnings', async () => {
  const root = await freshRoot();
  try {
    let run = initialRun(root, { slug: 'x', branch: 'b' });
    // stage a warning: impl dispatched, plan coverage incomplete
    run = await recordArtifact(run, '.agent-work/PLAN-FULL.md', 'plan');
    run = await recordSpawn(run, { agentId: '1', role: 'plan-review' });
    run = await recordEvent(run, { agentId: '1', event: 'result', outcome: 'COMPLETED' });
    run = await recordSpawn(run, { agentId: '2', role: 'impl' });
    const rev = run.revision;

    const store = new Map([[root, run]]);
    const injector = createRunInjector({ loadRun: async (r) => store.get(r) ?? null, resolveRoot: async (cwd) => (cwd === '/repo' ? root : null) });
    const ask = () => injector.textFor({ sessionId: 's1', cwd: '/repo', t });

    const first = await ask();
    assert.ok(first, 'a new revision injects');
    assert.equal(await ask(), null, 'same revision, no nudge yet -> silent');
    // step through the nudge window; the warning eventually re-injects
    let nudged = null;
    for (let i = 0; i < WARN_NUDGE_STEPS + 1 && nudged === null; i += 1) {
      nudged = await ask();
    }
    assert.ok(nudged, 'a lingering warning re-injects after the nudge window');
    assert.match(nudged, /WARN impl 1 done 1/);

    // a ledger change re-injects immediately
    run = await recordEvent(run, { agentId: '2', event: 'result', outcome: 'COMPLETED' });
    store.set(root, run);
    assert.ok((await ask()) !== null);
    assert.equal(rev < run.revision, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('injector: a fresh run injects once then quiets; closed runs and foreign cwds never inject', async () => {
  const root = await freshRoot();
  try {
    let run = initialRun(root, { slug: 'x', branch: 'b' });
    const store = new Map([[root, run]]);
    const injector = createRunInjector({ loadRun: async (r) => store.get(r) ?? null, resolveRoot: async () => root });
    assert.ok((await injector.textFor({ sessionId: 's1', cwd: '/repo', t })) !== null, 'first sight of the run injects');
    assert.equal(await injector.textFor({ sessionId: 's1', cwd: '/repo', t }), null);
    run = await closeRun(run);
    store.set(root, run);
    assert.equal(await injector.textFor({ sessionId: 's1', cwd: '/repo', t }), null, 'closed runs are silent');
    assert.equal(await injector.textFor({ sessionId: 's1', cwd: '/elsewhere', t }), null, 'unknown cwd is silent');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('renderResumeBrief wraps the block with the read-skill line', async () => {
  const root = await freshRoot();
  try {
    const run = initialRun(root, { slug: 'x', branch: 'b' });
    const text = renderResumeBrief(run, t);
    assert.match(text, /^# SFD resume/);
    assert.match(text, /read skill first/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
