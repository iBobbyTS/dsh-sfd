import test from 'node:test';
import assert from 'node:assert/strict';
import { WorkflowController } from '../src/core/controller.js';
import { runSchema } from '../src/core/schemas.js';
import type { ActorRunner, RunStore, WorkspacePort } from '../src/core/ports.js';
import type { ActorOutcome, ActorTask, AdjudicationOutput, Candidate, CommitEvidence, DevelopmentPlan, DevelopmentRun, FeatureVerificationOutput, ReviewEvidence, WorkspaceInfo } from '../src/core/types.js';

class MemoryStore implements RunStore {
  readonly runs = new Map<string, DevelopmentRun>();
  private chain: Promise<unknown> = Promise.resolve();
  async list() { return [...this.runs.values()].map((run) => structuredClone(run)); }
  async get(id: string) { const run = this.runs.get(id); return run && structuredClone(run); }
  async create(run: DevelopmentRun) { runSchema.parse(run); this.runs.set(run.id, structuredClone(run)); }
  async update(id: string, transform: (run: DevelopmentRun) => DevelopmentRun) {
    const job = this.chain.then(() => {
      const run = this.runs.get(id); if (!run) throw new Error('Missing run.');
      const next = transform(structuredClone(run)); runSchema.parse(next);
      this.runs.set(id, structuredClone(next)); return structuredClone(next);
    });
    this.chain = job.catch(() => undefined); return job;
  }
}

const plan: DevelopmentPlan = {
  title: 'Business export', assumptions: [],
  features: [{ id: 'F1', title: 'Export', outcome: 'A user exports their records.', acceptanceCriteria: ['User can export exactly their records.'], sectionIds: ['S1'], checks: [{ id: 'business', command: ['node', '--test', 'business.test.js'], required: true }] }],
  sections: [{ id: 'S1', title: 'Export implementation', featureIds: ['F1'], objective: 'Implement the export.', dependencies: [], writeScope: ['src/export.ts'], acceptanceCriteria: ['Export respects account ownership.'], implementation: 'standard', checks: [{ id: 'unit', command: ['node', '--test'], required: true }], subsections: [] }],
};
const clean = { verdict: 'clean', summary: 'The bounded behavior was checked.', coverage: ['Business contract and relevant changes'], limitations: [], findings: [] };
function accept(extra: Partial<AdjudicationOutput> = {}): AdjudicationOutput {
  return { resolution: 'accept', summary: 'Current obligations are supported by the available evidence.', coverageSufficient: true, dispositions: [], repairInstructions: '', material: false, invalidatedSectionIds: [], missingCoverage: [], evidenceReuse: [], ...extra };
}

class FakeWorkspace implements WorkspacePort {
  version = 0;
  checkCalls = 0;
  commitCalls = 0;
  failChecks = false;
  unsafe = false;
  async inspect(path: string) { return { path, branch: 'main', baseCommit: 'base' }; }
  async prepare(run: DevelopmentRun) { return { ...run.workspace, path: `/writer/${run.id}`, branch: `sfd/${run.id}`, prepared: true }; }
  async capture(_run: DevelopmentRun): Promise<Candidate> { return { id: `candidate-${this.version}`, capturedAt: new Date().toISOString(), workspacePath: `/snapshot/${this.version}`, head: 'base', treeHash: `tree-${this.version}`, diff: `actual diff ${this.version}`, changedFiles: ['src/export.ts'] }; }
  async check(run: DevelopmentRun, candidate: Candidate, specs: Parameters<WorkspacePort['check']>[2]) {
    this.checkCalls++;
    return specs.map((spec) => ({ id: `check:${candidate.id}:${spec.id}`, candidateId: candidate.id, specId: spec.id, status: this.failChecks ? 'failed' as const : 'passed' as const, exitCode: this.failChecks ? 1 : 0, startedAt: run.createdAt, endedAt: run.updatedAt, output: 'Actual host command output.' }));
  }
  async commit(run: DevelopmentRun, candidate: Candidate, message: string) { this.commitCalls++; return { commit: 'delivered', candidateId: candidate.id, branch: run.workspace.branch, createdAt: run.updatedAt, message }; }
  async reconcile(run: DevelopmentRun) { return { safe: !this.unsafe, candidate: await this.capture(run), ...(this.unsafe ? { reason: 'Unknown writes need explicit inspection.' } : {}) }; }
}

type Responder = (task: ActorTask) => unknown | Promise<unknown>;
class FakeActors implements ActorRunner {
  readonly calls: ActorTask[] = [];
  responder?: Responder;
  constructor(readonly workspace: FakeWorkspace, readonly configuredPlan = plan) {}
  async start(task: ActorTask, _signal?: AbortSignal) {
    this.calls.push(structuredClone(task));
    const output = Promise.resolve().then(() => this.responder ? this.responder(task) : this.defaultResult(task));
    const result: Promise<ActorOutcome> = output.then((value) => ({ status: 'completed', output: value, identity: { transport: 'test', sessionId: task.id } }));
    return { id: `actor-${task.id}`, result, async dispose() {} };
  }
  defaultResult(task: ActorTask): unknown {
    if (task.kind === 'planner') return { plan: this.configuredPlan, explanation: 'The plan maps business outcomes to parent Sections.' };
    if ((task.kind === 'plan-review-a' || task.kind === 'plan-review-b') && task.input.reviewMode === 'PLAN_DELTA') {
      const prior = task.input.previousSlot as { attemptId: string };
      return { ...clean, planEvidenceReuse: [{ attemptId: prior.attemptId, reason: 'The corrected current plan retains still-valid reviewed requirements and all changed source/owner relationships were inspected.' }] };
    }
    if (task.kind === 'implementer') {
      this.workspace.version++;
      return { summary: 'Implemented required behavior.', completedCriteria: ['Export respects account ownership.'], remainingWork: [], changedInterfaces: [] };
    }
    if (task.kind === 'review-selector') return { lenses: [{ id: 'R01', name: 'Full behavior baseline', focus: 'Complete business behavior' }], rationale: 'One bounded risk.' };
    if (task.kind === 'adjudicator' && task.input.purpose === 'plan-admission') {
      const findings = task.input.findings as { id: string }[];
      return accept({ resolution: 'repair', repairInstructions: 'Correct confirmed requirement coverage.',
        dispositions: findings.map((finding) => ({ findingId: finding.id, decision: 'fix', reason: 'Verified against current business contract.' })) });
    }
    if (task.kind === 'adjudicator') {
      const reviews = task.input.reviews as ReviewEvidence[];
      return accept({ evidenceReuse: task.input.purpose === 'closure-admission' ? reviews.filter((review) => review.stage === 'a').map((review) => ({ evidenceId: review.id, reason: 'The direct repair is covered by the current closure; the unaffected baseline remains applicable.' })) : [] });
    }
    if (task.kind === 'feature-verifier') {
      const checks = task.input.checks as { id: string; status: string }[];
      const passed = checks.find((check) => check.status === 'passed');
      if (!passed) throw new Error('Fixture expected a real successful final Feature check.');
      return { verdict: 'accepted', summary: 'The final business path is demonstrated.', criteria: this.configuredPlan.features.flatMap((feature) => feature.acceptanceCriteria.map((criterion) => ({ featureId: feature.id, criterion, evidenceIds: [passed.id], satisfied: true }))), repairSectionIds: [], repairInstructions: '' } satisfies FeatureVerificationOutput;
    }
    if (task.kind === 'closure-reviewer') return {
      ...clean, closures: ((task.input.targetFindingIds ?? []) as string[]).map((findingId) => ({
        findingId, status: 'verified-closed', evidence: 'Verified the exact repaired invariant on the current candidate.',
      })),
    };
    if (task.kind === 'diagnostician') return { summary: 'An independent diagnosis was completed.', recommendation: 'retry', instructions: 'Repair the demonstrated root cause and preserve the contract.' };
    return clean;
  }
}

function rig(configuredPlan = plan) {
  const store = new MemoryStore(); const workspace = new FakeWorkspace(); const actors = new FakeActors(workspace, configuredPlan);
  const controller = new WorkflowController({ store, actors, workspace });
  return { store, workspace, actors, controller };
}
async function waitFor(controller: WorkflowController, id: string, predicate: (run: DevelopmentRun) => boolean, timeoutMs = 4000): Promise<DevelopmentRun> {
  const initial = await controller.status(id); if (predicate(initial)) return initial;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(async () => { unsubscribe(); const latest = await controller.status(id); reject(new Error(`Timed out: ${latest.status}/${latest.stage}/${latest.activeSectionId ? latest.sections[latest.activeSectionId]?.stage : ''}; ${latest.blockedReason ?? ''}`)); }, timeoutMs);
    const unsubscribe = controller.subscribe((run) => { if (run.id === id && predicate(run)) { clearTimeout(timeout); unsubscribe(); resolve(run); } });
  });
}
async function launch(controller: WorkflowController) { const run = await controller.create({ goal: 'Users can export their own records.', workspacePath: '/project', policy: { commit: true } }); await controller.start(run.id); return run.id; }

