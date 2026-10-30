import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { compilePlan } from '../../lib/compiler.js';
import { validateGraph } from '../../lib/graph-store.js';
import { fixture, plan, section, label, markMain, markUserSkip, planDone, spawnWaitDone, markDone } from './fixtures.js';

const cleanup = async (f) => rm(f.repo, { recursive: true, force: true });

test('compile writes pending graph, is idempotent across progress, and backs up on plan change', async () => {
  const f = await fixture();
  try {
    const first = await f.compile();
    assert.equal(first.ok, true);
    assert.equal(first.upToDate, false);
    assert.equal(first.reconciled, true);
    assert.equal(first.graph.nodes['plan:initial'].status, 'pending');
    assert.equal(first.backupPath, null);
    assert.match(first.instruction, /process the next ready mandatory review/);

    await markUserSkip(f, 'plan:initial', 'user explicitly skipped this plan review');
    const before = await readFile(f.loc.file, 'utf8');
    const second = await f.compile();
    assert.equal(second.upToDate, true);
    assert.match(second.instruction, /already up to date, do not compile again/);
    assert.equal(await readFile(f.loc.file, 'utf8'), before);

    await f.setPlan(plan().replace('Foundation', 'Changed foundation'));
    const third = await f.compile();
    assert.equal(third.upToDate, false);
    assert.equal(third.reconciled, false);
    assert.equal(third.graph.nodes['plan:initial'].status, 'pending');
    const backup = JSON.parse(await readFile(f.loc.backup, 'utf8'));
    assert.equal(backup.nodes['plan:initial'].status, 'skipped_by_user');

    await f.setPlan(plan().replace('Foundation', 'Second change'));
    await f.compile();
    const overwritten = JSON.parse(await readFile(f.loc.backup, 'utf8'));
    assert.notEqual(overwritten.plan.digest, backup.plan.digest);
    assert.match(f.loc.backup, /SFD-GRAPH\.prev\.json$/);
  } finally { await cleanup(f); }
});

test('mandatory graph nodes and prerequisites cannot be deleted; every declared subsection keeps its checkpoint', async () => {
  const f = await fixture('# Plan\n\n' + section(1, { children: true }));
  try {
    await f.compile();
    const graph = await f.graph();
    assert.ok(graph.nodes['S01.A:checkpoint']);
    assert.equal(graph.nodes['S01.A:checkpoint'].kind, 'review');
    delete graph.nodes['S01.A:checkpoint'];
    await f.save(graph);
    const base = compilePlan(await readFile(f.repo + '/.agent-work/PLAN-FULL.md', 'utf8'));
    assert.throws(() => validateGraph(graph, base, {}, { file: f.loc.file }), /required node S01\.A:checkpoint is missing/);
  } finally { await cleanup(f); }
});

test('a subsection cannot release the next child before its real checkpoint review', async () => {
  const f = await fixture('# Plan\n\n' + section(1, { children: true }));
  try {
    await f.compile();
    await planDone(f);
    const first = await spawnWaitDone(f, 'S01.A:implement');
    await markDone(f, 'S01.A:implement', first.id, 1);
    await assert.rejects(
      () => f.spawn([{ node: 'S01.B:implement', assignment: 'next child', route: { subagent: 'fake', model: 'caller/model' } }]),
      /S01\.A:checkpoint/,
    );
    const checkpoint = await spawnWaitDone(f, 'S01.A:checkpoint');
    await markDone(f, 'S01.A:checkpoint', checkpoint.id, 1);
    const next = await f.spawn([{ node: 'S01.B:implement', assignment: 'next child', route: { subagent: 'fake', model: 'caller/model' } }]);
    assert.equal(next.ok, true);
  } finally { await cleanup(f); }
});

