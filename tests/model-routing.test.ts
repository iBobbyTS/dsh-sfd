import assert from 'node:assert/strict';
import test from 'node:test';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPolicy } from '../src/core/policy.js';
import { outputSchemaFor } from '../src/core/contracts.js';
import { Context } from '@deepseek-ai/cordis';
import { ModelFamilyActorRunner } from '../src/dsh/routing-runner.js';
import type { ActorTask, ActorRoute, DevelopmentRun } from '../src/core/types.js';
import { ExternalSubagentCli, ExternalSubagentRunner, externalActorPrompt, type ExternalSubagentClient, type ExternalCommand } from '../src/dsh/external-actor.js';
import { configuredActorRoute, externalTarget, freezeModelRoute, transportForModel } from '../src/dsh/model-routing.js';
import type { DomainRunStore, RunOwner } from '../src/dsh/store.js';
import { ROLE_PRESETS } from '../src/roles/specs.js';

const owner: RunOwner = {
  sessionId: 'owner', sourceRoot: '/tmp', sandboxMode: 'workspace-write',
  provider: 'deepseek', model: 'deepseek-flash', effort: 'high',
};
const clean = { verdict: 'clean', summary: 'Checked the complete assigned behavior.',
  coverage: ['Source and tests'], limitations: [], findings: [] };
function fixture(model = 'glm-5.3', provider = 'zai', kind: ActorTask['kind'] = 'reviewer-a') {
  const route = freezeModelRoute(ROLE_PRESETS[kind], owner, { provider, model, effort: 'high' });
  const run = {
    id: 'run-routing', workspace: { path: '/tmp', branch: 'sfd/run', baseCommit: 'base' },
    policy: createPolicy({ routes: { [kind]: route } }),
  } as DevelopmentRun;
  const store = { get: async () => run, ownerOf: () => owner } as unknown as DomainRunStore;
  const task: ActorTask = { id: 'task-routing', runId: run.id, kind,
    inputContractVersion: 1, controlEpoch: 1, route,
    workspace: run.workspace, input: { goal: 'Review the reachable user path.' },
    outputSchema: outputSchemaFor(kind), timeoutMs: 30_000 };
  return { route, store, task };
}
class FakeCli implements ExternalSubagentClient {
  readonly calls: { command: ExternalCommand; input: Record<string, unknown> }[] = [];
  cancelled = false;
  mutateAdmittedModel = false;
  partial = false;
  invalidJson = false;
  initialRunning = false;
  async call(command: ExternalCommand, input: Record<string, unknown>): Promise<Record<string, unknown>> {
    this.calls.push({ command, input });
    if (command === 'spawn') return { agent_id: 12345678, status: 'running', session_id: 'runtime-session' };
    if (command === 'cancel') { this.cancelled = true; return { task: { agent_id: 12345678, status: 'cancelling' } }; }
    if (command === 'close') return { task: { agent_id: 12345678, status: 'closed' } };
    if (command === 'wait') return { task: { agent_id: 12345678,
      status: this.cancelled ? 'cancelled' : this.initialRunning ? 'running' : 'completed' }, pending_requests: [] };
    const spawn = this.calls.find((entry) => entry.command === 'spawn')!.input;
    const role = /"role"\s*:\s*"([^"]+)"/.exec(String(spawn.prompt ?? ''))?.[1] ?? 'reviewer-a';
    const reportMarkdown = '# SFD Role Report\n' +
      JSON.stringify({ role, taskId: 'external-fixture' }) + '\n' +
      '## Evidence\n' + JSON.stringify({ status: 'observed', sourceRefs: ['test'] }) +
      '\nFixture result on the frozen source.\n## Outcome\n' +
      JSON.stringify({ status: 'complete', limitations: [] }) + '\n';
    const text = this.invalidJson ? 'not-json' : JSON.stringify({ ...clean, reportMarkdown });
    return { task: {
      agent_id: 12345678, status: this.cancelled ? 'cancelled' : 'completed',
      input_identity: {
        subagent: spawn.subagent, model: this.mutateAdmittedModel ? 'different-model' : spawn.model,
        effort: spawn.effort ?? null, permission_mode: spawn.permission_mode,
      },
    }, result: { outcome: 'completed', partial: this.partial, final_text: text, offset: 0,
      total_bytes: Buffer.byteLength(text), next_offset: null, complete: true, reason_code: null } };
  }
}