test('a real bounded native workflow reaches delivery only through plan A/B, logical code A/B, host checks, and business acceptance', async () => {
  const { controller, actors, workspace } = rig();
  const id = await launch(controller);
  const done = await waitFor(controller, id, (run) => ['completed', 'blocked', 'waiting-user'].includes(run.status));
  assert.equal(done.status, 'completed', done.blockedReason);
  assert.equal(workspace.commitCalls, 1);
  assert.equal(workspace.checkCalls, 2);
  assert.equal(done.sections.S1.stage, 'integrated');
  assert.equal(done.sections.S1.aAcceptedCandidateId, done.sections.S1.acceptedCandidateId);
  const kinds = actors.calls.map((task) => task.kind);
  assert.ok(kinds.indexOf('plan-review-a') < kinds.indexOf('plan-review-b'));
  assert.ok(kinds.indexOf('plan-review-b') < kinds.indexOf('implementer'));
  const reviewer = actors.calls.find((task) => task.kind === 'reviewer-b')!;
  assert.equal(reviewer.workspace.path, '/snapshot/1');
  assert.equal(actors.calls.find((task) => task.kind === 'implementer')!.workspace.path, `/writer/${id}`);
  for (const key of ['reviews', 'previousReviews', 'previousDecisions', 'repairInstructions', 'instructions', 'feedback']) assert.equal(Object.hasOwn(reviewer.input, key), false);
  assert.equal(done.attempts.every((attempt) => attempt.state === 'admitted'), true);
  await controller.dispose();
});

test('parallel A reports remain admissible after another report increments the aggregate revision', async () => {
  const { controller, actors } = rig();
  let release!: (value: unknown) => void;
  const delayed = new Promise((resolve) => { release = resolve; });
  actors.responder = (task) => {
    if (task.kind === 'review-selector') return { lenses: [{ id: 'R01', name: 'Behavior', focus: 'Complete behavior' }, { id: 'R03', name: 'Identity', focus: 'Cross account access' }], rationale: 'Independent risks.' };
    if (task.kind === 'reviewer-a' && task.lens?.id === 'R03') return delayed;
    return actors.defaultResult(task);
  };
  const id = await launch(controller);
  const mid = await waitFor(controller, id, (run) => run.attempts.some((attempt) => attempt.task.lens?.id === 'R01' && attempt.state === 'admitted') && run.attempts.some((attempt) => attempt.task.lens?.id === 'R03' && attempt.state === 'started'));
  assert.equal(actors.calls.some((task) => task.kind === 'reviewer-b'), false);
  release(clean);
  const done = await waitFor(controller, id, (run) => ['completed', 'blocked', 'waiting-user'].includes(run.status));
  assert.equal(done.status, 'completed', done.blockedReason);
  assert.ok(done.revision > mid.revision);
  assert.equal(done.reviews.filter((review) => review.stage === 'a').length, 2);
  assert.equal(new Set(done.reviews.filter((review) => review.stage === 'a').map((review) => review.candidateId)).size, 1);
  await controller.dispose();
});

test('material B fix requires fresh closure, admitted logical A reuse, and a full new blind B on the repaired candidate', async () => {
  const { controller, actors, workspace } = rig();
  let bCalls = 0;
  actors.responder = (task) => {
    if (task.kind === 'reviewer-b' && ++bCalls === 1) return { ...clean, verdict: 'findings', findings: [{ id: 'BUG1', title: 'Account boundary', body: 'The export can cross the account boundary.', severity: 'major', invariant: 'Only current-account records may be exported.' }] };
    if (task.kind === 'adjudicator' && task.input.purpose === 'b-admission' && workspace.version === 1) {
      const findings = task.input.findings as { id: string }[];
      return accept({ resolution: 'repair', dispositions: findings.map((finding) => ({ findingId: finding.id, decision: 'fix', reason: 'The bounded counterexample is real.' })), repairInstructions: 'Apply account scoping and test cross-account export.', material: true });
    }
    return actors.defaultResult(task);
  };
  const id = await launch(controller);
  const done = await waitFor(controller, id, (run) => ['completed', 'blocked', 'waiting-user'].includes(run.status));
  assert.equal(done.status, 'completed', done.blockedReason);
  assert.equal(done.sections.S1.materialRepairWaves, 1);
  const b = actors.calls.filter((task) => task.kind === 'reviewer-b');
  assert.equal(b.length, 2);
  assert.notEqual(b[0].candidateId, b[1].candidateId);
  assert.equal(actors.calls.filter((task) => task.kind === 'closure-reviewer').length, 1);
  assert.equal(actors.calls.filter((task) => task.kind === 'reviewer-a').length, 1);
  assert.equal(done.sections.S1.aAcceptedCandidateId, b[1].candidateId);
  await controller.dispose();
});

test('a model cannot turn failing actual checks into accepted work', async () => {
  const { controller, workspace } = rig(); workspace.failChecks = true;
  const id = await launch(controller);
  const stopped = await waitFor(controller, id, (run) => run.status === 'blocked');
  assert.match(stopped.blockedReason!, /actual passing host checks/);
  assert.equal(workspace.commitCalls, 0);
  assert.equal(stopped.sections.S1.materialRepairWaves, 0);
  await controller.dispose();
});

test('pause dominates late results and does not permit B or completion to start', async () => {
  const { controller, actors } = rig();
  let release!: (value: unknown) => void;
  actors.responder = (task) => task.kind === 'reviewer-a' ? new Promise((resolve) => { release = resolve; }) : actors.defaultResult(task);
  const id = await launch(controller);
  await waitFor(controller, id, (run) => run.attempts.some((attempt) => attempt.task.kind === 'reviewer-a' && attempt.state === 'started'));
  await controller.pause(id); release(clean);
  await new Promise((resolve) => setTimeout(resolve, 30));
  const paused = await controller.status(id);
  assert.equal(paused.status, 'paused');
  assert.equal(actors.calls.some((task) => task.kind === 'reviewer-b'), false);
  assert.equal(paused.reviews.length, 0);
  await controller.dispose();
});

test('startup recovery retains unknown writer identity and never blindly redispatches it', async () => {
  const { controller, actors, store, workspace } = rig();
  actors.responder = (task) => task.kind === 'implementer' ? new Promise(() => {}) : actors.defaultResult(task);
  const id = await launch(controller);
  await waitFor(controller, id, (run) => run.attempts.some((attempt) => attempt.task.kind === 'implementer' && attempt.state === 'started'));
  const snapshot = structuredClone((await store.get(id))!);
  const recoveredStore = new MemoryStore(); await recoveredStore.create(snapshot);
  const recoveredActors = new FakeActors(workspace);
  const recovered = new WorkflowController({ store: recoveredStore, actors: recoveredActors, workspace });
  await recovered.recover();
  const state = await recovered.status(id);
  assert.equal(state.status, 'paused');
  assert.equal(state.attempts.find((attempt) => attempt.task.kind === 'implementer')!.state, 'unknown');
  assert.equal(recoveredActors.calls.length, 0);
  await controller.dispose(); await recovered.dispose();
});

test('commit capability defaults to denied and verified worktree delivery never fabricates a commit', async () => {
  const { controller, workspace } = rig();
  const created = await controller.create({ goal: 'Implement export', workspacePath: '/project' });
  assert.equal(created.policy.commit, false);
  await controller.start(created.id);
  const stopped = await waitFor(controller, created.id, (run) => run.status === 'completed');
  assert.equal(stopped.delivery?.mode, 'worktree');
  assert.equal(stopped.commit, undefined);
  assert.equal(workspace.commitCalls, 0);
  await controller.dispose();
});

test('pause waits for a late-publishing startup handle to be stopped before reporting quiescence', async () => {
  const { store, workspace } = rig();
  const standard = new FakeActors(workspace);
  let publish!: (handle: Awaited<ReturnType<ActorRunner['start']>>) => void;
  let stopped = false;
  const actors: ActorRunner = {
    start: async (task, signal) => task.kind === 'implementer'
      ? new Promise((resolve) => { publish = resolve; })
      : standard.start(task, signal),
  };
  const controller = new WorkflowController({ store, workspace, actors });
  const id = await launch(controller);
  await waitFor(controller, id, (run) => run.attempts.some((attempt) => attempt.task.kind === 'implementer' && attempt.state === 'started'));
  let paused = false;
  const pausing = controller.pause(id).then(() => { paused = true; });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(paused, false);
  assert.equal((await controller.status(id)).status, 'pausing');
  publish({ id: 'late-writer', result: new Promise(() => {}), async dispose() { stopped = true; } });
  await pausing;
  assert.equal(stopped, true);
  assert.equal((await controller.status(id)).status, 'paused');
  await controller.dispose();
});

