import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Context } from '@deepseek-ai/cordis';
import Loader from '@deepseek-ai/cordis-plugin-loader';
import Storage from '@deepseek-ai/dsh-storage';
import type { KvUnit, StorageBackend } from '@deepseek-ai/dsh-storage';
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain';
import AgentLoop from '@deepseek-ai/dsh-agent-loop';
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit';
import AgentPresets from '@deepseek-ai/dsh-agent-preset-registry';
import { LlmAdapter, ToolCallId } from '@deepseek-ai/dsh-llm';
import type { GenerateOptions, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm';
import { SessionId } from '@deepseek-ai/dsh-session';
import * as SessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl';
import SubagentRuntime from '@deepseek-ai/dsh-subagent';
import * as Spawn from '@deepseek-ai/dsh-subagent-spawn-in-process';
import SandboxPolicy from '@deepseek-ai/dsh-sandbox-policy';
import UserApproval from '@deepseek-ai/dsh-user-approval';
import Commands from '@deepseek-ai/dsh-commands';
import Typert from '@deepseek-ai/dsh-typert-registry';
import Subprocess from '@deepseek-ai/dsh-subprocess-local';
import BashLocal from '@deepseek-ai/dsh-bash-local';
import BashSandbox from '@deepseek-ai/dsh-bash-sandbox';
import * as ShellEnv from '@deepseek-ai/dsh-shell-env';
import { ShellExecutor } from '@deepseek-ai/dsh-shell';
import type { ShellExecRequest, ShellExecSpec, ShellExecution } from '@deepseek-ai/dsh-shell';
import { SandboxProvider, SandboxUnavailableError } from '@deepseek-ai/dsh-sandbox';
import type { ConfinedArgv, SandboxPolicy as ExecutionSandboxPolicy } from '@deepseek-ai/dsh-sandbox';
import { assertObjectJsonSchema } from '@deepseek-ai/dsh-tools';
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools';
import { RemoteError, remoteMethods } from '@deepseek-ai/dsh-typert-protocol';
import { actorOutputSchemas, outputSchemaFor } from '../src/core/contracts.js';
import { WorkflowController } from '../src/core/controller.js';
import type { ActorKind, ActorTask, DevelopmentRun, WorkspaceInfo } from '../src/core/types.js';
import type { ActorRunner, WorkspacePort } from '../src/core/ports.js';
import { DomainRunStore, type RunOwner } from '../src/dsh/store.js';
import { NativeActorRunner, nativeAgentOptions, validateActorRoute } from '../src/dsh/actors.js';
import { nativeCheckExecutor, quoteArgv } from '../src/dsh/checks.js';
import { containedWorkspace, DevelopmentWorkflowService } from '../src/dsh/index.js';
import * as Sfd from '../src/dsh/index.js';
import { TYPERT_REMOTE } from '../src/dsh/remote-contract.js';
import { ROLE_PRESETS, ROLE_SPECS } from '../src/roles/index.js';
import { runProcess } from '../src/workspace/process.js';

/** Durable media fixture under the real DSH DomainFacility, with fail-before-write injection. */
class MemoryBackend implements StorageBackend {
  rows: Record<string, Record<string, unknown>> = {};
  failWrite = false;
  readonly kv = { open: async (): Promise<KvUnit> => ({
    loadAll: async () => ({ tables: structuredClone(this.rows), global: null }),
    putRecord: async (table, key, value) => {
      if (this.failWrite) { this.failWrite = false; throw new Error('Injected durable write failure.'); }
      (this.rows[table] ??= {})[key] = structuredClone(value);
    },
    deleteRecord: async (table, key) => { delete this.rows[table]?.[key]; },
    setGlobal: async () => { throw new Error('No global fixture data.'); },
    close: async () => {},
  }) };
  async close(): Promise<void> {}
}

const owner: RunOwner = { sessionId: 'owner', sourceRoot: '/tmp', sandboxMode: 'workspace-write', provider: 'fixture', model: 'fixture' };
const idleActors: ActorRunner = { start: async () => { throw new Error('No actor expected in this test.'); } };
function workspaceFixture(path = '/tmp'): WorkspacePort {
  const info: WorkspaceInfo = { path, branch: 'main', baseCommit: '0'.repeat(40) };
  return {
    inspect: async () => info, prepare: async () => ({ ...info, prepared: true }),
    capture: async () => { throw new Error('No capture expected.'); },
    check: async () => [], commit: async () => { throw new Error('No commit expected.'); },
    reconcile: async () => ({ safe: true }),
  };
}

async function storage(ctx: Context): Promise<{ facility: DomainFacility; backend: MemoryBackend }> {
  await ctx.plugin(Storage);
  const backend = new MemoryBackend();
  ctx.storage.backend.register('memory', backend);
  const facility = new DomainFacility(ctx, { backend: 'memory' });
  ctx.provide('storageDomain', facility);
  ctx.effect(() => () => facility.closeAll());
  return { facility, backend };
}

test('native domain atomically stores ownership and protects memory on durable rejection', async () => {
  const ctx = new Context();
  const { facility, backend } = await storage(ctx);
  const store = await DomainRunStore.open(facility);
  const controller = new WorkflowController({ store, actors: idleActors, workspace: workspaceFixture() });
  try {
    await assert.rejects(controller.create({ goal: 'Missing owner', workspacePath: '/tmp' }), /captured native owner/);
    const run = await store.withOwner(owner, () => controller.create({ goal: 'Owned task', workspacePath: '/tmp' }));
    assert.equal(store.ownerOf(run.id)?.sessionId, 'owner');
    const writes = await Promise.all(Array.from({ length: 8 }, () => store.update(run.id, value => ({ ...value, revision: value.revision + 1 }))));
    assert.equal((await store.get(run.id))?.revision, 8);
    assert.equal(new Set(writes.map(value => value.revision)).size, 8);
    backend.failWrite = true;
    await assert.rejects(store.update(run.id, value => ({ ...value, revision: 999 })), /Injected durable/);
    assert.equal((await store.get(run.id))?.revision, 8);
    const copy = (await store.get(run.id))!; copy.goal = 'In-place mutation';
    assert.equal((await store.get(run.id))?.goal, 'Owned task');
    await assert.rejects(store.update(run.id, value => ({ ...value, schemaVersion: 9 } as unknown as DevelopmentRun)), /Invalid/);
    await store.close();
    const reloaded = await DomainRunStore.open(facility);
    assert.equal((await reloaded.get(run.id))?.revision, 8);
    await reloaded.close();
    const envelope = backend.rows.runs[run.id] as { run: { schemaVersion: number } };
    envelope.run.schemaVersion = 99;
    await assert.rejects(DomainRunStore.open(facility), /does not match/);
  } finally { await controller.dispose(); await store.close(); await ctx.fiber.dispose(); }
});

test('native structured-output schemas validate against published DSH and routes cannot escape policy', () => {
  for (const kind of Object.keys(actorOutputSchemas) as ActorKind[]) assertObjectJsonSchema(outputSchemaFor(kind));
  const task = { kind: 'reviewer-a', route: { preset: ROLE_PRESETS['reviewer-a'], provider: 'fixture', model: 'fixture' } } as ActorTask;
  validateActorRoute(task, { model: 'fixture', provider: 'fixture', preset: ROLE_PRESETS['reviewer-a'] });
  assert.throws(() => validateActorRoute(task, { preset: ROLE_PRESETS['reviewer-a'], provider: 'other', model: 'other' }), /admitted Run policy/);
  assert.throws(() => validateActorRoute({ ...task, route: { preset: ROLE_PRESETS.implementer } }, task.route), /native role preset/);
  assert.equal(nativeAgentOptions({ ...owner, effort: 'high' }, { preset: ROLE_PRESETS.implementer, provider: 'new', model: 'new' }).reasoningEffort, undefined);
});

test('check argv remains literal and canonical workspace checks refuse traversal and symlinks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sfd-scope-'));
  try {
    await mkdir(join(root, 'owned')); await mkdir(join(root, 'outside'));
    await symlink(join(root, 'outside'), join(root, 'owned', 'escape'));
    assert.equal(await containedWorkspace(join(root, 'owned')), join(root, 'owned'));
    await assert.rejects(containedWorkspace(join(root, 'owned'), '../outside'), /within/);
    await assert.rejects(containedWorkspace(join(root, 'owned'), 'escape'), /within/);
    const argv = ['printf', '%s\n', '$(touch should-not-exist)', "a'b", ''];
    const value = await runProcess(['bash', '-c', quoteArgv(argv)], { cwd: root });
    assert.equal(value.exitCode, 0);
    assert.equal(value.output, `${argv.slice(2).join('\n')}\n`);
    await assert.rejects(readFile(join(root, 'should-not-exist')));
  } finally { await rm(root, { recursive: true, force: true }); }
});

class StructuredFixtureAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = [];
  output: object = { verdict: 'clean', summary: 'Inspected fixture.', coverage: ['The fixture criterion'], limitations: [], findings: [] };
  hold = false;
  release?: () => void;
  reached?: () => void;
  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> { return { provider, id: model, name: model }; }
  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options); this.reached?.();
    if (this.hold) await new Promise<void>((resolve, reject) => {
      this.release = resolve;
      const abort = (): void => reject(new Error('Fixture request cancelled.'));
      options.signal?.addEventListener('abort', abort, { once: true });
      if (options.signal?.aborted) abort();
    });
    const id = ToolCallId(`fixture-${this.requests.length}`);
    const argumentsJson = JSON.stringify(this.output);
    yield { type: 'block-start', index: 0, blockType: 'tool-call' };
    yield { type: 'tool-call-delta', index: 0, id, name: 'structured_output', argumentsDelta: argumentsJson };
    yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: 'structured_output', arguments: argumentsJson } };
    yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 10 } };
    yield { type: 'finish', reason: { kind: 'tool-calls' } };
  }
}

/** A sentinel executor: this fixture verifies policy denial before any shell dispatch. */
class CheckGateProbe extends ShellExecutor {
  attempts = 0;
  override get sandboxMode(): 'workspace-write' { return 'workspace-write'; }
  resolve(_request: ShellExecRequest): ShellExecSpec { this.attempts++; throw new Error('Denied check reached the shell resolver.'); }
  async execute(_spec: ShellExecSpec): Promise<ShellExecution> { this.attempts++; throw new Error('Denied check reached shell execution.'); }
}

