/** Host-independent, persisted contracts for a native development run. */
export declare const CORE_VERSION: "1.1.0";
export declare const POLICY_VERSION: "sfd-native-2";
export type ActorKind = 'planner' | 'plan-review-a' | 'plan-review-b' | 'implementer' | 'review-selector' | 'reviewer-a' | 'reviewer-b' | 'adjudicator' | 'closure-reviewer' | 'feature-verifier' | 'diagnostician';
export type WorkflowIntent = 'execute' | 'plan-handoff';
export type RunStatus = 'draft' | 'running' | 'pausing' | 'paused' | 'blocked' | 'waiting-user' | 'cancelled' | 'completed';
export type RunStage = 'planning' | 'plan-review-a' | 'plan-review-b' | 'sections' | 'feature-verification' | 'delivery' | 'done';
export type SectionStage = 'pending' | 'subsection-implementing' | 'subsection-review' | 'subsection-adjudicating' | 'implementing' | 'reroute' | 'review-selection' | 'review-a' | 'adjudicating-a' | 'repairing' | 'closure' | 'review-b' | 'adjudicating-b' | 'accepted' | 'integrated';
export type RouteTransport = 'dsh-native' | 'external-subagent/zcode' | 'external-subagent/codex';
export interface ActorRoute {
    preset: string;
    model?: string;
    provider?: string;
    effort?: string;
    transport?: RouteTransport;
}
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
    /** Original SFD impl_large: same native writer preset, independently configured model route. */
    largeImplementerRoute?: ActorRoute;
}
export interface CheckSpec {
    id: string;
    command: string[];
    cwd?: string;
    timeoutMs?: number;
    required: boolean;
}
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
    id: string;
    title: string;
    outcome: string;
    acceptanceCriteria: string[];
    sectionIds: string[];
    checks: CheckSpec[];
}
export interface SubsectionPlan {
    id: string;
    objective: string;
    acceptanceCriteria: string[];
    writeScope: string[];
    safeIntermediateState: string;
    consumer: string;
    checks: CheckSpec[];
    implementation?: 'standard' | 'large';
}
export interface SubsectionCheckpoint {
    subsectionId: string;
    candidateId: string;
    reviewId: string;
    checkIds: string[];
    priorCandidateId?: string;
}
export interface SimplificationProposal {
    mechanism: string;
    simplerPath: string;
    preservedInvariants: string[];
    preservationOracle: string;
    affectedConsumers: string[];
}
export interface SimplificationAction extends SimplificationProposal {
    id: string;
    originReviewId: string;
    proposedCandidateId: string;
    status: 'proposed' | 'deferred' | 'rejected' | 'batched' | 'preserved';
    closureCandidateId?: string;
}
export interface SectionPlan {
    id: string;
    title: string;
    featureIds: string[];
    objective: string;
    dependencies: string[];
    writeScope: string[];
    acceptanceCriteria: string[];
    implementation: 'standard' | 'large';
    checks: CheckSpec[];
    subsections: SubsectionPlan[];
    /** Only a diagnosed, original-lineage structural hard-cap recovery may use this field. */
    replacesSectionId?: string;
}
export interface DevelopmentPlan {
    title: string;
    features: FeaturePlan[];
    sections: SectionPlan[];
    assumptions: string[];
}
export interface WorkspaceInfo {
    path: string;
    branch: string;
    baseCommit: string;
    initialTreeHash?: string;
    /** A prepared run must use a dedicated non-default branch. */
    prepared?: boolean;
}
export interface Candidate {
    id: string;
    capturedAt: string;
    workspacePath: string;
    head: string;
    treeHash: string;
    diff: string;
    changedFiles: string[];
    /** Exact current parent Section delta, not the cumulative Feature diff. */
    sectionDelta?: {
        sectionId: string;
        baseTreeHash: string;
        diff: string;
        changedFiles: string[];
    };
}
export interface CommitEvidence {
    commit: string;
    candidateId: string;
    branch: string;
    createdAt: string;
    message: string;
}
export interface DeliveryEvidence {
    mode: 'worktree' | 'commit';
    candidateId: string;
    path: string;
    branch: string;
    createdAt: string;
    commit?: string;
}
export interface WorkspaceRecovery {
    safe: boolean;
    candidate?: Candidate;
    workspace?: WorkspaceInfo;
    commit?: CommitEvidence;
    reason?: string;
}
export interface Finding {
    id: string;
    title: string;
    body: string;
    severity: 'critical' | 'major' | 'minor';
    invariant: string;
    location?: string;
    classification?: 'PLAN_BLOCKER' | 'PLAN_SCOPE_EXPANSION' | 'OWNER_DECISION' | 'PLAN_NIT';
}
export interface ClosureFinding {
    findingId: string;
    status: 'verified-closed' | 'still-open' | 'regression' | 'insufficient-evidence';
    evidence: string;
}
export type AdvisorTrigger = 'ADV-01' | 'ADV-02' | 'ADV-03' | 'ADV-04' | 'ADV-05' | 'ADV-06';
export type RecoveryClassification = 'CONTINUE_CURRENT' | 'SIMPLIFY_CURRENT' | 'REPAIR_EVIDENCE' | 'SPLIT_REMAINING' | 'REBOUND_OWNER' | 'RESTART_FROM_BASE';
export interface ReviewOutput {
    verdict: 'clean' | 'findings' | 'incomplete';
    summary: string;
    coverage: string[];
    limitations: string[];
    findings: Finding[];
    closures?: ClosureFinding[];
    simplifications?: SimplificationProposal[];
    simplificationClosures?: {
        actionId: string;
        status: 'preserved' | 'regressed' | 'insufficient-evidence';
        evidence: string;
    }[];
    advisorTrigger?: AdvisorTrigger;
    /** PLAN_DELTA carries source-qualified coverage from its own earlier logical slot. */
    planEvidenceReuse?: {
        attemptId: string;
        reason: string;
    }[];
}
export interface PlanOutput {
    plan: DevelopmentPlan;
    explanation: string;
    advisorTrigger?: AdvisorTrigger;
}
export interface ImplementationOutput {
    summary: string;
    completedCriteria: string[];
    remainingWork: string[];
    changedInterfaces: string[];
}
export interface Lens {
    id: string;
    name: string;
    focus: string;
}
export interface ReviewSelectionOutput {
    lenses: Lens[];
    rationale: string;
    invalidatedLensIds?: string[];
    invalidationReason?: string;
}
export interface FindingDisposition {
    findingId: string;
    decision: 'fix' | 'reject' | 'needs-user';
    reason: string;
}
export interface AdjudicationOutput {
    resolution: 'accept' | 'repair' | 'more-review' | 'needs-user';
    summary: string;
    coverageSufficient: boolean;
    dispositions: FindingDisposition[];
    repairInstructions: string;
    /** Only an admitted semantic repair increments the original Section lineage. */
    material: boolean;
    invalidatedSectionIds: string[];
    missingCoverage: string[];
    evidenceReuse: {
        evidenceId: string;
        reason: string;
    }[];
    simplificationDispositions?: {
        actionId: string;
        decision: 'batch' | 'defer' | 'reject';
        reason: string;
    }[];
    advisorTrigger?: AdvisorTrigger;
    question?: string;
}
export interface FeatureVerificationOutput {
    verdict: 'accepted' | 'repair' | 'needs-user' | 'integration-review';
    summary: string;
    /** One item for every actual business acceptance criterion, with evidence references. */
    criteria: {
        featureId: string;
        criterion: string;
        evidenceIds: string[];
        satisfied: boolean;
    }[];
    unprovenComposition?: {
        id: string;
        featureId: string;
        lens: string;
        boundary: string;
    }[];
    integrationDispositions?: {
        findingId: string;
        decision: 'fix' | 'reject';
        reason: string;
    }[];
    repairSectionIds: string[];
    repairInstructions: string;
    question?: string;
    advisorTrigger?: AdvisorTrigger;
}
export interface DiagnosticOutput {
    summary: string;
    recommendation: 'retry' | 'revise-plan' | 'needs-user';
    instructions: string;
    question?: string;
    recoveryClass?: RecoveryClassification;
    advisorTrigger?: AdvisorTrigger;
}
export type ActorOutput = PlanOutput | ReviewOutput | ImplementationOutput | ReviewSelectionOutput | AdjudicationOutput | FeatureVerificationOutput | DiagnosticOutput;
export interface ExecutionIdentity {
    requested?: ActorRoute;
    /** External admission is not an observed runtime model echo. */
    external?: {
        subagent: 'zcode' | 'codex';
        agentId: number;
        admittedModel?: string;
        admittedEffort?: string;
    };
    observed?: {
        provider?: string;
        model?: string;
        effort?: string;
        preset?: string;
    };
    transport: 'dsh-native' | 'external' | 'test';
    sessionId?: string;
}
export interface ActorTask {
    /** Effective writer tier frozen at dispatch: a Subsection can override its parent. */
    implementationTier?: 'standard' | 'large';
    id: string;
    runId: string;
    kind: ActorKind;
    sectionId?: string;
    featureId?: string;
    lens?: Lens;
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
    output?: unknown;
    error?: string;
    identity: ExecutionIdentity;
    artifactRefs?: string[];
}
export interface Attempt {
    id: string;
    task: ActorTask;
    state: 'intent' | 'started' | 'terminal' | 'admitted' | 'unknown';
    createdAt: string;
    startedAt?: string;
    endedAt?: string;
    actorId?: string;
    outcome?: ActorOutcome;
    admittedOutput?: ActorOutput;
    rejection?: string;
    infrastructureRetries: number;
    recoveryDecisionId?: string;
    reconciledAt?: string;
}
export interface ReviewEvidence {
    id: string;
    attemptId: string;
    candidateId: string;
    sectionId: string;
    stage: 'a' | 'closure' | 'b';
    lensId: string;
    output: ReviewOutput;
    valid: boolean;
}
export interface IntegrationEvidence {
    id: string;
    attemptId: string;
    candidateId: string;
    featureId: string;
    gapId: string;
    output: ReviewOutput;
}
export interface DecisionEvidence {
    id: string;
    attemptId: string;
    sectionId?: string;
    candidateId?: string;
    output: AdjudicationOutput | FeatureVerificationOutput | DiagnosticOutput;
    createdAt: string;
}
export interface SectionState {
    id: string;
    stage: SectionStage;
    inputContractVersion: number;
    /** Cumulative admitted repair waves. Retain the historical field name for persisted compatibility. */
    lineageId: string;
    materialRepairWaves: number;
    diagnosticCount: number;
    candidateId?: string;
    /** Frozen source just before this parent Section first became executable. */
    sectionBaseTreeHash?: string;
    unfinishedContinuation?: {
        phase: 'implementing' | 'subsection-implementing';
        subsectionId?: string;
        treeHash: string;
        remainingWork: string;
        repeats: number;
    };
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
    closureFindingIds?: string[];
    freshRepairLensIds?: string[];
    subsectionIndex?: number;
    subsectionCheckpoints?: SubsectionCheckpoint[];
    subsectionCurrentChecks?: CheckEvidence[];
    subsectionChecks?: CheckEvidence[];
    subsectionRiskLenses?: Lens[];
    subsectionFindingIds?: string[];
    simplifications?: SimplificationAction[];
    activeSimplificationIds?: string[];
    recovery?: {
        classification: RecoveryClassification;
        atMaterialWaves: number;
        extraWaveLimit: number;
        diagnosisAttemptId: string;
        structuralPending?: boolean;
    };
}
export interface Operation {
    id: string;
    kind: 'prepare' | 'capture' | 'checks' | 'commit' | 'integrate';
    state: 'intent' | 'started' | 'completed' | 'unknown';
    scopeKey: string;
    sectionId?: string;
    candidateId?: string;
    controlEpoch: number;
    createdAt: string;
    endedAt?: string;
    error?: string;
    recoveryDecisionId?: string;
    reconciledAt?: string;
}
export interface UserDecision {
    id: string;
    question: string;
    context: string;
    kind: 'semantic' | 'recovery' | 'budget' | 'infrastructure' | 'advisor';
    advisorTrigger?: AdvisorTrigger;
    advisorResult?: string;
    advisorAdoption?: 'accept' | 'reject' | 'clarify';
    sectionId?: string;
    createdAt: string;
    answer?: string;
}
export interface RunEvent {
    id: string;
    at: string;
    type: string;
    message: string;
    attemptId?: string;
    sectionId?: string;
}
export interface DevelopmentRun {
    id: string;
    schemaVersion: 1;
    workflowVersion: string;
    /** Omitted in existing persisted Runs; execute remains the historical default. */
    intent?: WorkflowIntent;
    revision: number;
    controlEpoch: number;
    inputContractVersion: number;
    createdAt: string;
    updatedAt: string;
    goal: string;
    requirementsHistory: {
        version: number;
        goal: string;
        at: string;
    }[];
    workspace: WorkspaceInfo;
    policy: WorkflowPolicy;
    status: RunStatus;
    stage: RunStage;
    plan?: DevelopmentPlan;
    /** Only automatic (agent-tool) activation requires owner approval of its first plan. */
    initialPlanApprovalRequired?: boolean;
    initialPlanApprovalObtained?: boolean;
    planRevision: number;
    planRepairs: number;
    planRequirementsVersion?: number;
    planSilentRetirement?: {
        slot: 'plan-review-a';
        reportIds: string[];
        rationale: string;
    };
    retiredSections?: Record<string, {
        state: SectionState;
        contract: SectionPlan;
        requirementsVersion: number;
        retiredAt: string;
    }>;
    planFeedback: string[];
    sections: Record<string, SectionState>;
    activeSectionId?: string;
    candidates: Record<string, Candidate>;
    currentCandidateId?: string;
    attempts: Attempt[];
    operations: Operation[];
    reviews: ReviewEvidence[];
    decisions: DecisionEvidence[];
    featureChecks: CheckEvidence[];
    integrationGaps?: {
        id: string;
        featureId: string;
        lens: string;
        boundary: string;
        candidateId: string;
        reviewed?: boolean;
    }[];
    integrationReviews?: IntegrationEvidence[];
    featureVerificationAttemptId?: string;
    pendingDecision?: UserDecision;
    advisorCase?: {
        trigger: AdvisorTrigger;
        sectionId?: string;
        candidateId?: string;
        sourceAttemptId?: string;
        raisedAt: string;
        request: string;
        reportIds: string[];
        status: 'waiting-external' | 'waiting-human-decision' | 'adopted';
    };
    decisionHistory: UserDecision[];
    events: RunEvent[];
    commit?: CommitEvidence;
    delivery?: DeliveryEvidence;
    blockedReason?: string;
    diagnostic?: {
        reason: string;
        sectionId?: string;
        requestedAt: string;
    };
}
export type Run = DevelopmentRun;
export interface CreateRunInput {
    goal: string;
    workspacePath: string;
    intent?: WorkflowIntent;
    policy?: Partial<WorkflowPolicy>;
    requireInitialPlanApproval?: boolean;
}
export interface DecideInput {
    decisionId: string;
    answer: string;
    action?: 'continue' | 'retry' | 'replan' | 'cancel';
    advisorResult?: string;
    advisorAdoption?: 'accept' | 'reject' | 'clarify';
}
export interface RunSummary {
    id: string;
    goal: string;
    status: RunStatus;
    stage: RunStage;
    updatedAt: string;
}
