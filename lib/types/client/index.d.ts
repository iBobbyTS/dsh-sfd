import type { Context } from '@deepseek-ai/cordis';
export declare const name = "dsh-sfd-client";
export declare const inject: string[];
/** Global UI reads and operates the same Host domain as the scoped command. */
export declare function apply(ctx: Context): Promise<() => Promise<void>>;
export { DevelopmentClientController } from './controller.js';
export type { DevelopmentViewState } from './controller.js';
