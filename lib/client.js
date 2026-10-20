// src/dsh/remote-contract.ts
import { z as z3 } from "zod";
import { createTypertRemoteInfo } from "@deepseek-ai/dsh-typert-protocol/remote-info";

// src/core/schemas.ts
import { z as z2 } from "zod";

// src/core/contracts.ts
import { z } from "zod";
var text = z.string().min(1).max(4e4);
var id = z.string().regex(/^[A-Za-z][A-Za-z0-9_.-]{0,95}$/);
var texts = z.array(text).max(200);
var check = z.strictObject({
  id,
  command: z.array(z.string().min(1)).min(1).max(100),
  cwd: z.string().optional(),
  timeoutMs: z.number().int().min(100).max(36e5).optional(),
  required: z.boolean()
});
var planSchema = z.strictObject({
  title: text,
  features: z.array(z.strictObject({ id, title: text, outcome: text, acceptanceCriteria: texts.min(1), sectionIds: z.array(id).min(1), checks: z.array(check) })).min(1).max(100),
  sections: z.array(z.strictObject({
    id,
    title: text,
    featureIds: z.array(id).min(1),
    objective: text,
    dependencies: z.array(id),
    writeScope: texts.min(1),
    acceptanceCriteria: texts.min(1),
    implementation: z.enum(["standard", "large"]),
    checks: z.array(check),
    replacesSectionId: id.optional(),
    subsections: z.array(z.strictObject({
      id,
      objective: text,
      acceptanceCriteria: texts.min(1),
      writeScope: texts.min(1),
      safeIntermediateState: text,
      consumer: text,
      checks: z.array(check).min(1),
      implementation: z.enum(["standard", "large"]).optional()
    }))
  })).min(1).max(500),
  assumptions: texts
});
var advisorTrigger = z.enum(["ADV-01", "ADV-02", "ADV-03", "ADV-04", "ADV-05", "ADV-06"]);
var recoveryClass = z.enum(["CONTINUE_CURRENT", "SIMPLIFY_CURRENT", "REPAIR_EVIDENCE", "SPLIT_REMAINING", "REBOUND_OWNER", "RESTART_FROM_BASE"]);
var findingSchema = z.strictObject({
  id,
  title: text,
  body: text,
  severity: z.enum(["critical", "major", "minor"]),
  invariant: text,
  location: z.string().optional(),
  classification: z.enum(["PLAN_BLOCKER", "PLAN_SCOPE_EXPANSION", "OWNER_DECISION", "PLAN_NIT"]).optional()
});
var reviewSchema = z.strictObject({
  verdict: z.enum(["clean", "findings", "incomplete"]),
  summary: text,
  coverage: texts,
  limitations: texts,
  findings: z.array(findingSchema).max(200),
  closures: z.array(z.strictObject({ findingId: text, status: z.enum(["verified-closed", "still-open", "regression", "insufficient-evidence"]), evidence: text })).max(200).optional(),
  simplifications: z.array(z.strictObject({
    mechanism: text,
    simplerPath: text,
    preservedInvariants: texts.min(1),
    preservationOracle: text,
    affectedConsumers: texts
  })).max(30).optional(),
  advisorTrigger: advisorTrigger.optional(),
  planEvidenceReuse: z.array(z.strictObject({ attemptId: text, reason: text })).optional(),
  simplificationClosures: z.array(z.strictObject({
    actionId: text,
    status: z.enum(["preserved", "regressed", "insufficient-evidence"]),
    evidence: text
  })).max(30).optional()
});
var implementationSchema = z.strictObject({
  summary: text,
  completedCriteria: texts,
  remainingWork: texts,
  changedInterfaces: texts
});
var selectionSchema = z.strictObject({
  lenses: z.array(z.strictObject({ id, name: text, focus: text })).min(1).max(6),
  rationale: text,
  invalidatedLensIds: z.array(id).optional(),
  invalidationReason: text.optional()
});
var adjudicationSchema = z.strictObject({
  resolution: z.enum(["accept", "repair", "more-review", "needs-user"]),
  summary: text,
  coverageSufficient: z.boolean(),
  dispositions: z.array(z.strictObject({ findingId: text, decision: z.enum(["fix", "reject", "needs-user"]), reason: text })),
  repairInstructions: z.string(),
  material: z.boolean(),
  invalidatedSectionIds: z.array(id),
  missingCoverage: texts,
  evidenceReuse: z.array(z.strictObject({ evidenceId: text, reason: text })),
  simplificationDispositions: z.array(z.strictObject({ actionId: text, decision: z.enum(["batch", "defer", "reject"]), reason: text })).optional(),
  advisorTrigger: advisorTrigger.optional(),
  question: z.string().optional()
});
var featureVerificationSchema = z.strictObject({
  verdict: z.enum(["accepted", "repair", "needs-user", "integration-review"]),
  summary: text,
  criteria: z.array(z.strictObject({ featureId: id, criterion: text, evidenceIds: z.array(text).min(1), satisfied: z.boolean() })),
  unprovenComposition: z.array(z.strictObject({ id, featureId: id, lens: text, boundary: text })).max(6).optional(),
  integrationDispositions: z.array(z.strictObject({ findingId: text, decision: z.enum(["fix", "reject"]), reason: text })).optional(),
  repairSectionIds: z.array(id),
  repairInstructions: z.string(),
  question: z.string().optional(),
  advisorTrigger: advisorTrigger.optional()
});
var diagnosticSchema = z.strictObject({
  summary: text,
  recommendation: z.enum(["retry", "revise-plan", "needs-user"]),
  instructions: text,
  question: z.string().optional(),
  recoveryClass: recoveryClass.optional(),
  advisorTrigger: advisorTrigger.optional()
});
var actorOutputSchemas = {
  planner: z.strictObject({ plan: planSchema, explanation: text, advisorTrigger: advisorTrigger.optional() }),
  "plan-review-a": reviewSchema,
  "plan-review-b": reviewSchema,
  implementer: implementationSchema,
  "review-selector": selectionSchema,
  "reviewer-a": reviewSchema,
  "reviewer-b": reviewSchema,
  adjudicator: adjudicationSchema,
  "closure-reviewer": reviewSchema.extend({ closures: reviewSchema.shape.closures.unwrap() }),
  "feature-verifier": featureVerificationSchema,
  diagnostician: diagnosticSchema
};
function assertUnique(values, label) {
  if (new Set(values).size !== values.length) throw new Error(`Duplicate ${label} identity.`);
}
function validatePlan(plan) {
  assertUnique(plan.features.map((feature) => feature.id), "Feature");
  assertUnique(plan.sections.map((section2) => section2.id), "Section");
  const sections = new Map(plan.sections.map((section2) => [section2.id, section2]));
  const features = new Map(plan.features.map((feature) => [feature.id, feature]));
  const children = plan.sections.flatMap((section2) => section2.subsections.map((child) => child.id));
  assertUnique([...sections.keys(), ...children], "Section/Subsection");
  for (const section2 of plan.sections) {
    assertUnique(section2.acceptanceCriteria, `acceptance criterion in ${section2.id}`);
    assertUnique(section2.dependencies, "dependency");
    assertUnique(section2.featureIds, "Feature membership");
    for (const dependency of section2.dependencies) {
      if (!sections.has(dependency)) throw new Error(`Section ${section2.id} depends on missing or internal unit ${dependency}. Dependencies must identify parent Sections.`);
      if (dependency === section2.id) throw new Error(`Section ${section2.id} depends on itself.`);
    }
    for (const featureId of section2.featureIds) {
      if (!features.get(featureId)?.sectionIds.includes(section2.id)) throw new Error(`Feature/Section membership is inconsistent for ${section2.id}/${featureId}.`);
    }
    assertUnique(section2.checks.map((spec) => spec.id), `check in ${section2.id}`);
    for (const child of section2.subsections) {
      assertUnique(child.checks.map((spec) => spec.id), `check in Subsection ${child.id}`);
      if (!child.checks.some((spec) => spec.required)) throw new Error(`Subsection ${child.id} needs an executable required scoped oracle.`);
      const parentScopes = section2.writeScope.map((scope) => scope.replace(/\/$/, ""));
      for (const scope of child.writeScope) {
        if (!parentScopes.some((parent) => scope === parent || scope.startsWith(`${parent}/`) || parent === "**/*" || parent.endsWith("/**") && scope.startsWith(parent.slice(0, -2))))
          throw new Error(`Subsection ${child.id} writeScope is outside parent ${section2.id}.`);
      }
    }
  }
  for (const feature of plan.features) {
    assertUnique(feature.acceptanceCriteria, `business criterion in ${feature.id}`);
    assertUnique(feature.sectionIds, "Section membership");
    assertUnique(feature.checks.map((spec) => spec.id), `check in ${feature.id}`);
    for (const sectionId of feature.sectionIds) {
      if (!sections.get(sectionId)?.featureIds.includes(feature.id)) throw new Error(`Feature ${feature.id} references absent or unowned Section ${sectionId}.`);
    }
  }
  const visited = /* @__PURE__ */ new Set();
  const visiting = /* @__PURE__ */ new Set();
  const visit = (sectionId) => {
    if (visiting.has(sectionId)) throw new Error("Section dependency graph contains a cycle.");
    if (visited.has(sectionId)) return;
    visiting.add(sectionId);
    for (const dependency of sections.get(sectionId).dependencies) visit(dependency);
    visiting.delete(sectionId);
    visited.add(sectionId);
  };
  for (const section2 of plan.sections) visit(section2.id);
}

