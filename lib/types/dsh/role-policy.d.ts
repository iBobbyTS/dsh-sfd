import type { Context } from '@deepseek-ai/cordis';
import Schema from '@deepseek-ai/schemastery';
import type { ActorKind } from '../core/types.js';
export declare const name = "sfd-role-policy";
export declare const inject: string[];
export interface Config {
    kind: ActorKind;
}
export declare const Config: Schema<Config>;
/** Installed in a preset generation, so capability restrictions precede publication. */
export declare function apply(ctx: Context, config: Config): void;
