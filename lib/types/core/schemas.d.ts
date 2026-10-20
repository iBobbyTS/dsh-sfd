import { z } from 'zod';
import { type DevelopmentRun } from './types.js';
/** Storage and Remote boundaries validate actual persisted mechanics; no unchecked cast parser. */
export declare const runSchema: z.ZodType<DevelopmentRun>;
