import type { ActorKind, Attempt, DevelopmentRun, RunStatus, SectionStage } from '../core/types.js';
import type { RunAction } from './controller.js';
export declare const STATUS_LABELS: Record<RunStatus, string>;
export declare const SECTION_LABELS: Record<SectionStage, string>;
export declare const ROLE_LABELS: Record<ActorKind, string>;
export declare function phaseLabel(run: DevelopmentRun): string;
/** UI availability is a hint; the Host validates every state transition again. */
export declare function availableActions(run: DevelopmentRun): RunAction[];
export declare function observedIdentity(attempt: Attempt): string;
export declare function requestedIdentity(attempt: Attempt): string;
export declare function shorten(value: string | undefined, size?: number): string;
export declare function dateLabel(iso: string | undefined): string;
