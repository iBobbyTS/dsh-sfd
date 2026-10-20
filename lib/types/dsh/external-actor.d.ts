import type { ActorHandle, ActorRunner } from '../core/ports.js';
import type { ActorTask } from '../core/types.js';
import type { DomainRunStore } from './store.js';
/** CLI and MCP have the same external-subagent public result projection. JSON travels on stdin. */
export type ExternalCommand = 'spawn' | 'wait' | 'result' | 'cancel' | 'close';
export interface ExternalSubagentClient {
    call(command: ExternalCommand, input: Record<string, unknown>): Promise<Record<string, unknown>>;
}
export declare class ExternalSubagentCli implements ExternalSubagentClient {
    private readonly executable;
    constructor(executable?: string);
    call(command: ExternalCommand, input: Record<string, unknown>): Promise<Record<string, unknown>>;
}
/** External runtimes cannot call DSH's sfd_knowledge tool. Bundle role-relevant originals verbatim. */
export declare function externalActorPrompt(task: ActorTask, basePrompt: string): Promise<string>;
export declare class ExternalSubagentRunner implements ActorRunner {
    private readonly store;
    private readonly client;
    private readonly active;
    /** external-subagent does not admit overlapping tasks on an owned workspace. */
    private readonly workspaceQueues;
    private disposed;
    private reserveWorkspace;
    constructor(store: DomainRunStore, client: ExternalSubagentClient);
    start(task: ActorTask, signal: AbortSignal): Promise<ActorHandle>;
    private readTerminal;
    dispose(): Promise<void>;
}
