import type { Context } from '@deepseek-ai/cordis';
import type { ActorHandle, ActorRunner } from '../core/ports.js';
import type { ActorTask } from '../core/types.js';
import type { DomainRunStore } from './store.js';
import { type ExternalSubagentClient } from './external-actor.js';
/** One Host-owned dispatch authority. DeepSeek is native, GLM/GPT are external. */
export declare class ModelFamilyActorRunner implements ActorRunner {
    private readonly store;
    private readonly native;
    private readonly external;
    constructor(ctx: Context, store: DomainRunStore, client?: ExternalSubagentClient);
    start(task: ActorTask, signal: AbortSignal): Promise<ActorHandle>;
    release(runId: string): Promise<void>;
    dispose(): Promise<void>;
}