// src/core/types.ts
var CORE_VERSION = "1.1.0";
var POLICY_VERSION = "sfd-native-2";

// src/core/schemas.ts
var text2 = z2.string();
var identity = z2.string().min(1);
var integer = z2.number().int().nonnegative();
var object = z2.record(z2.string(), z2.unknown());
var actorKind = z2.enum(["planner", "plan-review-a", "plan-review-b", "implementer", "review-selector", "reviewer-a", "reviewer-b", "adjudicator", "closure-reviewer", "feature-verifier", "diagnostician"]);
var route = z2.strictObject({ preset: identity, model: text2.optional(), provider: text2.optional(), effort: text2.optional() });
var workspace = z2.strictObject({ path: identity, branch: text2, baseCommit: identity, prepared: z2.boolean().optional() });
var candidate = z2.strictObject({ id: identity, capturedAt: identity, workspacePath: identity, head: identity, treeHash: identity, diff: text2, changedFiles: z2.array(text2) });
var advisorTrigger2 = z2.enum(["ADV-01", "ADV-02", "ADV-03", "ADV-04", "ADV-05", "ADV-06"]);
var recoveryClass2 = z2.enum(["CONTINUE_CURRENT", "SIMPLIFY_CURRENT", "REPAIR_EVIDENCE", "SPLIT_REMAINING", "REBOUND_OWNER", "RESTART_FROM_BASE"]);
var checkEvidence = z2.strictObject({
  id: identity,
  candidateId: identity,
  specId: identity,
  status: z2.enum(["passed", "failed", "cancelled", "unknown"]),
  exitCode: z2.number().int().nullable(),
  startedAt: identity,
  endedAt: identity,
  output: text2,
  artifactRefs: z2.array(text2).optional()
});
var lens = z2.strictObject({ id: identity, name: identity, focus: identity });
var task = z2.strictObject({
  id: identity,
  runId: identity,
  kind: actorKind,
  sectionId: identity.optional(),
  featureId: identity.optional(),
  lens: lens.optional(),
  inputContractVersion: integer,
  candidateId: identity.optional(),
  controlEpoch: integer,
  route: route.optional(),
  workspace,
  input: object,
  outputSchema: object,
  timeoutMs: z2.number().int().positive()
});
var actorIdentity = z2.strictObject({
  requested: route.optional(),
  observed: z2.strictObject({ provider: text2.optional(), model: text2.optional(), effort: text2.optional(), preset: text2.optional() }).optional(),
  transport: z2.enum(["dsh-native", "external", "test"]),
  sessionId: identity.optional()
});
var attempt = z2.strictObject({
  id: identity,
  task,
  state: z2.enum(["intent", "started", "terminal", "admitted", "unknown"]),
  createdAt: identity,
  startedAt: identity.optional(),
  endedAt: identity.optional(),
  actorId: identity.optional(),
  outcome: z2.strictObject({ status: z2.enum(["completed", "failed", "cancelled"]), output: z2.unknown().optional(), error: text2.optional(), identity: actorIdentity, artifactRefs: z2.array(text2).optional() }).optional(),
  admittedOutput: z2.unknown().optional(),
  rejection: text2.optional(),
  infrastructureRetries: integer,
  recoveryDecisionId: identity.optional(),
  reconciledAt: identity.optional()
});
var section = z2.strictObject({
  id: identity,
  stage: z2.enum(["pending", "subsection-implementing", "subsection-review", "subsection-adjudicating", "implementing", "reroute", "review-selection", "review-a", "adjudicating-a", "repairing", "closure", "review-b", "adjudicating-b", "accepted", "integrated"]),
  inputContractVersion: integer,
  lineageId: identity,
  materialRepairWaves: integer,
  diagnosticCount: integer,
  candidateId: identity.optional(),
  lenses: z2.array(lens),
  checks: z2.array(checkEvidence),
  reviewIds: z2.array(identity),
  decisionIds: z2.array(identity),
  repairInstructions: text2.optional(),
  repairOrigin: z2.enum(["a", "b", "feature"]).optional(),
  acceptedCandidateId: identity.optional(),
  integratedCandidateId: identity.optional(),
  aAcceptedCandidateId: identity.optional(),
  aCoverageEvidenceIds: z2.array(identity),
  subsectionIndex: integer.optional(),
  subsectionCurrentChecks: z2.array(checkEvidence).optional(),
  subsectionChecks: z2.array(checkEvidence).optional(),
  subsectionRiskLenses: z2.array(lens).optional(),
  subsectionCheckpoints: z2.array(z2.strictObject({
    subsectionId: identity,
    candidateId: identity,
    reviewId: identity,
    checkIds: z2.array(identity),
    priorCandidateId: identity.optional()
  })).optional(),
  subsectionFindingIds: z2.array(identity).optional(),
  simplifications: z2.array(z2.strictObject({
    id: identity,
    originReviewId: identity,
    proposedCandidateId: identity,
    mechanism: identity,
    simplerPath: identity,
    preservedInvariants: z2.array(identity),
    preservationOracle: identity,
    affectedConsumers: z2.array(text2),
    status: z2.enum(["proposed", "deferred", "rejected", "batched", "preserved"]),
    closureCandidateId: identity.optional()
  })).optional(),
  activeSimplificationIds: z2.array(identity).optional(),
  recovery: z2.strictObject({
    classification: recoveryClass2,
    atMaterialWaves: integer,
    extraWaveLimit: integer,
    diagnosisAttemptId: identity,
    structuralPending: z2.boolean().optional()
  }).optional(),
  closureFindingIds: z2.array(identity).optional(),
  freshRepairLensIds: z2.array(identity).optional()
});
var decision = z2.strictObject({
  id: identity,
  question: identity,
  context: text2,
  kind: z2.enum(["semantic", "recovery", "budget", "infrastructure", "advisor"]),
  sectionId: identity.optional(),
  createdAt: identity,
  answer: text2.optional(),
  advisorTrigger: advisorTrigger2.optional(),
  advisorResult: text2.optional(),
  advisorAdoption: z2.enum(["accept", "reject", "clarify"]).optional()
});
var persistedRunSchema = z2.strictObject({
  id: identity,
  schemaVersion: z2.literal(1),
  workflowVersion: z2.literal(CORE_VERSION),
  revision: integer,
  controlEpoch: integer,
  inputContractVersion: integer,
  createdAt: identity,
  updatedAt: identity,
  goal: identity,
  requirementsHistory: z2.array(z2.strictObject({ version: integer, goal: identity, at: identity })).min(1),
  workspace,
  policy: z2.strictObject({
    version: z2.literal(POLICY_VERSION),
    actorTimeoutMs: z2.number().int().positive(),
    maxParallelReviews: z2.number().int().min(1).max(6),
    maxRepairWaves: z2.number().int().min(1).max(5),
    maxPlanRepairs: z2.number().int().min(1).max(2),
    maxDiagnostics: z2.number().int().min(1).max(2),
    maxInfrastructureRetries: z2.number().int().min(0).max(3),
    commit: z2.boolean(),
    routes: z2.partialRecord(actorKind, route),
    largeImplementerRoute: route.optional()
  }),
  status: z2.enum(["draft", "running", "pausing", "paused", "blocked", "waiting-user", "cancelled", "completed"]),
  stage: z2.enum(["planning", "plan-review-a", "plan-review-b", "sections", "feature-verification", "delivery", "done"]),
  plan: planSchema.optional(),
  planRevision: integer,
  planRepairs: integer,
  planFeedback: z2.array(text2),
  planRequirementsVersion: integer.optional(),
  planSilentRetirement: z2.strictObject({ slot: z2.literal("plan-review-a"), reportIds: z2.array(identity), rationale: identity }).optional(),
  retiredSections: z2.record(z2.string(), z2.strictObject({ state: section, contract: planSchema.shape.sections.element, requirementsVersion: integer, retiredAt: identity })).optional(),
  sections: z2.record(z2.string(), section),
  activeSectionId: identity.optional(),
  candidates: z2.record(z2.string(), candidate),
  currentCandidateId: identity.optional(),
  attempts: z2.array(attempt),
  operations: z2.array(z2.strictObject({
    id: identity,
    kind: z2.enum(["prepare", "capture", "checks", "commit", "integrate"]),
    state: z2.enum(["intent", "started", "completed", "unknown"]),
    scopeKey: identity,
    sectionId: identity.optional(),
    candidateId: identity.optional(),
    controlEpoch: integer,
    createdAt: identity,
    endedAt: identity.optional(),
    error: text2.optional(),
    recoveryDecisionId: identity.optional(),
    reconciledAt: identity.optional()
  })),
  reviews: z2.array(z2.strictObject({
    id: identity,
    attemptId: identity,
    candidateId: identity,
    sectionId: identity,
    stage: z2.enum(["a", "closure", "b"]),
    lensId: identity,
    output: reviewSchema,
    valid: z2.boolean()
  })),
  decisions: z2.array(z2.strictObject({ id: identity, attemptId: identity, sectionId: identity.optional(), candidateId: identity.optional(), output: z2.unknown(), createdAt: identity })),
  featureChecks: z2.array(checkEvidence),
  integrationGaps: z2.array(z2.strictObject({ id: identity, featureId: identity, lens: identity, boundary: identity, candidateId: identity, reviewed: z2.boolean().optional() })).optional(),
  integrationReviews: z2.array(z2.strictObject({
    id: identity,
    attemptId: identity,
    candidateId: identity,
    featureId: identity,
    gapId: identity,
    output: reviewSchema
  })).optional(),
  featureVerificationAttemptId: identity.optional(),
  pendingDecision: decision.optional(),
  advisorCase: z2.strictObject({
    trigger: advisorTrigger2,
    sectionId: identity.optional(),
    candidateId: identity.optional(),
    sourceAttemptId: identity.optional(),
    raisedAt: identity,
    request: identity,
    reportIds: z2.array(identity),
    status: z2.enum(["waiting-external", "waiting-human-decision", "adopted"])
  }).optional(),
  decisionHistory: z2.array(decision),
  events: z2.array(z2.strictObject({ id: identity, at: identity, type: identity, message: text2, attemptId: identity.optional(), sectionId: identity.optional() })),
  commit: z2.strictObject({ commit: identity, candidateId: identity, branch: identity, createdAt: identity, message: text2 }).optional(),
  delivery: z2.strictObject({ mode: z2.enum(["worktree", "commit"]), candidateId: identity, path: identity, branch: identity, createdAt: identity, commit: identity.optional() }).optional(),
  blockedReason: text2.optional(),
  diagnostic: z2.strictObject({ reason: identity, sectionId: identity.optional(), requestedAt: identity }).optional()
}).superRefine((run, context) => {
  const issue = (message2) => {
    context.addIssue({ code: "custom", message: message2 });
  };
  if (run.plan) {
    try {
      validatePlan(run.plan);
    } catch (error) {
      issue(String(error));
    }
  }
  if (new Set(run.attempts.map((entry) => entry.id)).size !== run.attempts.length) issue("Duplicate persisted execution identity.");
  if (run.attempts.some((entry) => entry.task.runId !== run.id || entry.task.id !== entry.id)) issue("Execution belongs to another task or has inconsistent identity.");
  for (const [id2, entry] of Object.entries(run.sections)) if (id2 !== entry.id) issue("Section map key does not match its identity.");
  for (const [id2, entry] of Object.entries(run.candidates)) if (id2 !== entry.id) issue("Candidate map key does not match its identity.");
  if (run.currentCandidateId && !run.candidates[run.currentCandidateId]) issue("Current candidate is missing.");
  if (run.activeSectionId && !run.sections[run.activeSectionId]) issue("Active Section is missing.");
  if (run.status === "completed" && (run.stage !== "done" || !run.delivery || !run.featureVerificationAttemptId)) issue("Completed task lacks delivery evidence.");
  if (run.delivery?.mode === "commit" && (!run.commit || run.commit.commit !== run.delivery.commit)) issue("Commit delivery lacks matching actual commit evidence.");
  if (run.stage === "done" && run.status !== "completed") issue("A done task must be completed.");
  for (const entry of run.attempts) {
    if (entry.state === "admitted" && (!entry.outcome || entry.outcome.status !== "completed" || entry.admittedOutput === void 0)) issue("Admitted execution lacks a completed structured result.");
    if (entry.state === "terminal" && !entry.outcome) issue("Terminal execution lacks an actual outcome.");
  }
});
var runSchema = persistedRunSchema;

