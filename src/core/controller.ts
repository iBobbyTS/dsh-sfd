import { randomUUID } from 'node:crypto';
import { outputSchemaFor, parseActorOutput, validatePlan } from './contracts.js';
import { createPolicy } from './policy.js';
import type { ActorHandle, ActorRunner, RunStore, WorkspacePort } from './ports.js';
import {
  CORE_VERSION, type ActorKind, type ActorOutcome, type ActorTask, type AdjudicationOutput,
  type Attempt, type Candidate, type CheckEvidence, type CreateRunInput, type DecideInput,
  type DevelopmentPlan, type DevelopmentRun, type DiagnosticOutput, type FeatureVerificationOutput,
  type ImplementationOutput, type Lens, type Operation, type PlanOutput, type ReviewEvidence,
  type ReviewOutput, type ReviewSelectionOutput, type SectionPlan, type SectionState,
} from './types.js';

export interface ControllerOptions {
  store: RunStore; actors: ActorRunner; workspace: WorkspacePort;
  now?: () => string; id?: () => string;
  /** Public stop calls remain bounded; unconfirmed execution keeps its workspace reservation. */
  cleanupTimeoutMs?: number;
}
type Listener = (run: DevelopmentRun) => void;
type ActiveActor = { runId: string; abort: AbortController; handle?: ActorHandle; timer?: ReturnType<typeof setTimeout>; startup?: Promise<ActorHandle | undefined>; done?: Promise<void> };
type ActiveOperation = { runId: string; abort: AbortController; done?: Promise<void> };

/** Persistent development controller. No model session owns this state machine. */
export class WorkflowController {
  private readonly store: RunStore;
  private readonly actors: ActorRunner;
  private readonly workspace: WorkspacePort;
  private readonly now: () => string;
  private readonly id: () => string;
  private readonly cleanupTimeoutMs: number;
  private readonly listeners = new Set<Listener>();
  private readonly activeActors = new Map<string, ActiveActor>();
  private readonly activeOperations = new Map<string, ActiveOperation>();
  private readonly drives = new Map<string, { again: boolean; promise: Promise<void> }>();
  private disposed = false;

  constructor(options: ControllerOptions) {
    this.store = options.store; this.actors = options.actors; this.workspace = options.workspace;
    this.now = options.now ?? (() => new Date().toISOString());
    this.id = options.id ?? randomUUID;
    this.cleanupTimeoutMs = Math.max(10, Math.min(options.cleanupTimeoutMs ?? 5000, 60_000));
  }

  subscribe(listener: Listener): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  async list(): Promise<DevelopmentRun[]> { return this.store.list(); }
  async status(id: string): Promise<DevelopmentRun> {
    const run = await this.store.get(id);
    if (!run) throw new Error(`Development run ${id} does not exist.`);
    return run;
  }
  async create(input: CreateRunInput): Promise<DevelopmentRun> {
    this.assertOpen();
    if (!input.goal.trim()) throw new Error('A development goal is required.');
    const workspace = await this.workspace.inspect(input.workspacePath);
    const at = this.now();
    const run: DevelopmentRun = {
      id: this.id(), schemaVersion: 1, workflowVersion: CORE_VERSION,
      revision: 0, controlEpoch: 0, inputContractVersion: 1, createdAt: at, updatedAt: at,
      goal: input.goal.trim(), requirementsHistory: [{ version: 1, goal: input.goal.trim(), at }],
      workspace, policy: createPolicy(input.policy), status: 'draft', stage: 'planning',
      planRevision: 0, planRepairs: 0, planFeedback: [], sections: {}, candidates: {},
      attempts: [], operations: [], reviews: [], decisions: [], featureChecks: [],
      decisionHistory: [], events: [],
    };
    this.event(run, 'created', 'Development task created.');
    await this.store.create(run); this.publish(run); return run;
  }

  async start(id: string): Promise<DevelopmentRun> {
    this.assertOpen();
    const result = await this.change(id, (run) => {
      if (run.status !== 'draft') throw new Error('Only a draft task can be started; use resume for paused work.');
      run.status = 'running'; run.controlEpoch++;
      this.event(run, 'started', 'Development task started.');
    });
    this.schedule(id); return result;
  }

  async pause(id: string): Promise<DevelopmentRun> {
    await this.change(id, (run) => {
      if (['completed', 'cancelled', 'paused'].includes(run.status)) return;
      run.status = 'pausing'; run.controlEpoch++;
      this.event(run, 'pause-requested', 'New dispatch stopped; active executions are being stopped.');
    });
    const quiescent = await this.stopLocal(id);
    return this.change(id, (run) => {
      if (run.status === 'pausing' && quiescent) {
        run.status = 'paused';
        this.event(run, 'paused', 'Task paused. Uncertain side effects are checked before resuming.');
      }
      if (run.status === 'pausing' && !quiescent) run.blockedReason = 'Stopping is still in progress; execution termination is unconfirmed and the workspace remains reserved.';
    });
  }

  async resume(id: string): Promise<DevelopmentRun> {
    this.assertOpen();
    const before = await this.status(id);
    if (!['paused', 'blocked'].includes(before.status)) throw new Error('Only paused or resolved blocked work can resume.');
    if (before.pendingDecision) throw new Error('Resolve the pending decision before resuming.');
    if ([...this.activeActors.values(), ...this.activeOperations.values()].some((active) => active.runId === id)) throw new Error('An interrupted activation is still stopping; wait for actual teardown before resuming.');
    const recovery = await this.workspace.reconcile(before);
    if (!recovery.safe) {
      await this.block(id, recovery.reason ?? 'Workspace execution state is uncertain.', 'recovery');
      return this.status(id);
    }
    const result = await this.change(id, (run) => {
      if (run.controlEpoch !== before.controlEpoch || run.pendingDecision) throw new Error('Task changed while recovery was being checked.');
      run.status = 'running'; run.controlEpoch++; delete run.blockedReason;
      for (const attempt of run.attempts) {
        if (attempt.state === 'intent' && attempt.task.controlEpoch !== run.controlEpoch) {
          attempt.rejection ??= 'Undispatched intent superseded by an explicit control change.';
        }
        if (attempt.outcome?.status === 'cancelled' || attempt.state === 'unknown') {
          attempt.rejection ??= 'Execution interrupted; explicit recovery authorized a new attempt.';
        }
      }
      for (const operation of run.operations) {
        if (operation.state === 'intent' && operation.controlEpoch !== run.controlEpoch) operation.error ??= 'Undispatched operation superseded by control change.';
        if (operation.state === 'unknown') operation.error ??= 'Reconciled after interruption; a new operation is required.';
      }
      this.event(run, 'resumed', 'Task resumed after checking actual workspace state.');
    });
    this.schedule(id); return result;
  }

  async cancel(id: string): Promise<DevelopmentRun> {
    const result = await this.change(id, (run) => {
      if (run.status === 'completed') throw new Error('A completed task cannot be cancelled.');
      run.status = 'cancelled'; run.controlEpoch++; delete run.pendingDecision;
      this.event(run, 'cancelled', 'Task cancelled; existing changes and evidence are retained.');
    });
    await this.stopLocal(id); return result;
  }

  async revise(id: string, goal: string): Promise<DevelopmentRun> {
    if (!goal.trim()) throw new Error('Revised requirements must not be empty.');
    const current = await this.status(id);
    if (['completed', 'cancelled'].includes(current.status)) throw new Error('Create a new task for a completed or cancelled run.');
    await this.pause(id);
    await this.change(id, (run) => {
      run.goal = goal.trim(); run.inputContractVersion++;
      run.requirementsHistory.push({ version: run.inputContractVersion, goal: run.goal, at: this.now() });
      run.stage = 'planning'; run.planFeedback.push('The user revised the requirements. Reassess obligations and reuse only still-applicable work; preserve Section identity and repair lineage.');
      delete run.pendingDecision; delete run.diagnostic; delete run.activeSectionId;
      for (const section of Object.values(run.sections)) {
        section.stage = 'pending'; section.inputContractVersion++;
        delete section.acceptedCandidateId; delete section.integratedCandidateId; delete section.aAcceptedCandidateId;
      }
      this.event(run, 'requirements-revised', 'User requirements changed; a new planning contract is required.');
    });
    return this.resume(id);
  }