/** No fake confinement facts: the positive test explicitly uses native danger-full-access. */
class UnavailableTestSandbox extends SandboxProvider {
  attempts = 0;
  async confine(_argv: readonly string[], policy: ExecutionSandboxPolicy): Promise<ConfinedArgv> {
    this.attempts++;
    throw new SandboxUnavailableError(policy.mode, 'This test provider offers no OS confinement.');
  }
}

async function nativeHost(root: string, shell: 'local' | 'gate' | 'full-access' = 'local'): Promise<{ ctx: Context; adapter: StructuredFixtureAdapter; facility: DomainFacility }> {
  const ctx = new Context();
  ctx.baseUrl = pathToFileURL(`${process.cwd()}/`).href;
  await ctx.plugin(Loader);
  await mountAgentLoopTestDependencies(ctx, { workingDirectory: true });
  await ctx.plugin(Typert);
  await ctx.plugin(Commands);
  await ctx.plugin(SandboxPolicy, { mode: 'workspace-write' });
  await ctx.plugin(UserApproval, { policy: 'never' });
  await ctx.plugin(Subprocess);
  if (shell === 'gate') await ctx.plugin(CheckGateProbe);
  else if (shell === 'full-access') {
    await ctx.plugin(UnavailableTestSandbox);
    await ctx.plugin(BashSandbox, { cwd: root });
  } else await ctx.plugin(BashLocal, { cwd: root });
  await ctx.plugin(ShellEnv);
  await ctx.plugin(SessionPersistence, { root: join(root, 'sessions') });
  await ctx.plugin(SubagentRuntime);
  await ctx.plugin(Spawn, { providerName: 'spawn' });
  await ctx.plugin(AgentLoop, { agents: [] });
  await ctx.plugin(AgentPresets, { default: 'sfd-planner' });
  for (const [kind, role] of Object.entries(ROLE_SPECS)) {
    await ctx.agentPresets.register({
      id: role.presetId,
      plugins: [
        { name: '@deepseek-ai/dsh-agent-instructions', config: { maxBytes: 65536 } },
        { name: '@deepseek-ai/dsh-tool-fs', config: { write: role.access === 'writer', edit: role.access === 'writer' } },
        { name: '@deepseek-ai/dsh-tool-fs-search', config: { sampleOverCapGlobResults: false } },
        ...(role.access === 'writer' ? [{ name: '@deepseek-ai/dsh-tool-bash', config: { enableRunInBackground: false, promoteOnTimeout: false } }] : []),
        { name: pathToFileURL(join(process.cwd(), 'src/dsh/role-policy.ts')).href, config: { kind } },
      ],
    });
  }
  const adapter = new StructuredFixtureAdapter();
  ctx.llm.registerAdapter(['fixture'], adapter);
  const { facility } = await storage(ctx);
  return { ctx, adapter, facility };
}