test('model families freeze to GLM ZCode, GPT Codex and DeepSeek native without transport substitution', () => {
  assert.equal(transportForModel('glm-5.3-flash'), 'external-subagent/zcode');
  assert.equal(transportForModel('zai/GLM-6'), 'external-subagent/zcode');
  assert.equal(transportForModel('gpt-6.1-sol'), 'external-subagent/codex');
  assert.equal(transportForModel('GPT-6'), 'external-subagent/codex');
  assert.equal(transportForModel('deepseek-flash'), 'dsh-native');
  assert.equal(transportForModel('deepseek/deepseek-v4'), 'dsh-native');
  assert.equal(freezeModelRoute(ROLE_PRESETS.implementer, owner).transport, 'dsh-native');
  assert.equal(freezeModelRoute(ROLE_PRESETS['reviewer-b'], owner, { provider: 'openai', model: 'gpt-6.1-sol' }).transport, 'external-subagent/codex');
  const glm = freezeModelRoute(ROLE_PRESETS['reviewer-a'], owner, { provider: 'zai', model: 'glm-5.3-flash', effort: 'max' });
  assert.deepEqual(externalTarget(glm, 'reader', 'workspace-write'), {
    subagent: 'zcode', model: 'zai/glm-5.3-flash', effort: 'max', permission_mode: 'plan',
  });
  assert.deepEqual(externalTarget(freezeModelRoute(ROLE_PRESETS.implementer, owner,
    { provider: 'openai', model: 'gpt-6.1-sol', effort: 'high' }), 'writer', 'workspace-write'), {
    subagent: 'codex', model: 'gpt-6.1-sol', effort: 'high', permission_mode: 'build',
  });
  assert.equal(externalTarget({ ...glm }, 'writer', 'danger-full-access').permission_mode, 'yolo');
  assert.throws(() => externalTarget({ ...glm, transport: 'dsh-native' }, 'reader', 'workspace-write'), /transport/);
});

test('external GLM and GPT runs use the requested runtime and admit only strict complete JSON', async () => {
  for (const [model, provider, subagent] of [['glm-5.3', 'zai', 'zcode'], ['gpt-6.1-sol', 'openai', 'codex']] as const) {
    const { task, store } = fixture(model, provider);
    const cli = new FakeCli();
    const runner = new ExternalSubagentRunner(store, cli);
    const handle = await runner.start(task, new AbortController().signal);
    const result = await handle.result;
    assert.equal(result.status, 'completed', result.error);
    assert.equal((result.output as { verdict: string }).verdict, clean.verdict);
    assert.match((result.output as { reportMarkdown: string }).reportMarkdown, /^# SFD Role Report\n/);
    assert.equal(result.identity.transport, 'external');
    assert.equal(result.identity.external?.subagent, subagent);
    assert.equal(result.identity.external?.admittedModel, subagent === 'zcode' ? `zai/${model}` : model);
    assert.equal(result.identity.observed, undefined, 'Admission is not a runtime model echo');
    assert.equal(cli.calls.find((entry) => entry.command === 'spawn')?.input.subagent, subagent);
    assert.equal(cli.calls.find((entry) => entry.command === 'spawn')?.input.write_manifest, undefined);
    assert.match(String(cli.calls.find((entry) => entry.command === 'spawn')?.input.prompt), /Required structured result/);
    assert.equal(cli.calls.some((entry) => entry.command === 'close'), true);
    assert.equal(cli.calls.some((entry) => entry.command === 'cancel'), false);
    await handle.dispose();
    await runner.dispose();
  }
});

test('an external model mismatch or unstructured or partial result never counts as review evidence', async () => {
  for (const property of ['mutateAdmittedModel', 'partial', 'invalidJson'] as const) {
    const { task, store } = fixture();
    const cli = new FakeCli(); cli[property] = true;
    const runner = new ExternalSubagentRunner(store, cli);
    const handle = await runner.start(task, new AbortController().signal);
    const outcome = await handle.result;
    assert.equal(outcome.status, 'failed', property);
    assert.equal(outcome.output, undefined);
    await handle.dispose();
    await runner.dispose();
  }
});

test('an interrupted external writer uses cancel, waits for terminal confirmation and closes', async () => {
  const { store, task } = fixture('gpt-6.1-sol', 'openai', 'implementer');
  const cli = new FakeCli(); cli.initialRunning = true;
  const runner = new ExternalSubagentRunner(store, cli);
  const abort = new AbortController();
  const handle = await runner.start(task, abort.signal);
  abort.abort();
  await handle.dispose();
  const outcome = await handle.result;
  assert.equal(outcome.status, 'cancelled');
  assert.deepEqual(cli.calls.filter((call) => ['cancel','close'].includes(call.command)).map((call) => call.command), ['cancel','close']);
  await runner.dispose();
});

test('external role receives required original review methodology without relying on a nonexistent native tool', async () => {
  const { task } = fixture();
  const prompt = await externalActorPrompt(task, 'Bounded SFD role task and complete user goal');
  assert.match(prompt, /Delegated bounded review/);
  assert.match(prompt, /Review Coverage and Evidence Methods/);
  assert.match(prompt, /native DSH sfd_knowledge tool does not exist/);
  assert.match(prompt, /Return precisely ONE raw JSON object/);
});

test('external-subagent CLI uses JSON stdin, not an oversized shell or argv string', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'sfd-external-cli-'));
  t.after(async () => rm(dir, { recursive: true, force: true }));
  const executable = join(dir, 'external-subagent-fixture');
  await writeFile(executable, `#!/usr/bin/env node
let body='';
process.stdin.setEncoding('utf8');
process.stdin.on('data',chunk=>body+=chunk);
process.stdin.on('end',()=>{
  const input=JSON.parse(body);
  process.stdout.write(JSON.stringify({ok:true,product:'external-subagent',command:process.argv[2],
    result:{size:Buffer.byteLength(input.prompt),repository:input.repository}})+'\\n');
});\n`);
  await chmod(executable, 0o755);
  const client = new ExternalSubagentCli(executable);
  const answer = await client.call('spawn', { repository: dir, prompt: 'A'.repeat(145_000) });
  assert.equal(answer.size, 145_000);
  assert.equal(answer.repository, dir);
});

