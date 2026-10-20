/** Host-independent, persisted contracts for a native development run. */
export const CORE_VERSION = '1.0.0' as const;
export const POLICY_VERSION = 'sfd-native-1' as const;

export type ActorKind =
  | 'planner' | 'plan-review-a' | 'plan-review-b' | 'implementer'
  | 'review-selector' | 'reviewer-a' | 'reviewer-b' | 'adjudicator'
  | 'closure-reviewer' | 'feature-verifier' | 'diagnostician';

export type RunStatus = 'draft' | 'running' | 'pausing' | 'paused' | 'blocked' | 'waiting-user' | 'cancelled' | 'completed';
export type RunStage = 'planning' | 'plan-review-a' | 'plan-review-b' | 'sections' | 'feature-verification' | 'delivery' | 'done';
export type SectionStage = 'pending' | 'implementing' | 'review-selection' | 'review-a' | 'adjudicating-a' | 'repairing' | 'closure' | 'review-b' | 'adjudicating-b' | 'accepted' | 'integrated';
export interface ActorRoute { preset: string; model?: string; provider?: string; effort?: string }
export interface WorkflowPolicy {
  version: string;
  actorTimeoutMs: number;
  maxParallelReviews: number;
  maxRepairWaves: number;
  maxPlanRepairs: number;
  maxDiagnostics: number;
  maxInfrastructureRetries: number;
  /** Explicit host authorization, never supplied by an actor result. */
  commit: boolean;
  routes: Partial<Record<ActorKind, ActorRoute>>;
}

export interface CheckSpec { id: string; command: string[]; cwd?: string; timeoutMs?: number; required: boolean }
export interface CheckEvidence {
  id: string;
  candidateId: string;
  specId: string;
  status: 'passed' | 'failed' | 'cancelled' | 'unknown';
  exitCode: number | null;
  startedAt: string;
  endedAt: string;
  output: string;
  artifactRefs?: string[];
}
export interface FeaturePlan {
  id: string; title: string; outcome: string;
  acceptanceCriteria: string[]; sectionIds: string[]; checks: CheckSpec[];
}
export interface SubsectionPlan { id: string; objective: string; acceptanceCriteria: string[] }
export interface SectionPlan {
  id: string; title: string; featureIds: string[]; objective: string;
  dependencies: string[]; writeScope: string[]; acceptanceCriteria: string[];
  implementation: 'standard' | 'large'; checks: CheckSpec[]; subsections: SubsectionPlan[];
}
export interface DevelopmentPlan { title: string; features: FeaturePlan[]; sections: SectionPlan[]; assumptions: string[] }
export interface WorkspaceInfo {
  path: string; branch: string; baseCommit: string;
  /** A prepared run must use a dedicated non-default branch. */
  prepared?: boolean;
}
export interface Candidate {
  id: string; capturedAt: string; workspacePath: string;
  head: string; treeHash: string; diff: string; changedFiles: string[];
}
export interface CommitEvidence { commit: string; candidateId: string; branch: string; createdAt: string; message: string }
export interface DeliveryEvidence { mode: 'worktree' | 'commit'; candidateId: string; path: string; branch: string; createdAt: string; commit?: string }
export interface WorkspaceRecovery { safe: boolean; candidate?: Candidate; workspace?: WorkspaceInfo; commit?: CommitEvidence; reason?: string }

export interface Finding {
  id: string; title: string; body: string;
  severity: 'critical' | 'major' | 'minor';
  invariant: string; location?: string;
}
export interface ReviewOutput {
  verdict: 'clean' | 'findings' | 'incomplete';
  summary: string; coverage: string[]; limitations: string[]; findings: Finding[];
}
export interface PlanOutput { plan: DevelopmentPlan; explanation: string }
export interface ImplementationOutput { summary: string; completedCriteria: string[]; remainingWork: string[]; changedInterfaces: string[] }
export interface Lens { id: string; name: string; focus: string }
export interface ReviewSelectionOutput { lenses: Lens[]; rationale: string }
export interface FindingDisposition { findingId: string; decision: 'fix' | 'reject' | 'needs-user'; reason: string }
export interface AdjudicationOutput {
  resolution: 'accept' | 'repair' | 'more-review' | 'needs-user';
  summary: string; coverageSufficient: boolean;
  dispositions: FindingDisposition[];
  repairInstructions: string;
  /** Only an admitted semantic repair increments the original Section lineage. */
  material: boolean;
  invalidatedSectionIds: string[];
  missingCoverage: string[];
  evidenceReuse: { evidenceId: string; reason: string }[];
  question?: string;
}
export interface FeatureVerificationOutput {
  verdict: 'accepted' | 'repair' | 'needs-user'; summary: string;
  /** One item for every actual business acceptance criterion, with evidence references. */
  criteria: { featureId: string; criterion: string; evidenceIds: string[]; satisfied: boolean }[];
  repairSectionIds: string[]; repairInstructions: string; question?: string;
}
export interface DiagnosticOutput {
  summary: string; recommendation: 'retry' | 'revise-plan' | 'needs-user';
  instructions: string; question?: string;
}
export type ActorOutput = PlanOutput | ReviewOutput | ImplementationOutput | ReviewSelectionOutput | AdjudicationOutput | FeatureVerificationOutput | DiagnosticOutput;