test('real DSH spawn keeps its Host anchor, isolates role tools, captures structured output and bounds cancellation', { timeout: 30_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'sfd-native-'));
  const { ctx, adapter, facility } = await nativeHost(root);
  const store = await DomainRunStore.open(facility);
  const controller = new WorkflowController({ store, actors: idleActors, workspace: workspaceFixture(root) });
  const runner = new NativeActorRunner(ctx, store);
  try {
    const user = await ctx.agents.create({ sessionId: SessionId('owner'), agentOptions: { provider: 'fixture', model: 'fixture' }, meta: { cwd: root } });
    const run = await store.withOwner({ ...owner, sourceRoot: root }, () => controller.create({ goal: 'Fixture goal', workspacePath: root }));
    await assert.rejects(nativeCheckExecutor(ctx, store)({
      run, spec: { id: 'unsafe-backend', command: ['printf', 'unconfined'], required: true }, cwd: root, timeoutMs: 1_000,
    }), /sandboxing DSH shell is required/);
    const task: ActorTask = {
      id: 'review-native', runId: run.id, kind: 'reviewer-a', inputContractVersion: 1, controlEpoch: 0,
      workspace: run.workspace, input: { goal: run.goal }, outputSchema: outputSchemaFor('reviewer-a'), timeoutMs: 10_000,
    };
    adapter.hold = true;
    const called = new Promise<void>(resolve => { adapter.reached = resolve; });
    const handle = await runner.start(task, new AbortController().signal);
    await called;
    const child = ctx.agents.get(SessionId(handle.id));
    assert.ok(child);
    assert.equal(ctx.sandboxPolicy.resolve({ session: child.session }).mode, 'read-only');
    const tools = adapter.requests[0].tools?.map(tool => tool.name) ?? [];
    for (const tool of ['read', 'grep', 'glob', 'structured_output']) assert.ok(tools.includes(tool), `${tool} must be in the actual actor request`);
    for (const tool of ['write', 'edit', 'bash', 'sfd_run', 'spawn_agent']) assert.ok(!tools.includes(tool), `${tool} must be absent from the reviewer request`);
    const denied = await ctx.tools.execute({ name: 'write', callId: ToolCallId('blocked-write'), arguments: { file_path: join(root, 'blocked'), content: 'no' }, agent: child, signal: new AbortController().signal });
    assert.equal(denied.isError, true);
    await user.dispose();
    assert.equal(ctx.agents.get(SessionId(handle.id)), child, 'disposing the chat does not own the workflow actor');
    assert.equal(adapter.requests.length, 1, 'anchor did not run a model');
    adapter.release?.();
    const outcome = await handle.result;
    assert.equal(outcome.status, 'completed', outcome.error);
    assert.deepEqual(outcome.output, adapter.output);
    assert.equal(outcome.identity.observed?.model, 'fixture');
    assert.equal(outcome.identity.observed?.preset, ROLE_PRESETS['reviewer-a']);
    adapter.hold = false;
    adapter.output = { summary: 'Fixture implementation.', completedCriteria: ['criterion'], remainingWork: [], changedInterfaces: [] };
    const writer = await runner.start({ ...task, id: 'writer-native', kind: 'implementer', outputSchema: outputSchemaFor('implementer') }, new AbortController().signal);
    assert.equal((await writer.result).status, 'completed');
    const writerTools = adapter.requests.at(-1)?.tools?.map(tool => tool.name) ?? [];
    for (const tool of ['write', 'edit', 'bash', 'read', 'grep', 'structured_output']) assert.ok(writerTools.includes(tool), `writer needs ${tool}`);
    adapter.hold = true;
    const timeout = await runner.start({ ...task, id: 'timeout-native', timeoutMs: 150 }, new AbortController().signal);
    assert.equal((await timeout.result).status, 'failed', 'actor deadline is a bounded failure');
  } finally { await runner.dispose(); await controller.dispose(); await store.close(); await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }); }
});