test('Host-level model-family runner selects external execution without invoking native spawn', async () => {
  const ctx = new Context();
  const { task, store } = fixture('gpt-6.1-sol', 'openai', 'reviewer-b');
  const cli = new FakeCli();
  const runner = new ModelFamilyActorRunner(ctx, store, cli);
  try {
    const handle = await runner.start(task, new AbortController().signal);
    const result = await handle.result;
    assert.equal(result.status, 'completed', result.error);
    assert.equal(result.identity.external?.subagent, 'codex');
    assert.ok(cli.calls.some((entry) => entry.command === 'spawn'));
    await handle.dispose();
  } finally {
    await runner.dispose();
    await ctx.fiber.dispose();
  }
});

test('external review siblings share a workspace serially, avoiding daemon ownership conflicts', async () => {
  const { task, store } = fixture();
  let releaseFirst!: () => void;
  const firstWait = new Promise<void>((resolve) => { releaseFirst = resolve; });
  let released = false;
  class BlockingFirstWaitCli extends FakeCli {
    override async call(command: ExternalCommand, input: Record<string, unknown>) {
      if (command === 'wait' && !released) await firstWait;
      return super.call(command, input);
    }
  }
  const cli = new BlockingFirstWaitCli();
  const runner = new ExternalSubagentRunner(store, cli);
  try {
    const first = await runner.start(task, new AbortController().signal);
    const secondTask = { ...task, id: 'another-independent-lens', input: { ...task.input, lens: 'R03' } };
    const pending = runner.start(secondTask, new AbortController().signal);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(cli.calls.filter((entry) => entry.command === 'spawn').length, 1);
    released = true; releaseFirst();
    assert.equal((await first.result).status, 'completed');
    const second = await pending;
    assert.equal((await second.result).status, 'completed');
    assert.equal(cli.calls.filter((entry) => entry.command === 'spawn').length, 2);
    await first.dispose(); await second.dispose();
  } finally { await runner.dispose(); }
});

test('external transport retains a 90k task contract inline when under its 262k prompt ceiling', async () => {
  const { task, store } = fixture('glm-5.3', 'zai', 'adjudicator');
  task.input = { goal: 'Keep the approved user requirement.', evidence: 'E'.repeat(90_000) };
  const cli = new FakeCli();
  const runner = new ExternalSubagentRunner(store, cli);
  try {
    const handle = await runner.start(task, new AbortController().signal);
    assert.equal((await handle.result).status, 'completed');
    const sent = String(cli.calls.find((entry) => entry.command === 'spawn')?.input.prompt);
    assert.ok(sent.includes('E'.repeat(10_000)));
    assert.ok(Buffer.byteLength(sent, 'utf8') < 262_144);
    assert.ok(!sent.includes('artifactPath'), 'In-range external inputs must not require out-of-worktree evidence files');
    await handle.dispose();
  } finally { await runner.dispose(); }
});

test('a frozen child implementation tier overrides the parent route without fallback', () => {
  const standard = freezeModelRoute(ROLE_PRESETS.implementer, owner, { provider: 'deepseek', model: 'deepseek-flash' });
  const large = freezeModelRoute(ROLE_PRESETS.implementer, owner, { provider: 'openai', model: 'gpt-6.1-sol' });
  const { task } = fixture('deepseek-flash', 'deepseek', 'implementer');
  const run = { policy: createPolicy({ routes: { implementer: standard }, largeImplementerRoute: large }) } as DevelopmentRun;
  assert.deepEqual(configuredActorRoute({ ...task, implementationTier: 'large', route: large }, run), large);
  assert.deepEqual(configuredActorRoute({ ...task, implementationTier: 'standard', route: standard }, run), standard);
  assert.throws(() => configuredActorRoute({ ...task, implementationTier: 'large' },
    { policy: createPolicy({ routes: { implementer: standard } }) } as DevelopmentRun), /impl_large/);
});
