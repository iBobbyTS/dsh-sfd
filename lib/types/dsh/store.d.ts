import { z } from 'zod';
import type { Domain, DomainFacility } from '@deepseek-ai/dsh-storage-domain';
import type { RunStore } from '../core/ports.js';
import type { DevelopmentRun } from '../core/types.js';
/** Authorization is fixed by the native entry point, never by a model result. */
export declare const ownerSchema: z.ZodObject<{
    sessionId: z.ZodString;
    sourceRoot: z.ZodString;
    sandboxMode: z.ZodEnum<{
        "read-only": "read-only";
        "workspace-write": "workspace-write";
        "danger-full-access": "danger-full-access";
    }>;
    permissionPreset: z.ZodOptional<z.ZodString>;
    provider: z.ZodString;
    model: z.ZodString;
    effort: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export type RunOwner = z.infer<typeof ownerSchema>;
export declare const runEnvelopeSchema: z.ZodObject<{
    owner: z.ZodObject<{
        sessionId: z.ZodString;
        sourceRoot: z.ZodString;
        sandboxMode: z.ZodEnum<{
            "read-only": "read-only";
            "workspace-write": "workspace-write";
            "danger-full-access": "danger-full-access";
        }>;
        permissionPreset: z.ZodOptional<z.ZodString>;
        provider: z.ZodString;
        model: z.ZodString;
        effort: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>;
    run: z.ZodType<DevelopmentRun, unknown, z.core.$ZodTypeInternals<DevelopmentRun, unknown>>;
}, z.core.$strict>;
export declare const workflowDomain: {
    name: string;
    version: number;
    layout: "single";
    tables: {
        runs: import("@deepseek-ai/dsh-storage-domain").DomainTableSpec<string, {
            owner: {
                sessionId: string;
                sourceRoot: string;
                sandboxMode: "read-only" | "workspace-write" | "danger-full-access";
                provider: string;
                model: string;
                permissionPreset?: string | undefined;
                effort?: string | undefined;
            };
            run: DevelopmentRun;
        }>;
    };
};
/** One strict, authoritative domain opened once per Host plugin instance. */
export declare class DomainRunStore implements RunStore {
    private readonly domain;
    private readonly creationOwner;
    private readonly creating;
    constructor(domain: Domain<typeof workflowDomain>);
    static open(facility: DomainFacility): Promise<DomainRunStore>;
    withOwner<T>(owner: RunOwner, operation: () => Promise<T>): Promise<T>;
    ownerOf(id: string): RunOwner | undefined;
    list(): Promise<DevelopmentRun[]>;
    get(id: string): Promise<DevelopmentRun | undefined>;
    create(run: DevelopmentRun): Promise<void>;
    update(id: string, transform: (run: DevelopmentRun) => DevelopmentRun): Promise<DevelopmentRun>;
    close(): Promise<void>;
}
