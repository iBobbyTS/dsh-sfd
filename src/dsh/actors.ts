import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import type { Context } from '@deepseek-ai/cordis';
import type { AgentHandle as NativeAgentHandle, Agent, AgentOptions } from '@deepseek-ai/dsh-agent';
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm';
import type { LlmCallConfig } from '@deepseek-ai/dsh-llm';
import { SessionId } from '@deepseek-ai/dsh-session';
import { assertObjectJsonSchema } from '@deepseek-ai/dsh-tools';
import { setSandboxMode } from '@deepseek-ai/dsh-sandbox-policy';
import { setApprovalPolicy } from '@deepseek-ai/dsh-user-approval';
import type { SubagentActivation } from '@deepseek-ai/dsh-subagent';
import type {} from '@deepseek-ai/dsh-agent-preset-registry';
import type {} from '@deepseek-ai/dsh-permission-presets';
import type {} from '@deepseek-ai/dsh-working-directory';
import type { ActorHandle, ActorRunner } from '../core/ports.js';
import type { ActorOutcome, ActorRoute, ActorTask, ExecutionIdentity } from '../core/types.js';
import { ROLE_PRESETS } from '../roles/index.js';
import { prepareActorPrompt } from '../workspace/actor-context.js';
import type { DomainRunStore, RunOwner } from './store.js';

export function nativeAgentOptions(owner: RunOwner, route?: ActorRoute): AgentOptions & LlmCallConfig {
  const changedRoute = route?.provider !== undefined && (route.provider !== owner.provider || route.model !== owner.model);
  const effort = route?.effort ?? (changedRoute ? undefined : owner.effort);
  return {
    provider: route?.provider ?? owner.provider,
    model: route?.model ?? owner.model,
    ...effort === undefined ? {} : { reasoningEffort: ReasoningEffortId(effort) },
  };
}

/** Canonical native setters retain permission identity (including Auto) without one-shot grants. */
export function seedAgentPermission(agent: Agent, owner: RunOwner): void {
  if (owner.permissionPreset !== undefined && owner.permissionPreset !== 'custom') {
    const presets = agent.ctx.get('permissionPresets');
    if (presets === undefined) throw new Error('The captured permission preset service is unavailable.');
    presets.set(agent.session, owner.permissionPreset);
  }
  setSandboxMode(agent.session, owner.sandboxMode);
  setApprovalPolicy(agent.session, 'never');
}

export function validateActorRoute(task: ActorTask, route: ActorRoute | undefined): void {
  const expected = route ?? { preset: ROLE_PRESETS[task.kind] };
  const selected = task.route ?? expected;
  if (selected.preset !== ROLE_PRESETS[task.kind]) throw new Error('An actor cannot replace its native role preset.');
  if ((['preset', 'provider', 'model', 'effort'] as const).some(field => selected[field] !== expected[field])) throw new Error('Actor route differs from its admitted Run policy.');
  if ((selected.provider === undefined) !== (selected.model === undefined)) throw new Error('Actor provider and model must be configured together.');
}