test('done review evidence must exist; skipping a mandatory review requires user provenance', async () => {
  const f = await fixture();
  try {
    await f.compile();
    await planDone(f);
    const impl = await spawnWaitDone(f, 'S01:implement');
    await markDone(f, 'S01:implement', impl.id, 1);
    const behavior = await spawnWaitDone(f, 'S01:behavior');
    await markDone(f, 'S01:behavior', behavior.id, 1);
    await markMain(f, 'S01:risk');
    const state = await f.state();
    const base = compilePlan(await readFile(f.repo + '/.agent-work/PLAN-FULL.md', 'utf8'));

    const bad = await f.graph();
    bad.nodes['S01:blind'].status = 'done';
    bad.nodes['S01:blind'].evidence = { reason: 'I forgot the report' };
    assert.throws(() => validateGraph(bad, base, state, { file: f.loc.file }), /settled successful authored report|unknown actor|report reference/);

    const premature = await f.graph();
    premature.nodes['S01:accept'].status = 'done';
    premature.nodes['S01:accept'].evidence = { reason: 'Main decision' };
    assert.throws(() => validateGraph(premature, base, state, { file: f.loc.file }), /S01:reconciliation/);

    const userSkip = await f.graph();
    userSkip.nodes['S01:blind'].status = 'skipped_by_user';
    userSkip.nodes['S01:blind'].evidence = { user_source: 'user message', reason: 'user accepted the risk' };
    userSkip.nodes['S01:reconciliation'].status = 'done';
    userSkip.nodes['S01:reconciliation'].evidence = { reason: 'Main inspected the skipped review' };
    userSkip.nodes['S01:accept'].status = 'done';
    userSkip.nodes['S01:accept'].evidence = { reason: 'user-authorized skip' };
    validateGraph(userSkip, base, state, { file: f.loc.file });
    assert.equal(userSkip.nodes['S01:blind'].status, 'skipped_by_user');

    const generic = await f.graph();
    generic.nodes['S01:blind'].status = 'skipped';
    assert.throws(() => validateGraph(generic, base, state, { file: f.loc.file }), /unsupported status/);

    const noSource = await f.graph();
    noSource.nodes['S01:blind'].status = 'skipped_by_user';
    noSource.nodes['S01:blind'].evidence = { reason: 'missing provenance' };
    assert.throws(() => validateGraph(noSource, base, state, { file: f.loc.file }), /user_source/);
  } finally { await cleanup(f); }
});

test('recompile is blocked by plan digest mismatch and by unreconciled backup', async () => {
  const f = await fixture();
  try {
    await f.compile();
    await f.setPlan(plan().replace('Foundation', 'Edited without compile'));
    await assert.rejects(
      () => f.spawn([{ node: 'plan:initial', assignment: 'plan A', route: { subagent: 'fake', model: 'caller/model' } }]),
      /PLAN-FULL changed.*sfd_workflow_compile/,
    );
    await f.compile();
    const graph = await f.graph();
    assert.equal(graph.reconciled, false);
    await f.save(graph);
    await assert.rejects(
      () => f.spawn([{ node: 'plan:initial', assignment: 'plan A', route: { subagent: 'fake', model: 'caller/model' } }]),
      /not reconciled/,
    );
    graph.reconciled = true;
    await f.save(graph);
    const answer = await f.spawn([{ node: 'plan:initial', assignment: 'plan A', route: { subagent: 'fake', model: 'caller/model' } }]);
    assert.equal(answer.ok, true);
  } finally { await cleanup(f); }
});
test('custom review gates may extend acceptance but cannot replace mandatory Code B', async () => {
  const f = await fixture();
  try {
    await f.compile();
    await planDone(f);
    const impl = await spawnWaitDone(f, 'S01:implement');
    await markDone(f, 'S01:implement', impl.id, 1);
    const behavior = await spawnWaitDone(f, 'S01:behavior');
    await markDone(f, 'S01:behavior', behavior.id, 1);
    await markMain(f, 'S01:risk');
    const blind = await spawnWaitDone(f, 'S01:blind');
    await markDone(f, 'S01:blind', blind.id, 1);
    await markMain(f, 'S01:reconciliation');

    const graph = await f.graph();
    graph.nodes['custom-b2'] = { id: 'custom-b2', kind: 'review', role: 'final-review', needs: ['S01:blind'], unit: 'S01', section: 'S01', feature: 'business', mandatory: false, status: 'pending', evidence: null, note: '' };
    graph.nodes['S01:accept'].needs.push('custom-b2');
    await f.save(graph);
    const base = compilePlan(await readFile(f.repo + '/.agent-work/PLAN-FULL.md', 'utf8'));
    const state = await f.state();
    graph.nodes['S01:accept'].status = 'done';
    graph.nodes['S01:accept'].evidence = { reason: 'premature' };
    assert.throws(() => validateGraph(graph, base, state, { file: f.loc.file }), /custom-b2/);
    graph.nodes['S01:accept'].status = 'pending';
    graph.nodes['S01:accept'].evidence = null;
    await f.save(graph);
    await f.send(blind.id, 'custom-b2', 'Same-head B2 reconciliation');
    await f.wait(blind.id);
    await markDone(f, 'custom-b2', blind.id, 2);
    await markMain(f, 'S01:accept');
    validateGraph(await f.graph(), base, await f.state(), { file: f.loc.file });
  } finally { await cleanup(f); }
});