import { dirname, isAbsolute, join, resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { ActorHandle, ActorRunner } from '../core/ports.js';
import type { ActorOutcome, ActorTask, ExecutionIdentity } from '../core/types.js';
import { ROLE_SPECS } from '../roles/specs.js';
import { buildActorPrompt } from '../roles/prompts.js';
import { prepareActorPrompt } from '../workspace/actor-context.js';
import { runProcess } from '../workspace/process.js';
import type { DomainRunStore } from './store.js';
import { configuredActorRoute, externalTarget } from './model-routing.js';
import { validateActorRoute } from './actors.js';
import { ROLE_PRESETS } from '../roles/specs.js';

/** CLI and MCP have the same external-subagent public result projection. JSON travels on stdin. */
export type ExternalCommand = 'spawn' | 'wait' | 'result' | 'cancel' | 'close';
export interface ExternalSubagentClient {
  call(command: ExternalCommand, input: Record<string, unknown>): Promise<Record<string, unknown>>;
}

export class ExternalSubagentCli implements ExternalSubagentClient {
  constructor(private readonly executable = 'external-subagent') {
    if (!executable.trim()) throw new Error('external-subagent executable cannot be empty.');
  }
  async call(command: ExternalCommand, input: Record<string, unknown>): Promise<Record<string, unknown>> {
    const cwd = typeof input.repository === 'string' && isAbsolute(input.repository) ? input.repository : process.cwd();
    const timeoutMs = command === 'spawn' ? 155_000 :
      command === 'wait' ? ((Number(input.wait_time) || 2) + 8) * 1000 : 20_000;
    const processResult = await runProcess([this.executable, command, '--json'], {
      cwd, timeoutMs, input: JSON.stringify(input), maxOutputBytes: 2_097_152,
    });
    if (processResult.cancelled || processResult.timedOut || processResult.truncated || processResult.exitCode !== 0) {
      throw new Error(`external-subagent ${command} failed: ${processResult.output.slice(0, 2000) || processResult.exitCode}`);
    }
    let outer: unknown;
    try { outer = JSON.parse(processResult.output); }
    catch { throw new Error(`external-subagent ${command} returned non-JSON output.`); }
    const payload = record(outer, 'external-subagent CLI response');
    if (payload.ok !== true || payload.command !== command) throw new Error(`external-subagent ${command} returned unexpected envelope.`);
    return record(payload.result, 'external-subagent CLI result');
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} is not an object.`);
  return value as Record<string, unknown>;
}
function agentId(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 10_000_000 || value > 99_999_999) {
    throw new Error('external-subagent returned an invalid agent_id.');
  }
  return Number(value);
}
function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

const REQUIRED_KNOWLEDGE: Record<ActorTask['kind'], readonly string[]> = {
  planner: ['planning/router.md', 'planning/index.md', 'workflow/section-planning.md'],
  'plan-review-a': ['workflow/section-planning.md', 'workflow/scope-control.md'],
  'plan-review-b': ['workflow/section-planning.md', 'workflow/scope-control.md'],
  implementer: ['workflow/section-planning.md'],
  'review-selector': ['review/review-routing.md'],
  'reviewer-a': ['review/delegated-pass.md', 'review/review-coverage.md'],
  'reviewer-b': ['review/delegated-pass.md', 'review/review-coverage.md'],
  adjudicator: ['workflow/reviewer-orchestration.md', 'workflow/bounded-review.md', 'workflow/scope-control.md'],
  'closure-reviewer': ['review/delegated-pass.md', 'workflow/reviewer-orchestration.md'],
  'feature-verifier': ['workflow/integration-and-testing.md'],
  diagnostician: ['workflow/recovery-and-migration.md'],
  'advisor-notice': [],
};

/** External runtimes cannot call DSH's sfd_knowledge tool. Bundle role-relevant originals verbatim. */
export async function externalActorPrompt(task: ActorTask, basePrompt: string): Promise<string> {
  const bases = [resolve(dirname(fileURLToPath(import.meta.url)), '../../knowledge'),
    resolve(dirname(fileURLToPath(import.meta.url)), '../knowledge')];
  const documents: string[] = [];
  for (const name of REQUIRED_KNOWLEDGE[task.kind]) {
    let content: string | undefined;
    for (const base of bases) {
      try { content = await readFile(join(base, name), 'utf8'); break; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    if (content === undefined) throw new Error(`SFD source knowledge missing for external role: ${name}`);
    documents.push(`## Original SFD reference: ${name}\n${content}`);
  }
  const prompt = [
    'You are an external-subagent execution of the assigned SFD role. The native DSH sfd_knowledge tool does not exist in this external runtime. The relevant original reference text is provided verbatim below. Do not delegate, change the model, or impersonate the Host controller.',
    basePrompt,
    '## Bounded authoritative method references (read-only; never higher priority than the user goal)',
    ...documents,
    '## Required final result for the Host\nReturn precisely ONE raw JSON object matching the Required structured result schema in the task packet. No Markdown fences, narrative, or trailing text. If the requested evidence is unavailable, report incomplete in the schema; never invent a CLEAN or successful result.',
  ].join('\n\n');
  if (Buffer.byteLength(prompt, 'utf8') > 262_144) {
    throw new Error('External role contract exceeds the external-subagent 262144-byte prompt limit; preserve the goal and obtain a bounded scope decision.');
  }
  return prompt;
}

