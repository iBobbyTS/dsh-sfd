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
    if (task.kind === 'implementer') {
      this.workspace.version++;
      return { summary: 'Implemented required behavior.', completedCriteria: ['Export respects account ownership.'], remainingWork: [], changedInterfaces: [] };
    }
    if (task.kind === 'review-selector') return { lenses: [{ id: 'R01', name: 'Full behavior baseline', focus: 'Complete business behavior' }], rationale: 'One bounded risk.' };
    if (task.kind === 'adjudicator') {
      const reviews = task.input.reviews as ReviewEvidence[];
      return accept({ evidenceReuse: task.input.purpose === 'closure-admission' ? reviews.filter((review) => review.stage === 'a').map((review) => ({ evidenceId: review.id, reason: 'The direct repair is covered by the current closure; the unaffected baseline remains applicable.' })) : [] });
    }
    if (task.kind === 'feature-verifier') {
      const evidence = task.input.evidence as { id: string }[];
      return { verdict: 'accepted', summary: 'The final business path is demonstrated.', criteria: this.configuredPlan.features.flatMap((feature) => feature.acceptanceCriteria.map((criterion) => ({ featureId: feature.id, criterion, evidenceIds: [evidence[0].id], satisfied: true }))), repairSectionIds: [], repairInstructions: '' } satisfies FeatureVerificationOutput;
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
  assert.match(stopped.blockedReason!, /sixth implementation/);
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
