import type { DevelopmentRun } from '../core/types.js';
import type { CreateRequest, DecideRequest, DevelopmentWorkflowRemote } from '../dsh/remote-contract.js';
export type RunAction = 'start' | 'pause' | 'resume' | 'cancel' | 'recover';
export interface DevelopmentViewState {
    readonly sessionId: string | undefined;
    readonly selectedRunId: string | undefined;
    readonly runs: readonly DevelopmentRun[];
    readonly loading: boolean;
    readonly busy: boolean;
    readonly error: string | undefined;
    readonly readError: string | undefined;
    readonly refreshedAt: string | undefined;
}
/** Read-only observation lifetime is independent of the Host Run's lifetime. */
export declare class DevelopmentClientController {
    private readonly remote;
    private readonly pollMs;
    private snapshot;
    private readonly listeners;
    private epoch;
    private mutationEpoch;
    private read;
    private readAgain;
    private timer;
    private disposed;
    constructor(remote: DevelopmentWorkflowRemote, pollMs?: number);
    readonly getSnapshot: () => DevelopmentViewState;
    readonly subscribe: (listener: () => void) => (() => void);
    private publish;
    private clearTimer;
    private schedule;
    /** Changing the visible owner does not reassign or mutate a Run. */
    setSession(sessionId: string | undefined): void;
    selectRun(runId: string): void;
    /** Coalesce reads and fence responses across owner changes and admitted mutations. */
    refresh(): Promise<void>;
    private owner;
    private request;
    private mutate;
    create(input: Omit<CreateRequest, 'sessionId'>): Promise<boolean>;
    act(action: RunAction, runId: string): Promise<boolean>;
    decide(runId: string, decisionId: string, answer: string, action: DecideRequest['action']): Promise<boolean>;
    revise(runId: string, goal: string): Promise<boolean>;
    dispose(): void;
}