// src/dsh/remote-contract.ts
var sessionRequestSchema = z3.object({ sessionId: z3.string().min(1) }).strict();
var runRequestSchema = sessionRequestSchema.extend({ runId: z3.string().min(1) }).strict();
var createRequestSchema = sessionRequestSchema.extend({
  goal: z3.string().trim().min(1).max(1e5),
  workspacePath: z3.string().min(1).optional(),
  commit: z3.boolean().optional()
}).strict();
var decideRequestSchema = runRequestSchema.extend({
  decisionId: z3.string().min(1),
  answer: z3.string().trim().min(1).max(1e5),
  action: z3.enum(["continue", "retry", "replan", "cancel"]).optional(),
  advisorResult: z3.string().trim().min(1).max(1e5).optional(),
  advisorAdoption: z3.enum(["accept", "reject", "clarify"]).optional()
}).strict();
var reviseRequestSchema = runRequestSchema.extend({ goal: z3.string().trim().min(1).max(1e5) }).strict();
function codec(schema, name2) {
  return { mode: "strict", typeSymbol: `dsh-sfd#${name2}`, create: () => schema };
}
function method(input, output, name2) {
  const requestCodec = codec(input, `${name2}Request`);
  return {
    service: "developmentWorkflow",
    invocation: { kind: "direct" },
    parameters: [{ name: "request", source: "json", codec: requestCodec, strictCodec: requestCodec }],
    result: codec(output, name2 === "list" ? "DevelopmentRun[]" : "DevelopmentRun")
  };
}
var TYPERT_REMOTE = createTypertRemoteInfo({
  package: "dsh-sfd",
  methods: {
    "developmentWorkflow/list": method(sessionRequestSchema, z3.array(runSchema), "list"),
    "developmentWorkflow/create": method(createRequestSchema, runSchema, "create"),
    "developmentWorkflow/status": method(runRequestSchema, runSchema, "status"),
    "developmentWorkflow/start": method(runRequestSchema, runSchema, "start"),
    "developmentWorkflow/pause": method(runRequestSchema, runSchema, "pause"),
    "developmentWorkflow/resume": method(runRequestSchema, runSchema, "resume"),
    "developmentWorkflow/cancel": method(runRequestSchema, runSchema, "cancel"),
    "developmentWorkflow/recover": method(runRequestSchema, runSchema, "recover"),
    "developmentWorkflow/decide": method(decideRequestSchema, runSchema, "decide"),
    "developmentWorkflow/revise": method(reviseRequestSchema, runSchema, "revise")
  }
}, z3);

// src/client/controller.ts
function message(error) {
  return error instanceof Error ? error.message : String(error);
}
function value(result) {
  if (!result.ok) throw new Error(`${result.error.message} (${result.error.code})`);
  return result.value;
}
var DevelopmentClientController = class {
  constructor(remote, pollMs = 2e3) {
    this.remote = remote;
    this.pollMs = pollMs;
  }
  snapshot = {
    sessionId: void 0,
    selectedRunId: void 0,
    runs: [],
    loading: false,
    busy: false,
    error: void 0,
    readError: void 0,
    refreshedAt: void 0
  };
  listeners = /* @__PURE__ */ new Set();
  epoch = 0;
  mutationEpoch = 0;
  read;
  readAgain = false;
  timer;
  disposed = false;
  getSnapshot = () => this.snapshot;
  subscribe = (listener) => {
    this.listeners.add(listener);
    if (this.listeners.size === 1) {
      void this.refresh();
      this.schedule();
    }
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size) this.clearTimer();
    };
  };
  publish(patch) {
    if (this.disposed) return;
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }
  clearTimer() {
    if (this.timer !== void 0) clearTimeout(this.timer);
    this.timer = void 0;
  }
  schedule() {
    this.clearTimer();
    if (this.disposed || !this.listeners.size || this.pollMs <= 0) return;
    this.timer = setTimeout(() => {
      void this.refresh().finally(() => this.schedule());
    }, this.pollMs);
  }
  /** Changing the visible owner does not reassign or mutate a Run. */
  setSession(sessionId) {
    if (sessionId === this.snapshot.sessionId) return;
    if (this.snapshot.busy) throw new Error("Wait for the current action to settle before changing its owner session.");
    this.epoch += 1;
    this.publish({
      sessionId,
      selectedRunId: void 0,
      runs: [],
      loading: !!sessionId,
      error: void 0,
      readError: void 0,
      refreshedAt: void 0
    });
    void this.refresh();
  }
  selectRun(runId) {
    if (!this.snapshot.runs.some((run) => run.id === runId)) return;
    this.publish({ selectedRunId: runId, error: void 0 });
  }
  /** Coalesce reads and fence responses across owner changes and admitted mutations. */
  refresh() {
    if (this.disposed || !this.snapshot.sessionId) return Promise.resolve();
    if (this.read) {
      this.readAgain = true;
      return this.read;
    }
    const sessionId = this.snapshot.sessionId;
    const epoch = this.epoch;
    const mutationEpoch = this.mutationEpoch;
    const current = () => !this.disposed && this.epoch === epoch && this.mutationEpoch === mutationEpoch;
    const work = async () => {
      try {
        const rows = value(await this.remote.list({ sessionId }));
        if (!current()) return;
        const existing = new Map(this.snapshot.runs.map((run) => [run.id, run]));
        const runs = rows.map((run) => {
          const prior = existing.get(run.id);
          return prior && prior.revision > run.revision ? prior : run;
        }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        const selected = runs.some((run) => run.id === this.snapshot.selectedRunId) ? this.snapshot.selectedRunId : runs[0]?.id;
        this.publish({ runs, selectedRunId: selected, readError: void 0, refreshedAt: (/* @__PURE__ */ new Date()).toISOString() });
      } catch (error) {
        if (current()) this.publish({ readError: message(error) });
      } finally {
        if (this.epoch === epoch) this.publish({ loading: false });
      }
    };
    this.read = work().finally(() => {
      this.read = void 0;
      if (this.readAgain) {
        this.readAgain = false;
        void this.refresh();
      }
    });
    return this.read;
  }
  owner() {
    const sessionId = this.snapshot.sessionId;
    if (!sessionId) throw new Error("Choose the conversation that owns this work.");
    return sessionId;
  }
  request(runId) {
    if (!this.snapshot.runs.some((run) => run.id === runId)) throw new Error("The selected Run is no longer in this owner session. Refresh the list.");
    return { sessionId: this.owner(), runId };
  }
  async mutate(action) {
    if (this.snapshot.busy || this.disposed) return false;
    this.mutationEpoch += 1;
    const epoch = this.epoch;
    this.publish({ busy: true, error: void 0 });
    try {
      const run = value(await action());
      if (this.disposed || epoch !== this.epoch) return false;
      const previous = this.snapshot.runs.find((item) => item.id === run.id);
      const actual = previous && previous.revision > run.revision ? previous : run;
      this.publish({ runs: [actual, ...this.snapshot.runs.filter((item) => item.id !== run.id)], selectedRunId: run.id });
      return true;
    } catch (error) {
      if (epoch === this.epoch) this.publish({ error: message(error) });
      return false;
    } finally {
      this.mutationEpoch += 1;
      if (epoch === this.epoch) this.publish({ busy: false });
      void this.refresh();
    }
  }
  create(input) {
    return this.mutate(() => this.remote.create({ ...input, sessionId: this.owner() }));
  }
  act(action, runId) {
    return this.mutate(() => this.remote[action](this.request(runId)));
  }
  decide(runId, decisionId, answer, action, advisor) {
    return this.mutate(() => this.remote.decide({
      ...this.request(runId),
      decisionId,
      answer,
      ...action ? { action } : {},
      ...advisor
    }));
  }
  revise(runId, goal) {
    return this.mutate(() => this.remote.revise({ ...this.request(runId), goal }));
  }
  dispose() {
    this.disposed = true;
    this.epoch += 1;
    this.clearTimer();
    this.listeners.clear();
  }
};