  async decide(id: string, input: DecideInput): Promise<DevelopmentRun> {
    const current = await this.status(id);
    const decision = current.pendingDecision;
    if (!decision || decision.id !== input.decisionId) throw new Error('The decision is missing or no longer current.');
    if (!input.answer.trim()) throw new Error('Record the user decision before continuing.');
    if (input.action === 'cancel') return this.cancel(id);
    if (decision.kind === 'budget' && input.action !== 'replan') {
      throw new Error('An exhausted repair budget cannot be reset by retry. Revise the plan or cancel; existing Section lineage is preserved.');
    }
    const recovery = decision.kind === 'recovery' ? await this.workspace.reconcile(current) : undefined;
    if (recovery && !recovery.safe && !recovery.candidate) {
      throw new Error(`Actual workspace state must be inspected before acknowledging recovery: ${recovery.reason ?? 'inspection unavailable'}`);
    }
    const recoveredCommit = recovery?.commit;
    if (recoveredCommit) {
      const accepted = current.candidates[recoveredCommit.candidateId];
      const verification = current.attempts.find((attempt) => attempt.id === current.featureVerificationAttemptId);
      if (!current.policy.commit || !accepted || current.currentCandidateId !== accepted.id || !verification || verification.state !== 'admitted' || verification.task.kind !== 'feature-verifier' || verification.task.candidateId !== accepted.id ||
        (verification.admittedOutput as FeatureVerificationOutput).verdict !== 'accepted' || !recovery?.candidate || recovery.candidate.treeHash !== accepted.treeHash || recovery.candidate.head !== recoveredCommit.commit || recoveredCommit.branch !== (recovery.workspace?.branch ?? current.workspace.branch)) {
        throw new Error('Recovered commit lacks matching actual HEAD/tree and admitted final business acceptance; delivery cannot be inferred.');
      }
    }
    const applied = await this.change(id, (run) => {
      if (run.pendingDecision?.id !== input.decisionId) throw new Error('The decision changed before it was applied.');
      run.decisionHistory.push({ ...run.pendingDecision, answer: input.answer.trim() });
      delete run.pendingDecision; delete run.blockedReason;
      run.status = 'paused';
      if (decision.kind === 'recovery') {
        if (recovery?.workspace) run.workspace = { ...recovery.workspace, prepared: true };
        for (const attempt of run.attempts) {
          if (attempt.state === 'unknown' || attempt.state === 'started' || attempt.outcome?.status === 'cancelled' || attempt.outcome?.status === 'failed') {
            attempt.recoveryDecisionId = decision.id; attempt.reconciledAt = this.now();
            attempt.rejection ??= 'Unknown side effects inspected and explicitly acknowledged; this is not a successful actor result.';
          }
        }
        for (const operation of run.operations) {
          if (operation.state === 'unknown' || operation.state === 'started') {
            operation.recoveryDecisionId = decision.id; operation.reconciledAt = this.now();
            operation.error ??= 'Actual side effects inspected and explicitly acknowledged; operation requires a new verified attempt.';
          }
        }
        if (recovery?.candidate) {
          const previous = run.currentCandidateId ? run.candidates[run.currentCandidateId] : undefined;
          run.candidates[recovery.candidate.id] = recovery.candidate;
          run.currentCandidateId = recovery.candidate.id;
          if (!recoveredCommit && previous && (previous.treeHash !== recovery.candidate.treeHash || previous.head !== recovery.candidate.head)) {
            delete run.featureVerificationAttemptId;
            for (const state of Object.values(run.sections)) {
              if (!['pending', 'implementing', 'repairing'].includes(state.stage)) state.stage = 'review-selection';
              state.candidateId = recovery.candidate.id; state.inputContractVersion++;
              delete state.acceptedCandidateId; delete state.integratedCandidateId; delete state.aAcceptedCandidateId;
            }
            if (['delivery', 'feature-verification'].includes(run.stage)) run.stage = 'sections';
          }
        }
      }
      const section = decision.sectionId ? run.sections[decision.sectionId] : undefined;
      if (recoveredCommit) {
        run.currentCandidateId = recoveredCommit.candidateId;
        run.commit = recoveredCommit;
        run.delivery = { mode: 'commit', candidateId: recoveredCommit.candidateId, path: run.workspace.path, branch: recoveredCommit.branch, createdAt: recoveredCommit.createdAt, commit: recoveredCommit.commit };
        run.stage = 'done'; run.status = 'completed'; run.controlEpoch++;
        this.event(run, 'delivery-recovered', 'Actual delivery commit matched the previously accepted candidate and business evidence; no commit was replayed.');
        return;
      }
      if (input.action === 'replan') {
        run.stage = 'planning'; run.inputContractVersion++;
        run.planFeedback.push(`User decision: ${input.answer.trim()}`);
        delete run.activeSectionId;
      } else if (section) {
        section.inputContractVersion++;
        section.repairInstructions = [section.repairInstructions, `User decision: ${input.answer.trim()}`].filter(Boolean).join('\n');
      } else {
        run.inputContractVersion++;
        run.planFeedback.push(`User decision: ${input.answer.trim()}`);
      }
      this.event(run, 'decision-recorded', 'The current user decision was recorded.');
    });
    if (applied.status === 'completed') return applied;
    return this.resume(id);
  }

