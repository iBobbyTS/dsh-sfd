import type { Context } from '@deepseek-ai/cordis';
import type { CheckExecutor } from '../workspace/git-workspace.js';
import type { DomainRunStore } from './store.js';
/** Bash transports argv literally; it does not evaluate model-owned argument contents. */
export declare function quoteArgv(argv: readonly string[]): string;
/** Checks cross the ordinary tool policy pipeline before the sandboxing shell runs them. */
export declare function nativeCheckExecutor(ctx: Context, store: DomainRunStore): CheckExecutor;