test('old-epoch terminal result is preserved but not admitted after resume', async () => {
  const { controller, actors, store } = rig();
  let aCalls = 0;
  actors.responder = (task) => task.kind === 'reviewer-a' && ++aCalls === 1 ? new Promise(() => {}) : actors.defaultResult(task);
  const id = await launch(controller);
  const started = await waitFor(controller, id, (run) => run.attempts.some((attempt) => attempt.task.kind === 'reviewer-a' && attempt.state === 'started'));
  const previous = started.attempts.find((attempt) => attempt.task.kind === 'reviewer-a')!;
  // Simulate a durable late terminal arriving just before pause, but before admission.
  await store.update(id, (run) => {
    const attempt = run.attempts.find((entry) => entry.id === previous.id)!;
    attempt.state = 'terminal'; attempt.outcome = { status: 'completed', output: clean, identity: { transport: 'test' } }; return run;
  });
  await controller.pause(id);
  await controller.resume(id);
  const done = await waitFor(controller, id, (run) => ['completed', 'blocked', 'waiting-user'].includes(run.status));
  assert.equal(done.status, 'completed', done.blockedReason);
  const old = done.attempts.find((attempt) => attempt.id === previous.id)!;
  assert.equal(old.state, 'terminal'); assert.match(old.rejection!, /obsolete/);
  assert.equal(done.reviews.some((review) => review.attemptId === previous.id), false);
  assert.equal(aCalls, 2);
  await controller.dispose();
});

function twoSectionPlan(): DevelopmentPlan {
  const value = structuredClone(plan);
  value.features[0].sectionIds = ['S1', 'S2'];
  value.sections.push({ ...structuredClone(value.sections[0]), id: 'S2', title: 'Consumer', dependencies: ['S1'], writeScope: ['src/consumer.ts'] });
  return value;
}

test('Feature repair assigns each named owner its own implementation and preserves dependency release', async () => {
  const { controller, actors } = rig(twoSectionPlan());
  let featureCalls = 0;
  actors.responder = (task) => {
    if (task.kind === 'feature-verifier' && ++featureCalls === 1) {
      const result = actors.defaultResult(task) as FeatureVerificationOutput;
      return { ...result, verdict: 'repair', repairSectionIds: ['S1', 'S2'], repairInstructions: 'Each owner must fix its own side of the composition contract.' };
    }
    return actors.defaultResult(task);
  };
  const id = await launch(controller);
  const done = await waitFor(controller, id, (run) => ['completed', 'blocked', 'waiting-user'].includes(run.status));
  assert.equal(done.status, 'completed', done.blockedReason);
  for (const sectionId of ['S1', 'S2']) {
    const implementations = actors.calls.filter((task) => task.kind === 'implementer' && task.sectionId === sectionId);
    assert.equal(implementations.length, 2);
    assert.equal(done.sections[sectionId].materialRepairWaves, 1);
    assert.match(String(implementations[1].input.instructions), /own side/);
  }
  assert.equal(done.delivery?.candidateId, 'candidate-4');
  await controller.dispose();
});

test('invalidated accepted Section captures the new candidate and reruns its real checks before acceptance', async () => {
  const { controller, actors } = rig(twoSectionPlan());
  let invalidated = false;
  actors.responder = (task) => {
    if (task.kind === 'adjudicator' && task.sectionId === 'S2' && task.input.purpose === 'a-admission' && !invalidated) {
      invalidated = true;
      return accept({ resolution: 'repair', repairInstructions: 'Repair the consumer and revalidate affected producer semantics.', material: true, invalidatedSectionIds: ['S1'] });
    }
    return actors.defaultResult(task);
  };
  const id = await launch(controller);
  const done = await waitFor(controller, id, (run) => ['completed', 'blocked', 'waiting-user'].includes(run.status));
  assert.equal(done.status, 'completed', done.blockedReason);
  assert.equal(actors.calls.filter((task) => task.kind === 'implementer' && task.sectionId === 'S1').length, 1);
  assert.equal(actors.calls.filter((task) => task.kind === 'reviewer-a' && task.sectionId === 'S1').length, 2);
  assert.equal(done.sections.S1.checks[0].candidateId, 'candidate-3');
  assert.equal(done.sections.S1.acceptedCandidateId, 'candidate-3');
  await controller.dispose();
});

test('an adopted user answer is delivered to the semantic decision that asked for it', async () => {
  const { controller, actors } = rig();
  let asked = false;
  actors.responder = (task) => {
    if (task.kind === 'adjudicator' && !asked) {
      asked = true; return accept({ resolution: 'needs-user', question: 'Should administrators export all accounts or only their own?' });
    }
    if (task.kind === 'adjudicator' && task.input.purpose === 'a-admission') {
      assert.match(JSON.stringify(task.input.userDecisions), /only their own/);
    }
    return actors.defaultResult(task);
  };
  const id = await launch(controller);
  const waiting = await waitFor(controller, id, (run) => run.status === 'waiting-user');
  await controller.decide(id, { decisionId: waiting.pendingDecision!.id, answer: 'Administrators export only their own account.', action: 'continue' });
  const done = await waitFor(controller, id, (run) => ['completed', 'blocked', 'waiting-user'].includes(run.status));
  assert.equal(done.status, 'completed', done.blockedReason);
  const b = actors.calls.find((task) => task.kind === 'reviewer-b')!;
  assert.match(JSON.stringify(b.input.userDecisions), /only their own/);
  assert.equal(JSON.stringify(b.input.userDecisions).includes('Should administrators'), false);
  await controller.dispose();
});

test('read-only infrastructure retries are bounded and do not consume semantic repair waves', async () => {
  const { store, workspace } = rig(); const normal = new FakeActors(workspace);
  let tries = 0;
  const actors: ActorRunner = {
    async start(task, signal) {
      if (task.kind !== 'reviewer-a') return normal.start(task, signal);
      tries++;
      return { id: `failure-${tries}`, result: Promise.resolve({ status: 'failed', error: 'Provider transport unavailable', identity: { transport: 'test' } } as ActorOutcome), async dispose() {} };
    },
  };
  const controller = new WorkflowController({ store, workspace, actors });
  const id = await launch(controller);
  const stopped = await waitFor(controller, id, (run) => run.status === 'blocked');
  assert.equal(tries, 2);
  assert.equal(stopped.sections.S1.materialRepairWaves, 0);
  assert.deepEqual(stopped.attempts.filter((attempt) => attempt.task.kind === 'reviewer-a').map((attempt) => attempt.infrastructureRetries), [0, 1]);
  await controller.dispose();
});

test('replanning cannot turn an exhausted repair lineage into a sixth implementation wave', async () => {
  const { controller, actors, store } = rig();
  let aCalls = 0;
  actors.responder = (task) => task.kind === 'reviewer-a' && ++aCalls === 1 ? new Promise(() => {}) : actors.defaultResult(task);
  const id = await launch(controller);
  await waitFor(controller, id, (run) => run.attempts.some((attempt) => attempt.task.kind === 'reviewer-a' && attempt.state === 'started'));
  await controller.pause(id);
  await store.update(id, (run) => { run.sections.S1.materialRepairWaves = 5; return run; });
  await controller.revise(id, 'Keep the same export obligation and resolve the outstanding defect.');
  const stopped = await waitFor(controller, id, (run) => ['blocked', 'waiting-user'].includes(run.status));
  assert.match(stopped.blockedReason!, /Hard-cap|hard-cap|HARD_CAP_RECOVERY|exhausted/);
  assert.equal(actors.calls.filter((task) => task.kind === 'implementer').length, 1);
  assert.equal(stopped.sections.S1.materialRepairWaves, 5);
  await controller.dispose();
});