// src/client/DevelopmentPanel.tsx
import { useEffect, useState, useSyncExternalStore } from "react";

// src/client/presentation.ts
var STATUS_LABELS = {
  draft: "Ready to start",
  running: "Working",
  pausing: "Pausing",
  paused: "Paused",
  blocked: "Blocked",
  "waiting-user": "Needs your decision",
  cancelled: "Cancelled",
  completed: "Completed"
};
var SECTION_LABELS = {
  pending: "Waiting on dependencies",
  "subsection-implementing": "Implementing child checkpoint",
  "subsection-review": "R01 child checkpoint",
  "subsection-adjudicating": "Reconciling child evidence",
  implementing: "Implementing",
  reroute: "Rechecking repair-delta risks",
  "review-selection": "Selecting risk lenses",
  "review-a": "Independent A review",
  "adjudicating-a": "Reconciling A evidence",
  repairing: "Repairing",
  closure: "Checking repair closure",
  "review-b": "Blind B review",
  "adjudicating-b": "Reconciling B evidence",
  accepted: "Accepted",
  integrated: "Integrated"
};
var ROLE_LABELS = {
  planner: "Planner",
  "plan-review-a": "Plan A",
  "plan-review-b": "Plan B",
  implementer: "Implementation",
  "review-selector": "Risk selection",
  "reviewer-a": "Code A",
  "reviewer-b": "Blind Code B",
  adjudicator: "Evidence adjudication",
  "closure-reviewer": "Repair closure",
  "feature-verifier": "Feature acceptance",
  diagnostician: "Diagnosis"
};
function phaseLabel(run) {
  if (run.stage === "sections") {
    const section2 = run.activeSectionId && run.sections[run.activeSectionId];
    return section2 ? `${section2.id} \xB7 ${SECTION_LABELS[section2.stage]}` : "Section scheduling";
  }
  return {
    planning: "Planning",
    "plan-review-a": "Independent plan A",
    "plan-review-b": "Independent plan B",
    "feature-verification": "Composed Feature acceptance",
    delivery: "Delivery",
    done: "Delivered"
  }[run.stage];
}
function availableActions(run) {
  switch (run.status) {
    case "draft":
      return ["start", "cancel"];
    case "running":
      return ["pause", "cancel"];
    case "pausing":
      return ["cancel"];
    case "paused":
      return ["resume", "recover", "cancel"];
    case "blocked":
      return ["recover", "cancel"];
    case "waiting-user":
      return ["cancel"];
    case "cancelled":
    case "completed":
      return [];
  }
}
function observedIdentity(attempt2) {
  const observed = attempt2.outcome?.identity.observed;
  if (!observed) return "Not recorded";
  const parts = [observed.provider, observed.model, observed.effort].filter(Boolean);
  return parts.length ? parts.join(" / ") : "Not recorded";
}
function requestedIdentity(attempt2) {
  const route2 = attempt2.outcome?.identity.requested ?? attempt2.task.route;
  if (!route2) return "Host configuration";
  return [route2.provider, route2.model, route2.effort, route2.preset].filter(Boolean).join(" / ");
}
function shorten(value2, size = 12) {
  return value2 ? value2.length > size ? `${value2.slice(0, size)}\u2026` : value2 : "\u2014";
}
function dateLabel(iso) {
  if (!iso) return "\u2014";
  const date = new Date(iso);
  return Number.isNaN(date.valueOf()) ? iso : date.toLocaleString();
}

// src/client/styles.ts
var PANEL_STYLES = `
.sfd-workflow { height:100%; overflow:auto; box-sizing:border-box; padding:28px max(24px, var(--dsh-frame-leading-clearance, 24px)); color:var(--dsh-color-text-primary, inherit); background:var(--dsh-color-bg-primary, transparent); font:inherit; }
.sfd-workflow * { box-sizing:border-box; }
.sfd-workflow h1 { margin:0; font-size:25px; line-height:1.3; font-weight:650; }
.sfd-workflow h2 { margin:0 0 12px; font-size:18px; }
.sfd-workflow h3 { margin:0 0 8px; font-size:15px; }
.sfd-workflow p { margin:7px 0 12px; line-height:1.6; }
.sfd-workflow code { overflow-wrap:anywhere; font-size:12px; }
.sfd-workflow small, .sfd-muted { opacity:.7; font-size:12px; }
.sfd-head, .sfd-row { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
.sfd-head { justify-content:space-between; margin-bottom:20px; }
.sfd-toolbar { display:flex; align-items:end; gap:12px; margin:18px 0; flex-wrap:wrap; }
.sfd-workflow button, .sfd-workflow select, .sfd-workflow input, .sfd-workflow textarea { font:inherit; color:inherit; }
.sfd-workflow button { border:1px solid color-mix(in srgb, currentColor 18%, transparent); border-radius:7px; background:color-mix(in srgb, currentColor 4%, transparent); padding:7px 12px; cursor:pointer; }
.sfd-workflow button:hover:not(:disabled) { background:color-mix(in srgb, currentColor 9%, transparent); }
.sfd-workflow button:disabled { opacity:.45; cursor:default; }
.sfd-workflow button:focus-visible, .sfd-workflow select:focus-visible, .sfd-workflow input:focus-visible, .sfd-workflow textarea:focus-visible, .sfd-workflow summary:focus-visible { outline:2px solid #488df5; outline-offset:2px; }
.sfd-workflow .sfd-primary { color:#fff; background:#236cdd; border-color:#236cdd; }
.sfd-workflow .sfd-primary:hover:not(:disabled) { background:#165bc5; }
.sfd-workflow .sfd-danger { color:#cc4a50; }
.sfd-workflow label { display:grid; gap:6px; font-size:13px; }
.sfd-workflow select, .sfd-workflow input:not([type=checkbox]), .sfd-workflow textarea { width:100%; border:1px solid color-mix(in srgb, currentColor 22%, transparent); border-radius:6px; background:transparent; padding:8px 10px; }
.sfd-workflow select { max-width:450px; }
.sfd-workflow select option { color:CanvasText; background:Canvas; }
.sfd-workflow textarea { resize:vertical; min-height:96px; line-height:1.55; }
.sfd-workflow .sfd-check { display:flex; flex-direction:row; align-items:center; gap:8px; }
.sfd-owner { min-width:240px; max-width:520px; flex:1; }
.sfd-layout { display:grid; grid-template-columns:minmax(210px, 270px) minmax(0, 1fr); gap:24px; }
.sfd-run-list { display:grid; align-content:start; gap:8px; }
.sfd-workflow .sfd-run { text-align:left; padding:12px; display:grid; gap:7px; line-height:1.45; }
.sfd-workflow .sfd-run[aria-current=true] { border-color:#488df5; background:color-mix(in srgb, #488df5 8%, transparent); }
.sfd-run-title { display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden; }
.sfd-detail { min-width:0; }
.sfd-card { border:1px solid color-mix(in srgb, currentColor 15%, transparent); border-radius:9px; padding:16px; margin-bottom:14px; }
.sfd-badge { font-size:11px; font-weight:600; padding:3px 7px; border-radius:4px; display:inline-block; background:color-mix(in srgb, currentColor 7%, transparent); }
.sfd-badge[data-status=running], .sfd-badge[data-status=started] { color:#3980e8; background:color-mix(in srgb, #3980e8 10%, transparent); }
.sfd-badge[data-status=completed], .sfd-badge[data-status=integrated], .sfd-badge[data-status=passed], .sfd-badge[data-status=admitted] { color:#268468; background:color-mix(in srgb, #268468 10%, transparent); }
.sfd-badge[data-status=blocked], .sfd-badge[data-status=failed], .sfd-badge[data-status=waiting-user], .sfd-badge[data-status=unknown] { color:#c07824; background:color-mix(in srgb, #c07824 10%, transparent); }
.sfd-notice { padding:12px 14px; border-left:3px solid #c07824; background:color-mix(in srgb, #c07824 7%, transparent); margin:12px 0; line-height:1.6; }
.sfd-error { color:#cf525a; overflow-wrap:anywhere; }
.sfd-form { display:grid; gap:14px; max-width:820px; margin:16px 0 24px; }
.sfd-workflow dl { display:grid; grid-template-columns:max-content minmax(0, 1fr); gap:6px 14px; margin:12px 0; font-size:13px; }
.sfd-workflow dt { opacity:.65; }
.sfd-workflow dd { margin:0; overflow-wrap:anywhere; }
.sfd-workflow ul { padding-left:20px; margin:10px 0; line-height:1.65; }
.sfd-workflow li { margin:3px 0; }
.sfd-workflow summary { cursor:pointer; line-height:1.6; }
.sfd-workflow details { margin:10px 0; }
.sfd-workflow details > .sfd-card { margin-top:10px; }
.sfd-workflow table { border-collapse:collapse; width:100%; text-align:left; font-size:12px; }
.sfd-table { width:100%; overflow:auto; margin:10px 0; }
.sfd-workflow th, .sfd-workflow td { vertical-align:top; padding:9px 8px; border-bottom:1px solid color-mix(in srgb, currentColor 12%, transparent); line-height:1.55; }
.sfd-workflow th { font-weight:600; }
.sfd-workflow pre { white-space:pre-wrap; overflow-wrap:anywhere; max-height:340px; overflow:auto; padding:12px; background:color-mix(in srgb, currentColor 4%, transparent); border-radius:6px; font-size:12px; }
.sfd-timeline { list-style:none; padding:0!important; }
.sfd-timeline li { margin:10px 0; padding-left:12px; border-left:2px solid color-mix(in srgb, currentColor 18%, transparent); }
.sfd-empty { padding:36px 16px; opacity:.7; text-align:center; line-height:1.7; }
@media (max-width:900px) { .sfd-layout { grid-template-columns:1fr; } .sfd-run-list { grid-template-columns:repeat(auto-fill, minmax(210px, 1fr)); } .sfd-workflow { padding:22px 16px; } }
`;

