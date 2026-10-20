import { z } from 'zod';
import { planSchema, reviewSchema, validatePlan } from './contracts.js';
import { CORE_VERSION, POLICY_VERSION, type DevelopmentRun } from './types.js';

const text = z.string();
const identity = z.string().min(1);
const integer = z.number().int().nonnegative();
const object = z.record(z.string(), z.unknown());
const actorKind = z.enum(['planner', 'plan-review-a', 'plan-review-b', 'implementer', 'review-selector', 'reviewer-a', 'reviewer-b', 'adjudicator', 'closure-reviewer', 'feature-verifier', 'diagnostician']);
const route = z.strictObject({ preset: identity, model: text.optional(), provider: text.optional(), effort: text.optional() });
const workspace = z.strictObject({ path: identity, branch: text, baseCommit: identity, prepared: z.boolean().optional() });
const candidate = z.strictObject({ id: identity, capturedAt: identity, workspacePath: identity, head: identity, treeHash: identity, diff: text, changedFiles: z.array(text),
  sectionDelta: z.strictObject({ sectionId: identity, baseTreeHash: identity, diff: text, changedFiles: z.array(text) }).optional() });
const advisorTrigger = z.enum(['ADV-01','ADV-02','ADV-03','ADV-04','ADV-05','ADV-06']);
const recoveryClass = z.enum(['CONTINUE_CURRENT','SIMPLIFY_CURRENT','REPAIR_EVIDENCE','SPLIT_REMAINING','REBOUND_OWNER','RESTART_FROM_BASE']);
const checkEvidence = z.strictObject({
  id: identity, candidateId: identity, specId: identity, status: z.enum(['passed', 'failed', 'cancelled', 'unknown']),
  exitCode: z.number().int().nullable(), startedAt: identity, endedAt: identity, output: text, artifactRefs: z.array(text).optional(),
});
const lens = z.strictObject({ id: identity, name: identity, focus: identity });
const task = z.strictObject({
  id: identity, runId: identity, kind: actorKind,
  sectionId: identity.optional(), featureId: identity.optional(), lens: lens.optional(),
  inputContractVersion: integer, candidateId: identity.optional(), controlEpoch: integer,
  route: route.optional(), workspace, input: object, outputSchema: object, timeoutMs: z.number().int().positive(),
});
const actorIdentity = z.strictObject({
  requested: route.optional(),
  observed: z.strictObject({ provider: text.optional(), model: text.optional(), effort: text.optional(), preset: text.optional() }).optional(),
  transport: z.enum(['dsh-native', 'external', 'test']), sessionId: identity.optional(),
});
const attempt = z.strictObject({
  id: identity, task, state: z.enum(['intent', 'started', 'terminal', 'admitted', 'unknown']),
  createdAt: identity, startedAt: identity.optional(), endedAt: identity.optional(), actorId: identity.optional(),
  outcome: z.strictObject({ status: z.enum(['completed', 'failed', 'cancelled']), output: z.unknown().optional(), error: text.optional(), identity: actorIdentity, artifactRefs: z.array(text).optional() }).optional(),
  admittedOutput: z.unknown().optional(), rejection: text.optional(), infrastructureRetries: integer,
  recoveryDecisionId: identity.optional(), reconciledAt: identity.optional(),
});
const section = z.strictObject({
  id: identity, stage: z.enum(['pending', 'subsection-implementing', 'subsection-review', 'subsection-adjudicating', 'implementing', 'reroute', 'review-selection', 'review-a', 'adjudicating-a', 'repairing', 'closure', 'review-b', 'adjudicating-b', 'accepted', 'integrated']),
  inputContractVersion: integer, lineageId: identity, materialRepairWaves: integer, diagnosticCount: integer,
  candidateId: identity.optional(), sectionBaseCandidateId: identity.optional(),
  unfinishedContinuation: z.strictObject({ phase: z.enum(['implementing', 'subsection-implementing']), subsectionId: identity.optional(), treeHash: identity, remainingWork: text, repeats: integer }).optional(),
  lenses: z.array(lens), checks: z.array(checkEvidence), reviewIds: z.array(identity), decisionIds: z.array(identity),
  repairInstructions: text.optional(), repairOrigin: z.enum(['a', 'b', 'feature']).optional(),
  acceptedCandidateId: identity.optional(), integratedCandidateId: identity.optional(),
  aAcceptedCandidateId: identity.optional(), aCoverageEvidenceIds: z.array(identity),
  subsectionIndex: integer.optional(),
  subsectionCurrentChecks: z.array(checkEvidence).optional(),
  subsectionChecks: z.array(checkEvidence).optional(),
  subsectionRiskLenses: z.array(lens).optional(),
  subsectionCheckpoints: z.array(z.strictObject({
    subsectionId: identity, candidateId: identity, reviewId: identity, checkIds: z.array(identity),
    priorCandidateId: identity.optional(),
  })).optional(),
  subsectionFindingIds: z.array(identity).optional(),
  simplifications: z.array(z.strictObject({
    id: identity, originReviewId: identity, proposedCandidateId: identity, mechanism: identity, simplerPath: identity,
    preservedInvariants: z.array(identity), preservationOracle: identity, affectedConsumers: z.array(text),
    status: z.enum(['proposed', 'deferred', 'rejected', 'batched', 'preserved']),
    closureCandidateId: identity.optional(),
  })).optional(),
  activeSimplificationIds: z.array(identity).optional(),
  recovery: z.strictObject({ classification: recoveryClass, atMaterialWaves: integer,
    extraWaveLimit: integer, diagnosisAttemptId: identity, structuralPending: z.boolean().optional() }).optional(),
  closureFindingIds: z.array(identity).optional(), freshRepairLensIds: z.array(identity).optional(),
});
const decision = z.strictObject({
  id: identity, question: identity, context: text, kind: z.enum(['semantic', 'recovery', 'budget', 'infrastructure', 'advisor']),
  sectionId: identity.optional(), createdAt: identity, answer: text.optional(),
  advisorTrigger: advisorTrigger.optional(), advisorResult: text.optional(),
  advisorAdoption: z.enum(['accept','reject','clarify']).optional(),
});
const persistedRunSchema = z.strictObject({
  id: identity, schemaVersion: z.literal(1), workflowVersion: z.literal(CORE_VERSION),
  revision: integer, controlEpoch: integer, inputContractVersion: integer,
  createdAt: identity, updatedAt: identity, goal: identity,
  requirementsHistory: z.array(z.strictObject({ version: integer, goal: identity, at: identity })).min(1),
  workspace,
  policy: z.strictObject({
    version: z.literal(POLICY_VERSION), actorTimeoutMs: z.number().int().positive(), maxParallelReviews: z.number().int().min(1).max(6),
    maxRepairWaves: z.number().int().min(1).max(5), maxPlanRepairs: z.number().int().min(1).max(2),
    maxDiagnostics: z.number().int().min(1).max(2), maxInfrastructureRetries: z.number().int().min(0).max(3),
    commit: z.boolean(), routes: z.partialRecord(actorKind, route), largeImplementerRoute: route.optional(),
  }),
  status: z.enum(['draft', 'running', 'pausing', 'paused', 'blocked', 'waiting-user', 'cancelled', 'completed']),
  stage: z.enum(['planning', 'plan-review-a', 'plan-review-b', 'sections', 'feature-verification', 'delivery', 'done']),
  plan: planSchema.optional(), initialPlanApprovalRequired: z.boolean().optional(), initialPlanApprovalObtained: z.boolean().optional(), planRevision: integer, planRepairs: integer, planFeedback: z.array(text),
  planRequirementsVersion: integer.optional(),
  planSilentRetirement: z.strictObject({ slot: z.literal('plan-review-a'), reportIds: z.array(identity), rationale: identity }).optional(),
  retiredSections: z.record(z.string(), z.strictObject({ state: section, contract: planSchema.shape.sections.element, requirementsVersion: integer, retiredAt: identity })).optional(),
  sections: z.record(z.string(), section), activeSectionId: identity.optional(),
  candidates: z.record(z.string(), candidate), currentCandidateId: identity.optional(),
  attempts: z.array(attempt),
  operations: z.array(z.strictObject({
    id: identity, kind: z.enum(['prepare', 'capture', 'checks', 'commit', 'integrate']),
    state: z.enum(['intent', 'started', 'completed', 'unknown']), scopeKey: identity,
    sectionId: identity.optional(), candidateId: identity.optional(), controlEpoch: integer,
    createdAt: identity, endedAt: identity.optional(), error: text.optional(),
    recoveryDecisionId: identity.optional(), reconciledAt: identity.optional(),
  })),
  reviews: z.array(z.strictObject({
    id: identity, attemptId: identity, candidateId: identity, sectionId: identity,
    stage: z.enum(['a', 'closure', 'b']), lensId: identity, output: reviewSchema, valid: z.boolean(),
  })),
  decisions: z.array(z.strictObject({ id: identity, attemptId: identity, sectionId: identity.optional(), candidateId: identity.optional(), output: z.unknown(), createdAt: identity })),
  featureChecks: z.array(checkEvidence),
  integrationGaps: z.array(z.strictObject({ id: identity, featureId: identity, lens: identity, boundary: identity, candidateId: identity, reviewed: z.boolean().optional() })).optional(),
  integrationReviews: z.array(z.strictObject({ id: identity, attemptId: identity, candidateId: identity,
    featureId: identity, gapId: identity, output: reviewSchema })).optional(),
  featureVerificationAttemptId: identity.optional(),
  pendingDecision: decision.optional(),
  advisorCase: z.strictObject({ trigger: advisorTrigger, sectionId: identity.optional(),
    candidateId: identity.optional(), sourceAttemptId: identity.optional(), raisedAt: identity, request: identity,
    reportIds: z.array(identity), status: z.enum(['waiting-external','waiting-human-decision','adopted']) }).optional(),
  decisionHistory: z.array(decision),
  events: z.array(z.strictObject({ id: identity, at: identity, type: identity, message: text, attemptId: identity.optional(), sectionId: identity.optional() })),
  commit: z.strictObject({ commit: identity, candidateId: identity, branch: identity, createdAt: identity, message: text }).optional(),
  delivery: z.strictObject({ mode: z.enum(['worktree', 'commit']), candidateId: identity, path: identity, branch: identity, createdAt: identity, commit: identity.optional() }).optional(),
  blockedReason: text.optional(), diagnostic: z.strictObject({ reason: identity, sectionId: identity.optional(), requestedAt: identity }).optional(),
}).superRefine((run, context) => {
  const issue = (message: string): void => { context.addIssue({ code: 'custom', message }); };
  if (run.plan) { try { validatePlan(run.plan); } catch (error) { issue(String(error)); } }
  if (new Set(run.attempts.map((entry) => entry.id)).size !== run.attempts.length) issue('Duplicate persisted execution identity.');
  if (run.attempts.some((entry) => entry.task.runId !== run.id || entry.task.id !== entry.id)) issue('Execution belongs to another task or has inconsistent identity.');
  for (const [id, entry] of Object.entries(run.sections)) if (id !== entry.id) issue('Section map key does not match its identity.');
  for (const [id, entry] of Object.entries(run.candidates)) if (id !== entry.id) issue('Candidate map key does not match its identity.');
  if (run.currentCandidateId && !run.candidates[run.currentCandidateId]) issue('Current candidate is missing.');
  if (run.activeSectionId && !run.sections[run.activeSectionId]) issue('Active Section is missing.');
  if (run.status === 'completed' && (run.stage !== 'done' || !run.delivery || !run.featureVerificationAttemptId)) issue('Completed task lacks delivery evidence.');
  if (run.delivery?.mode === 'commit' && (!run.commit || run.commit.commit !== run.delivery.commit)) issue('Commit delivery lacks matching actual commit evidence.');
  if (run.stage === 'done' && run.status !== 'completed') issue('A done task must be completed.');
  for (const entry of run.attempts) {
    if (entry.state === 'admitted' && (!entry.outcome || entry.outcome.status !== 'completed' || entry.admittedOutput === undefined)) issue('Admitted execution lacks a completed structured result.');
    if (entry.state === 'terminal' && !entry.outcome) issue('Terminal execution lacks an actual outcome.');
  }
});

/** Storage and Remote boundaries validate actual persisted mechanics; no unchecked cast parser. */
export const runSchema = persistedRunSchema as unknown as z.ZodType<DevelopmentRun>;
