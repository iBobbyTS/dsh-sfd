import type { ActorRoute, ActorTask, DevelopmentRun, RouteTransport } from '../core/types.js';
import type { RunOwner } from './store.js';
/** The requested model family, not the selected chat Host, owns the execution transport. */
export declare function transportForModel(model: string): RouteTransport;
/** Resolve once at Run creation so routing cannot mutate mid-task with Host config. */
export declare function freezeModelRoute(preset: string, owner: Pick<RunOwner, 'provider' | 'model' | 'effort'>, override?: {
    provider: string;
    model: string;
    effort?: string;
}): ActorRoute;
export interface ExternalTarget {
    subagent: 'zcode' | 'codex';
    model: string;
    effort?: string;
    permission_mode: 'plan' | 'build' | 'yolo';
}
/** The effective Subsection model tier is frozen by the controller. Older
 * attempts fall back to their authored tier rather than silently using an
 * unrelated parent tier. No large task can fall back to a standard route. */
export declare function configuredActorRoute(task: ActorTask, run: Pick<DevelopmentRun, 'plan' | 'policy'>): ActorRoute | undefined;
/** Exact public external-subagent spawn tokens, with no new write manifest. */
export declare function externalTarget(route: ActorRoute, access: 'reader' | 'writer', sandboxMode: RunOwner['sandboxMode']): ExternalTarget;
