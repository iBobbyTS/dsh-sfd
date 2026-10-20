import type { ActorTask } from '../core/types.js';
/** A final defensive presentation boundary. The Host must also persist clean input packets. */
export declare function visibleActorInput(task: ActorTask): Record<string, unknown>;
/** Build one reproducible task packet; no external Skill lookup or transcript inheritance. */
export declare function buildActorPrompt(task: ActorTask): string;
