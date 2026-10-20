/** Client-safe native Remote contract. The same strict schemas serve Host and UI. */
import { z } from 'zod';
import { createTypertRemoteInfo } from '@deepseek-ai/dsh-typert-protocol/remote-info';
import type { RemoteResult, TypertRemoteCodecSpec, TypertRemoteMethodSpec } from '@deepseek-ai/dsh-typert-protocol';
import type { DevelopmentRun } from '../core/types.js';
import { runSchema } from '../core/schemas.js';

export interface SessionRequest { sessionId: string }
export interface RunRequest extends SessionRequest { runId: string }
export interface CreateRequest extends SessionRequest { goal: string; workspacePath?: string; commit?: boolean; intent?: 'execute' | 'plan-handoff' | 'review-only' }
export interface DecideRequest extends RunRequest {
  decisionId: string; answer: string; action?: 'continue' | 'retry' | 'replan' | 'cancel';
  advisorResult?: string; advisorAdoption?: 'accept' | 'reject' | 'clarify';
}
export interface ReviseRequest extends RunRequest { goal: string }

export const sessionRequestSchema = z.object({ sessionId: z.string().min(1) }).strict();
export const runRequestSchema = sessionRequestSchema.extend({ runId: z.string().min(1) }).strict();
export const createRequestSchema = sessionRequestSchema.extend({
  goal: z.string().trim().min(1).max(100_000), workspacePath: z.string().min(1).optional(), commit: z.boolean().optional(),
  intent: z.enum(['execute', 'plan-handoff', 'review-only']).optional(),
}).strict();
export const decideRequestSchema = runRequestSchema.extend({
  decisionId: z.string().min(1), answer: z.string().trim().min(1).max(100_000),
  action: z.enum(['continue', 'retry', 'replan', 'cancel']).optional(),
  advisorResult: z.string().trim().min(1).max(100_000).optional(),
  advisorAdoption: z.enum(['accept','reject','clarify']).optional(),
}).strict();
export const reviseRequestSchema = runRequestSchema.extend({ goal: z.string().trim().min(1).max(100_000) }).strict();

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
  interface TypertRemoteNamespaceMap { developmentWorkflow: DevelopmentWorkflowRemote }
  interface RemoteErrorDetailsMap {
    'development-workflow/not-found': { runId: string };
    'development-workflow/forbidden': { sessionId: string };
    'development-workflow/invalid-request': { reason: string };
    'development-workflow/unavailable': { reason: string };
  }
}

function codec(schema: z.ZodType, name: string): TypertRemoteCodecSpec {
  return { mode: 'strict', typeSymbol: `dsh-sfd#${name}`, create: () => schema };
}

function method(input: z.ZodType, output: z.ZodType, name: string): TypertRemoteMethodSpec {
  const requestCodec = codec(input, `${name}Request`);
  return {
    service: 'developmentWorkflow', invocation: { kind: 'direct' },
    parameters: [{ name: 'request', source: 'json', codec: requestCodec, strictCodec: requestCodec }],
    result: codec(output, name === 'list' ? 'DevelopmentRun[]' : 'DevelopmentRun'),
  };
}

/** A handwritten ordinary Typert contribution, with no source-launch parser dependency. */
export const TYPERT_REMOTE = createTypertRemoteInfo({
  package: 'dsh-sfd',
  methods: {
    'developmentWorkflow/list': method(sessionRequestSchema, z.array(runSchema), 'list'),
    'developmentWorkflow/create': method(createRequestSchema, runSchema, 'create'),
    'developmentWorkflow/status': method(runRequestSchema, runSchema, 'status'),
    'developmentWorkflow/start': method(runRequestSchema, runSchema, 'start'),
    'developmentWorkflow/pause': method(runRequestSchema, runSchema, 'pause'),
    'developmentWorkflow/resume': method(runRequestSchema, runSchema, 'resume'),
    'developmentWorkflow/cancel': method(runRequestSchema, runSchema, 'cancel'),
    'developmentWorkflow/recover': method(runRequestSchema, runSchema, 'recover'),
    'developmentWorkflow/decide': method(decideRequestSchema, runSchema, 'decide'),
    'developmentWorkflow/revise': method(reviseRequestSchema, runSchema, 'revise'),
  },
}, z);
