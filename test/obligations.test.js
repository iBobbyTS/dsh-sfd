/**
 * Obligation derivation: the observable invariants of the latest skill.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveObligations, hasWarning } from '../lib/obligations.js';
import { initialRun, recordSpawn, recordEvent, recordArtifact, closeRun } from '../lib/ledger.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function freshRoot() {
  return mkdtemp(join(tmpdir(), 'sfd-obl-'));
}

const ids = (obligations) => obligations.map((o) => o.id);

test('a fresh run is in starting phase with no obligations', async () => {
  const root = await freshRoot();
  try {
    const { phase, obligations } = deriveObligations(initialRun(root, { slug: 'x', branch: 'b' }));
    assert.equal(phase, 'starting');
    assert.deepEqual(obligations, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('plan observed -> plan-coverage obligation counts dispatches vs completions', async () => {
  const root = await freshRoot();
  try {
    let run = initialRun(root, { slug: 'x', branch: 'b' });
    run = await recordArtifact(run, '.agent-work/PLAN-FULL.md', 'plan');
    run = await recordSpawn(run, { agentId: '1', role: 'plan-review' });
    let derived = deriveObligations(run);
    assert.equal(derived.phase, 'plan-review');
    assert.ok(ids(derived.obligations).includes('plan-coverage'));
    const cov = derived.obligations.find((o) => o.id === 'plan-coverage');
    assert.equal(cov.params.dispatched, 1);
    assert.equal(cov.params.done, 0);
    // first reviewer completes; the obligation persists until two are done
    run = await recordEvent(run, { agentId: '1', event: 'result', outcome: 'COMPLETED' });
    derived = deriveObligations(run);
    assert.equal(derived.obligations.find((o) => o.id === 'plan-coverage').params.done, 1);
    run = await recordSpawn(run, { agentId: '2', role: 'plan-review' });
    run = await recordEvent(run, { agentId: '2', event: 'result', outcome: 'COMPLETED' });
    derived = deriveObligations(run);
    assert.ok(!ids(derived.obligations).includes('plan-coverage'), 'two completed coverages satisfy the observed invariant');
    assert.equal(hasWarning(derived), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('implementer before closed plan coverage is a warning', async () => {
  const root = await freshRoot();
  try {
    let run = initialRun(root, { slug: 'x', branch: 'b' });
    run = await recordArtifact(run, '.agent-work/PLAN-FULL.md', 'plan');
    run = await recordSpawn(run, { agentId: '1', role: 'plan-review' });
    run = await recordEvent(run, { agentId: '1', event: 'result', outcome: 'COMPLETED' });
    run = await recordSpawn(run, { agentId: '2', role: 'plan-review' });
    run = await recordSpawn(run, { agentId: '3', role: 'impl' });
    const derived = deriveObligations(run);
    assert.equal(derived.phase, 'implement');
    const warn = derived.obligations.find((o) => o.id === 'plan-skip-warn');
    assert.ok(warn, 'impl dispatched with one completed coverage warns');
    assert.equal(warn.severity, 'warn');
    assert.equal(warn.params.done, 1);
    assert.equal(hasWarning(derived), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('lifecycle obligations: running actors awaited, terminal actors closed', async () => {
  const root = await freshRoot();
  try {
    let run = initialRun(root, { slug: 'x', branch: 'b' });
    run = await recordArtifact(run, '.agent-work/PLAN-FULL.md', 'plan');
    run = await recordSpawn(run, { agentId: '1', role: 'plan-review' });
    run = await recordSpawn(run, { agentId: '2', role: 'plan-review' });
    for (const id of ['1', '2']) run = await recordEvent(run, { agentId: id, event: 'result', outcome: 'COMPLETED' });
    run = await recordSpawn(run, { agentId: '3', role: 'impl' });
    const derived = deriveObligations(run);
    assert.ok(ids(derived.obligations).includes('await-actors'));
    assert.ok(ids(derived.obligations).includes('close-actors'));
    const close = derived.obligations.find((o) => o.id === 'close-actors');
    assert.equal(close.params.ids, '1 2');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('implement phase reminds freeze; code-review phase reminds B1/B2 discipline', async () => {
  const root = await freshRoot();
  try {
    let run = initialRun(root, { slug: 'x', branch: 'b' });
    run = await recordArtifact(run, '.agent-work/PLAN-FULL.md', 'plan');
    for (const id of ['1', '2']) {
      run = await recordSpawn(run, { agentId: id, role: 'plan-review' });
      run = await recordEvent(run, { agentId: id, event: 'result', outcome: 'COMPLETED' });
    }
    run = await recordSpawn(run, { agentId: '3', role: 'impl' });
    run = await recordEvent(run, { agentId: '3', event: 'result', outcome: 'COMPLETED' });
    let derived = deriveObligations(run);
    assert.equal(derived.phase, 'implement');
    assert.ok(ids(derived.obligations).includes('freeze-before-review'));
    run = await recordSpawn(run, { agentId: '4', role: 'code-review' });
    derived = deriveObligations(run);
    assert.equal(derived.phase, 'code-review');
    const cov = derived.obligations.find((o) => o.id === 'code-coverage');
    assert.ok(cov);
    assert.equal(cov.params.dispatched, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a closed run has no obligations', async () => {
  const root = await freshRoot();
  try {
    let run = initialRun(root, { slug: 'x', branch: 'b' });
    run = await recordSpawn(run, { agentId: '1', role: 'impl' });
    run = await closeRun(run);
    const derived = deriveObligations(run);
    assert.equal(derived.phase, 'closed');
    assert.deepEqual(derived.obligations, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