test('an incomplete historical report does not poison a later full report on the same unchanged candidate', async () => {
  const { controller, actors } = rig();
  let aCalls = 0;
  actors.responder = (task) => {
    if (task.kind === 'reviewer-a' && ++aCalls === 1) return { ...clean, verdict: 'incomplete', coverage: [], limitations: ['A required source file was temporarily unavailable.'] };
    if (task.kind === 'adjudicator' && task.input.purpose === 'a-admission' && aCalls === 1) return accept({ resolution: 'more-review', coverageSufficient: false, missingCoverage: ['Complete R01 behavior after source access is available.'] });
    return actors.defaultResult(task);
  };
  const id = await launch(controller);
  const done = await waitFor(controller, id, (run) => ['completed', 'blocked', 'waiting-user'].includes(run.status));
  assert.equal(done.status, 'completed', done.blockedReason);
  const a = done.reviews.filter((review) => review.stage === 'a');
  assert.equal(a.length, 2); assert.equal(a[0].candidateId, a[1].candidateId);
  assert.equal(a[0].output.verdict, 'incomplete'); assert.equal(a[1].output.verdict, 'clean');
  assert.equal(done.sections.S1.diagnosticCount, 1);
  await controller.dispose();
});

test('noncooperative startup has bounded public stop, retains unknown execution, and never releases its workspace reservation', async () => {
  const store = new MemoryStore(); const workspace = new FakeWorkspace();
  let released = false;
  const reservedWorkspace: WorkspacePort = Object.assign(workspace, { async dispose() { released = true; } });
  const controller = new WorkflowController({ store, workspace: reservedWorkspace, actors: { async start() { return new Promise(() => {}); } }, cleanupTimeoutMs: 20 });
  const run = await controller.create({ goal: 'A task', workspacePath: '/project', policy: { actorTimeoutMs: 30 } });
  await controller.start(run.id);
  await waitFor(controller, run.id, (value) => value.status === 'blocked');
  const paused = await controller.pause(run.id);
  assert.equal(paused.status, 'pausing');
  assert.ok(paused.attempts.some((attempt) => attempt.state === 'unknown'));
  await assert.rejects(controller.resume(run.id), /paused or resolved blocked/);
  await controller.cancel(run.id);
  await controller.dispose();
  assert.equal(released, false);
});

test('explicit revised scope can retire a repaired Section while keeping its original lineage history', async () => {
  const configured = twoSectionPlan();
  const { controller, actors, store } = rig(configured);
  let held = false;
  actors.responder = (task) => {
    if (task.kind === 'reviewer-a' && task.sectionId === 'S2' && !held) { held = true; return new Promise(() => {}); }
    if (task.kind === 'planner' && task.input.goal === 'Only the producer export remains in scope.') {
      return { plan: structuredClone(plan), explanation: 'The user removed the consumer obligation. Existing producer lineage is preserved.' };
    }
    if (task.kind === 'feature-verifier') {
      const value = actors.defaultResult(task) as FeatureVerificationOutput;
      return { ...value, criteria: value.criteria.slice(0, 1) };
    }
    return actors.defaultResult(task);
  };
  const id = await launch(controller);
  await waitFor(controller, id, (run) => run.attempts.some((attempt) => attempt.task.kind === 'reviewer-a' && attempt.task.sectionId === 'S2' && attempt.state === 'started'));
  await controller.pause(id);
  await store.update(id, (run) => { run.sections.S2.materialRepairWaves = 2; return run; });
  await controller.revise(id, 'Only the producer export remains in scope.');
  const done = await waitFor(controller, id, (run) => ['completed', 'blocked', 'waiting-user'].includes(run.status));
  assert.equal(done.status, 'completed', done.blockedReason);
  assert.equal(done.sections.S2, undefined);
  assert.equal(done.retiredSections?.S2.state.materialRepairWaves, 2);
  assert.equal(done.retiredSections?.S2.state.lineageId, `${id}:S2`);
  assert.equal(actors.calls.filter((task) => task.kind === 'implementer' && task.sectionId === 'S1').length, 1,
    'Revised scope must not reimplement an unchanged integrated parent');
  await controller.dispose();
});

test('recovery adopts a verified prepared worktree without replaying preparation', async () => {
  class PreparedBeforeReply extends FakeWorkspace {
    prepared?: WorkspaceInfo; prepareCalls = 0;
    override async prepare(run: DevelopmentRun): Promise<WorkspaceInfo & { prepared: boolean }> {
      this.prepareCalls++; this.prepared = await super.prepare(run);
      throw new Error('Host interrupted before preparation result admission.');
    }
    override async reconcile(run: DevelopmentRun) {
      return { safe: Boolean(run.workspace.prepared), workspace: this.prepared, candidate: await this.capture(run), reason: 'Prepared manifest and worktree were independently checked.' };
    }
  }
  const store = new MemoryStore(); const workspace = new PreparedBeforeReply(); const actors = new FakeActors(workspace);
  const controller = new WorkflowController({ store, workspace, actors });
  const id = await launch(controller);
  const blocked = await waitFor(controller, id, (run) => run.status === 'blocked');
  assert.equal(blocked.workspace.prepared, undefined);
  await controller.decide(id, { decisionId: blocked.pendingDecision!.id, answer: 'I inspected the prepared manifest and exact worktree; adopt the actual prepared workspace.', action: 'continue' });
  const done = await waitFor(controller, id, (run) => ['completed', 'blocked', 'waiting-user'].includes(run.status));
  assert.equal(done.status, 'completed', done.blockedReason);
  assert.equal(workspace.prepareCalls, 1);
  assert.equal(done.operations[0].state, 'unknown');
  assert.ok(done.operations[0].recoveryDecisionId);
  await controller.dispose();
});

test('actual delivery receipt closes a commit admission gap without replay or fabricated business acceptance', async () => {
  class CommittedBeforeReply extends FakeWorkspace {
    receipt?: CommitEvidence;
    override async commit(run: DevelopmentRun, candidate: Candidate, message: string): Promise<CommitEvidence> {
      this.receipt = await super.commit(run, candidate, message);
      throw new Error('Commit happened, but response was lost before state admission.');
    }
    override async reconcile(run: DevelopmentRun) {
      const candidate = await this.capture(run);
      return this.receipt
        ? { safe: false, candidate: { ...candidate, id: 'actual-delivered-head', head: this.receipt.commit }, commit: this.receipt, reason: 'Actual HEAD and immutable tree match the verified commit receipt.' }
        : { safe: true, candidate };
    }
  }
  const store = new MemoryStore(); const workspace = new CommittedBeforeReply(); const actors = new FakeActors(workspace);
  const controller = new WorkflowController({ store, workspace, actors });
  const id = await launch(controller);
  const blocked = await waitFor(controller, id, (run) => run.status === 'blocked');
  assert.equal(blocked.stage, 'delivery'); assert.equal(blocked.commit, undefined);
  const done = await controller.decide(id, { decisionId: blocked.pendingDecision!.id, answer: 'I verified that the exact accepted candidate was actually committed; adopt that receipt.', action: 'continue' });
  assert.equal(done.status, 'completed'); assert.equal(workspace.commitCalls, 1);
  assert.equal(done.commit?.commit, 'delivered');
  assert.equal(done.currentCandidateId, workspace.receipt?.candidateId);
  await controller.dispose();
});

test('closure cannot accept an unresolved admitted finding just because a targeted reviewer says clean', async () => {
  const { controller, actors, workspace } = rig();
  let bCalls = 0;
  actors.responder = (task) => {
    if (task.kind === 'reviewer-b' && ++bCalls === 1)
      return { ...clean, verdict: 'findings', findings: [{ id: 'BUG1', title: 'Ownership', body: 'Export leaks across accounts.', severity: 'major', invariant: 'Account isolation' }] };
    if (task.kind === 'adjudicator' && task.input.purpose === 'b-admission' && workspace.version === 1) {
      const findings = task.input.findings as { id: string }[];
      return accept({ resolution: 'repair', dispositions: findings.map((finding) => ({ findingId: finding.id, decision: 'fix', reason: 'Reproducible leak.' })),
        repairInstructions: 'Fix account isolation.', material: true });
    }
    if (task.kind === 'closure-reviewer') return { ...clean, closures: ((task.input.targetFindingIds ?? []) as string[]).map((findingId) => ({
      findingId, status: 'insufficient-evidence', evidence: 'No successful counterexample test.',
    })) };
    return actors.defaultResult(task);
  };
  const id = await launch(controller);
  const stopped = await waitFor(controller, id, (run) => ['blocked', 'waiting-user', 'completed'].includes(run.status));
  assert.notEqual(stopped.status, 'completed');
  assert.match(stopped.blockedReason ?? '', /VERIFIED_CLOSED|closure|finding/);
  assert.equal(stopped.sections.S1.materialRepairWaves, 1);
  await controller.dispose();
});

