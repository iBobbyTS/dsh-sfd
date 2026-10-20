// src/core/types.ts
var CORE_VERSION = "1.0.0";
var POLICY_VERSION = "sfd-native-1";

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
    subsections: z.array(z.strictObject({ id, objective: text, acceptanceCriteria: texts.min(1) }))
  })).min(1).max(500),
  assumptions: texts
});
var findingSchema = z.strictObject({
  id,
  title: text,
  body: text,
  severity: z.enum(["critical", "major", "minor"]),
  invariant: text,
  location: z.string().optional()
});
var reviewSchema = z.strictObject({
  verdict: z.enum(["clean", "findings", "incomplete"]),
  summary: text,
  coverage: texts,
  limitations: texts,
  findings: z.array(findingSchema).max(200),
  closures: z.array(z.strictObject({ findingId: text, status: z.enum(["verified-closed", "still-open", "regression", "insufficient-evidence"]), evidence: text })).max(200).optional()
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
  question: z.string().optional()
});
var featureVerificationSchema = z.strictObject({
  verdict: z.enum(["accepted", "repair", "needs-user"]),
  summary: text,
  criteria: z.array(z.strictObject({ featureId: id, criterion: text, evidenceIds: z.array(text).min(1), satisfied: z.boolean() })).min(1),
  repairSectionIds: z.array(id),
  repairInstructions: z.string(),
  question: z.string().optional()
});
var diagnosticSchema = z.strictObject({
  summary: text,
  recommendation: z.enum(["retry", "revise-plan", "needs-user"]),
  instructions: text,
  question: z.string().optional()
});
var actorOutputSchemas = {
  planner: z.strictObject({ plan: planSchema, explanation: text }),
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
function outputSchemaFor(kind) {
  const raw = JSON.parse(JSON.stringify(z.toJSONSchema(actorOutputSchemas[kind])));
  const lower = (node) => {
    const result = {};
    for (const key of ["type", "required", "additionalProperties", "enum", "const", "title", "description"]) {
      if (key in node) result[key] = node[key];
    }
    if (node.properties) result.properties = Object.fromEntries(Object.entries(node.properties).map(([key, value]) => [key, lower(value)]));
    if (node.items) result.items = lower(node.items);
    if (node.oneOf) result.oneOf = node.oneOf.map(lower);
    return result;
  };
  return lower(raw);
}
function parseActorOutput(kind, value) {
  const result = actorOutputSchemas[kind].parse(value);
  if (kind === "planner") validatePlan(result.plan);
  if ("verdict" in result && "findings" in result) {
    if (result.verdict === "clean" && result.findings.length) throw new Error("A clean review cannot contain findings.");
    if (result.verdict === "findings" && !result.findings.length) throw new Error("A findings review must contain findings.");
    if (result.verdict === "clean" && !result.coverage.length) throw new Error("A clean review must describe actual coverage.");
    assertUnique(result.findings.map((finding) => finding.id), "finding");
  }
  if ("lenses" in result) {
    assertUnique(result.lenses.map((lens2) => lens2.id), "lens");
    if (!result.lenses.some((lens2) => lens2.id === "R01")) throw new Error("Code A requires the independent full behavior baseline R01.");
    assertUnique(result.invalidatedLensIds ?? [], "invalidated lens");
    if (result.invalidatedLensIds?.length && !result.invalidationReason?.trim()) throw new Error("Invalidated A coverage requires a concrete reason.");
  }
  return result;
}
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

// src/core/schemas.ts
import { z as z2 } from "zod";
var text2 = z2.string();
var identity = z2.string().min(1);
var integer = z2.number().int().nonnegative();
var object = z2.record(z2.string(), z2.unknown());
var actorKind = z2.enum(["planner", "plan-review-a", "plan-review-b", "implementer", "review-selector", "reviewer-a", "reviewer-b", "adjudicator", "closure-reviewer", "feature-verifier", "diagnostician"]);
var route = z2.strictObject({ preset: identity, model: text2.optional(), provider: text2.optional(), effort: text2.optional() });
var workspace = z2.strictObject({ path: identity, branch: text2, baseCommit: identity, prepared: z2.boolean().optional() });
var candidate = z2.strictObject({ id: identity, capturedAt: identity, workspacePath: identity, head: identity, treeHash: identity, diff: text2, changedFiles: z2.array(text2) });
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
  stage: z2.enum(["pending", "implementing", "reroute", "review-selection", "review-a", "adjudicating-a", "repairing", "closure", "review-b", "adjudicating-b", "accepted", "integrated"]),
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
  closureFindingIds: z2.array(identity).optional(),
  freshRepairLensIds: z2.array(identity).optional()
});
var decision = z2.strictObject({
  id: identity,
  question: identity,
  context: text2,
  kind: z2.enum(["semantic", "recovery", "budget", "infrastructure"]),
  sectionId: identity.optional(),
  createdAt: identity,
  answer: text2.optional()
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
  featureVerificationAttemptId: identity.optional(),
  pendingDecision: decision.optional(),
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

// src/core/policy.ts
function createPolicy(input = {}) {
  const policy = {
    version: POLICY_VERSION,
    actorTimeoutMs: 30 * 6e4,
    maxParallelReviews: 4,
    maxRepairWaves: 5,
    maxPlanRepairs: 2,
    maxDiagnostics: 1,
    maxInfrastructureRetries: 1,
    commit: false,
    routes: {},
    ...input
  };
  if (policy.version !== POLICY_VERSION) throw new Error(`Unsupported workflow policy version: ${policy.version}. Explicit migration is required.`);
  for (const [name, maximum] of [
    ["actorTimeoutMs", 24 * 60 * 6e4],
    ["maxParallelReviews", 6],
    ["maxRepairWaves", 5],
    ["maxPlanRepairs", 2],
    ["maxDiagnostics", 2],
    ["maxInfrastructureRetries", 3]
  ]) {
    if (!Number.isInteger(policy[name]) || policy[name] < (name === "maxInfrastructureRetries" ? 0 : 1) || policy[name] > maximum) {
      throw new Error(`Invalid workflow policy ${name}; expected a bounded positive integer up to ${maximum}.`);
    }
  }
  return policy;
}

// src/core/controller.ts
import { randomUUID } from "node:crypto";
var WorkflowController = class {
  store;
  actors;
  workspace;
  now;
  id;
  cleanupTimeoutMs;
  listeners = /* @__PURE__ */ new Set();
  activeActors = /* @__PURE__ */ new Map();
  activeOperations = /* @__PURE__ */ new Map();
  drives = /* @__PURE__ */ new Map();
  disposed = false;
  constructor(options) {
    this.store = options.store;
    this.actors = options.actors;
    this.workspace = options.workspace;
    this.now = options.now ?? (() => (/* @__PURE__ */ new Date()).toISOString());
    this.id = options.id ?? randomUUID;
    this.cleanupTimeoutMs = Math.max(10, Math.min(options.cleanupTimeoutMs ?? 5e3, 6e4));
  }
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  async list() {
    return this.store.list();
  }
  async status(id2) {
    const run = await this.store.get(id2);
    if (!run) throw new Error(`Development run ${id2} does not exist.`);
    return run;
  }
  async create(input) {
    this.assertOpen();
    if (!input.goal.trim()) throw new Error("A development goal is required.");
    const workspace2 = await this.workspace.inspect(input.workspacePath);
    const at = this.now();
    const run = {
      id: this.id(),
      schemaVersion: 1,
      workflowVersion: CORE_VERSION,
      revision: 0,
      controlEpoch: 0,
      inputContractVersion: 1,
      createdAt: at,
      updatedAt: at,
      goal: input.goal.trim(),
      requirementsHistory: [{ version: 1, goal: input.goal.trim(), at }],
      workspace: workspace2,
      policy: createPolicy(input.policy),
      status: "draft",
      stage: "planning",
      planRevision: 0,
      planRepairs: 0,
      planFeedback: [],
      sections: {},
      candidates: {},
      attempts: [],
      operations: [],
      reviews: [],
      decisions: [],
      featureChecks: [],
      decisionHistory: [],
      events: []
    };
    this.event(run, "created", "Development task created.");
    await this.store.create(run);
    this.publish(run);
    return run;
  }
  async start(id2) {
    this.assertOpen();
    const result = await this.change(id2, (run) => {
      if (run.status !== "draft") throw new Error("Only a draft task can be started; use resume for paused work.");
      run.status = "running";
      run.controlEpoch++;
      this.event(run, "started", "Development task started.");
    });
    this.schedule(id2);
    return result;
  }
  async pause(id2) {
    await this.change(id2, (run) => {
      if (["completed", "cancelled", "paused"].includes(run.status)) return;
      run.status = "pausing";
      run.controlEpoch++;
      this.event(run, "pause-requested", "New dispatch stopped; active executions are being stopped.");
    });
    const quiescent = await this.stopLocal(id2);
    return this.change(id2, (run) => {
      if (run.status === "pausing" && quiescent) {
        run.status = "paused";
        this.event(run, "paused", "Task paused. Uncertain side effects are checked before resuming.");
      }
      if (run.status === "pausing" && !quiescent) run.blockedReason = "Stopping is still in progress; execution termination is unconfirmed and the workspace remains reserved.";
    });
  }
  async resume(id2) {
    this.assertOpen();
    const before = await this.status(id2);
    if (!["paused", "blocked"].includes(before.status)) throw new Error("Only paused or resolved blocked work can resume.");
    if (before.pendingDecision) throw new Error("Resolve the pending decision before resuming.");
    if ([...this.activeActors.values(), ...this.activeOperations.values()].some((active) => active.runId === id2)) throw new Error("An interrupted activation is still stopping; wait for actual teardown before resuming.");
    const recovery = await this.workspace.reconcile(before);
    if (!recovery.safe) {
      await this.block(id2, recovery.reason ?? "Workspace execution state is uncertain.", "recovery");
      return this.status(id2);
    }
    const result = await this.change(id2, (run) => {
      if (run.controlEpoch !== before.controlEpoch || run.pendingDecision) throw new Error("Task changed while recovery was being checked.");
      run.status = "running";
      run.controlEpoch++;
      delete run.blockedReason;
      for (const attempt2 of run.attempts) {
        if (attempt2.state === "intent" && attempt2.task.controlEpoch !== run.controlEpoch) {
          attempt2.rejection ??= "Undispatched intent superseded by an explicit control change.";
        }
        if (attempt2.outcome?.status === "cancelled" || attempt2.state === "unknown") {
          attempt2.rejection ??= "Execution interrupted; explicit recovery authorized a new attempt.";
        }
      }
      for (const operation of run.operations) {
        if (operation.state === "intent" && operation.controlEpoch !== run.controlEpoch) operation.error ??= "Undispatched operation superseded by control change.";
        if (operation.state === "unknown") operation.error ??= "Reconciled after interruption; a new operation is required.";
      }
      this.event(run, "resumed", "Task resumed after checking actual workspace state.");
    });
    this.schedule(id2);
    return result;
  }
  async cancel(id2) {
    const result = await this.change(id2, (run) => {
      if (run.status === "completed") throw new Error("A completed task cannot be cancelled.");
      run.status = "cancelled";
      run.controlEpoch++;
      delete run.pendingDecision;
      this.event(run, "cancelled", "Task cancelled; existing changes and evidence are retained.");
    });
    await this.stopLocal(id2);
    return result;
  }
  async revise(id2, goal) {
    if (!goal.trim()) throw new Error("Revised requirements must not be empty.");
    const current = await this.status(id2);
    if (["completed", "cancelled"].includes(current.status)) throw new Error("Create a new task for a completed or cancelled run.");
    await this.pause(id2);
    await this.change(id2, (run) => {
      run.goal = goal.trim();
      run.inputContractVersion++;
      run.requirementsHistory.push({ version: run.inputContractVersion, goal: run.goal, at: this.now() });
      run.stage = "planning";
      run.planFeedback.push("The user revised the requirements. Reassess obligations and reuse only still-applicable work; preserve Section identity and repair lineage.");
      delete run.pendingDecision;
      delete run.diagnostic;
      delete run.activeSectionId;
      for (const section2 of Object.values(run.sections)) {
        section2.stage = "pending";
        section2.inputContractVersion++;
        delete section2.acceptedCandidateId;
        delete section2.integratedCandidateId;
        delete section2.aAcceptedCandidateId;
      }
      this.event(run, "requirements-revised", "User requirements changed; a new planning contract is required.");
    });
    return this.resume(id2);
  }
  async decide(id2, input) {
    const current = await this.status(id2);
    const decision2 = current.pendingDecision;
    if (!decision2 || decision2.id !== input.decisionId) throw new Error("The decision is missing or no longer current.");
    if (!input.answer.trim()) throw new Error("Record the user decision before continuing.");
    if (input.action === "cancel") return this.cancel(id2);
    if (decision2.kind === "budget" && input.action !== "replan") {
      throw new Error("An exhausted repair budget cannot be reset by retry. Revise the plan or cancel; existing Section lineage is preserved.");
    }
    const recovery = decision2.kind === "recovery" ? await this.workspace.reconcile(current) : void 0;
    if (recovery && !recovery.safe && !recovery.candidate) {
      throw new Error(`Actual workspace state must be inspected before acknowledging recovery: ${recovery.reason ?? "inspection unavailable"}`);
    }
    const recoveredCommit = recovery?.commit;
    if (recoveredCommit) {
      const accepted = current.candidates[recoveredCommit.candidateId];
      const verification = current.attempts.find((attempt2) => attempt2.id === current.featureVerificationAttemptId);
      if (!current.policy.commit || !accepted || current.currentCandidateId !== accepted.id || !verification || verification.state !== "admitted" || verification.task.kind !== "feature-verifier" || verification.task.candidateId !== accepted.id || verification.admittedOutput.verdict !== "accepted" || !recovery?.candidate || recovery.candidate.treeHash !== accepted.treeHash || recovery.candidate.head !== recoveredCommit.commit || recoveredCommit.branch !== (recovery.workspace?.branch ?? current.workspace.branch)) {
        throw new Error("Recovered commit lacks matching actual HEAD/tree and admitted final business acceptance; delivery cannot be inferred.");
      }
    }
    const applied = await this.change(id2, (run) => {
      if (run.pendingDecision?.id !== input.decisionId) throw new Error("The decision changed before it was applied.");
      run.decisionHistory.push({ ...run.pendingDecision, answer: input.answer.trim() });
      delete run.pendingDecision;
      delete run.blockedReason;
      run.status = "paused";
      if (decision2.kind === "recovery") {
        if (recovery?.workspace) run.workspace = { ...recovery.workspace, prepared: true };
        for (const attempt2 of run.attempts) {
          if (attempt2.state === "unknown" || attempt2.state === "started" || attempt2.outcome?.status === "cancelled" || attempt2.outcome?.status === "failed") {
            attempt2.recoveryDecisionId = decision2.id;
            attempt2.reconciledAt = this.now();
            attempt2.rejection ??= "Unknown side effects inspected and explicitly acknowledged; this is not a successful actor result.";
          }
        }
        for (const operation of run.operations) {
          if (operation.state === "unknown" || operation.state === "started") {
            operation.recoveryDecisionId = decision2.id;
            operation.reconciledAt = this.now();
            operation.error ??= "Actual side effects inspected and explicitly acknowledged; operation requires a new verified attempt.";
          }
        }
        if (recovery?.candidate) {
          const previous = run.currentCandidateId ? run.candidates[run.currentCandidateId] : void 0;
          run.candidates[recovery.candidate.id] = recovery.candidate;
          run.currentCandidateId = recovery.candidate.id;
          if (!recoveredCommit && previous && (previous.treeHash !== recovery.candidate.treeHash || previous.head !== recovery.candidate.head)) {
            delete run.featureVerificationAttemptId;
            for (const state of Object.values(run.sections)) {
              if (!["pending", "implementing", "repairing"].includes(state.stage)) state.stage = "review-selection";
              state.candidateId = recovery.candidate.id;
              state.inputContractVersion++;
              delete state.acceptedCandidateId;
              delete state.integratedCandidateId;
              delete state.aAcceptedCandidateId;
            }
            if (["delivery", "feature-verification"].includes(run.stage)) run.stage = "sections";
          }
        }
      }
      const section2 = decision2.sectionId ? run.sections[decision2.sectionId] : void 0;
      if (recoveredCommit) {
        run.currentCandidateId = recoveredCommit.candidateId;
        run.commit = recoveredCommit;
        run.delivery = { mode: "commit", candidateId: recoveredCommit.candidateId, path: run.workspace.path, branch: recoveredCommit.branch, createdAt: recoveredCommit.createdAt, commit: recoveredCommit.commit };
        run.stage = "done";
        run.status = "completed";
        run.controlEpoch++;
        this.event(run, "delivery-recovered", "Actual delivery commit matched the previously accepted candidate and business evidence; no commit was replayed.");
        return;
      }
      if (input.action === "replan") {
        run.stage = "planning";
        run.inputContractVersion++;
        run.planFeedback.push(`User decision: ${input.answer.trim()}`);
        delete run.activeSectionId;
      } else if (section2) {
        section2.inputContractVersion++;
        section2.repairInstructions = [section2.repairInstructions, `User decision: ${input.answer.trim()}`].filter(Boolean).join("\n");
      } else {
        run.inputContractVersion++;
        run.planFeedback.push(`User decision: ${input.answer.trim()}`);
      }
      this.event(run, "decision-recorded", "The current user decision was recorded.");
    });
    if (applied.status === "completed") return applied;
    return this.resume(id2);
  }
  /** Startup never assumes a vanished in-memory handle completed its side effects. */
  async recover() {
    this.assertOpen();
    for (const run of await this.store.list()) {
      if (!["running", "pausing"].includes(run.status)) continue;
      await this.change(run.id, (draft) => {
        draft.controlEpoch++;
        for (const attempt2 of draft.attempts) {
          if (attempt2.state === "started") {
            attempt2.state = "unknown";
            attempt2.rejection = "Host restarted before a durable terminal result was recorded.";
          }
        }
        for (const operation of draft.operations) if (operation.state === "started") operation.state = "unknown";
        draft.status = "paused";
        this.event(draft, "recovery-required", "Recovered persisted task. Interrupted execution must be reconciled before further writes.");
      });
    }
  }
  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    const ids = new Set([...this.activeActors.values(), ...this.activeOperations.values()].map((value) => value.runId));
    for (const id2 of ids) await this.pause(id2);
    await Promise.allSettled([...this.drives.values()].map((drive) => drive.promise));
    if (!this.activeActors.size && !this.activeOperations.size) await this.workspace.dispose?.();
    this.listeners.clear();
  }
  assertOpen() {
    if (this.disposed) throw new Error("Development controller is disposed.");
  }
  publish(run) {
    for (const listener of this.listeners) {
      try {
        listener(structuredClone(run));
      } catch {
      }
    }
  }
  event(run, type, message2, extra = {}) {
    run.events.push({ id: this.id(), at: this.now(), type, message: message2, ...extra });
  }
  async change(id2, mutate) {
    const next = await this.store.update(id2, (stored) => {
      const draft = structuredClone(stored);
      mutate(draft);
      draft.revision = stored.revision + 1;
      draft.updatedAt = this.now();
      return draft;
    });
    this.publish(next);
    return next;
  }
  schedule(id2) {
    if (this.disposed) return;
    const existing = this.drives.get(id2);
    if (existing) {
      existing.again = true;
      return;
    }
    const state = { again: true, promise: Promise.resolve() };
    state.promise = Promise.resolve().then(async () => {
      while (state.again && !this.disposed) {
        state.again = false;
        try {
          if (await this.driveOnce(id2)) state.again = true;
        } catch (error) {
          await this.block(id2, message(error), "infrastructure");
        }
      }
    }).finally(() => this.drives.delete(id2));
    this.drives.set(id2, state);
  }
  async driveOnce(id2) {
    let run = await this.status(id2);
    if (run.status !== "running") return false;
    const terminal = run.attempts.find((attempt2) => attempt2.state === "terminal" && !attempt2.rejection);
    if (terminal) {
      await this.admit(run, terminal);
      return true;
    }
    for (const attempt2 of run.attempts.filter((value) => value.state === "intent" && !value.rejection)) {
      if (!this.activeActors.has(attempt2.id)) this.launchActor(run.id, attempt2);
    }
    if (!run.workspace.prepared) {
      return this.operation(run, "prepare", "prepare", void 0, async (snapshot) => this.workspace.prepare(snapshot), (draft, result) => {
        draft.workspace = { ...result, prepared: true };
      });
    }
    if (run.diagnostic) return this.driveDiagnostic(run);
    if (run.stage === "planning") return this.drivePlanning(run);
    if (run.stage === "plan-review-a" || run.stage === "plan-review-b") return this.drivePlanReview(run);
    if (run.stage === "sections") return this.driveSections(run);
    if (run.stage === "feature-verification") return this.driveFeatureVerification(run);
    if (run.stage === "delivery") return this.driveDelivery(run);
    return false;
  }
  async drivePlanning(run) {
    const attempt2 = this.latest(run, "planner");
    if (!attempt2) return this.queueActor(run, "planner", {
      goal: run.goal,
      phase: run.stage,
      previousPlan: run.plan,
      feedback: run.planFeedback,
      userDecisions: run.decisionHistory.map((decision2) => ({ question: decision2.question, answer: decision2.answer, sectionId: decision2.sectionId })),
      existingLineages: [...Object.values(run.sections), ...Object.values(run.retiredSections ?? {}).map((entry) => entry.state)].map((section2) => ({ sectionId: section2.id, lineageId: section2.lineageId, materialRepairWaves: section2.materialRepairWaves }))
    });
    if (attempt2.state !== "admitted") return false;
    const output = attempt2.admittedOutput;
    validatePlan(output.plan);
    await this.change(run.id, (draft) => {
      const old = { ...Object.fromEntries(Object.entries(draft.retiredSections ?? {}).map(([id2, entry]) => [id2, entry.state])), ...draft.sections };
      const requirementsVersion = draft.requirementsHistory[draft.requirementsHistory.length - 1].version;
      const explicitRevision = requirementsVersion > (draft.planRequirementsVersion ?? draft.requirementsHistory[0].version);
      for (const section2 of Object.values(draft.sections)) {
        if (section2.materialRepairWaves && !output.plan.sections.some((entry) => entry.id === section2.id)) {
          if (!explicitRevision) throw new Error(`Replanning removed repair lineage ${section2.lineageId}. Preserve its Section identity and budget.`);
        }
        if (!output.plan.sections.some((entry) => entry.id === section2.id)) {
          const contract = draft.plan?.sections.find((entry) => entry.id === section2.id);
          if (contract) {
            draft.retiredSections ??= {};
            draft.retiredSections[section2.id] = { state: section2, contract, requirementsVersion, retiredAt: this.now() };
          }
        }
      }
      draft.plan = output.plan;
      draft.planRevision++;
      draft.planRequirementsVersion = requirementsVersion;
      draft.sections = Object.fromEntries(output.plan.sections.map((section2) => [section2.id, {
        id: section2.id,
        stage: "pending",
        inputContractVersion: (old[section2.id]?.inputContractVersion ?? 0) + 1,
        lineageId: old[section2.id]?.lineageId ?? `${draft.id}:${section2.id}`,
        materialRepairWaves: old[section2.id]?.materialRepairWaves ?? 0,
        diagnosticCount: old[section2.id]?.diagnosticCount ?? 0,
        lenses: [],
        checks: [],
        reviewIds: [],
        decisionIds: [],
        aCoverageEvidenceIds: []
      }]));
      for (const section2 of output.plan.sections) if (draft.retiredSections) delete draft.retiredSections[section2.id];
      draft.stage = "plan-review-a";
      this.event(draft, "plan-proposed", "A structured plan was proposed; independent plan review A starts next.");
    });
    return true;
  }
  async drivePlanReview(run) {
    const kind = run.stage === "plan-review-a" ? "plan-review-a" : "plan-review-b";
    const attempt2 = this.latest(run, kind);
    if (!attempt2) return this.queueActor(run, kind, {
      goal: run.goal,
      phase: run.stage,
      plan: run.plan,
      planRevision: run.planRevision,
      userDecisions: run.decisionHistory.map((decision2) => ({ answer: decision2.answer, sectionId: decision2.sectionId })),
      retiredObligations: Object.values(run.retiredSections ?? {}).filter((entry) => entry.requirementsVersion === run.planRequirementsVersion).map((entry) => ({ contract: entry.contract, lineageId: entry.state.lineageId, reason: "Proposed retirement under the explicit revised user requirements. Verify that no still-authorized obligation was dropped." }))
    });
    if (attempt2.state !== "admitted") return false;
    const output = attempt2.admittedOutput;
    if (output.verdict === "clean" && !output.limitations.length) {
      await this.change(run.id, (draft) => {
        draft.stage = kind === "plan-review-a" ? "plan-review-b" : "sections";
        this.event(draft, "plan-review-accepted", `${kind} completed valid independent coverage.`);
      });
    } else if (run.planRepairs >= run.policy.maxPlanRepairs) {
      await this.change(run.id, (draft) => {
        draft.diagnostic = { reason: "Plan review remains unresolved after the bounded plan repair budget.", requestedAt: this.now() };
      });
    } else {
      await this.change(run.id, (draft) => {
        draft.planRepairs++;
        draft.inputContractVersion++;
        draft.stage = "planning";
        draft.planFeedback.push(JSON.stringify(output));
        this.event(draft, "plan-repair-required", `${kind} requires a material plan repair; both logical plan coverages must apply to the final plan.`);
      });
    }
    return true;
  }
  async driveSections(run) {
    if (!run.plan) throw new Error("Execution requires a reviewed plan.");
    const active = run.activeSectionId && run.sections[run.activeSectionId];
    if (!active || active.stage === "integrated") {
      const next = run.plan.sections.find((entry) => run.sections[entry.id]?.stage !== "integrated" && entry.dependencies.every((dependency) => run.sections[dependency]?.stage === "integrated"));
      if (!next) {
        if (Object.values(run.sections).some((section2) => section2.stage !== "integrated")) throw new Error("No executable Section exists; dependency acceptance is incomplete.");
        await this.change(run.id, (draft) => {
          draft.stage = "feature-verification";
          delete draft.activeSectionId;
        });
      } else {
        const state = run.sections[next.id];
        if (state.stage === "pending" && state.materialRepairWaves >= run.policy.maxRepairWaves) {
          await this.block(run.id, `Section ${next.id} retains exhausted original repair lineage ${state.lineageId}. Replanning cannot authorize a sixth implementation wave.`, "budget", next.id);
          return false;
        }
        await this.change(run.id, (draft) => {
          draft.activeSectionId = next.id;
          const section2 = draft.sections[next.id];
          if (section2.stage === "pending") {
            section2.stage = "implementing";
            section2.inputContractVersion++;
          }
          if (section2.stage === "repairing" && section2.materialRepairWaves === 3 && section2.diagnosticCount < draft.policy.maxDiagnostics) {
            draft.diagnostic = { reason: "Third material repair wave: diagnose recurring root cause before further implementation.", sectionId: section2.id, requestedAt: this.now() };
          }
          this.event(draft, "section-selected", `Section ${next.id} owns the implementation workspace.`, { sectionId: next.id });
        });
      }
      return true;
    }
    if (active.stage === "implementing" || active.stage === "repairing") return this.driveImplementation(run, active);
    if (active.stage === "review-selection") return this.driveSelection(run, active);
    if (active.stage === "reroute") return this.driveReroute(run, active);
    if (active.stage === "review-a") return this.driveA(run, active);
    if (active.stage === "closure") return this.driveClosure(run, active);
    if (active.stage === "adjudicating-a" || active.stage === "adjudicating-b") return this.driveAdjudication(run, active);
    if (active.stage === "review-b") return this.driveB(run, active);
    if (active.stage === "accepted") {
      const candidate2 = this.candidate(run, active);
      return this.operation(
        run,
        "integrate",
        `integrate:${active.id}:${candidate2.id}`,
        active.id,
        async (snapshot) => {
          const actual = await this.workspace.capture(snapshot, active.id);
          if (actual.treeHash !== candidate2.treeHash || actual.head !== candidate2.head) throw new Error("Workspace changed after review. Integration requires a new candidate assessment.");
          return actual;
        },
        (draft) => {
          const section2 = draft.sections[active.id];
          section2.stage = "integrated";
          section2.integratedCandidateId = candidate2.id;
          this.event(draft, "section-integrated", `Section ${active.id} accepted and integrated; its dependants may now proceed.`, { sectionId: active.id });
        }
      );
    }
    return false;
  }
  async driveImplementation(run, section2) {
    const attempt2 = this.latest(run, "implementer", section2);
    const contract = this.sectionPlan(run, section2);
    if (!attempt2) return this.queueActor(run, "implementer", {
      ...this.contractInput(run, section2),
      instructions: section2.repairInstructions ?? contract.objective,
      implementation: contract.implementation,
      subsections: contract.subsections
    }, section2);
    if (attempt2.state !== "admitted") return false;
    const result = attempt2.admittedOutput;
    if (result.remainingWork.length) {
      const captureKey2 = `unfinished:${attempt2.id}`;
      if (!this.completedOperation(run, captureKey2)) return this.operation(
        run,
        "capture",
        captureKey2,
        section2.id,
        (snapshot) => this.workspace.capture(snapshot, section2.id),
        (draft, value) => {
          const actual = value;
          draft.candidates[actual.id] = actual;
          draft.currentCandidateId = actual.id;
          draft.sections[section2.id].candidateId = actual.id;
        }
      );
      const unfinished = run.attempts.filter((entry) => entry.state === "admitted" && entry.task.sectionId === section2.id && entry.task.kind === "implementer" && entry.admittedOutput.remainingWork.length > 0).length;
      if (unfinished > 3) {
        await this.block(run.id, `Owned implementation remains unfinished after bounded continuation and diagnosis: ${result.remainingWork.join("; ")}`, "semantic", section2.id);
        return false;
      }
      await this.change(run.id, (draft) => {
        const state = draft.sections[section2.id];
        state.inputContractVersion++;
        state.repairInstructions = `Continue the existing owned task from the captured actual changes. Complete: ${result.remainingWork.join("; ")}. Do not propose a new scope for already authorized work.`;
        if (unfinished === 2) draft.diagnostic = { reason: "Repeated execution stopped with unfinished owned work; identify the obstacle and concrete continuation.", sectionId: section2.id, requestedAt: this.now() };
        this.event(draft, "owned-work-continued", "Unfinished authorized work retained in the same Section and continued from actual changes.", { sectionId: section2.id });
      });
      return true;
    }
    const captureKey = `capture:${attempt2.id}`;
    if (!this.completedOperation(run, captureKey)) {
      return this.operation(run, "capture", captureKey, section2.id, (snapshot) => this.workspace.capture(snapshot, section2.id), (draft, value) => {
        const candidate3 = value;
        draft.candidates[candidate3.id] = candidate3;
        draft.currentCandidateId = candidate3.id;
        draft.sections[section2.id].candidateId = candidate3.id;
      });
    }
    const candidate2 = this.candidate(run, section2);
    const checksKey = `checks:${attempt2.id}`;
    if (!this.completedOperation(run, checksKey)) {
      return this.operation(run, "checks", checksKey, section2.id, (snapshot, signal) => this.workspace.check(snapshot, candidate2, contract.checks, signal), (draft, value) => {
        draft.sections[section2.id].checks = value;
      }, candidate2.id);
    }
    await this.change(run.id, (draft) => {
      const next = draft.sections[section2.id];
      next.stage = section2.stage === "repairing" ? "reroute" : "review-selection";
      this.event(draft, "implementation-captured", "Actual implementation candidate and host-run checks recorded.", { sectionId: section2.id, attemptId: attempt2.id });
    });
    return true;
  }
  async driveSelection(run, section2) {
    if (!section2.candidateId) {
      return this.operation(run, "capture", `revalidation:${section2.id}:${section2.inputContractVersion}`, section2.id, (snapshot) => this.workspace.capture(snapshot, section2.id), (draft, result) => {
        const candidate3 = result;
        draft.candidates[candidate3.id] = candidate3;
        draft.currentCandidateId = candidate3.id;
        draft.sections[section2.id].candidateId = candidate3.id;
      });
    }
    const candidate2 = this.candidate(run, section2);
    const specs = this.sectionPlan(run, section2).checks;
    if (specs.some((spec) => !section2.checks.some((check2) => check2.candidateId === candidate2.id && check2.specId === spec.id))) {
      return this.operation(
        run,
        "checks",
        `revalidation-checks:${section2.id}:${section2.inputContractVersion}:${candidate2.id}`,
        section2.id,
        (snapshot, signal) => this.workspace.check(snapshot, candidate2, specs, signal),
        (draft, result) => {
          draft.sections[section2.id].checks = result;
        },
        candidate2.id
      );
    }
    const attempt2 = this.latest(run, "review-selector", section2);
    if (!attempt2) return this.queueActor(run, "review-selector", { ...this.contractInput(run, section2), requiredBaseline: "R01", maximumLenses: 6 }, section2);
    if (attempt2.state !== "admitted") return false;
    await this.change(run.id, (draft) => {
      const state = draft.sections[section2.id];
      state.lenses = attempt2.admittedOutput.lenses;
      state.stage = "review-a";
    });
    return true;
  }
  /** The old Skill re-routes the repair delta before closing A; it does not restart unaffected lenses. */
  async driveReroute(run, section2) {
    const attempt2 = this.latest(run, "review-selector", section2);
    if (!attempt2) return this.queueActor(run, "review-selector", {
      ...this.contractInput(run, section2),
      repairDelta: section2.repairInstructions,
      priorLenses: section2.lenses,
      previousReviews: run.reviews.filter((review) => review.sectionId === section2.id),
      obligation: "Inspect actual repair delta and direct consumers. Select R01-R12 risk coverage, declare invalidated previous A lenses only with a source-specific reason; do not restart unaffected A discovery."
    }, section2);
    if (attempt2.state !== "admitted") return false;
    const output = attempt2.admittedOutput;
    const known = new Set(section2.lenses.map((lens2) => lens2.id));
    for (const id2 of output.invalidatedLensIds ?? []) if (!known.has(id2)) throw new Error(`Unknown invalidated A lens ${id2}.`);
    const fresh = [.../* @__PURE__ */ new Set([...output.lenses.filter((lens2) => !known.has(lens2.id)).map((lens2) => lens2.id), ...output.invalidatedLensIds ?? []])];
    const lenses = [...section2.lenses, ...output.lenses.filter((lens2) => !known.has(lens2.id))];
    if (lenses.length > 6) throw new Error("Repair adds more than six required A lenses; reassess coverage and the Section boundary.");
    await this.change(run.id, (draft) => {
      const state = draft.sections[section2.id];
      state.lenses = lenses;
      state.freshRepairLensIds = fresh;
      state.stage = "closure";
      this.event(draft, "repair-risk-rerouted", `Fresh A risk coverage: ${fresh.join(", ") || "none"}.`, { sectionId: state.id });
    });
    return true;
  }
  async driveA(run, section2) {
    const attempts = section2.lenses.map((lens2) => this.latest(run, "reviewer-a", section2, lens2.id));
    const inflight = attempts.filter((attempt2) => attempt2 && attempt2.state !== "admitted").length;
    let capacity = run.policy.maxParallelReviews - inflight;
    for (let i = 0; i < section2.lenses.length && capacity > 0; i++) {
      if (!attempts[i]) {
        await this.queueActor(await this.status(run.id), "reviewer-a", { ...this.contractInput(run, section2), lens: section2.lenses[i] }, section2, section2.lenses[i]);
        capacity--;
      }
    }
    if (attempts.every((attempt2) => attempt2?.state === "admitted")) {
      await this.change(run.id, (draft) => {
        draft.sections[section2.id].stage = "adjudicating-a";
      });
      return true;
    }
    return false;
  }
  async driveClosure(run, section2) {
    const tasks = (section2.freshRepairLensIds ?? []).map((id2) => ({
      id: id2,
      lens: section2.lenses.find((lens2) => lens2.id === id2),
      attempt: this.latest(run, "reviewer-a", section2, id2)
    }));
    let capacity = run.policy.maxParallelReviews - tasks.filter((entry) => entry.attempt && entry.attempt.state !== "admitted").length;
    for (const entry of tasks) if (!entry.attempt && capacity > 0) {
      await this.queueActor(await this.status(run.id), "reviewer-a", {
        ...this.contractInput(run, section2),
        lens: entry.lens,
        obligation: "Fresh independent A evidence for a newly triggered or invalidated repair-delta risk."
      }, section2, entry.lens);
      capacity--;
    }
    if (!tasks.every((entry) => entry.attempt?.state === "admitted")) return false;
    const attempt2 = this.latest(run, "closure-reviewer", section2);
    if (!attempt2) return this.queueActor(run, "closure-reviewer", {
      ...this.contractInput(run, section2),
      instructions: section2.repairInstructions,
      targetFindingIds: section2.closureFindingIds ?? [],
      previousReviews: run.reviews.filter((review) => review.sectionId === section2.id),
      previousDecisions: run.decisions.filter((decision2) => decision2.sectionId === section2.id),
      obligation: "Report exactly one per-finding status for every targetFindingId, with actual current-candidate evidence. No generic CLEAN may replace closure; examine direct regressions. Do not repeat the full A group."
    }, section2);
    if (attempt2.state !== "admitted") return false;
    await this.change(run.id, (draft) => {
      draft.sections[section2.id].stage = "adjudicating-a";
    });
    return true;
  }
  async driveB(run, section2) {
    const attempt2 = this.latest(run, "reviewer-b", section2);
    if (!attempt2) {
      return this.queueActor(run, "reviewer-b", {
        ...this.contractInput(run, section2),
        obligation: "Independently review the complete final bounded Section candidate and actual business behavior."
      }, section2);
    }
    if (attempt2.state !== "admitted") return false;
    await this.change(run.id, (draft) => {
      draft.sections[section2.id].stage = "adjudicating-b";
    });
    return true;
  }
  async driveAdjudication(run, section2) {
    const attempt2 = this.latest(run, "adjudicator", section2);
    const candidate2 = this.candidate(run, section2);
    const allReviews = run.reviews.filter((review) => review.sectionId === section2.id);
    const currentReviews = this.currentReviews(allReviews, candidate2.id);
    const isB = section2.stage === "adjudicating-b";
    if (!attempt2) return this.queueActor(run, "adjudicator", {
      ...this.contractInput(run, section2),
      purpose: isB ? "b-admission" : currentReviews.some((review) => review.stage === "closure") ? "closure-admission" : "a-admission",
      reviews: allReviews,
      findings: allReviews.flatMap((review) => review.output.findings.map((finding) => ({ ...finding, id: `${review.id}:${finding.id}`, evidenceId: review.id, candidateId: review.candidateId }))),
      previousDecisions: run.decisions.filter((decision2) => decision2.sectionId === section2.id),
      repairBudget: { used: section2.materialRepairWaves, maximum: run.policy.maxRepairWaves, lineageId: section2.lineageId },
      selectedLenses: section2.lenses,
      obligation: "Admit or reject findings on semantic evidence. Reuse old coverage only through explicit evidenceReuse with reasons. Current checks and logical A plus independent final B are required; a report count never proves acceptance."
    }, section2);
    if (attempt2.state !== "admitted") return false;
    const output = attempt2.admittedOutput;
    this.validateAdjudication(run, section2, output, attempt2.id);
    if (output.resolution === "needs-user") {
      await this.block(run.id, output.question ?? output.summary, "semantic", section2.id);
      return false;
    }
    if (output.resolution === "more-review") {
      await this.change(run.id, (draft) => {
        draft.diagnostic = { reason: `${output.summary}
Missing coverage: ${output.missingCoverage.join("; ")}`, sectionId: section2.id, requestedAt: this.now() };
      });
      return true;
    }
    if (output.resolution === "repair") return this.requestRepair(run, section2, output.repairInstructions, output.material, isB ? "b" : "a", output.invalidatedSectionIds, output.dispositions.filter((item) => item.decision === "fix").map((item) => item.findingId));
    await this.change(run.id, (draft) => {
      const state = draft.sections[section2.id];
      if (isB) {
        state.stage = "accepted";
        state.acceptedCandidateId = candidate2.id;
        this.event(draft, "section-accepted", "A and independent full B logical coverage apply to this final candidate.", { sectionId: section2.id });
      } else {
        state.aAcceptedCandidateId = candidate2.id;
        state.aCoverageEvidenceIds = [.../* @__PURE__ */ new Set([
          ...currentReviews.filter((review) => review.stage !== "b").map((review) => review.id),
          ...output.evidenceReuse.map((entry) => entry.evidenceId)
        ])];
        state.stage = "review-b";
      }
    });
    return true;
  }
  validateAdjudication(run, section2, output, attemptId) {
    const reviews = run.reviews.filter((review) => review.sectionId === section2.id);
    const knownFindingIds = new Set(reviews.flatMap((review) => review.output.findings.map((finding) => `${review.id}:${finding.id}`)));
    const dispositions = new Map(output.dispositions.map((item) => [item.findingId, item]));
    if (dispositions.size !== output.dispositions.length) throw new Error("Duplicate finding disposition.");
    for (const item of output.dispositions) if (!knownFindingIds.has(item.findingId)) throw new Error(`Disposition references unknown finding ${item.findingId}.`);
    const priorDisposition = new Set(run.decisions.filter((decision2) => decision2.attemptId !== attemptId && decision2.sectionId === section2.id && "dispositions" in decision2.output).flatMap((decision2) => decision2.output.dispositions.map((item) => item.findingId)));
    for (const findingId of knownFindingIds) if (!dispositions.has(findingId) && !priorDisposition.has(findingId)) throw new Error(`Finding ${findingId} has no disposition.`);
    for (const sectionId of output.invalidatedSectionIds) if (!run.sections[sectionId]) throw new Error(`Unknown invalidated Section ${sectionId}.`);
    const candidate2 = this.candidate(run, section2);
    for (const reuse of output.evidenceReuse) {
      const review = reviews.find((entry) => entry.id === reuse.evidenceId);
      if (!review || review.output.verdict === "incomplete" || !reuse.reason.trim()) throw new Error("Coverage reuse requires an existing complete report and a semantic reason.");
      if (section2.freshRepairLensIds?.includes(review.lensId) && review.candidateId !== candidate2.id) throw new Error("Invalidated A lens cannot reuse stale source evidence.");
    }
    if (output.resolution === "repair" && !output.repairInstructions.trim()) throw new Error("A repair decision requires concrete repair instructions.");
    if (output.resolution !== "accept") return;
    if (!output.coverageSufficient || output.missingCoverage.length || output.dispositions.some((item) => item.decision !== "reject")) throw new Error("Acceptance cannot retain missing coverage or unresolved admitted findings.");
    const checks = this.sectionPlan(run, section2).checks.filter((spec) => spec.required);
    if (checks.some((spec) => !section2.checks.some((evidence) => evidence.specId === spec.id && evidence.candidateId === candidate2.id && evidence.status === "passed"))) throw new Error("Acceptance requires actual passing host checks on the current candidate.");
    const current = this.currentReviews(reviews, candidate2.id);
    if (current.some((review) => review.output.verdict === "incomplete")) throw new Error("An incomplete review cannot provide accepted coverage.");
    if (section2.repairOrigin) {
      const closure = [...current].reverse().find((review) => review.stage === "closure");
      if (!closure) throw new Error("Current repaired candidate lacks a targeted closure report.");
      const outcomes = closure.output.closures ?? [];
      const targets = section2.closureFindingIds ?? [];
      if (new Set(outcomes.map((entry) => entry.findingId)).size !== outcomes.length || outcomes.length !== targets.length || targets.some((id2) => !outcomes.some((entry) => entry.findingId === id2 && entry.status === "verified-closed" && entry.evidence.trim()))) {
        throw new Error("Every admitted finding must have itemized VERIFIED_CLOSED evidence on the current candidate.");
      }
      for (const lensId of section2.freshRepairLensIds ?? []) {
        if (!current.some((review) => review.stage === "a" && review.lensId === lensId && review.output.verdict !== "incomplete")) {
          throw new Error(`Repair-delta lens ${lensId} lacks fresh independent discovery.`);
        }
      }
    }
    if (section2.stage === "adjudicating-b") {
      if (section2.aAcceptedCandidateId !== candidate2.id) throw new Error("B acceptance requires logical A coverage on the same candidate.");
      if (!current.some((review) => review.stage === "b")) throw new Error("B acceptance requires an independent full current-candidate B report.");
    } else {
      const eligible = /* @__PURE__ */ new Set([...current.filter((review) => review.stage === "a" && review.output.verdict !== "incomplete").map((review) => review.id), ...output.evidenceReuse.map((item) => item.evidenceId)]);
      for (const lens2 of section2.lenses) {
        if (!reviews.some((review) => review.stage === "a" && review.lensId === lens2.id && eligible.has(review.id))) throw new Error(`Missing logical A coverage for ${lens2.id}; focused closure alone is insufficient.`);
      }
    }
  }
  async requestRepair(run, section2, instructions, material, origin, invalidated = [], findingIds = []) {
    const correctiveDecisions = run.events.filter((event) => event.type === "repair-admitted" && event.sectionId === section2.id).length;
    if (correctiveDecisions >= run.policy.maxRepairWaves + 2) {
      await this.block(run.id, `Section ${section2.id} exhausted the bounded corrective workflow attempts, including non-material repairs. Diagnose or revise the contract without resetting its original lineage.`, "budget", section2.id);
      return false;
    }
    if (material && section2.materialRepairWaves >= run.policy.maxRepairWaves) {
      await this.block(run.id, `Section ${section2.id} exhausted its original ${run.policy.maxRepairWaves}-wave material repair budget. ${instructions}`, "budget", section2.id);
      return false;
    }
    await this.change(run.id, (draft) => {
      const state = draft.sections[section2.id];
      if (material) state.materialRepairWaves++;
      state.inputContractVersion++;
      state.stage = "repairing";
      state.repairInstructions = instructions;
      state.repairOrigin = origin;
      state.closureFindingIds = [...new Set(findingIds)];
      delete state.freshRepairLensIds;
      delete state.acceptedCandidateId;
      delete state.integratedCandidateId;
      delete state.aAcceptedCandidateId;
      draft.stage = "sections";
      draft.activeSectionId = section2.id;
      delete draft.featureVerificationAttemptId;
      for (const sectionId of invalidated) {
        if (sectionId === section2.id) continue;
        const other = draft.sections[sectionId];
        other.stage = "review-selection";
        other.inputContractVersion++;
        delete other.acceptedCandidateId;
        delete other.integratedCandidateId;
        delete other.aAcceptedCandidateId;
        delete other.candidateId;
      }
      if ((material && state.materialRepairWaves === 3 || !material && correctiveDecisions >= 1) && state.diagnosticCount < draft.policy.maxDiagnostics) {
        draft.diagnostic = { reason: "Third material repair wave: diagnose recurring root cause before further implementation.", sectionId: state.id, requestedAt: this.now() };
      }
      this.event(draft, "repair-admitted", `Repair admitted to original Section lineage; ${state.materialRepairWaves} material waves used.`, { sectionId: section2.id });
    });
    return true;
  }
  async driveDiagnostic(run) {
    const diagnostic = run.diagnostic;
    const section2 = diagnostic.sectionId ? run.sections[diagnostic.sectionId] : void 0;
    const count = section2?.diagnosticCount ?? run.attempts.filter((attempt3) => attempt3.task.kind === "diagnostician" && !attempt3.task.sectionId && attempt3.state === "admitted" && attempt3.task.input.diagnosticKey !== diagnostic.requestedAt).length;
    if (count >= run.policy.maxDiagnostics) {
      await this.change(run.id, (draft) => {
        delete draft.diagnostic;
      });
      await this.block(run.id, diagnostic.reason, "budget", section2?.id);
      return false;
    }
    const attempt2 = this.latest(run, "diagnostician", section2, void 0, diagnostic.requestedAt);
    if (!attempt2) return this.queueActor(run, "diagnostician", {
      ...section2 ? this.contractInput(run, section2) : { goal: run.goal, plan: run.plan, phase: run.stage },
      diagnosticKey: diagnostic.requestedAt,
      reason: diagnostic.reason,
      priorDecisions: run.decisions,
      planFeedback: run.planFeedback
    }, section2);
    if (attempt2.state !== "admitted") return false;
    const result = attempt2.admittedOutput;
    await this.change(run.id, (draft) => {
      delete draft.diagnostic;
      if (section2) {
        draft.sections[section2.id].diagnosticCount++;
        draft.sections[section2.id].repairInstructions = [draft.sections[section2.id].repairInstructions, result.instructions].filter(Boolean).join("\n");
      } else draft.planFeedback.push(result.instructions);
    });
    if (section2 && ["adjudicating-a", "adjudicating-b"].includes(section2.stage) && result.recommendation === "retry") {
      await this.change(run.id, (draft) => {
        const state = draft.sections[section2.id];
        state.stage = section2.stage === "adjudicating-a" ? "review-a" : "review-b";
        state.inputContractVersion++;
        this.event(draft, "additional-review-scheduled", "A bounded independent diagnostic identified necessary fresh review coverage.", { sectionId: section2.id });
      });
      return true;
    }
    if (result.recommendation === "needs-user" || !section2 || !["repairing", "implementing"].includes(section2.stage)) {
      await this.block(run.id, result.question ?? `${result.summary}
${result.instructions}`, !section2 ? "budget" : "semantic", section2?.id);
      return false;
    }
    if (result.recommendation === "revise-plan") {
      await this.block(run.id, `Diagnosis recommends replanning: ${result.instructions}`, "semantic", section2.id);
      return false;
    }
    return true;
  }
  async driveFeatureVerification(run) {
    const plan = run.plan;
    const captureKey = `feature-capture:${run.planRevision}:${run.inputContractVersion}:${Object.values(run.sections).map((section2) => section2.integratedCandidateId).join(",")}`;
    if (!this.completedOperation(run, captureKey)) return this.operation(run, "capture", captureKey, void 0, (snapshot) => this.workspace.capture(snapshot), (draft, value) => {
      const candidate3 = value;
      draft.candidates[candidate3.id] = candidate3;
      draft.currentCandidateId = candidate3.id;
    });
    const candidate2 = run.candidates[run.currentCandidateId];
    const specs = plan.features.flatMap((feature) => feature.checks.map((spec) => ({ ...spec, id: `${feature.id}:${spec.id}` })));
    const checksKey = `feature-checks:${candidate2.id}:${run.planRevision}`;
    if (!this.completedOperation(run, checksKey)) return this.operation(run, "checks", checksKey, void 0, (snapshot, signal) => this.workspace.check(snapshot, candidate2, specs, signal), (draft, value) => {
      draft.featureChecks = value;
    }, candidate2.id);
    const attempt2 = this.latest(run, "feature-verifier");
    if (!attempt2) return this.queueActor(run, "feature-verifier", {
      goal: run.goal,
      phase: run.stage,
      plan,
      candidate: candidate2,
      sectionAcceptances: Object.values(run.sections).map((section2) => ({ ...section2, evidence: run.reviews.filter((review) => section2.reviewIds.includes(review.id)) })),
      evidence: [...run.reviews, ...run.decisions],
      checks: run.featureChecks,
      obligation: "Verify every actual composed business criterion on the common delivered candidate. Reuse applicable Section evidence with concrete IDs; one-Section Features do not need a second A/B. Identify unproven composition and real shared identity/state/security assumptions.",
      userDecisions: run.decisionHistory.map((decision2) => ({ question: decision2.question, answer: decision2.answer, sectionId: decision2.sectionId }))
    });
    if (attempt2.state !== "admitted") return false;
    const output = attempt2.admittedOutput;
    if (output.verdict === "needs-user") {
      await this.block(run.id, output.question ?? output.summary, "semantic");
      return false;
    }
    if (output.verdict === "repair") {
      if (!output.repairSectionIds.length || !output.repairInstructions.trim()) throw new Error("Feature repair requires an owned parent Section and concrete instructions.");
      if (output.repairSectionIds.some((id2) => !run.sections[id2])) throw new Error("Feature repair references an unknown Section.");
      if (new Set(output.repairSectionIds).size !== output.repairSectionIds.length) throw new Error("A Feature repair must identify each owning Section once.");
      const exhausted = output.repairSectionIds.find((id2) => run.sections[id2].materialRepairWaves >= run.policy.maxRepairWaves);
      if (exhausted) {
        await this.block(run.id, `Section ${exhausted} exhausted its original material repair budget.`, "budget", exhausted);
        return false;
      }
      const first = output.repairSectionIds[0];
      await this.requestRepair(run, run.sections[first], output.repairInstructions, true, "feature");
      await this.change(run.id, (draft) => {
        for (const id2 of output.repairSectionIds.slice(1)) {
          const state = draft.sections[id2];
          state.stage = "repairing";
          state.materialRepairWaves++;
          state.inputContractVersion++;
          state.repairOrigin = "feature";
          state.repairInstructions = output.repairInstructions;
          state.closureFindingIds = [];
          delete state.freshRepairLensIds;
          delete state.acceptedCandidateId;
          delete state.integratedCandidateId;
          delete state.aAcceptedCandidateId;
          this.event(draft, "repair-admitted", "Feature repair assigned to its own Section write owner and original material budget.", { sectionId: id2 });
        }
      });
      return true;
    }
    this.validateFeatureAcceptance(run, output, specs.filter((spec) => spec.required).map((spec) => spec.id));
    await this.change(run.id, (draft) => {
      draft.featureVerificationAttemptId = attempt2.id;
      draft.stage = "delivery";
      this.event(draft, "features-accepted", "All authorized business criteria have evidence on the common delivered candidate.");
    });
    return true;
  }
  validateFeatureAcceptance(run, output, requiredChecks) {
    if (output.repairSectionIds.length) throw new Error("Feature acceptance cannot retain required repairs.");
    if (Object.values(run.sections).some((section2) => section2.stage !== "integrated")) throw new Error("Feature acceptance requires every parent Section to be accepted and integrated.");
    const candidateId = run.currentCandidateId;
    if (requiredChecks.some((id2) => !run.featureChecks.some((check2) => check2.specId === id2 && check2.candidateId === candidateId && check2.status === "passed"))) throw new Error("Required real business path checks did not pass on the delivered candidate.");
    const evidenceIds = new Set(run.featureChecks.filter((check2) => check2.candidateId === candidateId && check2.status === "passed").map((check2) => check2.id));
    for (const section2 of Object.values(run.sections)) {
      if (section2.stage !== "integrated" || !section2.acceptedCandidateId) continue;
      for (const check2 of section2.checks) {
        if (check2.candidateId === section2.acceptedCandidateId && check2.status === "passed") evidenceIds.add(check2.id);
      }
      for (const review of run.reviews) {
        if (review.sectionId === section2.id && review.output.verdict !== "incomplete" && (review.candidateId === section2.acceptedCandidateId || section2.aCoverageEvidenceIds.includes(review.id))) evidenceIds.add(review.id);
      }
      for (const decision2 of run.decisions) {
        if (decision2.sectionId === section2.id && decision2.candidateId === section2.acceptedCandidateId && "resolution" in decision2.output && decision2.output.resolution === "accept") evidenceIds.add(decision2.id);
      }
    }
    const expected = run.plan.features.flatMap((feature) => feature.acceptanceCriteria.map((criterion) => ({ featureId: feature.id, criterion })));
    if (output.criteria.length !== expected.length) throw new Error("Feature acceptance must account for each business criterion exactly once.");
    for (const entry of expected) {
      const claims = output.criteria.filter((claim) => claim.featureId === entry.featureId && claim.criterion === entry.criterion);
      if (claims.length !== 1 || !claims[0].satisfied || !claims[0].evidenceIds.length) throw new Error(`Business criterion remains unproven: ${entry.featureId}/${entry.criterion}.`);
      for (const id2 of claims[0].evidenceIds) if (!evidenceIds.has(id2)) throw new Error(`Acceptance references missing evidence ${id2}.`);
    }
  }
  async driveDelivery(run) {
    if (!run.featureVerificationAttemptId || !run.currentCandidateId) throw new Error("Delivery requires accepted Feature evidence and a final candidate.");
    const candidate2 = run.candidates[run.currentCandidateId];
    if (!run.policy.commit) {
      return this.operation(
        run,
        "integrate",
        `worktree-delivery:${candidate2.id}`,
        void 0,
        async (snapshot) => {
          const actual = await this.workspace.capture(snapshot);
          if (actual.treeHash !== candidate2.treeHash || actual.head !== candidate2.head) throw new Error("Final worktree changed after Feature acceptance.");
          return actual;
        },
        (draft) => {
          draft.delivery = { mode: "worktree", candidateId: candidate2.id, path: draft.workspace.path, branch: draft.workspace.branch, createdAt: this.now() };
          draft.stage = "done";
          draft.status = "completed";
          this.event(draft, "completed", "Accepted development work verified and delivered in its dedicated worktree; no commit was requested.");
        },
        candidate2.id
      );
    }
    return this.operation(
      run,
      "commit",
      `delivery:${candidate2.id}`,
      void 0,
      (snapshot) => this.workspace.commit(snapshot, candidate2, `feat: ${snapshot.plan.title}`),
      (draft, value) => {
        draft.commit = value;
        draft.delivery = { mode: "commit", candidateId: candidate2.id, path: draft.workspace.path, branch: draft.workspace.branch, createdAt: this.now(), commit: draft.commit.commit };
        draft.stage = "done";
        draft.status = "completed";
        this.event(draft, "completed", "Accepted development work committed on the dedicated branch.");
      },
      candidate2.id
    );
  }
  contractInput(run, section2) {
    const contract = this.sectionPlan(run, section2);
    return {
      goal: run.goal,
      phase: section2.stage,
      section: contract,
      features: run.plan.features.filter((feature) => contract.featureIds.includes(feature.id)),
      upstream: contract.dependencies.map((id2) => ({ contract: run.plan.sections.find((entry) => entry.id === id2), acceptedCandidateId: run.sections[id2].integratedCandidateId })),
      candidate: section2.candidateId ? run.candidates[section2.candidateId] : run.currentCandidateId ? run.candidates[run.currentCandidateId] : void 0,
      requiredChecks: contract.checks,
      checks: section2.checks,
      // Only adopted human answers are part of the business contract. Do not feed a
      // reviewer the prior review/diagnostic question which prompted the answer.
      userDecisions: run.decisionHistory.filter((decision2) => !decision2.sectionId || decision2.sectionId === section2.id).map((decision2) => ({ answer: decision2.answer, sectionId: decision2.sectionId }))
    };
  }
  sectionPlan(run, section2) {
    const result = run.plan?.sections.find((entry) => entry.id === section2.id);
    if (!result) throw new Error(`Section ${section2.id} lacks a reviewed implementation contract.`);
    return result;
  }
  currentReviews(reviews, candidateId) {
    const latest = /* @__PURE__ */ new Map();
    for (const review of reviews) if (review.candidateId === candidateId) latest.set(`${review.stage}:${review.lensId}`, review);
    return [...latest.values()];
  }
  candidate(run, section2) {
    const candidate2 = section2.candidateId && run.candidates[section2.candidateId];
    if (!candidate2) throw new Error(`Section ${section2.id} lacks a captured candidate.`);
    return candidate2;
  }
  latest(run, kind, section2, lensId, diagnosticKey) {
    return [...run.attempts].reverse().find((attempt2) => !attempt2.rejection && attempt2.task.kind === kind && (attempt2.state === "admitted" || attempt2.task.controlEpoch === run.controlEpoch) && attempt2.task.sectionId === section2?.id && attempt2.task.lens?.id === lensId && attempt2.task.inputContractVersion === (section2?.inputContractVersion ?? run.inputContractVersion) && attempt2.task.input.phase === (section2?.stage ?? run.stage) && (["implementer", "planner", "plan-review-a", "plan-review-b"].includes(kind) || attempt2.task.candidateId === (section2?.candidateId ?? run.currentCandidateId)) && (diagnosticKey === void 0 || attempt2.task.input.diagnosticKey === diagnosticKey) && (kind !== "plan-review-a" && kind !== "plan-review-b" || attempt2.task.input.planRevision === run.planRevision));
  }
  async queueActor(run, kind, input, section2, lens2) {
    const candidateId = section2?.candidateId ?? run.currentCandidateId;
    const candidate2 = candidateId ? run.candidates[candidateId] : void 0;
    const task2 = {
      id: this.id(),
      runId: run.id,
      kind,
      inputContractVersion: section2?.inputContractVersion ?? run.inputContractVersion,
      controlEpoch: run.controlEpoch,
      workspace: kind === "implementer" || !candidate2 ? run.workspace : { ...run.workspace, path: candidate2.workspacePath },
      input: JSON.parse(JSON.stringify(input)),
      outputSchema: outputSchemaFor(kind),
      timeoutMs: run.policy.actorTimeoutMs,
      ...section2 ? { sectionId: section2.id } : {},
      ...lens2 ? { lens: lens2 } : {},
      ...candidateId ? { candidateId } : {},
      ...kind === "implementer" && section2 && this.sectionPlan(run, section2).implementation === "large" && run.policy.largeImplementerRoute ? { route: run.policy.largeImplementerRoute } : run.policy.routes[kind] ? { route: run.policy.routes[kind] } : {}
    };
    const previousInfrastructureFailures = run.attempts.filter((entry) => entry.task.kind === kind && entry.task.sectionId === section2?.id && entry.task.lens?.id === lens2?.id && entry.task.inputContractVersion === task2.inputContractVersion && entry.task.input.phase === task2.input.phase && entry.task.candidateId === task2.candidateId && (entry.outcome?.status === "failed" || entry.rejection?.startsWith("Invalid role result:"))).length;
    await this.change(run.id, (draft) => {
      if (draft.status !== "running" || draft.controlEpoch !== run.controlEpoch) return;
      draft.attempts.push({ id: task2.id, task: task2, state: "intent", createdAt: this.now(), infrastructureRetries: previousInfrastructureFailures });
      this.event(draft, "execution-intent", `${kind} execution intent persisted.`, { attemptId: task2.id, ...section2 ? { sectionId: section2.id } : {} });
    });
    this.schedule(run.id);
    return true;
  }
  launchActor(runId, attempt2) {
    const active = { runId, abort: new AbortController() };
    this.activeActors.set(attempt2.id, active);
    active.done = (async () => {
      try {
        const before = await this.status(runId);
        if (before.status !== "running" || before.controlEpoch !== attempt2.task.controlEpoch) return;
        const authorized = await this.change(runId, (run) => {
          if (run.status !== "running" || run.controlEpoch !== attempt2.task.controlEpoch || active.abort.signal.aborted) return;
          const record = run.attempts.find((value) => value.id === attempt2.id);
          record.state = "started";
          record.startedAt = this.now();
        });
        if (authorized.status !== "running" || authorized.controlEpoch !== attempt2.task.controlEpoch || active.abort.signal.aborted) return;
        let timedOut = false;
        const interrupted = new Promise((resolve) => {
          const onAbort = () => resolve({ status: timedOut ? "failed" : "cancelled", error: timedOut ? "Actor exceeded its bounded execution timeout." : "Execution stopped by task control.", identity: { transport: "dsh-native", ...active.handle ? { sessionId: active.handle.id } : {} } });
          active.abort.signal.addEventListener("abort", onAbort, { once: true });
          if (active.abort.signal.aborted) onAbort();
          active.timer = setTimeout(() => {
            timedOut = true;
            active.abort.abort("Actor execution timed out.");
            void active.handle?.dispose().catch(() => void 0);
          }, attempt2.task.timeoutMs);
        });
        const starting = this.actors.start(attempt2.task, active.abort.signal).then(async (handle2) => {
          if (active.abort.signal.aborted) {
            await handle2.dispose();
            return void 0;
          }
          return handle2;
        });
        active.startup = starting;
        const handle = await Promise.race([starting, interrupted.then(() => void 0)]);
        if (!handle) {
          await this.finishAttempt(runId, attempt2.id, await interrupted);
          return;
        }
        active.handle = handle;
        await this.change(runId, (run) => {
          run.attempts.find((value) => value.id === attempt2.id).actorId = handle.id;
        });
        if (active.abort.signal.aborted) await handle.dispose();
        const result = await Promise.race([handle.result, interrupted]);
        await this.finishAttempt(runId, attempt2.id, result);
      } catch (error) {
        await this.finishAttempt(runId, attempt2.id, {
          status: active.abort.signal.aborted ? "cancelled" : "failed",
          error: message(error),
          identity: { transport: "dsh-native" }
        });
      } finally {
        if (active.timer) clearTimeout(active.timer);
        if (active.startup) await active.startup.catch(() => void 0);
        if (active.handle) await active.handle.dispose().catch(() => void 0);
        this.activeActors.delete(attempt2.id);
        await this.finishStop(runId);
        this.schedule(runId);
      }
    })();
  }
  async finishAttempt(runId, attemptId, outcome) {
    await this.change(runId, (run) => {
      const attempt2 = run.attempts.find((entry) => entry.id === attemptId);
      if (!attempt2 || attempt2.state === "admitted" || attempt2.state === "terminal") return;
      attempt2.state = "terminal";
      attempt2.endedAt = this.now();
      attempt2.outcome = outcome;
      this.event(run, "execution-terminal", `${attempt2.task.kind} reported ${outcome.status}.`, { attemptId });
    });
    this.schedule(runId);
  }
  async admit(run, attempt2) {
    const task2 = attempt2.task;
    const section2 = task2.sectionId ? run.sections[task2.sectionId] : void 0;
    const currentVersion = section2?.inputContractVersion ?? run.inputContractVersion;
    const phase = section2?.stage ?? run.stage;
    if (task2.controlEpoch !== run.controlEpoch || task2.inputContractVersion !== currentVersion || task2.input.phase !== phase || task2.kind !== "implementer" && task2.candidateId && task2.candidateId !== (section2?.candidateId ?? run.currentCandidateId)) {
      await this.change(run.id, (draft) => {
        draft.attempts.find((entry) => entry.id === attempt2.id).rejection = "Result belongs to an obsolete input contract or candidate; preserved as historical fact.";
      });
      return;
    }
    if (attempt2.outcome?.status !== "completed") {
      await this.change(run.id, (draft) => {
        draft.attempts.find((entry) => entry.id === attempt2.id).rejection = attempt2.outcome?.error ?? "Execution did not complete.";
      });
      if (task2.kind !== "implementer" && attempt2.outcome?.status === "failed" && attempt2.infrastructureRetries < run.policy.maxInfrastructureRetries) {
        await this.change(run.id, (draft) => {
          this.event(draft, "infrastructure-retry", `Retrying the same ${task2.kind} route after an execution failure; semantic repair budget unchanged.`, { attemptId: attempt2.id });
        });
        return;
      }
      await this.block(run.id, `${task2.kind} did not complete: ${attempt2.outcome?.error ?? attempt2.outcome?.status ?? "unknown"}. No semantic repair budget was consumed.`, task2.kind === "implementer" ? "recovery" : "infrastructure", section2?.id);
      return;
    }
    let output;
    try {
      output = parseActorOutput(task2.kind, attempt2.outcome.output);
    } catch (error) {
      await this.change(run.id, (draft) => {
        draft.attempts.find((entry) => entry.id === attempt2.id).rejection = `Invalid role result: ${message(error)}`;
      });
      if (task2.kind !== "implementer" && attempt2.infrastructureRetries < run.policy.maxInfrastructureRetries) {
        await this.change(run.id, (draft) => {
          this.event(draft, "infrastructure-retry", `Retrying invalid ${task2.kind} result within the configured infrastructure budget.`, { attemptId: attempt2.id });
        });
        return;
      }
      await this.block(run.id, `Invalid ${task2.kind} result: ${message(error)}`, task2.kind === "implementer" ? "recovery" : "infrastructure", section2?.id);
      return;
    }
    await this.change(run.id, (draft) => {
      const currentSection = task2.sectionId ? draft.sections[task2.sectionId] : void 0;
      if (draft.status !== "running" || task2.controlEpoch !== draft.controlEpoch || task2.inputContractVersion !== (currentSection?.inputContractVersion ?? draft.inputContractVersion) || task2.input.phase !== (currentSection?.stage ?? draft.stage)) return;
      const record = draft.attempts.find((entry) => entry.id === attempt2.id);
      record.state = "admitted";
      record.admittedOutput = output;
      if (["reviewer-a", "reviewer-b", "closure-reviewer"].includes(task2.kind)) {
        const state = draft.sections[task2.sectionId];
        const evidence = {
          id: `review:${attempt2.id}`,
          attemptId: attempt2.id,
          candidateId: task2.candidateId,
          sectionId: state.id,
          stage: task2.kind === "reviewer-a" ? "a" : task2.kind === "reviewer-b" ? "b" : "closure",
          lensId: task2.lens?.id ?? (task2.kind === "reviewer-b" ? "B" : "CLOSURE"),
          output,
          valid: true
        };
        draft.reviews.push(evidence);
        state.reviewIds.push(evidence.id);
      }
      if (["adjudicator", "feature-verifier", "diagnostician"].includes(task2.kind)) {
        const evidence = { id: `decision:${attempt2.id}`, attemptId: attempt2.id, ...task2.sectionId ? { sectionId: task2.sectionId } : {}, ...task2.candidateId ? { candidateId: task2.candidateId } : {}, output, createdAt: this.now() };
        draft.decisions.push(evidence);
        if (task2.sectionId) draft.sections[task2.sectionId].decisionIds.push(evidence.id);
      }
      this.event(draft, "result-admitted", `${task2.kind} result admitted to its exact input contract.`, { attemptId: attempt2.id });
    });
  }
  completedOperation(run, scopeKey) {
    return [...run.operations].reverse().find((operation) => operation.scopeKey === scopeKey && operation.state === "completed");
  }
  async operation(run, kind, scopeKey, sectionId, execute, apply, candidateId) {
    const existing = [...run.operations].reverse().find((operation2) => operation2.scopeKey === scopeKey && !operation2.error);
    if (existing?.state === "completed") return false;
    if (existing?.state === "unknown") {
      await this.block(run.id, `${kind} has uncertain side effects and requires reconciliation.`, "recovery", sectionId);
      return false;
    }
    if (existing && this.activeOperations.has(existing.id)) return false;
    const operation = existing ?? {
      id: this.id(),
      kind,
      scopeKey,
      state: "intent",
      controlEpoch: run.controlEpoch,
      createdAt: this.now(),
      ...sectionId ? { sectionId } : {},
      ...candidateId ? { candidateId } : {}
    };
    if (!existing) await this.change(run.id, (draft) => {
      if (draft.status === "running" && draft.controlEpoch === run.controlEpoch) draft.operations.push(operation);
    });
    const active = { runId: run.id, abort: new AbortController() };
    this.activeOperations.set(operation.id, active);
    active.done = (async () => {
      try {
        const latest = await this.status(run.id);
        if (latest.status !== "running" || latest.controlEpoch !== operation.controlEpoch) return;
        const authorized = await this.change(run.id, (draft) => {
          if (draft.status !== "running" || draft.controlEpoch !== operation.controlEpoch || active.abort.signal.aborted) return;
          draft.operations.find((entry) => entry.id === operation.id).state = "started";
        });
        if (authorized.status !== "running" || authorized.controlEpoch !== operation.controlEpoch || active.abort.signal.aborted) return;
        const result = await execute(latest, active.abort.signal);
        await this.change(run.id, (draft) => {
          const record = draft.operations.find((entry) => entry.id === operation.id);
          record.endedAt = this.now();
          if (draft.status !== "running" || draft.controlEpoch !== operation.controlEpoch) {
            record.state = "unknown";
            record.error = "Operation completed after control changed; actual side effects require reconciliation.";
            return;
          }
          apply(draft, result);
          record.state = "completed";
        });
      } catch (error) {
        await this.change(run.id, (draft) => {
          const record = draft.operations.find((entry) => entry.id === operation.id);
          record.state = "unknown";
          record.error = message(error);
          record.endedAt = this.now();
        });
        await this.block(run.id, `${kind} failed or was interrupted: ${message(error)}`, "recovery", sectionId);
      } finally {
        this.activeOperations.delete(operation.id);
        await this.finishStop(run.id);
        this.schedule(run.id);
      }
    })();
    return false;
  }
  async block(id2, reason, kind, sectionId) {
    await this.change(id2, (run) => {
      if (["paused", "pausing", "cancelled", "completed"].includes(run.status)) return;
      run.status = kind === "semantic" || kind === "budget" ? "waiting-user" : "blocked";
      run.blockedReason = reason;
      run.pendingDecision = { id: this.id(), question: reason, context: `Run ${run.id}, ${sectionId ? `Section ${sectionId}` : run.stage}`, kind, ...sectionId ? { sectionId } : {}, createdAt: this.now() };
      this.event(run, "blocked", reason, sectionId ? { sectionId } : {});
    });
  }
  async stopLocal(runId) {
    const actors = [...this.activeActors.entries()].filter(([, active]) => active.runId === runId);
    for (const [, active] of actors) active.abort.abort("Task control stopped.");
    for (const active of this.activeOperations.values()) if (active.runId === runId) active.abort.abort("Task control stopped.");
    const stopping = Promise.allSettled(actors.map(async ([id2, active]) => {
      await active.handle?.dispose();
      await this.finishAttempt(runId, id2, { status: "cancelled", error: "Execution stopped by task control.", identity: { transport: "dsh-native", ...active.handle ? { sessionId: active.handle.id } : {} } });
    }));
    const settled = await settlesWithin(Promise.allSettled([
      stopping,
      ...actors.map(([, active]) => active.done),
      ...[...this.activeOperations.values()].filter((active) => active.runId === runId).map((active) => active.done)
    ]), this.cleanupTimeoutMs);
    if (!settled) {
      await this.change(runId, (run) => {
        for (const attempt2 of run.attempts) {
          if (this.activeActors.has(attempt2.id) && attempt2.state !== "admitted") {
            attempt2.state = "unknown";
            attempt2.rejection = "Stop requested but runtime termination is not yet confirmed; workspace remains reserved.";
          }
        }
        for (const operation of run.operations) if (this.activeOperations.has(operation.id)) {
          operation.state = "unknown";
          operation.error = "Operation termination is not confirmed; workspace remains reserved.";
        }
      });
    }
    return settled;
  }
  async finishStop(runId) {
    if ([...this.activeActors.values(), ...this.activeOperations.values()].some((active) => active.runId === runId)) return;
    const run = await this.status(runId);
    if (run.status !== "pausing") return;
    await this.change(runId, (draft) => {
      if (draft.status === "pausing") {
        draft.status = "paused";
        this.event(draft, "paused", "All active executions stopped; recovery checks still apply to uncertain side effects.");
      }
    });
  }
};
function message(error) {
  return error instanceof Error ? error.message : String(error);
}
async function settlesWithin(work, milliseconds) {
  let timer;
  try {
    return await Promise.race([work.then(() => true, () => true), new Promise((resolve) => {
      timer = setTimeout(() => resolve(false), milliseconds);
    })]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
export {
  CORE_VERSION,
  WorkflowController as DevelopmentController,
  POLICY_VERSION,
  WorkflowController,
  actorOutputSchemas,
  adjudicationSchema,
  assertUnique,
  createPolicy,
  diagnosticSchema,
  featureVerificationSchema,
  findingSchema,
  implementationSchema,
  outputSchemaFor,
  parseActorOutput,
  planSchema,
  reviewSchema,
  runSchema,
  selectionSchema,
  validatePlan
};
//# sourceMappingURL=core.js.map