test('native check execution honors the real pre-tool policy gate before shell dispatch', { timeout: 30_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'sfd-check-gate-'));
  const { ctx, facility, adapter } = await nativeHost(root, 'gate');
  const store = await DomainRunStore.open(facility);
  const controller = new WorkflowController({ store, actors: idleActors, workspace: workspaceFixture(root) });
  try {
    const run = await store.withOwner({ ...owner, sourceRoot: root }, () => controller.create({ goal: 'Checks obey permissions', workspacePath: root }));
    let checkedOwner: string | undefined;
    ctx.on('tools/pre-execute', async (exec, next) => {
      if (exec.name !== 'sfd_check') return next();
      checkedOwner = exec.agent?.session.header.parentSession;
      assert.equal(ctx.sandboxPolicy.resolve({ session: exec.agent?.session }).mode, 'workspace-write');
      return { kind: 'deny', reason: 'Fixture policy denied the check.' };
    });
    await assert.rejects(nativeCheckExecutor(ctx, store)({
      run, spec: { id: 'gate', command: ['printf', 'never executed'], required: true }, cwd: root, timeoutMs: 1_000,
    }), /Fixture policy denied the check/);
    assert.equal(checkedOwner, owner.sessionId);
    assert.ok(ctx.shell instanceof CheckGateProbe);
    assert.equal(ctx.shell.attempts, 0, 'the policy gate precedes resolve and execution');
    assert.equal(adapter.requests.length, 0, 'the check Agent is idle and makes no model request');
    assert.equal(ctx.agents.list().length, 0, 'the ephemeral check Agent is disposed after denial');
  } finally { await controller.dispose(); await store.close(); await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }); }
});

