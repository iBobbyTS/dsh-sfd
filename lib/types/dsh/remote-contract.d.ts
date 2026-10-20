/** Client-safe native Remote contract. The same strict schemas serve Host and UI. */
import { z } from 'zod';
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol';
import type { DevelopmentRun } from '../core/types.js';
export interface SessionRequest {
    sessionId: string;
}
export interface RunRequest extends SessionRequest {
    runId: string;
}
export interface CreateRequest extends SessionRequest {
    goal: string;
    workspacePath?: string;
    commit?: boolean;
    intent?: 'execute' | 'plan-handoff';
}
export interface DecideRequest extends RunRequest {
    decisionId: string;
    answer: string;
    action?: 'continue' | 'retry' | 'replan' | 'cancel';
    advisorResult?: string;
    advisorAdoption?: 'accept' | 'reject' | 'clarify';
}
export interface ReviseRequest extends RunRequest {
    goal: string;
}
export declare const sessionRequestSchema: z.ZodObject<{
    sessionId: z.ZodString;
}, z.core.$strict>;
export declare const runRequestSchema: z.ZodObject<{
    sessionId: z.ZodString;
    runId: z.ZodString;
}, z.core.$strict>;
export declare const createRequestSchema: z.ZodObject<{
    sessionId: z.ZodString;
    goal: z.ZodString;
    workspacePath: z.ZodOptional<z.ZodString>;
    commit: z.ZodOptional<z.ZodBoolean>;
    intent: z.ZodOptional<z.ZodEnum<{
        execute: "execute";
        "plan-handoff": "plan-handoff";
    }>>;
}, z.core.$strict>;
export declare const decideRequestSchema: z.ZodObject<{
    sessionId: z.ZodString;
    runId: z.ZodString;
    decisionId: z.ZodString;
    answer: z.ZodString;
    action: z.ZodOptional<z.ZodEnum<{
        retry: "retry";
        continue: "continue";
        replan: "replan";
        cancel: "cancel";
    }>>;
    advisorResult: z.ZodOptional<z.ZodString>;
    advisorAdoption: z.ZodOptional<z.ZodEnum<{
        reject: "reject";
        accept: "accept";
        clarify: "clarify";
    }>>;
}, z.core.$strict>;
export declare const reviseRequestSchema: z.ZodObject<{
    sessionId: z.ZodString;
    runId: z.ZodString;
    goal: z.ZodString;
}, z.core.$strict>;
export interface DevelopmentWorkflowRemote {
    list(request: SessionRequest): Promise<RemoteResult<DevelopmentRun[]>>;
    create(request: CreateRequest): Promise<RemoteResult<DevelopmentRun>>;
    status(request: RunRequest): Promise<RemoteResult<DevelopmentRun>>;
    start(request: RunRequest): Promise<RemoteResult<DevelopmentRun>>;
    pause(request: RunRequest): Promise<RemoteResult<DevelopmentRun>>;
    resume(request: RunRequest): Promise<RemoteResult<DevelopmentRun>>;
    cancel(request: RunRequest): Promise<RemoteResult<DevelopmentRun>>;
    recover(request: RunRequest): Promise<RemoteResult<DevelopmentRun>>;
    decide(request: DecideRequest): Promise<RemoteResult<DevelopmentRun>>;
    revise(request: ReviseRequest): Promise<RemoteResult<DevelopmentRun>>;
}
declare module '@deepseek-ai/dsh-typert-protocol' {
    interface TypertRemoteNamespaceMap {
        developmentWorkflow: DevelopmentWorkflowRemote;
    }
    interface RemoteErrorDetailsMap {
        'development-workflow/not-found': {
            runId: string;
        };
        'development-workflow/forbidden': {
            sessionId: string;
        };
        'development-workflow/invalid-request': {
            reason: string;
        };
        'development-workflow/unavailable': {
            reason: string;
        };
    }
}
/** A handwritten ordinary Typert contribution, with no source-launch parser dependency. */
export declare const TYPERT_REMOTE: import("@deepseek-ai/dsh-typert-protocol").TypertRemoteInfo<Readonly<Record<string, import("@deepseek-ai/dsh-typert-protocol").TypertRemoteMethod<object, unknown, "unary", never, unknown> | import("@deepseek-ai/dsh-typert-protocol").TypertRemoteMethod<object, unknown, "stream", unknown, unknown>>>>;