test('repair delta can reroute one new independent lens without repeating the unaffected full R01 pass', async () => {
  const { controller, actors, workspace } = rig();
  let bCalls = 0;
  actors.responder = (task) => {
    if (task.kind === 'reviewer-b' && ++bCalls === 1) return {
      ...clean, verdict: 'findings',
      findings: [{ id: 'FIX', title: 'Missing state guard', body: 'Fix the persisted guard.', severity: 'major', invariant: 'State safety' }],
    };
    if (task.kind === 'adjudicator' && task.input.purpose === 'b-admission' && workspace.version === 1) {
      const findings = task.input.findings as { id: string }[];
      return accept({ resolution: 'repair', dispositions: findings.map(({ id }) => ({ findingId: id, decision: 'fix', reason: 'Confirmed.' })),
        repairInstructions: 'Repair the guard.', material: true });
    }
    if (task.kind === 'review-selector' && task.input.phase === 'reroute') return {
      lenses: [{ id: 'R01', name: 'Behavior', focus: 'Existing baseline' }, { id: 'R03', name: 'State', focus: 'New persistence risk' }],
      rationale: 'The repaired state guard creates a previously unchecked persistence path.',
    };
    return actors.defaultResult(task);
  };
  const id = await launch(controller);
  const done = await waitFor(controller, id, (run) => ['completed', 'blocked', 'waiting-user'].includes(run.status));
  assert.equal(done.status, 'completed', done.blockedReason);
  assert.equal(actors.calls.filter((call) => call.kind === 'reviewer-a' && call.lens?.id === 'R01').length, 1);
  assert.equal(actors.calls.filter((call) => call.kind === 'reviewer-a' && call.lens?.id === 'R03').length, 1);
  assert.equal(actors.calls.filter((call) => call.kind === 'review-selector').length, 2);
  await controller.dispose();
});

test('original standard/large implementation tiers select distinct Host-authorized native model routes', async () => {
  const current = twoSectionPlan();
  current.sections[1]!.implementation = 'large';
  const { controller, actors } = rig(current);
  const run = await controller.create({ goal: 'Implement both Sections.', workspacePath: '/project', policy: {
    commit: true, largeImplementerRoute: { preset: 'sfd-implementer', provider: 'fixture', model: 'fixture-large', effort: 'high' },
  } });
  await controller.start(run.id);
  const done = await waitFor(controller, run.id, (r) => ['completed', 'blocked', 'waiting-user'].includes(r.status));
  assert.equal(done.status, 'completed', done.blockedReason);
  const standard = actors.calls.find((call) => call.kind === 'implementer' && call.sectionId === 'S1')!;
  const large = actors.calls.find((call) => call.kind === 'implementer' && call.sectionId === 'S2')!;
  assert.equal(standard.route, undefined);
  assert.equal(large.route?.model, 'fixture-large');
  assert.equal(large.route?.provider, 'fixture');
  assert.equal(large.route?.preset, 'sfd-implementer');
  await controller.dispose();
});

test('native Subsections enforce serial R01 checkpoints before consumer and parent A/B release', async () => {
  const p = structuredClone(plan);
  p.sections[0]!.subsections = [
    { id: 'S1a', objective: 'Produce the internal owner mapping.', acceptanceCriteria: ['Mapping produces correct ownership'],
      writeScope: ['src/export.ts'], safeIntermediateState: 'Internal mapping remains valid', consumer: 'S1b',
      checks: [{ id: 'child-a', command: ['node','--test'], required: true }] },
    { id: 'S1b', objective: 'Connect mapping to export entry.', acceptanceCriteria: ['Export calls mapping'],
      writeScope: ['src/export.ts'], safeIntermediateState: 'Export is ready for joint verification', consumer: 'Final user API',
      checks: [{ id: 'child-b', command: ['node','--test'], required: true }] },
  ];
  const { controller, actors } = rig(p);
  const id = await launch(controller);
  const done = await waitFor(controller, id, (run) => ['completed','blocked','waiting-user'].includes(run.status), 9000);
  assert.equal(done.status, 'completed', done.blockedReason);
  const section = done.sections.S1;
  assert.deepEqual(section.subsectionCheckpoints?.map((checkpoint) => checkpoint.subsectionId), ['S1a','S1b']);
  assert.equal(new Set(section.subsectionCheckpoints?.map((checkpoint) => checkpoint.candidateId)).size, 2);
  assert.equal(actors.calls.filter((call) => call.kind === 'implementer').length, 2);
  assert.equal(actors.calls.filter((call) => call.kind === 'reviewer-b').length, 1);
  assert.equal(actors.calls.filter((call) => call.kind === 'reviewer-a').length, 3);
  const calls = actors.calls.filter((call) => ['implementer','reviewer-a'].includes(call.kind));
  assert.ok(calls.findIndex((call) => call.kind === 'reviewer-a' && (call.input.subsection as { id?: string } | undefined)?.id === 'S1a') <
    calls.findIndex((call) => call.kind === 'implementer' && (call.input.subsection as { id?: string } | undefined)?.id === 'S1b'));
  assert.equal(section.stage, 'integrated');
  assert.equal(section.subsectionChecks?.length, 2, 'parent preserves both scoped check results');
  const parentR01 = actors.calls.find((call) => call.kind === 'reviewer-a' &&
    call.input.checkpointMode === 'PARENT_RECONCILIATION');
  assert.equal((parentR01?.input.previousCheckpoints as unknown[])?.length, 2);
  const secondChild = actors.calls.find((call) => call.kind === 'reviewer-a' &&
    call.input.checkpointMode === 'SUBSECTION_DELTA' && (call.input.subsection as { id: string } | undefined)?.id === 'S1b');
  const history = secondChild?.input.previousCheckpoints as { review?: ReviewEvidence; checks?: { status: string }[] }[] | undefined;
  assert.equal(history?.[0]?.review?.output.verdict, 'clean', 'A fresh checkpoint needs the prior authored R01 report');
  assert.equal(history?.[0]?.checks?.[0]?.status, 'passed');
  await controller.dispose();
});

test('Subsection repairs retain parent wave budget and require R01 closure of actual finding IDs', async () => {
  const p = structuredClone(plan);
  p.sections[0]!.subsections = [{ id: 'S1a', objective: 'Make owner map', acceptanceCriteria: ['Owner map correct'],
    writeScope: ['src/export.ts'], safeIntermediateState: 'Mapping safe', consumer: 'Parent export API',
    checks: [{ id: 'child', command: ['node','--test'], required: true }] }];
  const { controller, actors } = rig(p);
  let findingsSent = false;
  actors.responder = (task) => {
    if (task.kind === 'review-selector' && task.input.subsection && task.input.repairDelta) {
      return { lenses: [{ id: 'R01', name: 'Child baseline', focus: 'Scoped child invariant' },
        { id: 'R03', name: 'State regression', focus: 'New state risk from the repaired child' }],
        rationale: 'The admitted child repair affects shared state.',
      };
    }
    if (task.kind === 'reviewer-a' && task.input.subsection && !findingsSent) {
      findingsSent = true;
      return { ...clean, verdict: 'findings', findings: [{ id: 'CHILD-1', title: 'Map leak', body: 'Cross-account leak',
        severity: 'major', invariant: 'Only current user records' }] };
    }
    if (task.kind === 'adjudicator' && task.input.purpose === 'subsection-checkpoint') {
      const findings = task.input.findings as { id: string }[];
      return accept({ resolution: 'repair', material: true,
        repairInstructions: 'Fix the exact child owner map leak.',
        dispositions: findings.map(({ id }) => ({ findingId: id, decision: 'fix', reason: 'Reproduced.' })) });
    }
    if (task.kind === 'reviewer-a' && task.input.subsection && task.input.checkpointMode === 'REPAIR_DELTA') {
      return { ...clean, closures: ((task.input.targetFindingIds ?? []) as string[]).map((findingId) => ({
        findingId, status: 'verified-closed', evidence: 'Retested repaired child identity path.',
      })) };
    }
    return actors.defaultResult(task);
  };
  const id = await launch(controller);
  const done = await waitFor(controller, id, (run) => ['completed','blocked','waiting-user'].includes(run.status), 9000);
  assert.equal(done.status, 'completed', done.blockedReason);
  assert.equal(done.sections.S1.materialRepairWaves, 1);
  assert.equal(done.sections.S1.subsectionCheckpoints?.length, 1);
  assert.equal(actors.calls.filter((call) => call.kind === 'implementer').length, 2);
  assert.equal(actors.calls.filter((call) => call.kind === 'reviewer-a' &&
    call.input.subsection && call.lens?.id === 'R03').length, 1,
    'new child repair risks receive a bounded focused reviewer without another child A/B');
  await controller.dispose();
});

