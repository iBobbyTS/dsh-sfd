/**
 * Ledger transitions over a real tmp directory: atomic single-writer facts,
 * revision bumps, spawn counting, event upserts, artifact classification.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initialRun, loadRun, detectWork, recordSpawn, recordEvent, recordArtifact, closeRun, derivePhase, RUN_FILE, AGENT_WORK } from '../lib/ledger.js';

async function makeRoot() {
  return mkdtemp(join(tmpdir(), 'sfd-ledger-'));
}

const base = { taskSummary: 'add dark mode', slug: 'dark-mode', branch: 'sfd/dark-mode', git: { base: 'main', dirty: false, detached: false, midMerge: false } };

test('initialRun anchors the run and loads back', async () => {
  const root = await makeRoot();
  try {
    const run = initialRun(root, base);
    await (await import('../lib/ledger.js')).flush(run);
    const back = await loadRun(root);
    assert.equal(back.run.slug, 'dark-mode');
    assert.equal(back.run.branch, 'sfd/dark-mode');
    assert.equal(back.run.status, 'active');
    assert.equal(back.revision, 1);
    assert.deepEqual(back.counts, {});
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('recordSpawn counts each actor once, idempotent on the same id', async () => {
  const root = await makeRoot();
  try {
    let run = initialRun(root, base);
    run = await recordSpawn(run, { agentId: '1001', profile: 'sfd-zcode-plan-review', role: 'plan-review', promptHeadline: 'review the plan', reportHint: '.agent-work/reviews/plan-a.md' });
    run = await recordSpawn(run, { agentId: '1001', profile: 'sfd-zcode-plan-review', role: 'plan-review' });
    run = await recordSpawn(run, { agentId: '1002', profile: 'sfd-zcode-plan-review', role: 'plan-review' });
    assert.equal(run.counts['plan-review'], 2, 'a repeated observation of the same spawn must not double count');
    assert.equal(run.actors['1001'].status, 'running');
    assert.equal(run.revision, 3);
    const back = await loadRun(root);
    assert.equal(back.counts['plan-review'], 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('recordEvent marks terminal once and close separately', async () => {
  const root = await makeRoot();
  try {
    let run = initialRun(root, base);
    run = await recordSpawn(run, { agentId: '7', role: 'impl', profile: 'sfd-dsh-impl-std' });
    const revAfterSpawn = run.revision;
    run = await recordEvent(run, { agentId: '7', event: 'wait', status: 'running' });
    assert.equal(run.revision, revAfterSpawn + 1);
    run = await recordEvent(run, { agentId: '7', event: 'wait', status: 'running' });
    assert.equal(run.revision, revAfterSpawn + 1, 'a no-change event is not journaled');
    run = await recordEvent(run, { agentId: '7', event: 'result', outcome: 'COMPLETED' });
    assert.equal(run.actors['7'].status, 'terminal');
    assert.equal(run.actors['7'].outcome, 'COMPLETED');
    run = await recordEvent(run, { agentId: '7', event: 'close' });
    assert.equal(run.actors['7'].closed, true);
    run = await recordEvent(run, { agentId: '999', event: 'close' });
    assert.ok(!run.actors['999'], 'unknown actors are ignored, not invented');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('recordArtifact classifies and caps; closeRun stops phases', async () => {
  const root = await makeRoot();
  try {
    let run = initialRun(root, base);
    run = await recordArtifact(run, '.agent-work/PLAN-FULL.md', 'plan');
    run = await recordArtifact(run, '.agent-work/PLAN-FULL.md', 'plan');
    run = await recordArtifact(run, '.agent-work/reviews/plan-a.md', 'reports');
    assert.deepEqual(run.artifacts.plan, ['.agent-work/PLAN-FULL.md']);
    assert.equal(run.artifacts.reports.length, 1);
    assert.equal(derivePhase(run), 'plan-review');
    run = await closeRun(run);
    assert.equal(run.run.status, 'closed');
    assert.equal(derivePhase(run), 'closed');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('derivePhase walks the observed milestones', async () => {
  const root = await makeRoot();
  try {
    let run = initialRun(root, base);
    assert.equal(derivePhase(run), 'starting');
    run = await recordArtifact(run, '.agent-work/PLAN-FULL.md', 'plan');
    assert.equal(derivePhase(run), 'plan-review');
    run = await recordSpawn(run, { agentId: '1', role: 'plan-review' });
    assert.equal(derivePhase(run), 'plan-review');
    run = await recordSpawn(run, { agentId: '2', role: 'plan-review' });
    run = await recordSpawn(run, { agentId: '3', role: 'impl' });
    assert.equal(derivePhase(run), 'implement');
    run = await recordSpawn(run, { agentId: '4', role: 'code-review' });
    assert.equal(derivePhase(run), 'code-review');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('detectWork finds the ledger, then legacy markers', async () => {
  const root = await makeRoot();
  try {
    let detection = await detectWork(root);
    assert.equal(detection.present, false);
    const { mkdir, writeFile } = await import('node:fs/promises');
    await mkdir(join(root, AGENT_WORK), { recursive: true });
    await writeFile(join(root, AGENT_WORK, 'sfd-state.json'), '{}');
    detection = await detectWork(root);
    assert.equal(detection.kind, 'legacy-markers');
    assert.ok(detection.markers.includes('sfd-state.json'), 'the pre-plugin state file is a legacy marker');
    await writeFile(join(root, AGENT_WORK, RUN_FILE), JSON.stringify(initialRun(root, base)));
    detection = await detectWork(root);
    assert.equal(detection.kind, 'run');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('the ledger file on disk is always complete JSON (atomic writes)', async () => {
  const root = await makeRoot();
  try {
    let run = initialRun(root, base);
    for (let i = 0; i < 5; i += 1) {
      run = await recordSpawn(run, { agentId: String(1000 + i), role: 'impl' });
      const text = await readFile(join(root, AGENT_WORK, RUN_FILE), 'utf8');
      assert.doesNotThrow(() => JSON.parse(text));
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