test('native check success roundtrips real BashSandbox output through tools with an explicit full-access owner', { timeout: 30_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'sfd-check-success-'));
  const { ctx, facility, adapter } = await nativeHost(root, 'full-access');
  const store = await DomainRunStore.open(facility);
  const controller = new WorkflowController({ store, actors: idleActors, workspace: workspaceFixture(root) });
  try {
    const run = await store.withOwner({ ...owner, sourceRoot: root, sandboxMode: 'danger-full-access' },
      () => controller.create({ goal: 'Read a bounded check result', workspacePath: root }));
    let observed: ToolExecutionResult | undefined;
    let observedMode: string | undefined;
    ctx.on('tools/result', (exec, result) => {
      if (exec.name === 'sfd_check') {
        observed = structuredClone(result);
        observedMode = ctx.sandboxPolicy.resolve({ session: exec.agent?.session }).mode;
      }
      return undefined;
    });
    const result = await nativeCheckExecutor(ctx, store)({
      run, spec: { id: 'printf', command: ['printf', '%s\\n', 'native check roundtrip'], required: true }, cwd: root, timeoutMs: 2_000,
    });
    assert.deepEqual(result, { exitCode: 0, output: 'native check roundtrip\n', timedOut: false, cancelled: false, truncated: false });
    assert.ok(observed && !observed.isError, 'the actual native tool result passed its output schema');
    assert.deepEqual(observed.value, result, 'ctx.tools.execute preserved the canonical structured value');
    assert.deepEqual(observed.content, [{ type: 'text', text: result.output }]);
    assert.equal(observedMode, 'danger-full-access', 'the check retained its explicit owner permission mode');
    assert.ok(ctx.shell instanceof BashSandbox);
    assert.ok(ctx.sandbox instanceof UnavailableTestSandbox);
    assert.equal(ctx.sandbox.attempts, 0, 'native full-access does not claim or require OS confinement');
    assert.equal(adapter.requests.length, 0, 'a Host check never starts a model loop');
    assert.equal(ctx.agents.list().length, 0, 'the successful check Agent was disposed');
  } finally { await controller.dispose(); await store.close(); await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }); }
});

test('real Host service mounts strict Remote/command surfaces and fences Run and repository ownership', { timeout: 30_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'sfd-host-'));
  const project = join(root, 'project'); await mkdir(project);
  await runProcess(['git', 'init', '--initial-branch=main'], { cwd: project });
  await runProcess(['git', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '--allow-empty', '-m', 'initial'], { cwd: project });
  const { ctx } = await nativeHost(root);
  try {
    await ctx.plugin(Sfd, { stateRoot: join(root, 'workflows') });
    const user = await ctx.agents.create({ sessionId: SessionId('owner'), meta: { cwd: project }, agentOptions: { provider: 'fixture', model: 'fixture' } });
    const service = ctx.developmentWorkflow;
    assert.ok(service instanceof DevelopmentWorkflowService);
    const run = await service.create({ sessionId: 'owner', goal: 'Native workflow task' });
    assert.equal(run.status, 'draft'); assert.equal(run.policy.commit, false);
    assert.equal((await service.list({ sessionId: 'owner' })).length, 1);
    assert.deepEqual(await service.list({ sessionId: 'unrelated' }), []);
    await assert.rejects(service.status({ sessionId: 'unrelated', runId: run.id }), (error: unknown) => error instanceof RemoteError && error.code === 'development-workflow/not-found');
    const descriptors = remoteMethods(service);
    assert.equal(descriptors.length, 10);
    assert.ok(descriptors.every(method => method.resources?.session !== undefined));
    assert.equal(ctx.typert.local.get('developmentWorkflow/create')?.result.mode, 'strict');
    assert.throws(() => TYPERT_REMOTE.methods['developmentWorkflow/create'].input({ strict: true }).create().parse({ request: { sessionId: 'owner', goal: 'x', routes: {} } }));
    assert.ok(ctx.commands.list(user.agent).some(command => command.name === 'sfd'));
    assert.ok(ctx.tools.schemas(user.agent).some(tool => tool.name === 'sfd_run'));
    const subdir = join(project, 'subdir'); await mkdir(subdir);
    await ctx.agents.create({ sessionId: SessionId('narrow'), meta: { cwd: subdir }, agentOptions: { provider: 'fixture', model: 'fixture' } });
    await assert.rejects(service.create({ sessionId: 'narrow', goal: 'Must not gain parent repo' }), /within the owner/);
    assert.deepEqual(await service.list({ sessionId: 'narrow' }), []);
    const unchanged = await service.recover({ sessionId: 'owner', runId: run.id });
    assert.equal(unchanged.status, 'draft');
  } finally { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }); }
});