test('PLAN-only silent A slot retires after two independently clean A passes followed by material B changes', async () => {
  const { controller, actors } = rig();
  let b = 0;
  actors.responder = (task) => {
    if (task.kind === 'plan-review-b' && ++b <= 2)
      return { ...clean, verdict: 'findings', findings: [{ id: 'P1', title: 'Plan scope', body: 'Remove unrequested owner.',
        invariant: 'Do not expand scope', severity: 'major', classification: 'PLAN_SCOPE_EXPANSION' }] };
    return actors.defaultResult(task);
  };
  const id = await launch(controller);
  const done = await waitFor(controller, id, (run) => ['completed','blocked','waiting-user'].includes(run.status), 9000);
  assert.equal(done.status, 'completed', done.blockedReason);
  assert.equal(done.planRepairs, 2);
  assert.equal(done.planSilentRetirement?.slot, 'plan-review-a');
  assert.equal(actors.calls.filter((call) => call.kind === 'plan-review-a').length, 2);
  assert.equal(actors.calls.filter((call) => call.kind === 'plan-review-b').length, 3);
  await controller.dispose();
});

test('PLAN_NIT alone is not another correction wave and OWNER_DECISION requires a real response', async () => {
  const { controller, actors } = rig();
  let asked = false;
  actors.responder = (task) => {
    if (task.kind === 'adjudicator' && task.input.purpose === 'plan-admission') {
      const findings = task.input.findings as { id: string }[];
      return accept({ resolution: 'needs-user', question: 'Choose an externally supported compatibility format.',
        dispositions: findings.map((finding) => ({ findingId: finding.id, decision: 'needs-user', reason: 'Only the actual owner can choose this format.' })) });
    }
    if (task.kind === 'plan-review-a' && !asked) {
      asked = true;
      return { ...clean, verdict: 'findings', findings: [{ id: 'OWNER1', title: 'Compatibility semantics',
        body: 'Choose externally supported format', severity: 'major', invariant: 'Owner decides',
        classification: 'OWNER_DECISION' }] };
    }
    if (task.kind === 'plan-review-b') return { ...clean, verdict: 'findings', findings: [{
      id: 'NIT', title: 'Optional rename', body: 'Could improve name', severity: 'minor', invariant: 'Readable plan',
      classification: 'PLAN_NIT',
    }] };
    return actors.defaultResult(task);
  };
  const id = await launch(controller);
  const blocked = await waitFor(controller, id, (run) => run.status === 'waiting-user');
  assert.equal(blocked.planRepairs, 0);
  await controller.decide(id, { decisionId: blocked.pendingDecision!.id, answer: 'Use existing public format.', action: 'continue' });
  const done = await waitFor(controller, id, (run) => ['completed','blocked','waiting-user'].includes(run.status), 9000);
  assert.equal(done.status, 'completed', done.blockedReason);
  assert.equal(done.planRepairs, 0);
  await controller.dispose();
});

test('R02 optional SAFE_SIMPLIFICATION stays nonblocking when no material repair is admitted', async () => {
  const { controller, actors } = rig();
  actors.responder = (task) => {
    if (task.kind === 'review-selector') return {
      lenses: [{ id: 'R01', name: 'Behavior', focus: 'Complete behavior' },
        { id: 'R02', name: 'Simplification', focus: 'Unnecessary structural layer' }],
      rationale: 'Changed state structure requires R02.',
    };
    if (task.kind === 'reviewer-a' && task.lens?.id === 'R02') return {
      ...clean, simplifications: [{ mechanism: 'Redundant adapter', simplerPath: 'Use existing export owner',
        preservedInvariants: ['Account scoping'], preservationOracle: 'Business export test',
        affectedConsumers: ['Export entry'] }],
    };
    if (task.kind === 'adjudicator' && task.input.purpose === 'a-admission') {
      const actions = task.input.simplificationActions as { id: string }[];
      return accept({ simplificationDispositions: actions.map((action) => ({
        actionId: action.id, decision: 'defer', reason: 'No independent material defect was admitted.',
      })) });
    }
    return actors.defaultResult(task);
  };
  const id = await launch(controller);
  const done = await waitFor(controller, id, (run) => ['completed','blocked','waiting-user'].includes(run.status), 9000);
  assert.equal(done.status, 'completed', done.blockedReason);
  assert.equal(done.sections.S1.materialRepairWaves, 0);
  assert.deepEqual(done.sections.S1.simplifications?.map((entry) => [entry.id, entry.status]), [['SIMP-001','deferred']]);
  assert.equal(actors.calls.filter((call) => call.kind === 'implementer').length, 1);
  await controller.dispose();
});

test('a SIMP preservation oracle is a distinct mandatory closure when batched with admitted material repair', async () => {
  const { controller, actors, workspace } = rig();
  let initial = true;
  actors.responder = (task) => {
    if (task.kind === 'review-selector') return { lenses: [
      { id: 'R01', name: 'Behavior', focus: 'Complete behavior' },
      { id: 'R02', name: 'Simplification', focus: 'Remove redundant adapter' }],
      rationale: 'Changed structure.' };
    if (task.kind === 'reviewer-a' && initial && task.lens?.id === 'R01') return { ...clean,
      verdict: 'findings', findings: [{ id: 'BUG', title: 'Account leak', body: 'Cross-user read',
        severity: 'major', invariant: 'Account isolation' }] };
    if (task.kind === 'reviewer-a' && initial && task.lens?.id === 'R02') return { ...clean,
      simplifications: [{ mechanism: 'Extra adapter', simplerPath: 'Existing owner',
        preservedInvariants: ['Export result stable'], preservationOracle: 'Verified export fixture', affectedConsumers: ['Export'] }] };
    if (task.kind === 'adjudicator' && task.input.purpose === 'a-admission' && initial) {
      initial = false;
      const findings = task.input.findings as { id: string }[];
      const actions = task.input.simplificationActions as { id: string }[];
      return accept({ resolution: 'repair', material: true, repairInstructions: 'Fix scoping and remove extra adapter.',
        dispositions: findings.map((finding) => ({ findingId: finding.id, decision: 'fix', reason: 'Confirmed leak.' })),
        simplificationDispositions: actions.map((action) => ({ actionId: action.id, decision: 'batch', reason: 'Already repairing a real leak.' })) });
    }
    if (task.kind === 'closure-reviewer') return { ...clean,
      closures: ((task.input.targetFindingIds ?? []) as string[]).map((findingId) => ({
        findingId, status: 'verified-closed', evidence: 'Account isolation checked.',
      })),
      simplificationClosures: ((task.input.simplificationActions ?? []) as { id: string }[]).map((action) => ({
        actionId: action.id, status: 'preserved', evidence: 'Export fixture passes without redundant adapter.',
      })) };
    return actors.defaultResult(task);
  };
  const id = await launch(controller);
  const done = await waitFor(controller, id, (run) => ['completed','blocked','waiting-user'].includes(run.status), 9000);
  assert.equal(done.status, 'completed', done.blockedReason);
  assert.equal(done.sections.S1.materialRepairWaves, 1);
  assert.equal(done.sections.S1.simplifications?.[0]?.status, 'preserved');
  assert.equal(done.sections.S1.simplifications?.[0]?.closureCandidateId, done.sections.S1.acceptedCandidateId);
  assert.equal(workspace.version, 2);
  await controller.dispose();
});

test('an external Advisor result never substitutes for separate explicit owner adoption', async () => {
  const { controller, actors } = rig();
  let trigger = true;
  actors.responder = (task) => {
    if (task.kind === 'plan-review-a' && trigger) {
      trigger = false;
      return { ...clean, advisorTrigger: 'ADV-02' };
    }
    return actors.defaultResult(task);
  };
  const id = await launch(controller);
  const pending = await waitFor(controller, id, (run) => run.status === 'waiting-user' && run.pendingDecision?.kind === 'advisor');
  assert.equal(pending.advisorCase?.trigger, 'ADV-02');
  assert.equal(pending.advisorCase?.status, 'waiting-external');
  assert.match(pending.advisorCase!.request, /requirementsHistory/);
  assert.match(pending.advisorCase!.request, /reviewEvidence/);
  assert.match(pending.advisorCase!.request, /not a sanitized ZIP/);
  await assert.rejects(controller.revise(id, 'Silently change the goal and bypass external adjudication.'),
    /external Advisor hold/i);
  await assert.rejects(controller.decide(id, { decisionId: pending.pendingDecision!.id, answer: 'Continue', action: 'continue' }),
    /actual advisor result/);
  const clarify = await controller.decide(id, { decisionId: pending.pendingDecision!.id, answer: 'Need evidence',
    advisorResult: 'Independent reviewer needs a controlled test.', advisorAdoption: 'clarify', action: 'continue' });
  assert.equal(clarify.status, 'waiting-user');
  assert.equal(clarify.advisorCase?.status, 'waiting-human-decision');
  await controller.decide(id, { decisionId: pending.pendingDecision!.id, answer: 'Adopt the narrow test resolution.',
    advisorResult: 'Independent reviewer recommends the minimal existing-owner change.', advisorAdoption: 'accept', action: 'continue' });
  const done = await waitFor(controller, id, (run) => ['completed','blocked','waiting-user'].includes(run.status), 9000);
  assert.equal(done.status, 'completed', done.blockedReason);
  assert.equal(done.advisorCase?.status, 'adopted');
  assert.ok(done.decisionHistory.some((entry) => entry.advisorAdoption === 'accept' &&
    entry.advisorResult?.includes('existing-owner')));
  await controller.dispose();
});