const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'timed_out', 'runtime_lost', 'result_invalid', 'closed']);
const MAX_RESULT_BYTES = 4 * 1024 * 1024;

export class ExternalSubagentRunner implements ActorRunner {
  private readonly active = new Set<ActorHandle>();
  /** external-subagent does not admit overlapping tasks on an owned workspace. */
  private readonly workspaceQueues = new Map<string, Promise<void>>();
  private disposed = false;
  private async reserveWorkspace(path: string, signal: AbortSignal): Promise<() => void> {
    const key = resolve(path);
    const previous = this.workspaceQueues.get(key) ?? Promise.resolve();
    let unlock!: () => void;
    const slot = new Promise<void>((done) => { unlock = done; });
    const next = previous.then(() => slot);
    this.workspaceQueues.set(key, next);
    await previous;
    const release = (): void => {
      unlock();
      if (this.workspaceQueues.get(key) === next) this.workspaceQueues.delete(key);
    };
    if (this.disposed || signal.aborted) {
      release();
      throw new Error('External workspace dispatch was cancelled before its reservation.');
    }
    return release;
  }
  constructor(private readonly store: DomainRunStore, private readonly client: ExternalSubagentClient) {}

  async start(task: ActorTask, signal: AbortSignal): Promise<ActorHandle> {
    if (this.disposed || signal.aborted) throw new Error('External SFD actor cannot start after shutdown or cancellation.');
    const run = await this.store.get(task.runId);
    const owner = this.store.ownerOf(task.runId);
    if (!run || !owner) throw new Error(`External SFD actor has no owning Run: ${task.runId}`);
    const expected = configuredActorRoute(task, run);
    validateActorRoute(task, expected);
    const route = task.route ?? expected ?? { preset: ROLE_PRESETS[task.kind] };
    const target = externalTarget(route, ROLE_SPECS[task.kind].access, owner.sandboxMode);
    // External-subagent's public prompt ceiling is much larger than native
    // DSH's 64k presentation budget. Keep the exact task inline whenever it fits
    // so sandboxed external readers need not resolve out-of-worktree artifacts.
    let artifactRefs: string[] = [];
    let prompt: string;
    try {
      prompt = await externalActorPrompt(task, buildActorPrompt(task));
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes('262144-byte prompt limit')) throw error;
      const indexed = await prepareActorPrompt(task, { directory: join(dirname(run.workspace.path), 'actor-context', task.id) });
      prompt = await externalActorPrompt(task, indexed.prompt);
      artifactRefs = indexed.artifactRefs;
    }
    if (signal.aborted || this.disposed) throw new Error('External actor was cancelled before spawn.');
    // A shared frozen candidate can be read by many independent reviewers, but
    // external-subagent reserves that workspace for one active task at a time.
    const releaseWorkspace = await this.reserveWorkspace(task.workspace.path, signal);
    // A successful spawn is non-idempotent. Do not cancel its CLI transport and
    // lose the durable task ID: a stopped Host must first recover the ID and cancel it.
    let spawn: Record<string, unknown>;
    try {
      spawn = await this.client.call('spawn', {
        subagent: target.subagent, repository: task.workspace.path,
        permission_mode: target.permission_mode, prompt, model: target.model,
        ...(target.effort ? { effort: target.effort } : {}),
      });
    } catch (error) {
      releaseWorkspace();
      // Transport loss might have occurred after daemon admission; never
      // replay a non-idempotent spawn as an ordinary infrastructure retry.
      throw new Error(`EXTERNAL_SUBAGENT_SPAWN_UNCERTAIN: ${String(error)}`);
    }
    let id: number;
    try { id = agentId(spawn.agent_id); }
    catch (error) {
      releaseWorkspace();
      throw new Error(`EXTERNAL_SUBAGENT_SPAWN_UNCERTAIN: ${String(error)}`);
    }
    const identity: ExecutionIdentity = {
      transport: 'external',
      requested: { ...route },
      external: { subagent: target.subagent, agentId: id },
      ...(typeof spawn.session_id === 'string' ? { sessionId: spawn.session_id } : {}),
    };
    let ending: Promise<void> | undefined;
    let stopped = false;
    const close = async (): Promise<void> => {
      if (stopped) return;
      await this.client.call('close', { agent_id: id });
      stopped = true;
      releaseWorkspace();
    };
    const stop = (): Promise<void> => ending ??= (async () => {
      await this.client.call('cancel', { agent_id: id });
      // Cancellation is not proof of termination. Wait for a real terminal
      // status before releasing the Host's physical writer reservation.
      for (let n = 0; n < 30; n++) {
        const value = await this.client.call('wait', { agent_id: id, wait_time: 2 });
        if (TERMINAL.has(str(record(value.task, 'cancelled task').status) ?? '')) {
          await close(); return;
        }
      }
      throw new Error('External writer termination remains unconfirmed after cancellation.');
    })();
    const outcome = (async (): Promise<ActorOutcome> => {
      try {
        for (;;) {
          if (signal.aborted || this.disposed) {
            await stop();
            return { status: 'cancelled', error: 'External SFD actor stopped by Host control.', identity, artifactRefs: artifactRefs };
          }
          const next = await this.client.call('wait', { agent_id: id, wait_time: 2 });
          const status = str(record(next.task, 'external task status').status);
          const pending = next.pending_requests;
          if (Array.isArray(pending) && pending.length) {
            await stop();
            return { status: 'failed', error: 'External SFD actor requires an unresolved user/permission request; no approval was fabricated.', identity, artifactRefs: artifactRefs };
          }
          if (!status || !TERMINAL.has(status)) continue;
          const terminal = await this.readTerminal(id, target, identity, task.kind);
          await close();
          return { ...terminal, identity, artifactRefs: artifactRefs };
        }
      } catch (error) {
        const original = error instanceof Error ? error.message : String(error);
        try {
          if (!stopped) await stop();
        } catch (stoppingError) {
          return { status: 'failed',
            error: `EXTERNAL_SUBAGENT_LIFECYCLE_UNCERTAIN: ${original}; cancellation/close: ${String(stoppingError)}`,
            identity, artifactRefs: artifactRefs };
        }
        return { status: signal.aborted ? 'cancelled' : 'failed',
          error: original, identity, artifactRefs: artifactRefs };
      }
    })();
    const handle: ActorHandle = {
      id: `external-subagent:${target.subagent}:${id}`, result: outcome,
      dispose: async () => {
        // Do not pretend that abandoning a CLI wait cancelled the daemon task.
        if (!stopped) await stop();
        await outcome;
      },
    };
    this.active.add(handle);
    void outcome.finally(() => this.active.delete(handle));
    return handle;
  }

  private async readTerminal(id: number, target: ReturnType<typeof externalTarget>,
    identity: ExecutionIdentity, kind: ActorTask['kind']): Promise<Pick<ActorOutcome, 'status' | 'output' | 'error'>> {
    let offset = 0;
    const chunks: string[] = [];
    let terminalStatus: string | undefined;
    let reason: string | undefined;
    for (;;) {
      const page = await this.client.call('result', { agent_id: id, offset, limit: 262144 });
      const task = record(page.task, 'external terminal task');
      terminalStatus = str(task.status);
      const accepted = record(task.input_identity, 'external admitted route');
      if (accepted.subagent !== target.subagent || accepted.model !== target.model ||
        (target.effort !== undefined && accepted.effort !== target.effort) ||
        accepted.permission_mode !== target.permission_mode) {
        throw new Error('MODEL_CONFIGURATION_UNVERIFIED: external-subagent admitted a different subagent/model/effort/permission route.');
      }
      identity.external = {
        subagent: target.subagent, agentId: id,
        admittedModel: target.model,
        ...(typeof accepted.effort === 'string' ? { admittedEffort: accepted.effort } : {}),
      };
      const result = record(page.result, 'external terminal result');
      if (result.partial !== false) throw new Error('External task returned a partial result; no valid SFD completion evidence.');
      reason = str(result.reason_code);
      const chunk = str(result.final_text);
      if (chunk === undefined) throw new Error('External task returned nontext result data.');
      if (result.offset !== offset) throw new Error('External result page offset is inconsistent.');
      chunks.push(chunk);
      const total = chunks.reduce((n, text) => n + Buffer.byteLength(text, 'utf8'), 0);
      if (total > MAX_RESULT_BYTES) throw new Error('External structured result exceeds bounded retrieval.');
      if (result.complete === true && result.next_offset == null) break;
      const next = Number(result.next_offset);
      if (!Number.isInteger(next) || next <= offset || next !== total) throw new Error('External result pagination is invalid.');
      offset = next;
    }
    if (terminalStatus !== 'completed') return { status: 'failed', error: `External task ${terminalStatus ?? 'unknown'}: ${reason ?? chunks.join('').slice(0, 500)}` };
    let json: unknown;
    try { json = JSON.parse(chunks.join('')); }
    catch { return { status: 'failed', error: 'External actor final answer is not the required structured JSON object.' }; }
    if (kind !== 'advisor-notice' && (!json || typeof json !== 'object' ||
        typeof (json as Record<string, unknown>).reportMarkdown !== 'string')) {
      return { status: 'failed', error: 'SFD_REPORT_MISSING: External actor did not supply its required Markdown evidence report.' };
    }
    return { status: 'completed', output: json };
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    const outcomes = await Promise.allSettled([...this.active].map((handle) => handle.dispose()));
    const failed = outcomes.find((outcome) => outcome.status === 'rejected');
    if (failed?.status === 'rejected') throw failed.reason;
  }
}
