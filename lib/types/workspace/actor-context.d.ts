import type { ActorTask } from '../core/types.js';
export interface PreparedActorPrompt {
    prompt: string;
    artifactRefs: string[];
}
export interface ActorContextOptions {
    directory: string;
    maxCharacters?: number;
}
/**
 * Bound presentation, not the durable task or its requirements. Large evidence is
 * stored outside all source candidates. Readers retrieve the exact immutable data.
 */
export declare function prepareActorPrompt(task: ActorTask, options: ActorContextOptions): Promise<PreparedActorPrompt>;