test('five-wave hard cap grants at most one diagnosed nonstructural recovery wave and then ADV-01', async () => {
  const { controller, actors, workspace } = rig();
  actors.responder = (task) => {
    if (task.kind === 'reviewer-b') return {
      ...clean, verdict: 'findings', findings: [{ id: 'BUG1', title: 'Still leaking', body: 'Account boundary remains vulnerable.',
        severity: 'major', invariant: 'Owner isolation' }],
    };
    if (task.kind === 'adjudicator' && task.input.purpose === 'b-admission') {
      const findings = task.input.findings as { id: string }[];
      return accept({ resolution: 'repair', material: true, repairInstructions: 'Repair owner isolation at the original contract.',
        dispositions: findings.map(({ id }) => ({ findingId: id, decision: 'fix', reason: 'Confirmed same root cause.' })) });
    }
    if (task.kind === 'diagnostician' && String(task.input.reason).startsWith('HARD_CAP_RECOVERY:'))
      return { summary: 'One final local repair remains', recommendation: 'retry', recoveryClass: 'CONTINUE_CURRENT',
        instructions: 'One scoped final repair, then FINAL_BOUNDED.' };
    return actors.defaultResult(task);
  };
  const id = await launch(controller);
  const blocked = await waitFor(controller, id, (run) => run.status === 'waiting-user' && run.pendingDecision?.kind === 'advisor', 20000);
  assert.equal(blocked.pendingDecision?.advisorTrigger, 'ADV-01');
  assert.equal(blocked.sections.S1.materialRepairWaves, 6);
  assert.equal(blocked.sections.S1.recovery?.classification, 'CONTINUE_CURRENT');
  assert.equal(blocked.sections.S1.recovery?.extraWaveLimit, 6);
  assert.equal(actors.calls.filter((task) => task.kind === 'diagnostician' && String(task.input.reason).startsWith('HARD_CAP_RECOVERY:')).length, 1);
  await assert.rejects(controller.decide(id, { decisionId: blocked.pendingDecision!.id, answer: 'Continue',
    advisorResult: 'External advice', advisorAdoption: 'accept', action: 'continue' }), /ADV-01/);
  assert.equal(workspace.version, 7);
  await controller.dispose();
});

test('actual residual Feature risk invokes one independent bounded integration reviewer, not another parent A/B', async () => {
  const { controller, actors } = rig(twoSectionPlan());
  let verifierCalls = 0;
  actors.responder = (task) => {
    if (task.kind === 'feature-verifier' && ++verifierCalls === 1) {
      return { verdict: 'integration-review', summary: 'Shared session boundary is not covered by the local Section evidence.',
        criteria: [], repairSectionIds: [], repairInstructions: '',
        unprovenComposition: [{ id: 'BOUNDARY1', featureId: 'F1', lens: 'R05', boundary: 'Consumer reads producer-owned session in real export flow.' }] };
    }
    if (task.kind === 'feature-verifier') {
      const check = (task.input.checks as { id: string }[])[0]!;
      const reviews = task.input.evidence as { id: string }[];
      const integration = reviews.find((entry) => entry.id.startsWith('integration:'))!;
      assert.ok(integration);
      return { verdict: 'accepted', summary: 'Composed path checked by independent focused evidence.',
        criteria: [{ featureId: 'F1', criterion: 'User can export exactly their records.',
          evidenceIds: [check.id, integration.id], satisfied: true }],
        repairSectionIds: [], repairInstructions: '', integrationDispositions: [] };
    }
    return actors.defaultResult(task);
  };
  const id = await launch(controller);
  const done = await waitFor(controller, id, (run) => ['completed','blocked','waiting-user'].includes(run.status), 9000);
  assert.equal(done.status, 'completed', done.blockedReason);
  assert.equal(verifierCalls, 2);
  assert.equal(done.integrationGaps?.length, 1);
  assert.equal(done.integrationReviews?.length, 1);
  const focused = actors.calls.filter((call) => call.kind === 'reviewer-a' && call.featureId === 'F1');
  assert.equal(focused.length, 1);
  assert.ok(focused[0]?.input.integrationGap);
  assert.equal(actors.calls.filter((call) => call.kind === 'reviewer-b').length, 2);
  await controller.dispose();
});

test('SPLIT_REMAINING requires two real descendants and inherits one exhausted parent lineage without resetting counts', async () => {
  const { controller, actors } = rig();
  let planningCalls = 0, repairCalls = 0;
  const replacement = structuredClone(plan);
  replacement.features[0]!.sectionIds = ['S1a','S1b'];
  const first = replacement.sections[0]!;
  replacement.sections = [
    { ...structuredClone(first), id: 'S1a', replacesSectionId: 'S1', title: 'Owner representation', dependencies: [], writeScope: ['src/export.ts'] },
    { ...structuredClone(first), id: 'S1b', replacesSectionId: 'S1', title: 'Export integration', dependencies: ['S1a'], writeScope: ['src/export.ts'] },
  ];
  actors.responder = (task) => {
    if (task.kind === 'planner') return {
      plan: ++planningCalls === 1 ? plan : replacement,
      explanation: 'Only the same original export requirement; split remaining owner and consumer into real peer contracts.',
    };
    if (task.kind === 'reviewer-b' && task.sectionId === 'S1') return { ...clean, verdict: 'findings',
      findings: [{ id: 'BLOCKER', title: 'Faulty export', body: 'The export remains incorrect.',
        severity: 'major', invariant: 'Only owner records can be exported' }] };
    if (task.kind === 'adjudicator' && task.sectionId === 'S1' && task.input.purpose === 'b-admission') {
      repairCalls++;
      const findings = task.input.findings as { id: string }[];
      return accept({ resolution: 'repair', material: true,
        repairInstructions: 'Fix the original export without adding any scope.',
        dispositions: findings.map(({ id }) => ({ findingId: id, decision: 'fix', reason: 'Confirmed same root.' })) });
    }
    if (task.kind === 'diagnostician' && String(task.input.reason).startsWith('HARD_CAP_RECOVERY:'))
      return { summary: 'Two bounded owner and consumer obligations must be split.',
        recommendation: 'revise-plan', recoveryClass: 'SPLIT_REMAINING',
        instructions: 'Split only the remaining behavior into S1a and S1b with shared original lineage.' };
    return actors.defaultResult(task);
  };
  const id = await launch(controller);
  const done = await waitFor(controller, id, (run) => ['completed','blocked','waiting-user'].includes(run.status), 20000);
  assert.equal(done.status, 'completed', done.blockedReason);
  assert.ok(planningCalls >= 2);
  assert.equal(repairCalls, 6, '5 original corrective waves and a sixth request blocked for structural recovery');
  assert.equal(done.retiredSections?.S1?.state.materialRepairWaves, 5);
  assert.equal(done.sections.S1a.lineageId, done.sections.S1b.lineageId);
  assert.equal(done.sections.S1a.lineageId, done.retiredSections?.S1?.state.lineageId);
  assert.equal(done.sections.S1a.materialRepairWaves, 5);
  assert.equal(done.sections.S1b.materialRepairWaves, 5);
  assert.equal(done.sections.S1a.recovery?.classification, 'SPLIT_REMAINING');
  assert.equal(done.sections.S1b.recovery?.extraWaveLimit, 10);
  await controller.dispose();
});


test('automatic native activation pauses before PLAN reviewers until owner approves the first plan', async () => {
  const { controller, actors } = rig();
  const run = await controller.create({ goal: 'Users can export their own records.', workspacePath: '/project',
    policy: { commit: true }, requireInitialPlanApproval: true });
  await controller.start(run.id);
  const waiting = await waitFor(controller, run.id, (value) => value.status === 'waiting-user');
  assert.equal(waiting.stage, 'plan-review-a');
  assert.equal(waiting.initialPlanApprovalObtained, undefined);
  assert.equal(actors.calls.some((call) => call.kind === 'plan-review-a' || call.kind === 'implementer'), false);
  await controller.decide(run.id, { decisionId: waiting.pendingDecision!.id, action: 'continue', answer: 'Approve this bounded first plan.' });
  const done = await waitFor(controller, run.id, (value) => value.status === 'completed');
  assert.equal(done.initialPlanApprovalObtained, true);
  assert.ok(actors.calls.some((call) => call.kind === 'plan-review-b'));
  await controller.dispose();
});