export interface ExecutionIdentity {
  requested?: ActorRoute;
  observed?: { provider?: string; model?: string; effort?: string; preset?: string };
  transport: 'dsh-native' | 'external' | 'test';
  sessionId?: string;
}
export interface ActorTask {
  id: string; runId: string; kind: ActorKind;
  sectionId?: string; featureId?: string; lens?: Lens;
  /** Version of semantic input; independent of Run.revision. */
  inputContractVersion: number;
  candidateId?: string;
  controlEpoch: number;
  route?: ActorRoute;
  workspace: WorkspaceInfo;
  input: Record<string, unknown>;
  /** Persisted schema contract, used by the native structured-output tool. */
  outputSchema: Record<string, unknown>;
  timeoutMs: number;
}
export interface ActorOutcome {
  status: 'completed' | 'failed' | 'cancelled';
  output?: unknown; error?: string;
  identity: ExecutionIdentity;
  artifactRefs?: string[];
}
export interface Attempt {
  id: string; task: ActorTask;
  state: 'intent' | 'started' | 'terminal' | 'admitted' | 'unknown';
  createdAt: string; startedAt?: string; endedAt?: string;
  actorId?: string;
  outcome?: ActorOutcome;
  admittedOutput?: ActorOutput;
  rejection?: string;
  infrastructureRetries: number;
  recoveryDecisionId?: string;
  reconciledAt?: string;
}
export interface ReviewEvidence {
  id: string; attemptId: string; candidateId: string;
  sectionId: string; stage: 'a' | 'closure' | 'b';
  lensId: string; output: ReviewOutput;
  valid: boolean;
}
export interface DecisionEvidence {
  id: string; attemptId: string; sectionId?: string;
  candidateId?: string; output: AdjudicationOutput | FeatureVerificationOutput | DiagnosticOutput;
  createdAt: string;
}
export interface SectionState {
  id: string; stage: SectionStage; inputContractVersion: number;
  /** Never reset by a candidate change, replan, or child subdivision. */
  lineageId: string; materialRepairWaves: number; diagnosticCount: number;
  candidateId?: string;
  lenses: Lens[];
  checks: CheckEvidence[];
  reviewIds: string[];
  decisionIds: string[];
  repairInstructions?: string;
  repairOrigin?: 'a' | 'b' | 'feature';
  acceptedCandidateId?: string;
  integratedCandidateId?: string;
  aAcceptedCandidateId?: string;
  aCoverageEvidenceIds: string[];
}
export interface Operation {
  id: string;
  kind: 'prepare' | 'capture' | 'checks' | 'commit' | 'integrate';
  state: 'intent' | 'started' | 'completed' | 'unknown';
  scopeKey: string;
  sectionId?: string;
  candidateId?: string;
  controlEpoch: number;
  createdAt: string; endedAt?: string; error?: string;
  recoveryDecisionId?: string;
  reconciledAt?: string;
}
export interface UserDecision {
  id: string; question: string; context: string;
  kind: 'semantic' | 'recovery' | 'budget' | 'infrastructure';
  sectionId?: string;
  createdAt: string;
  answer?: string;
}
export interface RunEvent { id: string; at: string; type: string; message: string; attemptId?: string; sectionId?: string }
export interface DevelopmentRun {
  id: string; schemaVersion: 1; workflowVersion: string;
  revision: number; controlEpoch: number; inputContractVersion: number;
  createdAt: string; updatedAt: string;
  goal: string; requirementsHistory: { version: number; goal: string; at: string }[];
  workspace: WorkspaceInfo; policy: WorkflowPolicy;
  status: RunStatus; stage: RunStage;
  plan?: DevelopmentPlan;
  planRevision: number; planRepairs: number;
  planRequirementsVersion?: number;
  retiredSections?: Record<string, { state: SectionState; contract: SectionPlan; requirementsVersion: number; retiredAt: string }>;
  planFeedback: string[];
  sections: Record<string, SectionState>;
  activeSectionId?: string;
  candidates: Record<string, Candidate>;
  currentCandidateId?: string;
  attempts: Attempt[]; operations: Operation[];
  reviews: ReviewEvidence[]; decisions: DecisionEvidence[];
  featureChecks: CheckEvidence[];
  featureVerificationAttemptId?: string;
  pendingDecision?: UserDecision;
  decisionHistory: UserDecision[];
  events: RunEvent[];
  commit?: CommitEvidence;
  delivery?: DeliveryEvidence;
  blockedReason?: string;
  diagnostic?: { reason: string; sectionId?: string; requestedAt: string };
}
export type Run = DevelopmentRun;
export interface CreateRunInput { goal: string; workspacePath: string; policy?: Partial<WorkflowPolicy> }
export interface DecideInput { decisionId: string; answer: string; action?: 'continue' | 'retry' | 'replan' | 'cancel' }
export interface RunSummary { id: string; goal: string; status: RunStatus; stage: RunStage; updatedAt: string }