// src/client/DevelopmentPanel.tsx
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
var ACTION_LABELS = {
  start: "Start",
  pause: "Pause",
  resume: "Resume",
  cancel: "Cancel run",
  recover: "Reconcile recovery"
};
function Badge({ status, children }) {
  return /* @__PURE__ */ jsx("span", { className: "sfd-badge", "data-status": status, children });
}
function TextItems({ items }) {
  return items.length ? /* @__PURE__ */ jsx("ul", { children: items.map((item, index) => /* @__PURE__ */ jsx("li", { children: item }, `${index}-${item}`)) }) : null;
}
function Checks({ checks }) {
  if (!checks.length) return /* @__PURE__ */ jsx("p", { className: "sfd-muted", children: "No check results recorded yet." });
  return /* @__PURE__ */ jsx("div", { children: checks.map((check2) => /* @__PURE__ */ jsxs("details", { children: [
    /* @__PURE__ */ jsxs("summary", { children: [
      /* @__PURE__ */ jsx(Badge, { status: check2.status, children: check2.status }),
      " ",
      check2.specId,
      " ",
      /* @__PURE__ */ jsxs("span", { className: "sfd-muted", children: [
        "\xB7 ",
        shorten(check2.candidateId)
      ] })
    ] }),
    /* @__PURE__ */ jsxs("dl", { children: [
      /* @__PURE__ */ jsx("dt", { children: "Evidence" }),
      /* @__PURE__ */ jsx("dd", { children: /* @__PURE__ */ jsx("code", { children: check2.id }) }),
      /* @__PURE__ */ jsx("dt", { children: "Finished" }),
      /* @__PURE__ */ jsx("dd", { children: dateLabel(check2.endedAt) }),
      /* @__PURE__ */ jsx("dt", { children: "Exit code" }),
      /* @__PURE__ */ jsx("dd", { children: check2.exitCode ?? "Not recorded" })
    ] }),
    check2.output && /* @__PURE__ */ jsx("pre", { children: check2.output })
  ] }, check2.id)) });
}
function CreateForm({ controller, workspacePath, busy, onClose }) {
  const [goal, setGoal] = useState("");
  const [path, setPath] = useState(workspacePath ?? "");
  const submit = async (event) => {
    event.preventDefault();
    const created = await controller.create({ goal: goal.trim(), ...path.trim() ? { workspacePath: path.trim() } : {} });
    if (created) onClose();
  };
  return /* @__PURE__ */ jsxs("form", { className: "sfd-card sfd-form", onSubmit: (event) => {
    void submit(event);
  }, children: [
    /* @__PURE__ */ jsx("h2", { children: "New development run" }),
    /* @__PURE__ */ jsxs("label", { children: [
      "Goal and acceptance constraints",
      /* @__PURE__ */ jsx("textarea", { required: true, value: goal, onChange: (event) => setGoal(event.target.value), placeholder: "Describe the complete outcome, important constraints, and how you will know it works.", disabled: busy })
    ] }),
    /* @__PURE__ */ jsxs("label", { children: [
      "Repository path",
      /* @__PURE__ */ jsx("input", { value: path, onChange: (event) => setPath(event.target.value), placeholder: "Use the owner conversation's working directory", disabled: busy })
    ] }),
    /* @__PURE__ */ jsx("p", { children: "The accepted candidate is committed on its dedicated non-main branch. This workflow never pushes or merges automatically." }),
    /* @__PURE__ */ jsx("p", { className: "sfd-muted", children: "The selected conversation supplies the execution permissions. The run keeps its own goal, progress, reviews, and recovery state." }),
    /* @__PURE__ */ jsxs("div", { className: "sfd-row", children: [
      /* @__PURE__ */ jsx("button", { className: "sfd-primary", disabled: busy || !goal.trim(), type: "submit", children: "Create run" }),
      /* @__PURE__ */ jsx("button", { disabled: busy, type: "button", onClick: onClose, children: "Close" })
    ] })
  ] });
}
function DecisionForm({ run, decision: decision2, busy, controller }) {
  const [answer, setAnswer] = useState("");
  const [action, setAction] = useState("continue");
  const [advisorResult, setAdvisorResult] = useState("");
  const [advisorAdoption, setAdvisorAdoption] = useState("accept");
  const external = decision2.kind === "advisor";
  return /* @__PURE__ */ jsxs("form", { className: "sfd-notice sfd-form", onSubmit: (event) => {
    event.preventDefault();
    void controller.decide(
      run.id,
      decision2.id,
      answer.trim(),
      action,
      external ? { advisorResult: advisorResult.trim(), advisorAdoption } : void 0
    );
  }, children: [
    /* @__PURE__ */ jsx("h3", { children: "Your decision is needed" }),
    /* @__PURE__ */ jsx("p", { children: decision2.question }),
    decision2.context && /* @__PURE__ */ jsxs("details", { children: [
      /* @__PURE__ */ jsx("summary", { children: "Context" }),
      /* @__PURE__ */ jsx("p", { children: decision2.context })
    ] }),
    external && /* @__PURE__ */ jsxs(Fragment, { children: [
      /* @__PURE__ */ jsxs("p", { children: [
        "External human Advisor: ",
        run.advisorCase?.trigger,
        ". Development remains blocked until its actual advice and your separate human disposition have been recorded."
      ] }),
      run.advisorCase && /* @__PURE__ */ jsxs("details", { open: true, children: [
        /* @__PURE__ */ jsx("summary", { children: "Frozen handoff facts" }),
        /* @__PURE__ */ jsx("pre", { children: run.advisorCase.request }),
        /* @__PURE__ */ jsxs("p", { children: [
          "Candidate: ",
          run.advisorCase.candidateId ?? "PLAN"
        ] })
      ] }),
      /* @__PURE__ */ jsxs("label", { children: [
        "Verbatim external Advisor result",
        /* @__PURE__ */ jsx("textarea", { required: true, value: advisorResult, onChange: (event) => setAdvisorResult(event.target.value), disabled: busy })
      ] }),
      /* @__PURE__ */ jsxs("label", { children: [
        "Your disposition",
        /* @__PURE__ */ jsxs("select", { value: advisorAdoption, onChange: (event) => setAdvisorAdoption(event.target.value), disabled: busy, children: [
          /* @__PURE__ */ jsx("option", { value: "accept", children: "Accept bounded advice" }),
          /* @__PURE__ */ jsx("option", { value: "reject", children: "Reject (replan or cancel)" }),
          /* @__PURE__ */ jsx("option", { value: "clarify", children: "Request clarification; keep hold" })
        ] })
      ] })
    ] }),
    /* @__PURE__ */ jsxs("label", { children: [
      "Your instruction",
      /* @__PURE__ */ jsx("textarea", { required: true, value: answer, onChange: (event) => setAnswer(event.target.value), disabled: busy })
    ] }),
    /* @__PURE__ */ jsxs("label", { children: [
      "Next step",
      /* @__PURE__ */ jsxs("select", { value: action, onChange: (event) => setAction(event.target.value), disabled: busy, children: [
        /* @__PURE__ */ jsx("option", { value: "continue", children: "Continue with this decision" }),
        /* @__PURE__ */ jsx("option", { value: "retry", children: "Retry the interrupted task" }),
        /* @__PURE__ */ jsx("option", { value: "replan", children: "Revise the plan" }),
        /* @__PURE__ */ jsx("option", { value: "cancel", children: "Cancel the run" })
      ] })
    ] }),
    /* @__PURE__ */ jsx("div", { children: /* @__PURE__ */ jsx("button", { className: "sfd-primary", type: "submit", disabled: busy || !answer.trim() || external && !advisorResult.trim(), children: "Record decision" }) })
  ] });
}
function FeatureCards({ run }) {
  if (!run.plan) return null;
  const verification = run.attempts.find((attempt2) => attempt2.id === run.featureVerificationAttemptId)?.admittedOutput;
  return /* @__PURE__ */ jsxs("section", { className: "sfd-card", children: [
    /* @__PURE__ */ jsx("h2", { children: "Feature outcomes" }),
    run.plan.features.map((feature) => {
      const integrated = feature.sectionIds.filter((id2) => run.sections[id2]?.stage === "integrated").length;
      return /* @__PURE__ */ jsxs("details", { open: run.plan?.features.length === 1, children: [
        /* @__PURE__ */ jsxs("summary", { children: [
          /* @__PURE__ */ jsx("strong", { children: feature.title }),
          " ",
          /* @__PURE__ */ jsxs("span", { className: "sfd-muted", children: [
            integrated,
            "/",
            feature.sectionIds.length,
            " Sections integrated"
          ] })
        ] }),
        /* @__PURE__ */ jsx("p", { children: feature.outcome }),
        /* @__PURE__ */ jsx("ul", { children: feature.acceptanceCriteria.map((criterion, index) => {
          const evidence = verification?.criteria?.find((entry) => entry.featureId === feature.id && entry.criterion === criterion);
          return /* @__PURE__ */ jsxs("li", { children: [
            criterion,
            evidence && /* @__PURE__ */ jsxs(Fragment, { children: [
              /* @__PURE__ */ jsx("br", {}),
              /* @__PURE__ */ jsx(Badge, { status: evidence.satisfied ? "passed" : "failed", children: evidence.satisfied ? "Supported by evidence" : "Not yet satisfied" }),
              " ",
              /* @__PURE__ */ jsx("span", { className: "sfd-muted", children: evidence.evidenceIds.join(", ") })
            ] })
          ] }, index);
        }) })
      ] }, feature.id);
    }),
    verification?.summary && /* @__PURE__ */ jsx("p", { children: verification.summary }),
    /* @__PURE__ */ jsxs("details", { children: [
      /* @__PURE__ */ jsx("summary", { children: "Composition checks" }),
      /* @__PURE__ */ jsx(Checks, { checks: run.featureChecks })
    ] })
  ] });
}
function SectionCards({ run }) {
  if (!run.plan) return null;
  return /* @__PURE__ */ jsxs("section", { className: "sfd-card", children: [
    /* @__PURE__ */ jsx("h2", { children: "Sections" }),
    run.plan.sections.map((section2) => {
      const state = run.sections[section2.id];
      if (!state) return null;
      return /* @__PURE__ */ jsxs("details", { open: run.activeSectionId === section2.id, children: [
        /* @__PURE__ */ jsxs("summary", { children: [
          /* @__PURE__ */ jsx(Badge, { status: state.stage, children: SECTION_LABELS[state.stage] }),
          " ",
          /* @__PURE__ */ jsxs("strong", { children: [
            section2.id,
            " \xB7 ",
            section2.title
          ] })
        ] }),
        /* @__PURE__ */ jsxs("div", { className: "sfd-card", children: [
          /* @__PURE__ */ jsx("p", { children: section2.objective }),
          /* @__PURE__ */ jsxs("dl", { children: [
            /* @__PURE__ */ jsx("dt", { children: "Depends on" }),
            /* @__PURE__ */ jsx("dd", { children: section2.dependencies.length ? section2.dependencies.join(", ") : "Ready from the start" }),
            /* @__PURE__ */ jsx("dt", { children: "Material repairs" }),
            /* @__PURE__ */ jsxs("dd", { children: [
              state.materialRepairWaves,
              " / ",
              run.policy.maxRepairWaves,
              " \xB7 original lineage ",
              /* @__PURE__ */ jsx("code", { children: state.lineageId })
            ] }),
            /* @__PURE__ */ jsx("dt", { children: "Write scope" }),
            /* @__PURE__ */ jsx("dd", { children: section2.writeScope.join(", ") }),
            /* @__PURE__ */ jsx("dt", { children: "Candidate" }),
            /* @__PURE__ */ jsx("dd", { children: /* @__PURE__ */ jsx("code", { children: state.candidateId ?? "Not captured yet" }) }),
            state.lenses.length > 0 && /* @__PURE__ */ jsxs(Fragment, { children: [
              /* @__PURE__ */ jsx("dt", { children: "A review lenses" }),
              /* @__PURE__ */ jsx("dd", { children: state.lenses.map((lens2) => `${lens2.id}: ${lens2.name}`).join(" \xB7 ") })
            ] })
          ] }),
          /* @__PURE__ */ jsx("h3", { children: "Acceptance criteria" }),
          /* @__PURE__ */ jsx(TextItems, { items: section2.acceptanceCriteria }),
          section2.subsections.length > 0 && /* @__PURE__ */ jsxs("details", { children: [
            /* @__PURE__ */ jsx("summary", { children: "Internal checkpoints" }),
            /* @__PURE__ */ jsx("ul", { children: section2.subsections.map((child) => /* @__PURE__ */ jsx("li", { children: child.objective }, child.id)) }),
            /* @__PURE__ */ jsx("p", { className: "sfd-muted", children: "These checkpoints share this Section's acceptance and repair budget." })
          ] }),
          state.repairInstructions && /* @__PURE__ */ jsxs("details", { open: true, children: [
            /* @__PURE__ */ jsx("summary", { children: "Admitted repair" }),
            /* @__PURE__ */ jsx("p", { children: state.repairInstructions })
          ] }),
          /* @__PURE__ */ jsxs("details", { children: [
            /* @__PURE__ */ jsx("summary", { children: "Verification checks" }),
            /* @__PURE__ */ jsx(Checks, { checks: state.checks })
          ] })
        ] })
      ] }, section2.id);
    })
  ] });
}
function Reviews({ run }) {
  return /* @__PURE__ */ jsxs("details", { className: "sfd-card", children: [
    /* @__PURE__ */ jsxs("summary", { children: [
      /* @__PURE__ */ jsx("strong", { children: "Review evidence" }),
      " ",
      /* @__PURE__ */ jsxs("span", { className: "sfd-muted", children: [
        run.reviews.length,
        " recorded"
      ] })
    ] }),
    !run.reviews.length && /* @__PURE__ */ jsx("p", { className: "sfd-muted", children: "Independent results appear here when admitted by the Host." }),
    [...run.reviews].reverse().map((review) => /* @__PURE__ */ jsxs("details", { children: [
      /* @__PURE__ */ jsxs("summary", { children: [
        /* @__PURE__ */ jsx(Badge, { status: review.valid ? review.output.verdict === "clean" ? "passed" : "unknown" : "unknown", children: review.valid ? review.output.verdict : "Superseded" }),
        " ",
        review.sectionId,
        " \xB7 ",
        review.stage === "b" ? "Blind B" : review.stage === "closure" ? "Closure" : "A",
        " \xB7 ",
        review.lensId
      ] }),
      /* @__PURE__ */ jsx("p", { children: review.output.summary }),
      /* @__PURE__ */ jsxs("dl", { children: [
        /* @__PURE__ */ jsx("dt", { children: "Evidence" }),
        /* @__PURE__ */ jsx("dd", { children: /* @__PURE__ */ jsx("code", { children: review.id }) }),
        /* @__PURE__ */ jsx("dt", { children: "Candidate" }),
        /* @__PURE__ */ jsx("dd", { children: /* @__PURE__ */ jsx("code", { children: review.candidateId }) })
      ] }),
      /* @__PURE__ */ jsx("h3", { children: "Coverage" }),
      /* @__PURE__ */ jsx(TextItems, { items: review.output.coverage }),
      review.output.limitations.length > 0 && /* @__PURE__ */ jsxs(Fragment, { children: [
        /* @__PURE__ */ jsx("h3", { children: "Limitations" }),
        /* @__PURE__ */ jsx(TextItems, { items: review.output.limitations })
      ] }),
      review.output.findings.map((finding) => /* @__PURE__ */ jsxs("div", { className: "sfd-notice", children: [
        /* @__PURE__ */ jsxs("strong", { children: [
          finding.severity,
          ": ",
          finding.title
        ] }),
        /* @__PURE__ */ jsx("p", { children: finding.body }),
        /* @__PURE__ */ jsxs("p", { className: "sfd-muted", children: [
          "Invariant: ",
          finding.invariant,
          finding.location ? ` \xB7 ${finding.location}` : ""
        ] })
      ] }, finding.id))
    ] }, review.id)),
    run.decisions.length > 0 && /* @__PURE__ */ jsxs("details", { children: [
      /* @__PURE__ */ jsx("summary", { children: "Adjudication and acceptance decisions" }),
      [...run.decisions].reverse().map((decision2) => /* @__PURE__ */ jsxs("div", { className: "sfd-card", children: [
        /* @__PURE__ */ jsx("strong", { children: decision2.sectionId ?? "Feature acceptance" }),
        /* @__PURE__ */ jsx("p", { children: decision2.output.summary }),
        "dispositions" in decision2.output && decision2.output.dispositions.map((item) => /* @__PURE__ */ jsxs("p", { children: [
          /* @__PURE__ */ jsx(Badge, { status: item.decision, children: item.decision }),
          " ",
          /* @__PURE__ */ jsx("code", { children: item.findingId }),
          /* @__PURE__ */ jsx("br", {}),
          item.reason
        ] }, item.findingId)),
        "missingCoverage" in decision2.output && decision2.output.missingCoverage.length > 0 && /* @__PURE__ */ jsxs(Fragment, { children: [
          /* @__PURE__ */ jsx("h3", { children: "Missing coverage" }),
          /* @__PURE__ */ jsx(TextItems, { items: decision2.output.missingCoverage })
        ] }),
        /* @__PURE__ */ jsxs("p", { className: "sfd-muted", children: [
          dateLabel(decision2.createdAt),
          " \xB7 ",
          shorten(decision2.candidateId)
        ] })
      ] }, decision2.id))
    ] })
  ] });
}
function Attempts({ run }) {
  return /* @__PURE__ */ jsxs("details", { className: "sfd-card", children: [
    /* @__PURE__ */ jsxs("summary", { children: [
      /* @__PURE__ */ jsx("strong", { children: "Actor attempts" }),
      " ",
      /* @__PURE__ */ jsxs("span", { className: "sfd-muted", children: [
        run.attempts.length,
        " recorded"
      ] })
    ] }),
    /* @__PURE__ */ jsx("p", { className: "sfd-muted", children: "Requested configuration and observed execution are separate facts. An unrecorded route stays unknown." }),
    /* @__PURE__ */ jsx("div", { className: "sfd-table", children: /* @__PURE__ */ jsxs("table", { children: [
      /* @__PURE__ */ jsx("thead", { children: /* @__PURE__ */ jsxs("tr", { children: [
        /* @__PURE__ */ jsx("th", { children: "Role and task" }),
        /* @__PURE__ */ jsx("th", { children: "State" }),
        /* @__PURE__ */ jsx("th", { children: "Requested" }),
        /* @__PURE__ */ jsx("th", { children: "Observed" })
      ] }) }),
      /* @__PURE__ */ jsx("tbody", { children: [...run.attempts].reverse().map((attempt2) => /* @__PURE__ */ jsxs("tr", { children: [
        /* @__PURE__ */ jsxs("td", { children: [
          ROLE_LABELS[attempt2.task.kind],
          attempt2.task.lens && ` \xB7 ${attempt2.task.lens.id}`,
          /* @__PURE__ */ jsx("br", {}),
          /* @__PURE__ */ jsxs("span", { className: "sfd-muted", children: [
            attempt2.task.sectionId ?? "Run",
            " \xB7 ",
            dateLabel(attempt2.createdAt)
          ] }),
          /* @__PURE__ */ jsx("br", {}),
          /* @__PURE__ */ jsx("code", { children: shorten(attempt2.id, 22) })
        ] }),
        /* @__PURE__ */ jsxs("td", { children: [
          /* @__PURE__ */ jsx(Badge, { status: attempt2.state, children: attempt2.state }),
          attempt2.outcome && /* @__PURE__ */ jsxs(Fragment, { children: [
            /* @__PURE__ */ jsx("br", {}),
            attempt2.outcome.status
          ] }),
          (attempt2.rejection || attempt2.outcome?.error) && /* @__PURE__ */ jsxs("details", { children: [
            /* @__PURE__ */ jsx("summary", { children: "Details" }),
            /* @__PURE__ */ jsx("p", { className: "sfd-error", children: attempt2.rejection ?? attempt2.outcome?.error })
          ] })
        ] }),
        /* @__PURE__ */ jsx("td", { children: requestedIdentity(attempt2) }),
        /* @__PURE__ */ jsxs("td", { children: [
          observedIdentity(attempt2),
          attempt2.outcome?.identity.sessionId && /* @__PURE__ */ jsxs(Fragment, { children: [
            /* @__PURE__ */ jsx("br", {}),
            /* @__PURE__ */ jsx("code", { children: shorten(attempt2.outcome.identity.sessionId, 24) })
          ] })
        ] })
      ] }, attempt2.id)) })
    ] }) }),
    !run.attempts.length && /* @__PURE__ */ jsx("p", { className: "sfd-muted", children: "No actors have been dispatched." })
  ] });
}
function RunDetail({ run, busy, controller }) {
  const [editingGoal, setEditingGoal] = useState(false);
  const [goal, setGoal] = useState(run.goal);
  const active = run.status !== "completed" && run.status !== "cancelled";
  const candidate2 = run.currentCandidateId && run.candidates[run.currentCandidateId];
  const lastFailure = [...run.attempts].reverse().find((attempt2) => attempt2.outcome?.status === "failed");
  return /* @__PURE__ */ jsxs("article", { className: "sfd-detail", "aria-label": "Development run details", children: [
    /* @__PURE__ */ jsxs("section", { className: "sfd-card", children: [
      /* @__PURE__ */ jsxs("div", { className: "sfd-row", children: [
        /* @__PURE__ */ jsx(Badge, { status: run.status, children: STATUS_LABELS[run.status] }),
        /* @__PURE__ */ jsx("span", { children: phaseLabel(run) })
      ] }),
      /* @__PURE__ */ jsx("h2", { style: { marginTop: 14 }, children: run.plan?.title ?? "Development run" }),
      /* @__PURE__ */ jsx("p", { style: { whiteSpace: "pre-wrap" }, children: run.goal }),
      /* @__PURE__ */ jsxs("dl", { children: [
        /* @__PURE__ */ jsx("dt", { children: "Repository" }),
        /* @__PURE__ */ jsx("dd", { children: /* @__PURE__ */ jsx("code", { children: run.workspace.path }) }),
        /* @__PURE__ */ jsx("dt", { children: "Branch" }),
        /* @__PURE__ */ jsx("dd", { children: /* @__PURE__ */ jsx("code", { children: run.workspace.branch }) }),
        /* @__PURE__ */ jsx("dt", { children: "Goal version" }),
        /* @__PURE__ */ jsx("dd", { children: run.inputContractVersion }),
        /* @__PURE__ */ jsx("dt", { children: "Run" }),
        /* @__PURE__ */ jsx("dd", { children: /* @__PURE__ */ jsx("code", { children: run.id }) })
      ] }),
      /* @__PURE__ */ jsxs("div", { className: "sfd-row", children: [
        availableActions(run).map((action) => /* @__PURE__ */ jsx("button", { type: "button", disabled: busy, className: action === "cancel" ? "sfd-danger" : action === "start" || action === "resume" ? "sfd-primary" : "", onClick: () => {
          void controller.act(action, run.id);
        }, children: ACTION_LABELS[action] }, action)),
        active && /* @__PURE__ */ jsx("button", { disabled: busy, type: "button", onClick: () => {
          setGoal(run.goal);
          setEditingGoal(!editingGoal);
        }, children: "Revise goal" })
      ] }),
      run.status === "pausing" && /* @__PURE__ */ jsx("p", { className: "sfd-muted", children: "Waiting for active work to stop and settle." }),
      run.blockedReason && /* @__PURE__ */ jsx("p", { className: "sfd-notice", children: run.blockedReason }),
      editingGoal && /* @__PURE__ */ jsxs("form", { className: "sfd-form", onSubmit: (event) => {
        event.preventDefault();
        void controller.revise(run.id, goal.trim()).then((saved) => {
          if (saved) setEditingGoal(false);
        });
      }, children: [
        /* @__PURE__ */ jsxs("label", { children: [
          "Revised objective",
          /* @__PURE__ */ jsx("textarea", { value: goal, onChange: (event) => setGoal(event.target.value), disabled: busy })
        ] }),
        /* @__PURE__ */ jsx("p", { className: "sfd-muted", children: "This records a new goal version and invalidates work dispatched under the prior task authority." }),
        /* @__PURE__ */ jsxs("div", { className: "sfd-row", children: [
          /* @__PURE__ */ jsx("button", { disabled: busy || !goal.trim() || goal === run.goal, className: "sfd-primary", type: "submit", children: "Save revised goal" }),
          /* @__PURE__ */ jsx("button", { disabled: busy, type: "button", onClick: () => setEditingGoal(false), children: "Close" })
        ] })
      ] }),
      run.commit && /* @__PURE__ */ jsxs("p", { children: [
        "Accepted candidate committed as ",
        /* @__PURE__ */ jsx("code", { children: run.commit.commit }),
        " on ",
        /* @__PURE__ */ jsx("code", { children: run.commit.branch }),
        "."
      ] }),
      run.delivery?.mode === "worktree" && /* @__PURE__ */ jsxs("p", { children: [
        "Accepted candidate delivered in ",
        /* @__PURE__ */ jsx("code", { children: run.delivery.path }),
        " on ",
        /* @__PURE__ */ jsx("code", { children: run.delivery.branch }),
        "."
      ] }),
      candidate2 && /* @__PURE__ */ jsxs("details", { children: [
        /* @__PURE__ */ jsx("summary", { children: "Current source snapshot" }),
        /* @__PURE__ */ jsxs("dl", { children: [
          /* @__PURE__ */ jsx("dt", { children: "Candidate" }),
          /* @__PURE__ */ jsx("dd", { children: /* @__PURE__ */ jsx("code", { children: candidate2.id }) }),
          /* @__PURE__ */ jsx("dt", { children: "Tree" }),
          /* @__PURE__ */ jsx("dd", { children: /* @__PURE__ */ jsx("code", { children: candidate2.treeHash }) }),
          /* @__PURE__ */ jsx("dt", { children: "Captured" }),
          /* @__PURE__ */ jsx("dd", { children: dateLabel(candidate2.capturedAt) })
        ] }),
        /* @__PURE__ */ jsx(TextItems, { items: candidate2.changedFiles })
      ] }),
      lastFailure && /* @__PURE__ */ jsxs("details", { children: [
        /* @__PURE__ */ jsx("summary", { children: "Last actor error" }),
        /* @__PURE__ */ jsx("p", { className: "sfd-error", children: lastFailure.outcome?.error ?? "No detailed error recorded." }),
        /* @__PURE__ */ jsxs("p", { className: "sfd-muted", children: [
          ROLE_LABELS[lastFailure.task.kind],
          " \xB7 ",
          dateLabel(lastFailure.endedAt)
        ] })
      ] })
    ] }),
    run.pendingDecision && /* @__PURE__ */ jsx(DecisionForm, { run, decision: run.pendingDecision, busy, controller }, run.pendingDecision.id),
    /* @__PURE__ */ jsx(FeatureCards, { run }),
    /* @__PURE__ */ jsx(SectionCards, { run }),
    /* @__PURE__ */ jsx(Reviews, { run }),
    /* @__PURE__ */ jsx(Attempts, { run }),
    /* @__PURE__ */ jsxs("details", { className: "sfd-card", children: [
      /* @__PURE__ */ jsx("summary", { children: /* @__PURE__ */ jsx("strong", { children: "Recent progress" }) }),
      /* @__PURE__ */ jsx("ol", { className: "sfd-timeline", children: run.events.slice(-20).reverse().map((event) => /* @__PURE__ */ jsxs("li", { children: [
        event.message,
        /* @__PURE__ */ jsx("br", {}),
        /* @__PURE__ */ jsxs("small", { children: [
          dateLabel(event.at),
          event.sectionId && ` \xB7 ${event.sectionId}`
        ] })
      ] }, event.id)) })
    ] }),
    run.requirementsHistory.length > 1 && /* @__PURE__ */ jsxs("details", { className: "sfd-card", children: [
      /* @__PURE__ */ jsx("summary", { children: "Goal history" }),
      [...run.requirementsHistory].reverse().map((entry) => /* @__PURE__ */ jsxs("div", { children: [
        /* @__PURE__ */ jsxs("h3", { children: [
          "Version ",
          entry.version
        ] }),
        /* @__PURE__ */ jsx("p", { style: { whiteSpace: "pre-wrap" }, children: entry.goal }),
        /* @__PURE__ */ jsx("small", { children: dateLabel(entry.at) })
      ] }, entry.version))
    ] })
  ] });
}
function DevelopmentPanel({ controller, sessionCatalog }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const sessions = useSyncExternalStore((listener) => sessionCatalog.subscribe(listener), () => sessionCatalog.getSnapshot(), () => sessionCatalog.getSnapshot());
  const [creating, setCreating] = useState(false);
  const choices = sessions.ids.map((id2) => sessions.byId[id2]).filter((session) => session && !session.parentId && session.origin !== "subagent");
  const selectedSession = choices.find((session) => session.id === state.sessionId);
  const run = state.runs.find((item) => item.id === state.selectedRunId);
  useEffect(() => {
    if (!state.sessionId && choices.length) {
      const current = choices.find((session) => Object.entries(session.retainedBy).some(([source, count]) => source === "mainView" && count > 0)) ?? choices[0];
      controller.setSession(current.id);
    }
  }, [choices, controller, state.sessionId]);
  return /* @__PURE__ */ jsxs("main", { className: "sfd-workflow", children: [
    /* @__PURE__ */ jsx("style", { children: PANEL_STYLES }),
    /* @__PURE__ */ jsxs("header", { className: "sfd-head", children: [
      /* @__PURE__ */ jsxs("div", { children: [
        /* @__PURE__ */ jsx("h1", { children: "Development" }),
        /* @__PURE__ */ jsx("p", { className: "sfd-muted", children: "Goals, implementation, independent reviews, and recovery in one durable workflow." })
      ] }),
      /* @__PURE__ */ jsx("button", { className: "sfd-primary", type: "button", disabled: !state.sessionId || state.busy, onClick: () => setCreating(!creating), children: "New run" })
    ] }),
    /* @__PURE__ */ jsxs("div", { className: "sfd-toolbar", children: [
      /* @__PURE__ */ jsxs("label", { className: "sfd-owner", children: [
        "Owner conversation",
        /* @__PURE__ */ jsxs("select", { "aria-label": "Owner conversation", value: state.sessionId ?? "", disabled: state.busy, onChange: (event) => {
          setCreating(false);
          controller.setSession(event.target.value || void 0);
        }, children: [
          !choices.length && /* @__PURE__ */ jsx("option", { value: "", children: "No conversation available" }),
          choices.map((session) => /* @__PURE__ */ jsxs("option", { value: session.id, children: [
            session.displayTitle,
            session.cwd ? ` \xB7 ${session.cwd}` : ""
          ] }, session.id))
        ] })
      ] }),
      /* @__PURE__ */ jsx("button", { type: "button", disabled: !state.sessionId || state.loading, onClick: () => {
        void controller.refresh();
      }, children: "Refresh" }),
      state.refreshedAt && /* @__PURE__ */ jsxs("small", { children: [
        "Updated ",
        dateLabel(state.refreshedAt)
      ] })
    ] }),
    state.error && /* @__PURE__ */ jsx("p", { className: "sfd-notice sfd-error", role: "alert", children: state.error }),
    state.readError && /* @__PURE__ */ jsxs("p", { className: "sfd-notice", role: "status", children: [
      "Could not refresh the latest state: ",
      state.readError,
      ". Previously loaded evidence remains visible."
    ] }),
    creating && /* @__PURE__ */ jsx(CreateForm, { controller, workspacePath: selectedSession?.cwd, busy: state.busy, onClose: () => setCreating(false) }, state.sessionId),
    !choices.length ? /* @__PURE__ */ jsx("p", { className: "sfd-empty", children: "Open a repository conversation in DSH, then create a development run here." }) : state.loading && !state.runs.length ? /* @__PURE__ */ jsx("p", { role: "status", className: "sfd-empty", children: "Loading development runs\u2026" }) : !state.runs.length ? /* @__PURE__ */ jsx("p", { className: "sfd-empty", children: "This conversation has no development runs yet. Create a run with the full outcome you want to deliver." }) : /* @__PURE__ */ jsxs("div", { className: "sfd-layout", children: [
      /* @__PURE__ */ jsx("nav", { className: "sfd-run-list", "aria-label": "Development runs", children: state.runs.map((item) => /* @__PURE__ */ jsxs("button", { className: "sfd-run", type: "button", "aria-current": item.id === state.selectedRunId, onClick: () => controller.selectRun(item.id), children: [
        /* @__PURE__ */ jsx("span", { className: "sfd-run-title", children: item.plan?.title ?? item.goal }),
        /* @__PURE__ */ jsx("div", { children: /* @__PURE__ */ jsx(Badge, { status: item.status, children: STATUS_LABELS[item.status] }) }),
        /* @__PURE__ */ jsx("small", { children: phaseLabel(item) })
      ] }, item.id)) }),
      run && /* @__PURE__ */ jsx(RunDetail, { run, controller, busy: state.busy }, run.id)
    ] })
  ] });
}
function DevelopmentIcon({ size }) {
  return /* @__PURE__ */ jsx("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "1.6", "aria-hidden": "true", children: /* @__PURE__ */ jsx("path", { d: "M8 4H4v4M16 4h4v4M4 16v4h4M20 16v4h-4M8 12l3 3 5-6", strokeLinecap: "round", strokeLinejoin: "round" }) });
}

// src/client/index.ts
var name = "dsh-sfd-client";
var inject = ["remote", "slots", "sessions"];
async function apply(ctx) {
  const unmount = await ctx.remote.$mount(TYPERT_REMOTE);
  const sessions = ctx.get("sessions");
  const controller = new DevelopmentClientController(ctx.remote.developmentWorkflow);
  const stopPanel = ctx.slots.inject("main", () => ctx.slots.register({
    name: "main",
    key: "sfd-development",
    inject: () => ({ controller, sessionCatalog: sessions.list })
  }, DevelopmentPanel));
  const stopIcon = ctx.slots.inject("sidebar.panellist", () => ctx.slots.register({
    name: "sidebar.panellist",
    id: "sfd-development",
    order: 20,
    label: "Development"
  }, DevelopmentIcon));
  return async () => {
    controller.dispose();
    stopIcon();
    stopPanel();
    await unmount();
  };
}
export {
  DevelopmentClientController,
  apply,
  inject,
  name
};
//# sourceMappingURL=client.js.map
