import type { ActorOutcome, ActorTask, Candidate, CheckEvidence, CheckSpec, CommitEvidence, DevelopmentRun, WorkspaceInfo, WorkspaceRecovery, AdvisorNotice, AdvisorPackage, AdvisorNotification } from './types.js';

/** update serializes a single Run and persists it before returning. Its callback is pure. */
export interface RunStore {
  list(): Promise<DevelopmentRun[]>;
  get(id: string): Promise<DevelopmentRun | undefined>;
  create(run: DevelopmentRun): Promise<void>;
  update(id: string, transform: (run: DevelopmentRun) => DevelopmentRun): Promise<DevelopmentRun>;
}
export interface ActorHandle {
  id: string;
  result: Promise<ActorOutcome>;
  /** Cancels/stops this activation and releases its resources, idempotently. */
  dispose(): Promise<void>;
}
export interface ActorRunner { start(task: ActorTask, signal: AbortSignal): Promise<ActorHandle> }
export interface WorkspacePort {
  inspect(path: string): Promise<WorkspaceInfo>;
  prepare(run: DevelopmentRun): Promise<WorkspaceInfo>;
  capture(run: DevelopmentRun, sectionId?: string): Promise<Candidate>;
  check(run: DevelopmentRun, candidate: Candidate, specs: CheckSpec[], signal?: AbortSignal): Promise<CheckEvidence[]>;
  commit(run: DevelopmentRun, candidate: Candidate, message: string): Promise<CommitEvidence>;
  reconcile(run: DevelopmentRun): Promise<WorkspaceRecovery>;
  dispose?(): Promise<void>;
}

/** Only the Host may produce and send Advisor handoffs. */
export interface AdvisorPort {
  pack(run: DevelopmentRun): Promise<AdvisorPackage>;
  notify(run: DevelopmentRun, pack: AdvisorPackage, fields: AdvisorNotice): Promise<AdvisorNotification>;
  saveHumanResponse(run: DevelopmentRun, advice: string, adoption: 'accept' | 'reject' | 'clarify', humanAnswer: string, action?: string): Promise<void>;
}
