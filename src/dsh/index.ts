import { realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import type { Context } from '@deepseek-ai/cordis';
import Schema from '@deepseek-ai/schemastery';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { SessionId } from '@deepseek-ai/dsh-session';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import type {} from '@deepseek-ai/dsh-commands';
import type {} from '@deepseek-ai/dsh-typert-registry';
import type {} from '@deepseek-ai/dsh-api-session-controller';
import { WorkflowController } from '../core/controller.js';
import type { WorkspacePort } from '../core/ports.js';
import type { ActorKind, ActorRoute, DevelopmentRun, WorkflowPolicy } from '../core/types.js';
import { GitWorkspace } from '../workspace/git-workspace.js';
import { ROLE_PRESETS } from '../roles/index.js';
import { DomainRunStore, type RunOwner } from './store.js';
import { NativeActorRunner } from './actors.js';
import { nativeCheckExecutor } from './checks.js';
import {
  TYPERT_REMOTE, createRequestSchema, decideRequestSchema, reviseRequestSchema, runRequestSchema, sessionRequestSchema,
} from './remote-contract.js';
import type { CreateRequest, DecideRequest, ReviseRequest, RunRequest, SessionRequest } from './remote-contract.js';

export const name = 'dsh-sfd';
export const inject = ['agents', 'subagents', 'agentPresets', 'llm', 'tools', 'commands', 'storageDomain', 'typert', 'sandboxPolicy', 'approval', 'workingDirectory'];

export interface Config {
  stateRoot?: string;
  actorTimeoutMs?: number;
  maxParallelReviews?: number;
  maxInfrastructureRetries?: number;
  /** Deployment routes are user configuration, never fields in model tool input. */
  modelRoutes?: Partial<Record<ActorKind, { provider: string; model: string; effort?: string }>>;
  largeImplementerProvider?: string;
  largeImplementerModel?: string;
  largeImplementerEffort?: string;
  allowCommits?: boolean;
}
export const Config: Schema<Config> = Schema.object({
  stateRoot: Schema.string(),
  actorTimeoutMs: Schema.natural().min(1).max(86_400_000).default(1_800_000),
  maxParallelReviews: Schema.natural().min(1).max(6).default(3),
  maxInfrastructureRetries: Schema.natural().max(3).default(1),
  modelRoutes: Schema.dict(Schema.object({ provider: Schema.string().min(1).required(), model: Schema.string().min(1).required(), effort: Schema.string().min(1) })).default({}),
  largeImplementerProvider: Schema.string(),
  largeImplementerModel: Schema.string(),
  largeImplementerEffort: Schema.string(),
  allowCommits: Schema.boolean().default(true),
});

declare module '@deepseek-ai/cordis' {
  interface Context { developmentWorkflow: DevelopmentWorkflowService }
}

/** Reject sibling paths and symlink escapes after canonicalizing both sides. */
export async function containedWorkspace(sourceRoot: string, requested?: string): Promise<string> {
  const root = await realpath(sourceRoot);
  const selected = await realpath(requested === undefined ? root : resolve(root, requested));
  const offset = relative(root, selected);
  if (offset === '..' || offset.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(offset)) {
    throw new Error('The requested workspace must be within the owner Session workspace.');
  }
  return selected;
}

export class DevelopmentWorkflowService extends TypertRemoteService {
  constructor(
    ctx: Context,
    readonly controller: WorkflowController,
    private readonly store: DomainRunStore,
    private readonly config: Config,
    private readonly workspace: Pick<WorkspacePort, 'inspect'> = new GitWorkspace(),
  ) { super(ctx, 'developmentWorkflow'); }

  /** The Gateway checks this Session resource; the domain fence checks the Run it owns. */
  private assertOwner(request: RunRequest): void {
    const owner = this.store.ownerOf(request.runId);
    if (owner === undefined || owner.sessionId !== request.sessionId) {
      throw new RemoteError('development-workflow/not-found', 'This Session has no such development Run.', { runId: request.runId });
    }
  }

  private async requireLiveOwner(sessionId: string): Promise<Agent> {
    let owner = this.ctx.agents.get(SessionId(sessionId));
    if (owner === undefined) {
      const sessions = this.ctx.get('sessionController');
      if (sessions !== undefined) {
        const result = await sessions.resolveAgent(SessionId(sessionId));
        if ('error' in result) throw result.error;
        owner = result.agent;
      }
    }
    if (owner === undefined) throw new RemoteError('development-workflow/unavailable', 'Open the owning Session before creating a development Run.', { reason: 'owner-session-not-live' });
    if (owner.session.header.origin === 'subagent') throw new RemoteError('development-workflow/forbidden', 'A delegated actor cannot start another development workflow.', { sessionId });
    return owner;
  }

  @Remote({ resources: { session: (request: SessionRequest) => SessionId(request.sessionId) } })
  async list(request: SessionRequest): Promise<DevelopmentRun[]> {
    sessionRequestSchema.parse(request);
    return (await this.controller.list()).filter(run => this.store.ownerOf(run.id)?.sessionId === request.sessionId);
  }

  @Remote({ resources: { session: (request: CreateRequest) => SessionId(request.sessionId) } })
  async create(request: CreateRequest, automaticActivation = false): Promise<DevelopmentRun> {
    request = createRequestSchema.parse(request);
    const agent = await this.requireLiveOwner(request.sessionId);
    const sandbox = this.ctx.sandboxPolicy.resolve({ session: agent.session });
    if (sandbox.mode === 'read-only') throw new RemoteError('development-workflow/forbidden', 'Development requires a writable native Session permission scope.', { sessionId: request.sessionId });
    const sourceRoot = agent.session.header.cwd ?? this.ctx.workingDirectory.get(agent.session);
    const workspacePath = await containedWorkspace(sourceRoot, request.workspacePath ?? this.ctx.workingDirectory.get(agent.session));
    const repository = await this.workspace.inspect(workspacePath);
    // Git inspection promotes a directory to its repository root. Check that
    // resolved root too, before a broader Run can reach the durable boundary.
    await containedWorkspace(sourceRoot, repository.path);
    const route = agent.session.requestHeader()?.config ?? agent.options;
    if (!route.provider || !route.model) throw new RemoteError('development-workflow/unavailable', 'Select a model in the owning Session before creating a Run.', { reason: 'owner-model-not-selected' });
    const permissionPreset = this.ctx.get('permissionPresets')?.current(agent.session);
    const owner: RunOwner = {
      sessionId: request.sessionId, sourceRoot: await realpath(sourceRoot), sandboxMode: sandbox.mode,
      provider: route.provider, model: route.model,
      ...(route.reasoningEffort === undefined ? {} : { effort: route.reasoningEffort }),
      ...(permissionPreset === undefined ? {} : { permissionPreset }),
    };
    if (request.commit === false) throw new RemoteError('development-workflow/forbidden', 'EXECUTE_WITH_COMMIT requires an accepted commit on the isolated run branch; choose a separately authorized plan-only workflow for no-commit work.', { sessionId: request.sessionId });
    if (this.config.allowCommits === false) throw new RemoteError('development-workflow/forbidden', 'This deployment disables workflow commits.', { sessionId: request.sessionId });
    const routes: Partial<Record<ActorKind, ActorRoute>> = {};
    for (const kind of Object.keys(ROLE_PRESETS) as ActorKind[]) routes[kind] = { preset: ROLE_PRESETS[kind], ...this.config.modelRoutes?.[kind] };
    const policy: Partial<WorkflowPolicy> = {
      actorTimeoutMs: this.config.actorTimeoutMs ?? 1_800_000,
      maxParallelReviews: this.config.maxParallelReviews ?? 3,
      maxInfrastructureRetries: this.config.maxInfrastructureRetries ?? 1,
      commit: true, routes,
      ...(this.config.largeImplementerProvider && this.config.largeImplementerModel ? {
        largeImplementerRoute: { preset: ROLE_PRESETS.implementer, provider: this.config.largeImplementerProvider,
          model: this.config.largeImplementerModel,
          ...(this.config.largeImplementerEffort ? { effort: this.config.largeImplementerEffort } : {}) },
      } : {}),
    };
    return this.store.withOwner(owner, () => this.controller.create({ goal: request.goal, workspacePath, policy, requireInitialPlanApproval: automaticActivation }));
  }

  @Remote({ resources: { session: (request: RunRequest) => SessionId(request.sessionId) } })
  async status(request: RunRequest): Promise<DevelopmentRun> {
    runRequestSchema.parse(request); this.assertOwner(request); return this.controller.status(request.runId);
  }

  @Remote({ resources: { session: (request: RunRequest) => SessionId(request.sessionId) } })
  async start(request: RunRequest): Promise<DevelopmentRun> {
    runRequestSchema.parse(request); this.assertOwner(request); return this.controller.start(request.runId);
  }

  @Remote({ resources: { session: (request: RunRequest) => SessionId(request.sessionId) } })
  async pause(request: RunRequest): Promise<DevelopmentRun> {
    runRequestSchema.parse(request); this.assertOwner(request); return this.controller.pause(request.runId);
  }

  @Remote({ resources: { session: (request: RunRequest) => SessionId(request.sessionId) } })
  async resume(request: RunRequest): Promise<DevelopmentRun> {
    runRequestSchema.parse(request); this.assertOwner(request); return this.controller.resume(request.runId);
  }

  @Remote({ resources: { session: (request: RunRequest) => SessionId(request.sessionId) } })
  async cancel(request: RunRequest): Promise<DevelopmentRun> {
    runRequestSchema.parse(request); this.assertOwner(request); return this.controller.cancel(request.runId);
  }

  @Remote({ resources: { session: (request: RunRequest) => SessionId(request.sessionId) } })
  async recover(request: RunRequest): Promise<DevelopmentRun> {
    const run = await this.status(request);
    // Startup reconciliation already marks vanished side effects. A client
    // cannot reset other live Runs or bypass an unanswered recovery decision.
    if (run.pendingDecision || !['paused', 'blocked'].includes(run.status)) return run;
    return this.controller.resume(run.id);
  }

  @Remote({ resources: { session: (request: DecideRequest) => SessionId(request.sessionId) } })
  async decide(request: DecideRequest): Promise<DevelopmentRun> {
    request = decideRequestSchema.parse(request); this.assertOwner(request);
    return this.controller.decide(request.runId, { decisionId: request.decisionId, answer: request.answer,
      ...(request.action === undefined ? {} : { action: request.action }),
      ...(request.advisorResult === undefined ? {} : { advisorResult: request.advisorResult }),
      ...(request.advisorAdoption === undefined ? {} : { advisorAdoption: request.advisorAdoption }) });
  }

  @Remote({ resources: { session: (request: ReviseRequest) => SessionId(request.sessionId) } })
  async revise(request: ReviseRequest): Promise<DevelopmentRun> {
    request = reviseRequestSchema.parse(request); this.assertOwner(request); return this.controller.revise(request.runId, request.goal);
  }
}

/** Human command grammar is intentionally small; decision text is retained verbatim. */
export async function executeCommand(service: DevelopmentWorkflowService, agent: Agent, raw: string): Promise<string> {
  const input = raw.trim();
  const split = /^(\S+)(?:\s+([\s\S]*))?$/.exec(input);
  const action = split?.[1] ?? 'list';
  const tail = split?.[2] ?? '';
  const sessionId = String(agent.id);
  if (action === 'help') return '/sfd create <goal> | list | status/start/pause/resume/cancel/recover <run-id> | revise <run-id> <goal> | decide <run-id> <decision-id> <continue|retry|replan|cancel> <answer> | advisor <run-id> <decision-id> <accept|reject|clarify> <continue|replan|cancel> <verbatim-advice>';
  if (action === 'list') return JSON.stringify(await service.list({ sessionId }), null, 2);
  if (action === 'create') return JSON.stringify(await service.create({ sessionId, goal: tail }), null, 2);
  const parts = /^(\S+)(?:\s+([\s\S]*))?$/.exec(tail);
  if (!parts) throw new Error('A Run id is required. Use /sfd help.');
  const runId = parts[1];
  const rest = parts[2] ?? '';
  if (action === 'revise') return JSON.stringify(await service.revise({ sessionId, runId, goal: rest }), null, 2);
  if (action === 'advisor') {
    const answer = /^(\S+)\s+(accept|reject|clarify)\s+(continue|replan|cancel)\s+([\s\S]+)$/.exec(rest);
    if (!answer) throw new Error('Use /sfd advisor <run-id> <decision-id> <accept|reject|clarify> <continue|replan|cancel> <verbatim-advice>.');
    return JSON.stringify(await service.decide(decideRequestSchema.parse({
      sessionId, runId, decisionId: answer[1], advisorAdoption: answer[2], action: answer[3],
      advisorResult: answer[4], answer: `Human disposition: ${answer[2]} external Advisor advice.`,
    })), null, 2);
  }
  if (action === 'decide') {
    const decision = /^(\S+)\s+(continue|retry|replan|cancel)\s+([\s\S]+)$/.exec(rest);
    if (!decision) throw new Error('Use /sfd decide <run-id> <decision-id> <continue|retry|replan|cancel> <answer>.');
    return JSON.stringify(await service.decide(decideRequestSchema.parse({ sessionId, runId, decisionId: decision[1], action: decision[2], answer: decision[3] })), null, 2);
  }
  switch (action) {
    case 'status': return JSON.stringify(await service.status({ sessionId, runId }), null, 2);
    case 'start': return JSON.stringify(await service.start({ sessionId, runId }), null, 2);
    case 'pause': return JSON.stringify(await service.pause({ sessionId, runId }), null, 2);
    case 'resume': return JSON.stringify(await service.resume({ sessionId, runId }), null, 2);
    case 'cancel': return JSON.stringify(await service.cancel({ sessionId, runId }), null, 2);
    case 'recover': return JSON.stringify(await service.recover({ sessionId, runId }), null, 2);
    default: throw new Error('Unknown SFD command. Use /sfd help.');
  }
}

function installEntries(ctx: Context, service: DevelopmentWorkflowService): void {
  ctx.commands.register({
    name: 'sfd', description: 'Manage native sectioned development Runs.', input: { hint: 'create <goal>, list, status/start/pause/resume/cancel/recover <run-id>, decide, revise' },
    recordInput: false,
    handler: async ({ agent, rawInput, signal }) => {
      signal.throwIfAborted();
      try { return { kind: 'success', text: await executeCommand(service, agent, rawInput) }; }
      catch (error) { return { kind: 'error', text: error instanceof Error ? error.message : String(error) }; }
    },
  });
  ctx.tools.register(defineTool({
    name: 'sfd_run',
    description: 'Create or control a durable native development Run for this Session. Creating is separate from starting. Run completion is decided by the Host workflow, not by a final chat reply. User decisions and requirement revisions use the native UI or /sfd command.',
    parameters: {
      action: { type: 'string', required: true, enum: ['create', 'start', 'list', 'status', 'pause', 'resume', 'cancel'] },
      goal: { type: 'string', description: 'Authorized user goal, required only when creating.' },
      run_id: { type: 'string', description: 'This Session’s existing Run id.' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, exec) {
      if (exec.agent === undefined || ctx.agents.get(exec.agent.id) !== exec.agent || exec.agent.session.header.origin === 'subagent') throw new Error('SFD control requires the exact live owning chat Agent.');
      const sessionId = String(exec.agent.id);
      if (args.action === 'list') return JSON.stringify(await service.list({ sessionId }));
      if (args.action === 'create') return JSON.stringify(await service.create({ sessionId, goal: args.goal ?? '' }, true));
      const request = { sessionId, runId: args.run_id ?? '' };
      switch (args.action) {
        case 'start': return JSON.stringify(await service.start(request));
        case 'status': return JSON.stringify(await service.status(request));
        case 'pause': return JSON.stringify(await service.pause(request));
        case 'resume': return JSON.stringify(await service.resume(request));
        case 'cancel': return JSON.stringify(await service.cancel(request));
        default: throw new Error('Unknown SFD tool action.');
      }
    },
  }));
}

/** Mount durable state before exposing operations; startup never replays vanished writes. */
export async function apply(ctx: Context, config: Config = {}): Promise<void> {
  for (const kind of Object.keys(config.modelRoutes ?? {})) if (!(kind in ROLE_PRESETS)) throw new Error(`Unknown configured SFD actor kind: ${kind}`);
  if (Boolean(config.largeImplementerProvider) !== Boolean(config.largeImplementerModel)) throw new Error('Large implementer routing requires both provider and model.');
  const store = await DomainRunStore.open(ctx.storageDomain);
  const actors = new NativeActorRunner(ctx, store);
  const workspace = new GitWorkspace({ stateRoot: config.stateRoot, executeCheck: nativeCheckExecutor(ctx, store) });
  const controller = new WorkflowController({ store, actors, workspace });
  ctx.effect(() => async () => {
    try { await controller.dispose(); }
    finally { try { await actors.dispose(); } finally { await store.close(); } }
  });
  await controller.recover();
  const service = new DevelopmentWorkflowService(ctx, controller, store, config, workspace);
  ctx.typert.register({
    package: 'dsh-sfd', face: 'host', schemas: [],
    model: { services: [{ key: 'developmentWorkflow', exportName: 'DevelopmentWorkflowService', tags: [], members: [], types: [] }], events: [], objects: [] },
    invocations: TYPERT_REMOTE.descriptors,
  });
  installEntries(ctx, service);
  const unsubscribe = controller.subscribe(run => {
    if (run.status === 'completed' || run.status === 'cancelled') void actors.release(run.id).catch(error => ctx.logger.warn(`SFD anchor cleanup failed: ${String(error)}`));
  });
  ctx.effect(() => unsubscribe);
}
