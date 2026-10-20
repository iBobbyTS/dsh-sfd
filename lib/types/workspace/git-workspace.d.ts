import type { WorkspacePort } from '../core/ports.js';
import type { Candidate, CheckEvidence, CheckSpec, CommitEvidence, DevelopmentRun, WorkspaceInfo, WorkspaceRecovery } from '../core/types.js';
import { type ProcessResult } from './process.js';
export interface CheckExecution {
    run: DevelopmentRun;
    spec: CheckSpec;
    cwd: string;
    signal?: AbortSignal;
    timeoutMs: number;
}
export type CheckExecutor = (execution: CheckExecution) => Promise<ProcessResult>;
export interface GitWorkspaceOptions {
    /** Optional persistent absolute directory; the default is inside the common Git directory. */
    stateRoot?: string;
    maxOutputBytes?: number;
    checkTimeoutMs?: number;
    /** Required for production checks: the Host adapter must enforce DSH permissions/sandbox. */
    executeCheck?: CheckExecutor;
}
/** Complete Git candidates and one explicit writer per Run. No source checkout mutations. */
export declare class GitWorkspace implements WorkspacePort {
    private readonly options;
    private readonly claims;
    private readonly preparing;
    constructor(options?: GitWorkspaceOptions);
    private git;
    inspect(path: string): Promise<WorkspaceInfo>;
    private rejectSubmodules;
    private paths;
    private claim;
    private writeJson;
    private tree;
    private snapshotCommit;
    prepare(run: DevelopmentRun): Promise<WorkspaceInfo>;
    private assertPrepared;
    private freeze;
    capture(run: DevelopmentRun, _sectionId?: string): Promise<Candidate>;
    check(run: DevelopmentRun, candidate: Candidate, specs: CheckSpec[], signal?: AbortSignal): Promise<CheckEvidence[]>;
    commit(run: DevelopmentRun, candidate: Candidate, message: string): Promise<CommitEvidence>;
    reconcile(run: DevelopmentRun): Promise<WorkspaceRecovery>;
    dispose(): Promise<void>;
}