test('unsupported PLAN reviewer scope suggestions do not consume a correction wave', async () => {
  const { controller, actors } = rig();
  let proposed = false;
  actors.responder = (task) => {
    if (task.kind === 'plan-review-a' && !proposed) {
      proposed = true;
      return { ...clean, verdict: 'findings', findings: [{ id: 'UNSUPPORTED',
        title: 'Unrequested generalized registry', body: 'Would create extra product surface',
        invariant: 'Only approved requirements count', severity: 'major',
        classification: 'PLAN_BLOCKER' }] };
    }
    if (task.kind === 'adjudicator' && task.input.purpose === 'plan-admission') {
      return accept({ dispositions: [{ findingId: 'UNSUPPORTED', decision: 'reject',
        reason: 'No user intent or existing product contract requires the registry.' }] });
    }
    return actors.defaultResult(task);
  };
  const id = await launch(controller);
  const done = await waitFor(controller, id, (run) => ['completed', 'blocked', 'waiting-user'].includes(run.status));
  assert.equal(done.status, 'completed', done.blockedReason);
  assert.equal(done.planRepairs, 0);
  assert.equal(actors.calls.filter((call) => call.kind === 'plan-review-a').length, 1);
  assert.equal(actors.calls.filter((call) => call.kind === 'adjudicator' && call.input.purpose === 'plan-admission').length, 1);
  await controller.dispose();
});

test('forward-progress implementation may continue beyond three bounded activations', async () => {
  const { controller, actors, workspace } = rig();
  let calls = 0;
  actors.responder = (task) => {
    if (task.kind === 'implementer') {
      workspace.version++;
      calls++;
      return { summary: 'A real additional interface increment was written.',
        completedCriteria: [], remainingWork: calls <= 4 ? ['Continue next reachable increment'] : [], changedInterfaces: [] };
    }
    return actors.defaultResult(task);
  };
  const id = await launch(controller);
  const done = await waitFor(controller, id, (run) => ['completed', 'blocked', 'waiting-user'].includes(run.status), 9000);
  assert.equal(done.status, 'completed', done.blockedReason);
  assert.equal(calls, 5);
  assert.equal(done.sections.S1.diagnosticCount, 0);
  await controller.dispose();
});

test('identical unfinished handoffs without source progress are diagnosed and then blocked', async () => {
  const { controller, actors } = rig();
  actors.responder = (task) => task.kind === 'implementer'
    ? { summary: 'No new file changed.', completedCriteria: [],
      remainingWork: ['Same outstanding work'], changedInterfaces: [] }
    : actors.defaultResult(task);
  const id = await launch(controller);
  const stopped = await waitFor(controller, id, (run) => run.status === 'waiting-user' || run.status === 'blocked', 9000);
  assert.match(stopped.blockedReason ?? '', /no observable progress|no progress/i);
  assert.equal(stopped.sections.S1.diagnosticCount, 1);
  assert.ok(actors.calls.filter((call) => call.kind === 'implementer').length >= 3);
  await controller.dispose();
});


test('an admitted source repair consumes an original wave even when classified nonmaterial', async () => {
  const { controller, actors, workspace } = rig();
  let bCalls = 0;
  actors.responder = (task) => {
    if (task.kind === 'reviewer-b' && ++bCalls === 1) return {
      ...clean, verdict: 'findings',
      findings: [{ id: 'BUG', title: 'Required behavior missing',
        body: 'A real reachable case fails.', severity: 'major', invariant: 'User export works' }],
    };
    if (task.kind === 'adjudicator' && task.input.purpose === 'b-admission' && workspace.version === 1) {
      return accept({ resolution: 'repair', material: false,
        dispositions: [{ findingId: (task.input.findings as { id: string }[])[0].id,
          decision: 'fix', reason: 'Reproduced required behavior.' }],
        repairInstructions: 'Restore required export response on the exact route.' });
    }
    return actors.defaultResult(task);
  };
  const id = await launch(controller);
  const done = await waitFor(controller, id, (run) => ['completed', 'blocked', 'waiting-user'].includes(run.status), 9000);
  assert.equal(done.status, 'completed', done.blockedReason);
  assert.equal(done.sections.S1.materialRepairWaves, 1);
  assert.equal(actors.calls.filter((task) => task.kind === 'implementer').length, 2);
  await controller.dispose();
});

test('an incomplete historical PLAN slot is not offered as reusable PLAN_DELTA authority', async () => {
  const { controller, actors } = rig();
  let bCalls = 0;
  actors.responder = (task) => {
    if (task.kind === 'plan-review-b' && ++bCalls === 1) {
      return { ...clean, verdict: 'incomplete', coverage: [], limitations: ['Repository evidence temporarily unavailable'] };
    }
    return actors.defaultResult(task);
  };
  const id = await launch(controller);
  const waiting = await waitFor(controller, id, (run) => run.status === 'waiting-user');
  await controller.decide(id, { decisionId: waiting.pendingDecision!.id, action: 'replan', answer: 'Retry reviewed plan with available source.' });
  const done = await waitFor(controller, id, (run) => ['completed', 'blocked', 'waiting-user'].includes(run.status), 9000);
  assert.equal(done.status, 'completed', done.blockedReason);
  const b = actors.calls.filter((call) => call.kind === 'plan-review-b');
  assert.equal(b.length, 2);
  assert.equal(b[1]?.input.reviewMode, 'FULL');
  assert.equal(b[1]?.input.previousSlot, undefined);
  await controller.dispose();
});

test('subsection-specific implementation tier is frozen into the actual writer task', async () => {
  const withChild = structuredClone(plan);
  withChild.sections[0]!.subsections = [{
    id: 'C1', objective: 'Build child', acceptanceCriteria: ['Child behavior'],
    writeScope: ['src/export.ts'], safeIntermediateState: 'No public export yet',
    consumer: 'Parent export', checks: [{ id: 'child', command: ['node', '--test'], required: true }],
    implementation: 'large',
  }];
  const { controller, actors } = rig(withChild);
  const id = await launch(controller);
  const reached = await waitFor(controller, id, () => actors.calls.some(task => task.kind === 'implementer'));
  const writer = actors.calls.find(task => task.kind === 'implementer')!;
  assert.equal(writer.implementationTier, 'large');
  assert.equal(writer.input.implementation, 'large');
  assert.equal(reached.plan?.sections[0]?.implementation, 'standard');
  await controller.dispose();
});

test('PLAN_HANDOFF completes after independent PLAN A/B without a task worktree or product writes', async () => {
  const { controller, actors, workspace } = rig();
  const created = await controller.create({ goal: 'Plan a scoped export safely.', workspacePath: '/project',
    intent: 'plan-handoff', policy: { commit: false } });
  assert.equal(created.intent, 'plan-handoff');
  await controller.start(created.id);
  const done = await waitFor(controller, created.id, run => ['completed', 'blocked', 'waiting-user'].includes(run.status));
  assert.equal(done.status, 'completed', done.blockedReason);
  assert.equal(done.stage, 'done');
  assert.equal(done.workspace.prepared, undefined);
  assert.equal(done.policy.commit, false);
  assert.ok(done.plan);
  assert.equal(done.operations.some(operation => operation.kind === 'prepare' || operation.kind === 'commit'), false);
  assert.deepEqual(actors.calls.map(task => task.kind), ['planner', 'plan-review-a', 'plan-review-b']);
  assert.equal(workspace.commitCalls, 0);
  assert.equal(workspace.checkCalls, 0);
  await controller.dispose();
});

test('PLAN_HANDOFF owner approval resumes without workspace recovery or implementation', async () => {
  const { controller, actors } = rig();
  const created = await controller.create({ goal: 'Plan only.', workspacePath: '/project',
    intent: 'plan-handoff', requireInitialPlanApproval: true });
  await controller.start(created.id);
  const held = await waitFor(controller, created.id, run => run.status === 'waiting-user' && !!run.pendingDecision);
  assert.equal(held.workspace.prepared, undefined);
  const done = await controller.decide(created.id, {
    decisionId: held.pendingDecision!.id, action: 'continue', answer: 'Approve this plan.'
  });
  assert.equal(done.status, 'running');
  const finished = await waitFor(controller, created.id, run => ['completed', 'blocked'].includes(run.status));
  assert.equal(finished.status, 'completed', finished.blockedReason);
  assert.equal(actors.calls.some(task => task.kind === 'implementer'), false);
  await controller.dispose();
});