  /** Startup never assumes a vanished in-memory handle completed its side effects. */
  async recover(): Promise<void> {
    this.assertOpen();
    for (const run of await this.store.list()) {
      if (!['running', 'pausing'].includes(run.status)) continue;
      await this.change(run.id, (draft) => {
        draft.controlEpoch++;
        for (const attempt of draft.attempts) {
          if (attempt.state === 'started') {
            attempt.state = 'unknown';
            attempt.rejection = 'Host restarted before a durable terminal result was recorded.';
          }
        }
        for (const operation of draft.operations) if (operation.state === 'started') operation.state = 'unknown';
        draft.status = 'paused';
        this.event(draft, 'recovery-required', 'Recovered persisted task. Interrupted execution must be reconciled before further writes.');
      });
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    const ids = new Set([...this.activeActors.values(), ...this.activeOperations.values()].map((value) => value.runId));
    for (const id of ids) await this.pause(id);
    await Promise.allSettled([...this.drives.values()].map((drive) => drive.promise));
    if (!this.activeActors.size && !this.activeOperations.size) await this.workspace.dispose?.();
    this.listeners.clear();
  }

  private assertOpen(): void { if (this.disposed) throw new Error('Development controller is disposed.'); }
  private publish(run: DevelopmentRun): void {
    for (const listener of this.listeners) {
      try { listener(structuredClone(run)); } catch { /* A view cannot roll back persisted state. */ }
    }
  }
  private event(run: DevelopmentRun, type: string, message: string, extra: { attemptId?: string; sectionId?: string } = {}): void {
    run.events.push({ id: this.id(), at: this.now(), type, message, ...extra });
  }
  private async change(id: string, mutate: (run: DevelopmentRun) => void): Promise<DevelopmentRun> {
    const next = await this.store.update(id, (stored) => {
      const draft = structuredClone(stored); mutate(draft);
      draft.revision = stored.revision + 1; draft.updatedAt = this.now(); return draft;
    });
    this.publish(next); return next;
  }

  private schedule(id: string): void {
    if (this.disposed) return;
    const existing = this.drives.get(id);
    if (existing) { existing.again = true; return; }
    const state = { again: true, promise: Promise.resolve() };
    state.promise = Promise.resolve().then(async () => {
      while (state.again && !this.disposed) {
        state.again = false;
        try { if (await this.driveOnce(id)) state.again = true; }
        catch (error) { await this.block(id, message(error), 'infrastructure'); }
      }
    }).finally(() => this.drives.delete(id));
    this.drives.set(id, state);
  }

  private async driveOnce(id: string): Promise<boolean> {
    let run = await this.status(id);
    if (run.status !== 'running') return false;
    const terminal = run.attempts.find((attempt) => attempt.state === 'terminal' && !attempt.rejection);
    if (terminal) { await this.admit(run, terminal); return true; }
    // Intent is durable before any asynchronous side effect is dispatched.
    for (const attempt of run.attempts.filter((value) => value.state === 'intent' && !value.rejection)) {
      if (!this.activeActors.has(attempt.id)) this.launchActor(run.id, attempt);
    }
    if (!run.workspace.prepared) {
      return this.operation(run, 'prepare', 'prepare', undefined, async (snapshot) => this.workspace.prepare(snapshot), (draft, result) => {
        draft.workspace = { ...result as DevelopmentRun['workspace'], prepared: true };
      });
    }
    if (run.diagnostic) return this.driveDiagnostic(run);
    if (run.stage === 'planning') return this.drivePlanning(run);
    if (run.stage === 'plan-review-a' || run.stage === 'plan-review-b') return this.drivePlanReview(run);
    if (run.stage === 'sections') return this.driveSections(run);
    if (run.stage === 'feature-verification') return this.driveFeatureVerification(run);
    if (run.stage === 'delivery') return this.driveDelivery(run);
    return false;
  }

  private async drivePlanning(run: DevelopmentRun): Promise<boolean> {
    const attempt = this.latest(run, 'planner');
    if (!attempt) return this.queueActor(run, 'planner', {
      goal: run.goal, phase: run.stage, previousPlan: run.plan, feedback: run.planFeedback,
      userDecisions: run.decisionHistory.map((decision) => ({ question: decision.question, answer: decision.answer, sectionId: decision.sectionId })),
      existingLineages: [...Object.values(run.sections), ...Object.values(run.retiredSections ?? {}).map((entry) => entry.state)].map((section) => ({ sectionId: section.id, lineageId: section.lineageId, materialRepairWaves: section.materialRepairWaves })),
    });
    if (attempt.state !== 'admitted') return false;
    const output = attempt.admittedOutput as PlanOutput;
    validatePlan(output.plan);
    await this.change(run.id, (draft) => {
      const old = { ...Object.fromEntries(Object.entries(draft.retiredSections ?? {}).map(([id, entry]) => [id, entry.state])), ...draft.sections };
      const requirementsVersion = draft.requirementsHistory[draft.requirementsHistory.length - 1]!.version;
      const explicitRevision = requirementsVersion > (draft.planRequirementsVersion ?? draft.requirementsHistory[0]!.version);
      // A replan must not silently discard an existing repair lineage by renaming a Section.
      for (const section of Object.values(draft.sections)) {
        if (section.materialRepairWaves && !output.plan.sections.some((entry) => entry.id === section.id)) {
          if (!explicitRevision) throw new Error(`Replanning removed repair lineage ${section.lineageId}. Preserve its Section identity and budget.`);
        }
        if (!output.plan.sections.some((entry) => entry.id === section.id)) {
          const contract = draft.plan?.sections.find((entry) => entry.id === section.id);
          if (contract) {
            draft.retiredSections ??= {};
            draft.retiredSections[section.id] = { state: section, contract, requirementsVersion, retiredAt: this.now() };
          }
        }
      }
      draft.plan = output.plan; draft.planRevision++; draft.planRequirementsVersion = requirementsVersion;
      draft.sections = Object.fromEntries(output.plan.sections.map((section) => [section.id, {
        id: section.id, stage: 'pending', inputContractVersion: (old[section.id]?.inputContractVersion ?? 0) + 1,
        lineageId: old[section.id]?.lineageId ?? `${draft.id}:${section.id}`,
        materialRepairWaves: old[section.id]?.materialRepairWaves ?? 0,
        diagnosticCount: old[section.id]?.diagnosticCount ?? 0,
        lenses: [], checks: [], reviewIds: [], decisionIds: [], aCoverageEvidenceIds: [],
      } satisfies SectionState]));
      for (const section of output.plan.sections) if (draft.retiredSections) delete draft.retiredSections[section.id];
      draft.stage = 'plan-review-a';
      this.event(draft, 'plan-proposed', 'A structured plan was proposed; independent plan review A starts next.');
    });
    return true;
  }

  private async drivePlanReview(run: DevelopmentRun): Promise<boolean> {
    const kind = run.stage === 'plan-review-a' ? 'plan-review-a' : 'plan-review-b';
    const attempt = this.latest(run, kind);
    // Both reviewers receive the plan itself. B does not receive A's conclusions.
    if (!attempt) return this.queueActor(run, kind, {
      goal: run.goal, phase: run.stage, plan: run.plan, planRevision: run.planRevision,
      userDecisions: run.decisionHistory.map((decision) => ({ answer: decision.answer, sectionId: decision.sectionId })),
      retiredObligations: Object.values(run.retiredSections ?? {}).filter((entry) => entry.requirementsVersion === run.planRequirementsVersion).map((entry) => ({ contract: entry.contract, lineageId: entry.state.lineageId, reason: 'Proposed retirement under the explicit revised user requirements. Verify that no still-authorized obligation was dropped.' })),
    });
    if (attempt.state !== 'admitted') return false;
    const output = attempt.admittedOutput as ReviewOutput;
    if (output.verdict === 'clean' && !output.limitations.length) {
      await this.change(run.id, (draft) => {
        draft.stage = kind === 'plan-review-a' ? 'plan-review-b' : 'sections';
        this.event(draft, 'plan-review-accepted', `${kind} completed valid independent coverage.`);
      });
    } else if (run.planRepairs >= run.policy.maxPlanRepairs) {
      await this.change(run.id, (draft) => {
        draft.diagnostic = { reason: 'Plan review remains unresolved after the bounded plan repair budget.', requestedAt: this.now() };
      });
    } else {
      await this.change(run.id, (draft) => {
        draft.planRepairs++; draft.inputContractVersion++; draft.stage = 'planning';
        draft.planFeedback.push(JSON.stringify(output));
        this.event(draft, 'plan-repair-required', `${kind} requires a material plan repair; both logical plan coverages must apply to the final plan.`);
      });
    }
    return true;
  }

  private async driveSections(run: DevelopmentRun): Promise<boolean> {
    if (!run.plan) throw new Error('Execution requires a reviewed plan.');
    const active = run.activeSectionId && run.sections[run.activeSectionId];
    if (!active || active.stage === 'integrated') {
      const next = run.plan.sections.find((entry) => run.sections[entry.id]?.stage !== 'integrated' && entry.dependencies.every((dependency) => run.sections[dependency]?.stage === 'integrated'));
      if (!next) {
        if (Object.values(run.sections).some((section) => section.stage !== 'integrated')) throw new Error('No executable Section exists; dependency acceptance is incomplete.');
        await this.change(run.id, (draft) => { draft.stage = 'feature-verification'; delete draft.activeSectionId; });
      } else {
        const state = run.sections[next.id]!;
        if (state.stage === 'pending' && state.materialRepairWaves >= run.policy.maxRepairWaves) {
          await this.block(run.id, `Section ${next.id} retains exhausted original repair lineage ${state.lineageId}. Replanning cannot authorize a sixth implementation wave.`, 'budget', next.id);
          return false;
        }
        await this.change(run.id, (draft) => {
          draft.activeSectionId = next.id;
          const section = draft.sections[next.id]!;
          if (section.stage === 'pending') { section.stage = 'implementing'; section.inputContractVersion++; }
          if (section.stage === 'repairing' && section.materialRepairWaves === 3 && section.diagnosticCount < draft.policy.maxDiagnostics) {
            draft.diagnostic = { reason: 'Third material repair wave: diagnose recurring root cause before further implementation.', sectionId: section.id, requestedAt: this.now() };
          }
          this.event(draft, 'section-selected', `Section ${next.id} owns the implementation workspace.`, { sectionId: next.id });
        });
      }
      return true;
    }
    if (active.stage === 'implementing' || active.stage === 'repairing') return this.driveImplementation(run, active);
    if (active.stage === 'review-selection') return this.driveSelection(run, active);
    if (active.stage === 'reroute') return this.driveReroute(run, active);
    if (active.stage === 'review-a') return this.driveA(run, active);
    if (active.stage === 'closure') return this.driveClosure(run, active);
    if (active.stage === 'adjudicating-a' || active.stage === 'adjudicating-b') return this.driveAdjudication(run, active);
    if (active.stage === 'review-b') return this.driveB(run, active);
    if (active.stage === 'accepted') {
      const candidate = this.candidate(run, active);
      return this.operation(run, 'integrate', `integrate:${active.id}:${candidate.id}`, active.id,
        async (snapshot) => {
          const actual = await this.workspace.capture(snapshot, active.id);
          if (actual.treeHash !== candidate.treeHash || actual.head !== candidate.head) throw new Error('Workspace changed after review. Integration requires a new candidate assessment.');
          return actual;
        }, (draft) => {
          const section = draft.sections[active.id]!;
          section.stage = 'integrated'; section.integratedCandidateId = candidate.id;
          this.event(draft, 'section-integrated', `Section ${active.id} accepted and integrated; its dependants may now proceed.`, { sectionId: active.id });
        });
    }
    return false;
  }

  private async driveImplementation(run: DevelopmentRun, section: SectionState): Promise<boolean> {
    const attempt = this.latest(run, 'implementer', section);
    const contract = this.sectionPlan(run, section);
    if (!attempt) return this.queueActor(run, 'implementer', {
      ...this.contractInput(run, section), instructions: section.repairInstructions ?? contract.objective,
      implementation: contract.implementation,
      subsections: contract.subsections,
    }, section);
    if (attempt.state !== 'admitted') return false;
    const result = attempt.admittedOutput as ImplementationOutput;
    if (result.remainingWork.length) {
      const captureKey = `unfinished:${attempt.id}`;
      if (!this.completedOperation(run, captureKey)) return this.operation(run, 'capture', captureKey, section.id,
        (snapshot) => this.workspace.capture(snapshot, section.id), (draft, value) => {
          const actual = value as Candidate;
          draft.candidates[actual.id] = actual; draft.currentCandidateId = actual.id; draft.sections[section.id]!.candidateId = actual.id;
        });
      const unfinished = run.attempts.filter((entry) => entry.state === 'admitted' && entry.task.sectionId === section.id && entry.task.kind === 'implementer' && (entry.admittedOutput as ImplementationOutput).remainingWork.length > 0).length;
      if (unfinished > 3) {
        await this.block(run.id, `Owned implementation remains unfinished after bounded continuation and diagnosis: ${result.remainingWork.join('; ')}`, 'semantic', section.id); return false;
      }
      await this.change(run.id, (draft) => {
        const state = draft.sections[section.id]!;
        state.inputContractVersion++;
        state.repairInstructions = `Continue the existing owned task from the captured actual changes. Complete: ${result.remainingWork.join('; ')}. Do not propose a new scope for already authorized work.`;
        if (unfinished === 2) draft.diagnostic = { reason: 'Repeated execution stopped with unfinished owned work; identify the obstacle and concrete continuation.', sectionId: section.id, requestedAt: this.now() };
        this.event(draft, 'owned-work-continued', 'Unfinished authorized work retained in the same Section and continued from actual changes.', { sectionId: section.id });
      });
      return true;
    }
    const captureKey = `capture:${attempt.id}`;
    if (!this.completedOperation(run, captureKey)) {
      return this.operation(run, 'capture', captureKey, section.id, (snapshot) => this.workspace.capture(snapshot, section.id), (draft, value) => {
        const candidate = value as Candidate;
        draft.candidates[candidate.id] = candidate; draft.currentCandidateId = candidate.id;
        draft.sections[section.id]!.candidateId = candidate.id;
      });
    }
    const candidate = this.candidate(run, section);
    const checksKey = `checks:${attempt.id}`;
    if (!this.completedOperation(run, checksKey)) {
      return this.operation(run, 'checks', checksKey, section.id, (snapshot, signal) => this.workspace.check(snapshot, candidate, contract.checks, signal), (draft, value) => {
        draft.sections[section.id]!.checks = value as CheckEvidence[];
      }, candidate.id);
    }
    await this.change(run.id, (draft) => {
      const next = draft.sections[section.id]!;
      next.stage = section.stage === 'repairing' ? 'reroute' : 'review-selection';
      this.event(draft, 'implementation-captured', 'Actual implementation candidate and host-run checks recorded.', { sectionId: section.id, attemptId: attempt.id });
    });
    return true;
  }

  private async driveSelection(run: DevelopmentRun, section: SectionState): Promise<boolean> {
    if (!section.candidateId) {
      return this.operation(run, 'capture', `revalidation:${section.id}:${section.inputContractVersion}`, section.id, (snapshot) => this.workspace.capture(snapshot, section.id), (draft, result) => {
        const candidate = result as Candidate;
        draft.candidates[candidate.id] = candidate; draft.currentCandidateId = candidate.id;
        draft.sections[section.id]!.candidateId = candidate.id;
      });
    }
    const candidate = this.candidate(run, section);
    const specs = this.sectionPlan(run, section).checks;
    if (specs.some((spec) => !section.checks.some((check) => check.candidateId === candidate.id && check.specId === spec.id))) {
      return this.operation(run, 'checks', `revalidation-checks:${section.id}:${section.inputContractVersion}:${candidate.id}`, section.id,
        (snapshot, signal) => this.workspace.check(snapshot, candidate, specs, signal),
        (draft, result) => { draft.sections[section.id]!.checks = result as CheckEvidence[]; }, candidate.id);
    }
    const attempt = this.latest(run, 'review-selector', section);
    if (!attempt) return this.queueActor(run, 'review-selector', { ...this.contractInput(run, section), requiredBaseline: 'R01', maximumLenses: 6 }, section);
    if (attempt.state !== 'admitted') return false;
    await this.change(run.id, (draft) => {
      const state = draft.sections[section.id]!;
      state.lenses = (attempt.admittedOutput as ReviewSelectionOutput).lenses;
      state.stage = 'review-a';
    });
    return true;
  }

  /** The old Skill re-routes the repair delta before closing A; it does not restart unaffected lenses. */
  private async driveReroute(run: DevelopmentRun, section: SectionState): Promise<boolean> {
    const attempt = this.latest(run, 'review-selector', section);
    if (!attempt) return this.queueActor(run, 'review-selector', {
      ...this.contractInput(run, section), repairDelta: section.repairInstructions,
      priorLenses: section.lenses,
      previousReviews: run.reviews.filter((review) => review.sectionId === section.id),
      obligation: 'Inspect actual repair delta and direct consumers. Select R01-R12 risk coverage, declare invalidated previous A lenses only with a source-specific reason; do not restart unaffected A discovery.',
    }, section);
    if (attempt.state !== 'admitted') return false;
    const output = attempt.admittedOutput as ReviewSelectionOutput;
    const known = new Set(section.lenses.map((lens) => lens.id));
    for (const id of output.invalidatedLensIds ?? []) if (!known.has(id)) throw new Error(`Unknown invalidated A lens ${id}.`);
    const fresh = [...new Set([...output.lenses.filter((lens) => !known.has(lens.id)).map((lens) => lens.id), ...(output.invalidatedLensIds ?? [])])];
    const lenses = [...section.lenses, ...output.lenses.filter((lens) => !known.has(lens.id))];
    if (lenses.length > 6) throw new Error('Repair adds more than six required A lenses; reassess coverage and the Section boundary.');
    await this.change(run.id, (draft) => {
      const state = draft.sections[section.id]!;
      state.lenses = lenses; state.freshRepairLensIds = fresh; state.stage = 'closure';
      this.event(draft, 'repair-risk-rerouted', `Fresh A risk coverage: ${fresh.join(', ') || 'none'}.`, { sectionId: state.id });
    });
    return true;
  }

  private async driveA(run: DevelopmentRun, section: SectionState): Promise<boolean> {
    const attempts = section.lenses.map((lens) => this.latest(run, 'reviewer-a', section, lens.id));
    const inflight = attempts.filter((attempt) => attempt && attempt.state !== 'admitted').length;
    let capacity = run.policy.maxParallelReviews - inflight;
    for (let i = 0; i < section.lenses.length && capacity > 0; i++) {
      if (!attempts[i]) {
        await this.queueActor(await this.status(run.id), 'reviewer-a', { ...this.contractInput(run, section), lens: section.lenses[i] }, section, section.lenses[i]);
        capacity--;
      }
    }
    if (attempts.every((attempt) => attempt?.state === 'admitted')) {
      await this.change(run.id, (draft) => { draft.sections[section.id]!.stage = 'adjudicating-a'; });
      return true;
    }
    return false;
  }

  private async driveClosure(run: DevelopmentRun, section: SectionState): Promise<boolean> {
    // Dispatch only new/invalidated independent A lenses identified on the repair delta.
    const tasks = (section.freshRepairLensIds ?? []).map((id) => ({
      id, lens: section.lenses.find((lens) => lens.id === id)!,
      attempt: this.latest(run, 'reviewer-a', section, id),
    }));
    let capacity = run.policy.maxParallelReviews - tasks.filter((entry) => entry.attempt && entry.attempt.state !== 'admitted').length;
    for (const entry of tasks) if (!entry.attempt && capacity > 0) {
      await this.queueActor(await this.status(run.id), 'reviewer-a', {
        ...this.contractInput(run, section), lens: entry.lens,
        obligation: 'Fresh independent A evidence for a newly triggered or invalidated repair-delta risk.',
      }, section, entry.lens);
      capacity--;
    }
    if (!tasks.every((entry) => entry.attempt?.state === 'admitted')) return false;
    const attempt = this.latest(run, 'closure-reviewer', section);
    if (!attempt) return this.queueActor(run, 'closure-reviewer', {
      ...this.contractInput(run, section), instructions: section.repairInstructions,
      targetFindingIds: section.closureFindingIds ?? [],
      previousReviews: run.reviews.filter((review) => review.sectionId === section.id),
      previousDecisions: run.decisions.filter((decision) => decision.sectionId === section.id),
      obligation: 'Report exactly one per-finding status for every targetFindingId, with actual current-candidate evidence. No generic CLEAN may replace closure; examine direct regressions. Do not repeat the full A group.',
    }, section);
    if (attempt.state !== 'admitted') return false;
    await this.change(run.id, (draft) => { draft.sections[section.id]!.stage = 'adjudicating-a'; });
    return true;
  }

  private async driveB(run: DevelopmentRun, section: SectionState): Promise<boolean> {
    const attempt = this.latest(run, 'reviewer-b', section);
    if (!attempt) {
      // Intentional allowlist: no A reports, prior verdicts, repair instructions, or implementation narration.
      return this.queueActor(run, 'reviewer-b', {
        ...this.contractInput(run, section),
        obligation: 'Independently review the complete final bounded Section candidate and actual business behavior.',
      }, section);
    }
    if (attempt.state !== 'admitted') return false;
    await this.change(run.id, (draft) => { draft.sections[section.id]!.stage = 'adjudicating-b'; });
    return true;
  }

  private async driveAdjudication(run: DevelopmentRun, section: SectionState): Promise<boolean> {
    const attempt = this.latest(run, 'adjudicator', section);
    const candidate = this.candidate(run, section);
    const allReviews = run.reviews.filter((review) => review.sectionId === section.id);
    const currentReviews = this.currentReviews(allReviews, candidate.id);
    const isB = section.stage === 'adjudicating-b';
    if (!attempt) return this.queueActor(run, 'adjudicator', {
      ...this.contractInput(run, section),
      purpose: isB ? 'b-admission' : currentReviews.some((review) => review.stage === 'closure') ? 'closure-admission' : 'a-admission',
      reviews: allReviews,
      findings: allReviews.flatMap((review) => review.output.findings.map((finding) => ({ ...finding, id: `${review.id}:${finding.id}`, evidenceId: review.id, candidateId: review.candidateId }))),
      previousDecisions: run.decisions.filter((decision) => decision.sectionId === section.id),
      repairBudget: { used: section.materialRepairWaves, maximum: run.policy.maxRepairWaves, lineageId: section.lineageId },
      selectedLenses: section.lenses,
      obligation: 'Admit or reject findings on semantic evidence. Reuse old coverage only through explicit evidenceReuse with reasons. Current checks and logical A plus independent final B are required; a report count never proves acceptance.',
    }, section);
    if (attempt.state !== 'admitted') return false;
    const output = attempt.admittedOutput as AdjudicationOutput;
    this.validateAdjudication(run, section, output, attempt.id);
    if (output.resolution === 'needs-user') {
      await this.block(run.id, output.question ?? output.summary, 'semantic', section.id); return false;
    }
    if (output.resolution === 'more-review') {
      // A bounded, diagnosed obligation; never an unbounded repeat-until-clean loop.
      await this.change(run.id, (draft) => {
        draft.diagnostic = { reason: `${output.summary}\nMissing coverage: ${output.missingCoverage.join('; ')}`, sectionId: section.id, requestedAt: this.now() };
      });
      return true;
    }
    if (output.resolution === 'repair') return this.requestRepair(run, section, output.repairInstructions, output.material, isB ? 'b' : 'a', output.invalidatedSectionIds, output.dispositions.filter((item) => item.decision === 'fix').map((item) => item.findingId));
    await this.change(run.id, (draft) => {
      const state = draft.sections[section.id]!;
      if (isB) {
        state.stage = 'accepted'; state.acceptedCandidateId = candidate.id;
        this.event(draft, 'section-accepted', 'A and independent full B logical coverage apply to this final candidate.', { sectionId: section.id });
      } else {
        state.aAcceptedCandidateId = candidate.id;
        state.aCoverageEvidenceIds = [...new Set([
          ...currentReviews.filter((review) => review.stage !== 'b').map((review) => review.id),
          ...output.evidenceReuse.map((entry) => entry.evidenceId),
        ])];
        state.stage = 'review-b';
      }
    });
    return true;
  }

  private validateAdjudication(run: DevelopmentRun, section: SectionState, output: AdjudicationOutput, attemptId: string): void {
    const reviews = run.reviews.filter((review) => review.sectionId === section.id);
    const knownFindingIds = new Set(reviews.flatMap((review) => review.output.findings.map((finding) => `${review.id}:${finding.id}`)));
    const dispositions = new Map(output.dispositions.map((item) => [item.findingId, item]));
    if (dispositions.size !== output.dispositions.length) throw new Error('Duplicate finding disposition.');
    for (const item of output.dispositions) if (!knownFindingIds.has(item.findingId)) throw new Error(`Disposition references unknown finding ${item.findingId}.`);
    const priorDisposition = new Set(run.decisions.filter((decision) => decision.attemptId !== attemptId && decision.sectionId === section.id && 'dispositions' in decision.output).flatMap((decision) => (decision.output as AdjudicationOutput).dispositions.map((item) => item.findingId)));
    for (const findingId of knownFindingIds) if (!dispositions.has(findingId) && !priorDisposition.has(findingId)) throw new Error(`Finding ${findingId} has no disposition.`);
    for (const sectionId of output.invalidatedSectionIds) if (!run.sections[sectionId]) throw new Error(`Unknown invalidated Section ${sectionId}.`);
    const candidate = this.candidate(run, section);
    for (const reuse of output.evidenceReuse) {
      const review = reviews.find((entry) => entry.id === reuse.evidenceId);
      if (!review || review.output.verdict === 'incomplete' || !reuse.reason.trim()) throw new Error('Coverage reuse requires an existing complete report and a semantic reason.');
      if (section.freshRepairLensIds?.includes(review.lensId) && review.candidateId !== candidate.id) throw new Error('Invalidated A lens cannot reuse stale source evidence.');
    }
    if (output.resolution === 'repair' && !output.repairInstructions.trim()) throw new Error('A repair decision requires concrete repair instructions.');
    if (output.resolution !== 'accept') return;
    if (!output.coverageSufficient || output.missingCoverage.length || output.dispositions.some((item) => item.decision !== 'reject')) throw new Error('Acceptance cannot retain missing coverage or unresolved admitted findings.');
    const checks = this.sectionPlan(run, section).checks.filter((spec) => spec.required);
    if (checks.some((spec) => !section.checks.some((evidence) => evidence.specId === spec.id && evidence.candidateId === candidate.id && evidence.status === 'passed'))) throw new Error('Acceptance requires actual passing host checks on the current candidate.');
    const current = this.currentReviews(reviews, candidate.id);
    if (current.some((review) => review.output.verdict === 'incomplete')) throw new Error('An incomplete review cannot provide accepted coverage.');
    if (section.repairOrigin) {
      const closure = [...current].reverse().find((review) => review.stage === 'closure');
      if (!closure) throw new Error('Current repaired candidate lacks a targeted closure report.');
      const outcomes = closure.output.closures ?? [];
      const targets = section.closureFindingIds ?? [];
      if (new Set(outcomes.map((entry) => entry.findingId)).size !== outcomes.length ||
          outcomes.length !== targets.length ||
          targets.some((id) => !outcomes.some((entry) => entry.findingId === id && entry.status === 'verified-closed' && entry.evidence.trim()))) {
        throw new Error('Every admitted finding must have itemized VERIFIED_CLOSED evidence on the current candidate.');
      }
      for (const lensId of section.freshRepairLensIds ?? []) {
        if (!current.some((review) => review.stage === 'a' && review.lensId === lensId && review.output.verdict !== 'incomplete')) {
          throw new Error(`Repair-delta lens ${lensId} lacks fresh independent discovery.`);
        }
      }
    }
    if (section.stage === 'adjudicating-b') {
      if (section.aAcceptedCandidateId !== candidate.id) throw new Error('B acceptance requires logical A coverage on the same candidate.');
      if (!current.some((review) => review.stage === 'b')) throw new Error('B acceptance requires an independent full current-candidate B report.');
    } else {
      const eligible = new Set([...current.filter((review) => review.stage === 'a' && review.output.verdict !== 'incomplete').map((review) => review.id), ...output.evidenceReuse.map((item) => item.evidenceId)]);
      for (const lens of section.lenses) {
        if (!reviews.some((review) => review.stage === 'a' && review.lensId === lens.id && eligible.has(review.id))) throw new Error(`Missing logical A coverage for ${lens.id}; focused closure alone is insufficient.`);
      }
      // Exact finding closures and new risk evidence have been checked above.
    }
  }

  private async requestRepair(run: DevelopmentRun, section: SectionState, instructions: string, material: boolean, origin: 'a' | 'b' | 'feature', invalidated: string[] = [], findingIds: string[] = []): Promise<boolean> {
    const correctiveDecisions = run.events.filter((event) => event.type === 'repair-admitted' && event.sectionId === section.id).length;
    if (correctiveDecisions >= run.policy.maxRepairWaves + 2) {
      await this.block(run.id, `Section ${section.id} exhausted the bounded corrective workflow attempts, including non-material repairs. Diagnose or revise the contract without resetting its original lineage.`, 'budget', section.id); return false;
    }
    if (material && section.materialRepairWaves >= run.policy.maxRepairWaves) {
      await this.block(run.id, `Section ${section.id} exhausted its original ${run.policy.maxRepairWaves}-wave material repair budget. ${instructions}`, 'budget', section.id); return false;
    }
    await this.change(run.id, (draft) => {
      const state = draft.sections[section.id]!;
      if (material) state.materialRepairWaves++;
      state.inputContractVersion++; state.stage = 'repairing'; state.repairInstructions = instructions; state.repairOrigin = origin;
      state.closureFindingIds = [...new Set(findingIds)]; delete state.freshRepairLensIds;
      delete state.acceptedCandidateId; delete state.integratedCandidateId; delete state.aAcceptedCandidateId;
      draft.stage = 'sections'; draft.activeSectionId = section.id;
      delete draft.featureVerificationAttemptId;
      for (const sectionId of invalidated) {
        if (sectionId === section.id) continue;
        const other = draft.sections[sectionId]!;
        other.stage = 'review-selection'; other.inputContractVersion++;
        delete other.acceptedCandidateId; delete other.integratedCandidateId; delete other.aAcceptedCandidateId;
        // Its complete bounded contract is reviewed against the new final candidate after repair.
        delete other.candidateId;
      }
      if ((material && state.materialRepairWaves === 3 || !material && correctiveDecisions >= 1) && state.diagnosticCount < draft.policy.maxDiagnostics) {
        draft.diagnostic = { reason: 'Third material repair wave: diagnose recurring root cause before further implementation.', sectionId: state.id, requestedAt: this.now() };
      }
      this.event(draft, 'repair-admitted', `Repair admitted to original Section lineage; ${state.materialRepairWaves} material waves used.`, { sectionId: section.id });
    });
    return true;
  }

  private async driveDiagnostic(run: DevelopmentRun): Promise<boolean> {
    const diagnostic = run.diagnostic!;
    const section = diagnostic.sectionId ? run.sections[diagnostic.sectionId] : undefined;
    const count = section?.diagnosticCount ?? run.attempts.filter((attempt) => attempt.task.kind === 'diagnostician' && !attempt.task.sectionId && attempt.state === 'admitted' && attempt.task.input.diagnosticKey !== diagnostic.requestedAt).length;
    if (count >= run.policy.maxDiagnostics) {
      await this.change(run.id, (draft) => { delete draft.diagnostic; });
      await this.block(run.id, diagnostic.reason, 'budget', section?.id); return false;
    }
    const attempt = this.latest(run, 'diagnostician', section, undefined, diagnostic.requestedAt);
    if (!attempt) return this.queueActor(run, 'diagnostician', {
      ...(section ? this.contractInput(run, section) : { goal: run.goal, plan: run.plan, phase: run.stage }),
      diagnosticKey: diagnostic.requestedAt, reason: diagnostic.reason,
      priorDecisions: run.decisions, planFeedback: run.planFeedback,
    }, section);
    if (attempt.state !== 'admitted') return false;
    const result = attempt.admittedOutput as DiagnosticOutput;
    await this.change(run.id, (draft) => {
      delete draft.diagnostic;
      if (section) {
        draft.sections[section.id]!.diagnosticCount++;
        draft.sections[section.id]!.repairInstructions = [draft.sections[section.id]!.repairInstructions, result.instructions].filter(Boolean).join('\n');
      } else draft.planFeedback.push(result.instructions);
    });
    if (section && ['adjudicating-a', 'adjudicating-b'].includes(section.stage) && result.recommendation === 'retry') {
      await this.change(run.id, (draft) => {
        const state = draft.sections[section.id]!;
        state.stage = section.stage === 'adjudicating-a' ? 'review-a' : 'review-b';
        state.inputContractVersion++;
        this.event(draft, 'additional-review-scheduled', 'A bounded independent diagnostic identified necessary fresh review coverage.', { sectionId: section.id });
      });
      return true;
    }
    if (result.recommendation === 'needs-user' || !section || !['repairing', 'implementing'].includes(section.stage)) {
      await this.block(run.id, result.question ?? `${result.summary}\n${result.instructions}`, !section ? 'budget' : 'semantic', section?.id);
      return false;
    }
    if (result.recommendation === 'revise-plan') {
      await this.block(run.id, `Diagnosis recommends replanning: ${result.instructions}`, 'semantic', section.id); return false;
    }
    return true;
  }

  private async driveFeatureVerification(run: DevelopmentRun): Promise<boolean> {
    const plan = run.plan!;
    const captureKey = `feature-capture:${run.planRevision}:${run.inputContractVersion}:${Object.values(run.sections).map((section) => section.integratedCandidateId).join(',')}`;
    if (!this.completedOperation(run, captureKey)) return this.operation(run, 'capture', captureKey, undefined, (snapshot) => this.workspace.capture(snapshot), (draft, value) => {
      const candidate = value as Candidate; draft.candidates[candidate.id] = candidate; draft.currentCandidateId = candidate.id;
    });
    const candidate = run.candidates[run.currentCandidateId!]!;
    const specs = plan.features.flatMap((feature) => feature.checks.map((spec) => ({ ...spec, id: `${feature.id}:${spec.id}` })));
    const checksKey = `feature-checks:${candidate.id}:${run.planRevision}`;
    if (!this.completedOperation(run, checksKey)) return this.operation(run, 'checks', checksKey, undefined, (snapshot, signal) => this.workspace.check(snapshot, candidate, specs, signal), (draft, value) => { draft.featureChecks = value as CheckEvidence[]; }, candidate.id);
    const attempt = this.latest(run, 'feature-verifier');
    if (!attempt) return this.queueActor(run, 'feature-verifier', {
      goal: run.goal, phase: run.stage, plan, candidate,
      sectionAcceptances: Object.values(run.sections).map((section) => ({ ...section, evidence: run.reviews.filter((review) => section.reviewIds.includes(review.id)) })),
      evidence: [...run.reviews, ...run.decisions], checks: run.featureChecks,
      obligation: 'Verify every actual composed business criterion on the common delivered candidate. Reuse applicable Section evidence with concrete IDs; one-Section Features do not need a second A/B. Identify unproven composition and real shared identity/state/security assumptions.',
      userDecisions: run.decisionHistory.map((decision) => ({ question: decision.question, answer: decision.answer, sectionId: decision.sectionId })),
    });
    if (attempt.state !== 'admitted') return false;
    const output = attempt.admittedOutput as FeatureVerificationOutput;
    if (output.verdict === 'needs-user') { await this.block(run.id, output.question ?? output.summary, 'semantic'); return false; }
    if (output.verdict === 'repair') {
      if (!output.repairSectionIds.length || !output.repairInstructions.trim()) throw new Error('Feature repair requires an owned parent Section and concrete instructions.');
      if (output.repairSectionIds.some((id) => !run.sections[id])) throw new Error('Feature repair references an unknown Section.');
      if (new Set(output.repairSectionIds).size !== output.repairSectionIds.length) throw new Error('A Feature repair must identify each owning Section once.');
      const exhausted = output.repairSectionIds.find((id) => run.sections[id]!.materialRepairWaves >= run.policy.maxRepairWaves);
      if (exhausted) { await this.block(run.id, `Section ${exhausted} exhausted its original material repair budget.`, 'budget', exhausted); return false; }
      const first = output.repairSectionIds[0]!;
      await this.requestRepair(run, run.sections[first]!, output.repairInstructions, true, 'feature');
      await this.change(run.id, (draft) => {
        for (const id of output.repairSectionIds.slice(1)) {
          const state = draft.sections[id]!;
          state.stage = 'repairing'; state.materialRepairWaves++; state.inputContractVersion++;
          state.repairOrigin = 'feature'; state.repairInstructions = output.repairInstructions;
          state.closureFindingIds = []; delete state.freshRepairLensIds;
          delete state.acceptedCandidateId; delete state.integratedCandidateId; delete state.aAcceptedCandidateId;
          this.event(draft, 'repair-admitted', 'Feature repair assigned to its own Section write owner and original material budget.', { sectionId: id });
        }
      });
      return true;
    }
    this.validateFeatureAcceptance(run, output, specs.filter((spec) => spec.required).map((spec) => spec.id));
    await this.change(run.id, (draft) => {
      draft.featureVerificationAttemptId = attempt.id; draft.stage = 'delivery';
      this.event(draft, 'features-accepted', 'All authorized business criteria have evidence on the common delivered candidate.');
    });
    return true;
  }

  private validateFeatureAcceptance(run: DevelopmentRun, output: FeatureVerificationOutput, requiredChecks: string[]): void {
    if (output.repairSectionIds.length) throw new Error('Feature acceptance cannot retain required repairs.');
    if (Object.values(run.sections).some((section) => section.stage !== 'integrated')) throw new Error('Feature acceptance requires every parent Section to be accepted and integrated.');
    const candidateId = run.currentCandidateId;
    if (requiredChecks.some((id) => !run.featureChecks.some((check) => check.specId === id && check.candidateId === candidateId && check.status === 'passed'))) throw new Error('Required real business path checks did not pass on the delivered candidate.');
    // Evidence must still apply to the accepted Section or the final composed candidate.
    const evidenceIds = new Set(run.featureChecks.filter((check) => check.candidateId === candidateId && check.status === 'passed').map((check) => check.id));
    for (const section of Object.values(run.sections)) {
      if (section.stage !== 'integrated' || !section.acceptedCandidateId) continue;
      for (const check of section.checks) {
        if (check.candidateId === section.acceptedCandidateId && check.status === 'passed') evidenceIds.add(check.id);
      }
      for (const review of run.reviews) {
        if (review.sectionId === section.id && review.output.verdict !== 'incomplete' &&
            (review.candidateId === section.acceptedCandidateId || section.aCoverageEvidenceIds.includes(review.id))) evidenceIds.add(review.id);
      }
      for (const decision of run.decisions) {
        if (decision.sectionId === section.id && decision.candidateId === section.acceptedCandidateId &&
            'resolution' in decision.output && decision.output.resolution === 'accept') evidenceIds.add(decision.id);
      }
    }
    const expected = run.plan!.features.flatMap((feature) => feature.acceptanceCriteria.map((criterion) => ({ featureId: feature.id, criterion })));
    if (output.criteria.length !== expected.length) throw new Error('Feature acceptance must account for each business criterion exactly once.');
    for (const entry of expected) {
      const claims = output.criteria.filter((claim) => claim.featureId === entry.featureId && claim.criterion === entry.criterion);
      if (claims.length !== 1 || !claims[0]!.satisfied || !claims[0]!.evidenceIds.length) throw new Error(`Business criterion remains unproven: ${entry.featureId}/${entry.criterion}.`);
      for (const id of claims[0]!.evidenceIds) if (!evidenceIds.has(id)) throw new Error(`Acceptance references missing evidence ${id}.`);
    }
  }

  private async driveDelivery(run: DevelopmentRun): Promise<boolean> {
    if (!run.featureVerificationAttemptId || !run.currentCandidateId) throw new Error('Delivery requires accepted Feature evidence and a final candidate.');
    const candidate = run.candidates[run.currentCandidateId]!;
    if (!run.policy.commit) {
      return this.operation(run, 'integrate', `worktree-delivery:${candidate.id}`, undefined,
        async (snapshot) => {
          const actual = await this.workspace.capture(snapshot);
          if (actual.treeHash !== candidate.treeHash || actual.head !== candidate.head) throw new Error('Final worktree changed after Feature acceptance.');
          return actual;
        }, (draft) => {
          draft.delivery = { mode: 'worktree', candidateId: candidate.id, path: draft.workspace.path, branch: draft.workspace.branch, createdAt: this.now() };
          draft.stage = 'done'; draft.status = 'completed';
          this.event(draft, 'completed', 'Accepted development work verified and delivered in its dedicated worktree; no commit was requested.');
        }, candidate.id);
    }
    return this.operation(run, 'commit', `delivery:${candidate.id}`, undefined,
      (snapshot) => this.workspace.commit(snapshot, candidate, `feat: ${snapshot.plan!.title}`),
      (draft, value) => {
        draft.commit = value as NonNullable<DevelopmentRun['commit']>;
        draft.delivery = { mode: 'commit', candidateId: candidate.id, path: draft.workspace.path, branch: draft.workspace.branch, createdAt: this.now(), commit: draft.commit.commit };
        draft.stage = 'done'; draft.status = 'completed';
        this.event(draft, 'completed', 'Accepted development work committed on the dedicated branch.');
      }, candidate.id);
  }

  private contractInput(run: DevelopmentRun, section: SectionState): Record<string, unknown> {
    const contract = this.sectionPlan(run, section);
    return {
      goal: run.goal, phase: section.stage, section: contract,
      features: run.plan!.features.filter((feature) => contract.featureIds.includes(feature.id)),
      upstream: contract.dependencies.map((id) => ({ contract: run.plan!.sections.find((entry) => entry.id === id), acceptedCandidateId: run.sections[id]!.integratedCandidateId })),
      candidate: section.candidateId ? run.candidates[section.candidateId] : run.currentCandidateId ? run.candidates[run.currentCandidateId] : undefined,
      requiredChecks: contract.checks, checks: section.checks,
      // Only adopted human answers are part of the business contract. Do not feed a
      // reviewer the prior review/diagnostic question which prompted the answer.
      userDecisions: run.decisionHistory.filter((decision) => !decision.sectionId || decision.sectionId === section.id).map((decision) => ({ answer: decision.answer, sectionId: decision.sectionId })),
    };
  }
  private sectionPlan(run: DevelopmentRun, section: SectionState): SectionPlan {
    const result = run.plan?.sections.find((entry) => entry.id === section.id);
    if (!result) throw new Error(`Section ${section.id} lacks a reviewed implementation contract.`);
    return result;
  }
  private currentReviews(reviews: ReviewEvidence[], candidateId: string): ReviewEvidence[] {
    const latest = new Map<string, ReviewEvidence>();
    for (const review of reviews) if (review.candidateId === candidateId) latest.set(`${review.stage}:${review.lensId}`, review);
    return [...latest.values()];
  }
  private candidate(run: DevelopmentRun, section: SectionState): Candidate {
    const candidate = section.candidateId && run.candidates[section.candidateId];
    if (!candidate) throw new Error(`Section ${section.id} lacks a captured candidate.`);
    return candidate;
  }

  private latest(run: DevelopmentRun, kind: ActorKind, section?: SectionState, lensId?: string, diagnosticKey?: string): Attempt | undefined {
    return [...run.attempts].reverse().find((attempt) => !attempt.rejection && attempt.task.kind === kind &&
      (attempt.state === 'admitted' || attempt.task.controlEpoch === run.controlEpoch) &&
      attempt.task.sectionId === section?.id && attempt.task.lens?.id === lensId &&
      attempt.task.inputContractVersion === (section?.inputContractVersion ?? run.inputContractVersion) &&
      attempt.task.input.phase === (section?.stage ?? run.stage) &&
      (['implementer', 'planner', 'plan-review-a', 'plan-review-b'].includes(kind) || attempt.task.candidateId === (section?.candidateId ?? run.currentCandidateId)) &&
      (diagnosticKey === undefined || attempt.task.input.diagnosticKey === diagnosticKey) &&
      (kind !== 'plan-review-a' && kind !== 'plan-review-b' || attempt.task.input.planRevision === run.planRevision));
  }

  private async queueActor(run: DevelopmentRun, kind: ActorKind, input: Record<string, unknown>, section?: SectionState, lens?: Lens): Promise<boolean> {
    const candidateId = section?.candidateId ?? run.currentCandidateId;
    const candidate = candidateId ? run.candidates[candidateId] : undefined;
    const task: ActorTask = {
      id: this.id(), runId: run.id, kind, inputContractVersion: section?.inputContractVersion ?? run.inputContractVersion,
      controlEpoch: run.controlEpoch, workspace: kind === 'implementer' || !candidate ? run.workspace : { ...run.workspace, path: candidate.workspacePath },
      input: JSON.parse(JSON.stringify(input)) as Record<string, unknown>,
      outputSchema: outputSchemaFor(kind), timeoutMs: run.policy.actorTimeoutMs,
      ...(section ? { sectionId: section.id } : {}), ...(lens ? { lens } : {}),
      ...(candidateId ? { candidateId } : {}),
      ...(kind === 'implementer' && section && this.sectionPlan(run, section).implementation === 'large' && run.policy.largeImplementerRoute
        ? { route: run.policy.largeImplementerRoute }
        : run.policy.routes[kind] ? { route: run.policy.routes[kind] } : {}),
    };
    const previousInfrastructureFailures = run.attempts.filter((entry) => entry.task.kind === kind && entry.task.sectionId === section?.id && entry.task.lens?.id === lens?.id &&
      entry.task.inputContractVersion === task.inputContractVersion && entry.task.input.phase === task.input.phase && entry.task.candidateId === task.candidateId &&
      (entry.outcome?.status === 'failed' || entry.rejection?.startsWith('Invalid role result:'))).length;
    await this.change(run.id, (draft) => {
      if (draft.status !== 'running' || draft.controlEpoch !== run.controlEpoch) return;
      draft.attempts.push({ id: task.id, task, state: 'intent', createdAt: this.now(), infrastructureRetries: previousInfrastructureFailures });
      this.event(draft, 'execution-intent', `${kind} execution intent persisted.`, { attemptId: task.id, ...(section ? { sectionId: section.id } : {}) });
    });
    this.schedule(run.id); return true;
  }

  private launchActor(runId: string, attempt: Attempt): void {
    const active: ActiveActor = { runId, abort: new AbortController() };
    this.activeActors.set(attempt.id, active);
    active.done = (async () => {
      try {
        const before = await this.status(runId);
        if (before.status !== 'running' || before.controlEpoch !== attempt.task.controlEpoch) return;
        const authorized = await this.change(runId, (run) => {
          if (run.status !== 'running' || run.controlEpoch !== attempt.task.controlEpoch || active.abort.signal.aborted) return;
          const record = run.attempts.find((value) => value.id === attempt.id)!;
          record.state = 'started'; record.startedAt = this.now();
        });
        if (authorized.status !== 'running' || authorized.controlEpoch !== attempt.task.controlEpoch || active.abort.signal.aborted) return;
        let timedOut = false;
        const interrupted = new Promise<ActorOutcome>((resolve) => {
          const onAbort = () => resolve({ status: timedOut ? 'failed' : 'cancelled', error: timedOut ? 'Actor exceeded its bounded execution timeout.' : 'Execution stopped by task control.', identity: { transport: 'dsh-native', ...(active.handle ? { sessionId: active.handle.id } : {}) } });
          active.abort.signal.addEventListener('abort', onAbort, { once: true });
          if (active.abort.signal.aborted) onAbort();
          active.timer = setTimeout(() => { timedOut = true; active.abort.abort('Actor execution timed out.'); void active.handle?.dispose().catch(() => undefined); }, attempt.task.timeoutMs);
        });
        const starting = this.actors.start(attempt.task, active.abort.signal).then(async (handle) => {
          if (active.abort.signal.aborted) { await handle.dispose(); return undefined; }
          return handle;
        });
        active.startup = starting;
        const handle = await Promise.race([starting, interrupted.then(() => undefined)]);
        if (!handle) { await this.finishAttempt(runId, attempt.id, await interrupted); return; }
        active.handle = handle;
        await this.change(runId, (run) => { run.attempts.find((value) => value.id === attempt.id)!.actorId = handle.id; });
        if (active.abort.signal.aborted) await handle.dispose();
        const result = await Promise.race([handle.result, interrupted]);
        await this.finishAttempt(runId, attempt.id, result);
      } catch (error) {
        await this.finishAttempt(runId, attempt.id, {
          status: active.abort.signal.aborted ? 'cancelled' : 'failed', error: message(error), identity: { transport: 'dsh-native' },
        });
      } finally {
        if (active.timer) clearTimeout(active.timer);
        // A cancelled start can still publish a handle. Quiescence means that handle was stopped,
        // not merely that our race against its startup promise ended.
        if (active.startup) await active.startup.catch(() => undefined);
        if (active.handle) await active.handle.dispose().catch(() => undefined);
        this.activeActors.delete(attempt.id); await this.finishStop(runId); this.schedule(runId);
      }
    })();
  }

  private async finishAttempt(runId: string, attemptId: string, outcome: ActorOutcome): Promise<void> {
    await this.change(runId, (run) => {
      const attempt = run.attempts.find((entry) => entry.id === attemptId);
      if (!attempt || attempt.state === 'admitted' || attempt.state === 'terminal') return;
      attempt.state = 'terminal'; attempt.endedAt = this.now(); attempt.outcome = outcome;
      this.event(run, 'execution-terminal', `${attempt.task.kind} reported ${outcome.status}.`, { attemptId });
    });
    this.schedule(runId);
  }

  private async admit(run: DevelopmentRun, attempt: Attempt): Promise<void> {
    const task = attempt.task;
    const section = task.sectionId ? run.sections[task.sectionId] : undefined;
    const currentVersion = section?.inputContractVersion ?? run.inputContractVersion;
    const phase = section?.stage ?? run.stage;
    if (task.controlEpoch !== run.controlEpoch || task.inputContractVersion !== currentVersion || task.input.phase !== phase ||
      (task.kind !== 'implementer' && task.candidateId && task.candidateId !== (section?.candidateId ?? run.currentCandidateId))) {
      await this.change(run.id, (draft) => { draft.attempts.find((entry) => entry.id === attempt.id)!.rejection = 'Result belongs to an obsolete input contract or candidate; preserved as historical fact.'; });
      return;
    }
    if (attempt.outcome?.status !== 'completed') {
      await this.change(run.id, (draft) => { draft.attempts.find((entry) => entry.id === attempt.id)!.rejection = attempt.outcome?.error ?? 'Execution did not complete.'; });
      if (task.kind !== 'implementer' && attempt.outcome?.status === 'failed' && attempt.infrastructureRetries < run.policy.maxInfrastructureRetries) {
        await this.change(run.id, (draft) => { this.event(draft, 'infrastructure-retry', `Retrying the same ${task.kind} route after an execution failure; semantic repair budget unchanged.`, { attemptId: attempt.id }); });
        return;
      }
      await this.block(run.id, `${task.kind} did not complete: ${attempt.outcome?.error ?? attempt.outcome?.status ?? 'unknown'}. No semantic repair budget was consumed.`, task.kind === 'implementer' ? 'recovery' : 'infrastructure', section?.id);
      return;
    }
    let output;
    try { output = parseActorOutput(task.kind, attempt.outcome.output); }
    catch (error) {
      await this.change(run.id, (draft) => { draft.attempts.find((entry) => entry.id === attempt.id)!.rejection = `Invalid role result: ${message(error)}`; });
      if (task.kind !== 'implementer' && attempt.infrastructureRetries < run.policy.maxInfrastructureRetries) {
        await this.change(run.id, (draft) => { this.event(draft, 'infrastructure-retry', `Retrying invalid ${task.kind} result within the configured infrastructure budget.`, { attemptId: attempt.id }); });
        return;
      }
      await this.block(run.id, `Invalid ${task.kind} result: ${message(error)}`, task.kind === 'implementer' ? 'recovery' : 'infrastructure', section?.id); return;
    }
    await this.change(run.id, (draft) => {
      const currentSection = task.sectionId ? draft.sections[task.sectionId] : undefined;
      if (draft.status !== 'running' || task.controlEpoch !== draft.controlEpoch || task.inputContractVersion !== (currentSection?.inputContractVersion ?? draft.inputContractVersion) || task.input.phase !== (currentSection?.stage ?? draft.stage)) return;
      const record = draft.attempts.find((entry) => entry.id === attempt.id)!;
      record.state = 'admitted'; record.admittedOutput = output;
      if (['reviewer-a', 'reviewer-b', 'closure-reviewer'].includes(task.kind)) {
        const state = draft.sections[task.sectionId!]!;
        const evidence: ReviewEvidence = {
          id: `review:${attempt.id}`, attemptId: attempt.id, candidateId: task.candidateId!, sectionId: state.id,
          stage: task.kind === 'reviewer-a' ? 'a' : task.kind === 'reviewer-b' ? 'b' : 'closure',
          lensId: task.lens?.id ?? (task.kind === 'reviewer-b' ? 'B' : 'CLOSURE'), output: output as ReviewOutput, valid: true,
        };
        draft.reviews.push(evidence); state.reviewIds.push(evidence.id);
      }
      if (['adjudicator', 'feature-verifier', 'diagnostician'].includes(task.kind)) {
        const evidence = { id: `decision:${attempt.id}`, attemptId: attempt.id, ...(task.sectionId ? { sectionId: task.sectionId } : {}), ...(task.candidateId ? { candidateId: task.candidateId } : {}), output: output as AdjudicationOutput | FeatureVerificationOutput | DiagnosticOutput, createdAt: this.now() };
        draft.decisions.push(evidence);
        if (task.sectionId) draft.sections[task.sectionId]!.decisionIds.push(evidence.id);
      }
      this.event(draft, 'result-admitted', `${task.kind} result admitted to its exact input contract.`, { attemptId: attempt.id });
    });
  }

  private completedOperation(run: DevelopmentRun, scopeKey: string): Operation | undefined {
    return [...run.operations].reverse().find((operation) => operation.scopeKey === scopeKey && operation.state === 'completed');
  }
  private async operation(
    run: DevelopmentRun, kind: Operation['kind'], scopeKey: string, sectionId: string | undefined,
    execute: (snapshot: DevelopmentRun, signal: AbortSignal) => Promise<unknown>,
    apply: (draft: DevelopmentRun, result: unknown) => void, candidateId?: string,
  ): Promise<boolean> {
    const existing = [...run.operations].reverse().find((operation) => operation.scopeKey === scopeKey && !operation.error);
    if (existing?.state === 'completed') return false;
    if (existing?.state === 'unknown') { await this.block(run.id, `${kind} has uncertain side effects and requires reconciliation.`, 'recovery', sectionId); return false; }
    if (existing && this.activeOperations.has(existing.id)) return false;
    const operation: Operation = existing ?? {
      id: this.id(), kind, scopeKey, state: 'intent', controlEpoch: run.controlEpoch, createdAt: this.now(),
      ...(sectionId ? { sectionId } : {}), ...(candidateId ? { candidateId } : {}),
    };
    if (!existing) await this.change(run.id, (draft) => {
      if (draft.status === 'running' && draft.controlEpoch === run.controlEpoch) draft.operations.push(operation);
    });
    const active: ActiveOperation = { runId: run.id, abort: new AbortController() };
    this.activeOperations.set(operation.id, active);
    active.done = (async () => {
      try {
        const latest = await this.status(run.id);
        if (latest.status !== 'running' || latest.controlEpoch !== operation.controlEpoch) return;
        const authorized = await this.change(run.id, (draft) => {
          if (draft.status !== 'running' || draft.controlEpoch !== operation.controlEpoch || active.abort.signal.aborted) return;
          draft.operations.find((entry) => entry.id === operation.id)!.state = 'started';
        });
        if (authorized.status !== 'running' || authorized.controlEpoch !== operation.controlEpoch || active.abort.signal.aborted) return;
        const result = await execute(latest, active.abort.signal);
        await this.change(run.id, (draft) => {
          const record = draft.operations.find((entry) => entry.id === operation.id)!;
          record.endedAt = this.now();
          if (draft.status !== 'running' || draft.controlEpoch !== operation.controlEpoch) {
            record.state = 'unknown'; record.error = 'Operation completed after control changed; actual side effects require reconciliation.';
            return;
          }
          apply(draft, result); record.state = 'completed';
        });
      } catch (error) {
        await this.change(run.id, (draft) => {
          const record = draft.operations.find((entry) => entry.id === operation.id)!;
          record.state = 'unknown'; record.error = message(error); record.endedAt = this.now();
        });
        await this.block(run.id, `${kind} failed or was interrupted: ${message(error)}`, 'recovery', sectionId);
      } finally {
        this.activeOperations.delete(operation.id); await this.finishStop(run.id); this.schedule(run.id);
      }
    })();
    return false;
  }

  private async block(id: string, reason: string, kind: 'semantic' | 'recovery' | 'budget' | 'infrastructure', sectionId?: string): Promise<void> {
    await this.change(id, (run) => {
      if (['paused', 'pausing', 'cancelled', 'completed'].includes(run.status)) return;
      run.status = kind === 'semantic' || kind === 'budget' ? 'waiting-user' : 'blocked';
      run.blockedReason = reason;
      run.pendingDecision = { id: this.id(), question: reason, context: `Run ${run.id}, ${sectionId ? `Section ${sectionId}` : run.stage}`, kind, ...(sectionId ? { sectionId } : {}), createdAt: this.now() };
      this.event(run, 'blocked', reason, sectionId ? { sectionId } : {});
    });
  }

  private async stopLocal(runId: string): Promise<boolean> {
    const actors = [...this.activeActors.entries()].filter(([, active]) => active.runId === runId);
    for (const [, active] of actors) active.abort.abort('Task control stopped.');
    for (const active of this.activeOperations.values()) if (active.runId === runId) active.abort.abort('Task control stopped.');
    const stopping = Promise.allSettled(actors.map(async ([id, active]) => {
      await active.handle?.dispose();
      await this.finishAttempt(runId, id, { status: 'cancelled', error: 'Execution stopped by task control.', identity: { transport: 'dsh-native', ...(active.handle ? { sessionId: active.handle.id } : {}) } });
    }));
    const settled = await settlesWithin(Promise.allSettled([
      stopping,
      ...actors.map(([, active]) => active.done),
      ...[...this.activeOperations.values()].filter((active) => active.runId === runId).map((active) => active.done),
    ]), this.cleanupTimeoutMs);
    if (!settled) {
      await this.change(runId, (run) => {
        for (const attempt of run.attempts) {
          if (this.activeActors.has(attempt.id) && attempt.state !== 'admitted') {
            attempt.state = 'unknown'; attempt.rejection = 'Stop requested but runtime termination is not yet confirmed; workspace remains reserved.';
          }
        }
        for (const operation of run.operations) if (this.activeOperations.has(operation.id)) { operation.state = 'unknown'; operation.error = 'Operation termination is not confirmed; workspace remains reserved.'; }
      });
    }
    return settled;
  }

  private async finishStop(runId: string): Promise<void> {
    if ([...this.activeActors.values(), ...this.activeOperations.values()].some((active) => active.runId === runId)) return;
    const run = await this.status(runId);
    if (run.status !== 'pausing') return;
    await this.change(runId, (draft) => {
      if (draft.status === 'pausing') { draft.status = 'paused'; this.event(draft, 'paused', 'All active executions stopped; recovery checks still apply to uncertain side effects.'); }
    });
  }
}

function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
async function settlesWithin(work: Promise<unknown>, milliseconds: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work.then(() => true, () => true), new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), milliseconds); })]);
  } finally { if (timer) clearTimeout(timer); }
}
export { WorkflowController as DevelopmentController };
