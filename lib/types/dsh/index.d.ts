import type { Context } from '@deepseek-ai/cordis';
import Schema from '@deepseek-ai/schemastery';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { WorkflowController } from '../core/controller.js';
import type { WorkspacePort } from '../core/ports.js';
import type { ActorKind, DevelopmentRun } from '../core/types.js';
import { DomainRunStore } from './store.js';
import type { CreateRequest, DecideRequest, ReviseRequest, RunRequest, SessionRequest } from './remote-contract.js';
export declare const name = "dsh-sfd";
export declare const inject: string[];
export interface Config {
    stateRoot?: string;
    actorTimeoutMs?: number;
    maxParallelReviews?: number;
    maxInfrastructureRetries?: number;
    /** Deployment routes are user configuration, never fields in model tool input. */
    modelRoutes?: Partial<Record<ActorKind, {
        provider: string;
        model: string;
        effort?: string;
    }>>;
    largeImplementerProvider?: string;
    largeImplementerModel?: string;
    largeImplementerEffort?: string;
    allowCommits?: boolean;
}
export declare const Config: Schema<Config>;
declare module '@deepseek-ai/cordis' {
    interface Context {
        developmentWorkflow: DevelopmentWorkflowService;
    }
}
/** Reject sibling paths and symlink escapes after canonicalizing both sides. */
export declare function containedWorkspace(sourceRoot: string, requested?: string): Promise<string>;
export declare class DevelopmentWorkflowService extends TypertRemoteService {
    readonly controller: WorkflowController;
    private readonly store;
    private readonly config;
    private readonly workspace;
    constructor(ctx: Context, controller: WorkflowController, store: DomainRunStore, config: Config, workspace?: Pick<WorkspacePort, 'inspect'>);
    /** The Gateway checks this Session resource; the domain fence checks the Run it owns. */
    private assertOwner;
    private requireLiveOwner;
    list(request: SessionRequest): Promise<DevelopmentRun[]>;
    create(request: CreateRequest): Promise<DevelopmentRun>;
    status(request: RunRequest): Promise<DevelopmentRun>;
    start(request: RunRequest): Promise<DevelopmentRun>;
    pause(request: RunRequest): Promise<DevelopmentRun>;
    resume(request: RunRequest): Promise<DevelopmentRun>;
    cancel(request: RunRequest): Promise<DevelopmentRun>;
    recover(request: RunRequest): Promise<DevelopmentRun>;
    decide(request: DecideRequest): Promise<DevelopmentRun>;
    revise(request: ReviseRequest): Promise<DevelopmentRun>;
}
/** Human command grammar is intentionally small; decision text is retained verbatim. */
export declare function executeCommand(service: DevelopmentWorkflowService, agent: Agent, raw: string): Promise<string>;
/** Mount durable state before exposing operations; startup never replays vanished writes. */
export declare function apply(ctx: Context, config?: Config): Promise<void>;
