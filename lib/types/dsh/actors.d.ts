import type { Context } from '@deepseek-ai/cordis';
import type { Agent, AgentOptions } from '@deepseek-ai/dsh-agent';
import type { LlmCallConfig } from '@deepseek-ai/dsh-llm';
import type { ActorHandle, ActorRunner } from '../core/ports.js';
import type { ActorRoute, ActorTask } from '../core/types.js';
import type { DomainRunStore, RunOwner } from './store.js';
export declare function nativeAgentOptions(owner: RunOwner, route?: ActorRoute): AgentOptions & LlmCallConfig;
/** Canonical native setters retain permission identity (including Auto) without one-shot grants. */
export declare function seedAgentPermission(agent: Agent, owner: RunOwner): void;
export declare function validateActorRoute(task: ActorTask, route: ActorRoute | undefined): void;
/** Host-owned anchors outlive the initiating chat turn. Only child activations run models. */
export declare class NativeActorRunner implements ActorRunner {
    private readonly ctx;
    private readonly store;
    private readonly anchors;
    private readonly active;
    private readonly bootId;
    private readonly shutdown;
    private disposed;
    constructor(ctx: Context, store: DomainRunStore);
    private anchor;
    start(task: ActorTask, signal: AbortSignal): Promise<ActorHandle>;
    private startNative;
    release(runId: string): Promise<void>;
    dispose(): Promise<void>;
}