function awaitAbortable<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) { void pending.catch(() => {}); return Promise.reject(signal.reason); }
  return new Promise<T>((resolve, reject) => {
    const abort = (): void => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    void pending.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

/** Host-owned anchors outlive the initiating chat turn. Only child activations run models. */
export class NativeActorRunner implements ActorRunner {
  private readonly anchors = new Map<string, Promise<NativeAgentHandle>>();
  private readonly active = new Set<ActorHandle>();
  private readonly bootId = randomUUID();
  private readonly shutdown = new AbortController();
  private disposed = false;

  constructor(private readonly ctx: Context, private readonly store: DomainRunStore) {}

  private async anchor(task: ActorTask): Promise<NativeAgentHandle> {
    if (this.disposed) throw new Error('Native actor runner is disposed.');
    let pending = this.anchors.get(task.runId);
    if (pending === undefined) {
      const owner = this.store.ownerOf(task.runId);
      if (owner === undefined) throw new Error(`Run has no native owner: ${task.runId}`);
      pending = this.ctx.agents.withoutInitiator(() => this.ctx.agents.create({
        sessionId: SessionId(`sfd-anchor-${task.runId}-${this.bootId}`),
        signal: this.shutdown.signal,
        meta: { cwd: task.workspace.path, parentSession: SessionId(owner.sessionId), origin: 'subagent', delegationDepth: 0 },
        agentOptions: nativeAgentOptions(owner),
        setup: (_agentCtx, agent) => {
          seedAgentPermission(agent, owner);
          agent.ctx.tools.restrict({ allow: [] });
        },
      }));
      this.anchors.set(task.runId, pending);
      void pending.catch(() => { if (this.anchors.get(task.runId) === pending) this.anchors.delete(task.runId); });
    }
    return pending;
  }

  async start(task: ActorTask, signal: AbortSignal): Promise<ActorHandle> {
    if (this.disposed) throw new Error('Native actor runner is disposed.');
    if (!Number.isFinite(task.timeoutMs) || task.timeoutMs <= 0 || task.timeoutMs > 2_147_483_647) {
      throw new Error('Actor timeout must be a positive bounded duration.');
    }
    const deadline = new AbortController();
    const timeout = setTimeout(() => deadline.abort(new Error(`Actor deadline exceeded (${task.timeoutMs} ms).`)), task.timeoutMs);
    const lifetime = AbortSignal.any([signal, deadline.signal, this.shutdown.signal]);
    try { return await awaitAbortable(this.startNative(task, signal, deadline, lifetime, timeout), lifetime); }
    catch (error) { clearTimeout(timeout); throw error; }
  }

  private async startNative(task: ActorTask, signal: AbortSignal, deadline: AbortController, lifetime: AbortSignal, timeout: ReturnType<typeof setTimeout>): Promise<ActorHandle> {
    lifetime.throwIfAborted();
    const run = await this.store.get(task.runId);
    const owner = this.store.ownerOf(task.runId);
    if (run === undefined || owner === undefined) throw new Error(`Unknown Run: ${task.runId}`);
    validateActorRoute(task, run.policy.routes[task.kind]);
    const route = task.route ?? run.policy.routes[task.kind] ?? { preset: ROLE_PRESETS[task.kind] };
    const requestedOptions = nativeAgentOptions(owner, route);
    const provider = this.ctx.subagents.getProvider('spawn');
    if (provider === undefined || provider.prepareContinuable === undefined || provider.inheritsParentContext || !provider.capabilities.agentPreset || !provider.capabilities.outputSchema) {
      throw new Error('SFD requires the native fresh spawn provider with presets and structured output.');
    }
    const preset = await this.ctx.agentPresets.resolve(route.preset);
    lifetime.throwIfAborted();
    if (preset.broken !== undefined) throw new Error(`Role preset is unavailable: ${preset.broken}`);
    const outputSchema = task.outputSchema;
    assertObjectJsonSchema(outputSchema);
    const prepared = await prepareActorPrompt(task, { directory: join(dirname(run.workspace.path), 'actor-context', task.id) });
    lifetime.throwIfAborted();
    const childId = SessionId(`sfd-actor-${task.id}`);
    const artifactRefs = [`dsh-session:${childId}`, ...prepared.artifactRefs];
    const identity: ExecutionIdentity = {
      requested: { preset: route.preset, provider: requestedOptions.provider, model: requestedOptions.model,
        ...(requestedOptions.reasoningEffort === undefined ? {} : { effort: requestedOptions.reasoningEffort }) },
      transport: 'dsh-native', sessionId: childId,
    };
    let routeChanged = false;
    const observe = this.ctx.on('session/event', (session, event) => {
      if (session.id !== childId || event.type !== 'request/header') return;
      const config = event.data.header.config;
      const child = this.ctx.agents.get(childId);
      identity.observed = {
        provider: config.provider, model: config.model,
        ...(config.reasoningEffort === undefined ? {} : { effort: config.reasoningEffort }),
        ...(child === undefined ? {} : { preset: this.ctx.agentPresets.composedPreset(child.ctx) }),
      };
      if (config.provider !== requestedOptions.provider || config.model !== requestedOptions.model
        || (requestedOptions.reasoningEffort !== undefined && config.reasoningEffort !== requestedOptions.reasoningEffort)) {
        routeChanged = true;
        deadline.abort(new Error('The observed model route changed.'));
      }
    });
    let activation: SubagentActivation;
    try {
      lifetime.throwIfAborted();
      await this.ctx.llm.resolveCallConfig(requestedOptions, lifetime);
      const anchor = await this.anchor(task);
      lifetime.throwIfAborted();
      activation = await this.ctx.subagents.startActivation({
        provider: 'spawn', childId, label: `${task.kind}: ${task.sectionId ?? task.runId}`,
        request: {
          parent: anchor.agent, cwd: task.workspace.path, agentPreset: route.preset,
          agentOptions: requestedOptions, maxDepth: 1,
          prompt: [{ type: 'text', text: prepared.prompt }], outputSchema,
        },
        signal: lifetime, delivery: 'caller',
      });
    } catch (error) {
      clearTimeout(timeout); observe();
      throw error;
    }
    let disposal: Promise<void> | undefined;
    const dispose = (): Promise<void> => disposal ??= activation.dispose();
    const onAbort = (): void => { void dispose().catch(() => {}); };
    lifetime.addEventListener('abort', onAbort, { once: true });
    if (lifetime.aborted) onAbort();
    const result: Promise<ActorOutcome> = activation.result.then((value): ActorOutcome => {
      if (routeChanged) return { status: 'failed', error: 'The observed model route changed; no silent route substitution is admitted.', identity, artifactRefs };
      if (lifetime.aborted) return { status: signal.aborted ? 'cancelled' : 'failed', error: String(lifetime.reason), identity, artifactRefs };
      if (value.stopReason !== 'completed') return {
        status: value.stopReason === 'aborted' ? 'cancelled' : 'failed',
        error: value.diagnostic ?? `Native actor stopped: ${value.stopReason}`, identity, artifactRefs,
      };
      if (value.structured === undefined) return { status: 'failed', error: 'The actor finished without the required structured output.', identity, artifactRefs };
      return { status: 'completed', output: value.structured, identity, artifactRefs };
    }, (error): ActorOutcome => ({ status: signal.aborted ? 'cancelled' : 'failed', error: String(error), identity, artifactRefs })).finally(() => {
      clearTimeout(timeout); lifetime.removeEventListener('abort', onAbort); observe(); this.active.delete(handle);
    });
    const handle: ActorHandle = { id: childId, result, dispose };
    this.active.add(handle);
    return handle;
  }

  async release(runId: string): Promise<void> {
    const pending = this.anchors.get(runId);
    if (pending === undefined) return;
    this.anchors.delete(runId);
    await (await pending).dispose();
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.shutdown.abort(new Error('Native actor runner is shutting down.'));
    const results = await Promise.allSettled([...this.active].map(handle => handle.dispose()));
    const anchors = await Promise.allSettled([...this.anchors.keys()].map(id => this.release(id)));
    const failed = [...results, ...anchors].find(result => result.status === 'rejected');
    if (failed?.status === 'rejected') throw failed.reason;
  }
}
