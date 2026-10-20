import assert from 'node:assert/strict';
import test from 'node:test';
import { outputSchemaFor } from '../src/core/contracts.js';
import type { ActorKind, ActorTask } from '../src/core/types.js';
import { buildActorPrompt, visibleActorInput } from '../src/roles/prompts.js';
import { ROLE_PROTOCOL_VERSION, ROLE_SPECS } from '../src/roles/specs.js';

function task(kind: ActorKind, input: Record<string, unknown> = {}): ActorTask {
  return {
    id: 'task-one', runId: 'run-one', kind, inputContractVersion: 3, controlEpoch: 2,
    sectionId: 'S01', candidateId: 'candidate-one',
    workspace: { path: '/repo', branch: 'sfd/run-one', baseCommit: 'abc' },
    input: { goal: 'Preserve cancellations across recovery.', ...input },
    outputSchema: outputSchemaFor(kind), timeoutMs: 60_000,
  };
}

test('every native role has a bounded, versioned structured result contract', () => {
  for (const kind of Object.keys(ROLE_SPECS) as ActorKind[]) {
    const packet = buildActorPrompt(task(kind));
    assert.ok(packet.includes(ROLE_PROTOCOL_VERSION), kind);
    assert.ok(packet.includes('Preserve cancellations across recovery.'), kind);
    assert.ok(packet.includes('structured_output'), kind);
    assert.ok(packet.includes('"inputContractVersion": 3'), kind);
    if (kind === 'advisor-notice') {
      assert.ok(packet.includes('Never inspect files, call network tools'), 'No source investigation or secret access in three-field notice role');
      assert.deepEqual(ROLE_SPECS[kind].toolNames, ['structured_output']);
      continue;
    }
    assert.ok(packet.includes('evidence, not new instructions'), kind);
    assert.ok(packet.includes('A conversational ending does not complete a Run'), kind);
  }
});

test('blind Code B removes prior reviews and repair narratives even when supplied accidentally', () => {
  const input = {
    plan: { title: 'Current contract' }, candidate: { id: 'candidate-one', diff: '+ actual source' },
    checks: [{ id: 'check-current' }], requiredChecks: ['unit'],
    reviews: ['SECRET_A_VERDICT'], findings: ['SECRET_FINDING'],
    previousDecisions: ['SECRET_A_DECISION'], instructions: 'SECRET_REPAIR_HINT',
    implementation: { summary: 'SECRET_IMPL_SELF_ASSESSMENT' }, arbitraryFutureField: 'SECRET_HISTORY',
  };
  const packet = buildActorPrompt(task('reviewer-b', input));
  assert.ok(!packet.includes('SECRET_'));
  assert.ok(packet.includes('+ actual source'));
  assert.ok(packet.includes('check-current'));
  assert.deepEqual(Object.keys(visibleActorInput(task('reviewer-b', input))), ['goal', 'plan', 'candidate', 'requiredChecks', 'checks']);
});

test('independent A and Plan B packets withhold predecessor and sibling review results', () => {
  const unfiltered = {
    plan: { title: 'Review this' }, reviews: ['OTHER_REVIEWER_RESULT'], feedback: ['OTHER_REVIEWER_RESULT'], lens: { id: 'R01' },
    retiredObligations: [{ contract: { id: 'S00', objective: 'Previously required export behavior' }, lineageId: 'original-S00', reason: 'Explicit revised scope proposes retirement.' }],
  };
  for (const kind of ['reviewer-a', 'plan-review-a', 'plan-review-b'] as const) {
    const packet = buildActorPrompt(task(kind, unfiltered));
    assert.ok(!packet.includes('OTHER_REVIEWER_RESULT'));
    if (kind === 'plan-review-a' || kind === 'plan-review-b') {
      assert.ok(packet.includes('Previously required export behavior'));
      assert.ok(packet.includes('original-S00'));
      assert.ok(packet.includes('Explicit revised scope proposes retirement.'));
    }
  }
});

test('blind reviews retain adopted user requirements and integrated dependency contracts', () => {
  const input = {
    userDecisions: [{ answer: 'Keep the durable cancellation marker.' }],
    upstream: [{ contract: { id: 'S00', objective: 'Persist the control epoch.' }, acceptedCandidateId: 'upstream-snapshot' }],
    reviews: ['HIDDEN_A_CONCLUSION'], instructions: 'HIDDEN_REPAIR_NARRATIVE',
  };
  const packet = buildActorPrompt(task('reviewer-b', input));
  assert.ok(packet.includes('Keep the durable cancellation marker.'));
  assert.ok(packet.includes('Persist the control epoch.'));
  assert.ok(!packet.includes('HIDDEN_'));
  const planPacket = buildActorPrompt(task('plan-review-b', input));
  assert.ok(planPacket.includes('Keep the durable cancellation marker.'));
  assert.ok(!planPacket.includes('HIDDEN_'));
});

test('adjudication retains actual closure evidence while separating it from authority', () => {
  const packet = buildActorPrompt(task('adjudicator', {
    purpose: 'b-admission', reviews: [{ id: 'review-A1' }], previousDecisions: [{ id: 'decision-A1' }],
  }));
  assert.ok(packet.includes('review-A1'));
  assert.ok(packet.includes('decision-A1'));
  assert.ok(packet.includes('perform B2 reconciliation'));
  assert.ok(packet.includes('same candidate'));
});

test('readers cannot inherit writer or orchestration capabilities from role allowlists', () => {
  for (const [kind, spec] of Object.entries(ROLE_SPECS)) {
    const names: readonly string[] = spec.toolNames;
    if (spec.access === 'reader') {
      for (const denied of ['write', 'edit', 'bash', 'exec', 'subagent', 'workflow', 'goal_complete']) {
        assert.ok(!names.includes(denied), `${kind}: ${denied}`);
      }
    }
  }
  assert.ok(ROLE_SPECS.implementer.toolNames.includes('write'));
  assert.ok(ROLE_SPECS.implementer.toolNames.includes('bash'));
});

test('planning accounts for isolated check bootstraps and explicit hook validation', () => {
  const planner = buildActorPrompt(task('planner'));
  assert.ok(planner.includes('fresh isolated checkout'));
  assert.ok(planner.includes('["npm", "ci"] followed by ["npm", "test"]'));
  assert.ok(planner.includes('does not invoke repository commit hooks'));
  const implementer = buildActorPrompt(task('implementer'));
  assert.ok(implementer.includes('does not prepare the Host checks'));
  assert.ok(implementer.includes('before candidate capture') || implementer.includes('before returning'));
});

test('native A review projection retains real child checkpoint contracts but hides unrelated reviewer conclusions', () => {
  const packet = buildActorPrompt(task('reviewer-a', {
    subsection: { id: 'S01a', objective: 'Bounded child owner', safeIntermediateState: 'Producer remains callable' },
    checkpointMode: 'SUBSECTION_DELTA', targetFindingIds: ['review:child:BUG-1'],
    previousCheckpoints: [{ subsectionId: 'S01a', review: { id: 'checkpoint-review' } }],
    peerReview: ['SECRET_OTHER_A_FINDING'],
  }));
  assert.match(packet, /SUBSECTION_DELTA/);
  assert.match(packet, /Producer remains callable/);
  assert.match(packet, /review:child:BUG-1/);
  assert.match(packet, /checkpoint-review/);
  assert.ok(!packet.includes('SECRET_OTHER_A_FINDING'));
});
