import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { createPolicy } from '../src/core/policy.js';
import { runSchema } from '../src/core/schemas.js';
import type { DevelopmentRun } from '../src/core/types.js';
import { GitWorkspace, type GitWorkspaceOptions } from '../src/workspace/git-workspace.js';
import { runProcess } from '../src/workspace/process.js';

async function git(cwd: string, ...args: string[]): Promise<string> {
  const result = await runProcess(['git', ...args], { cwd });
  assert.equal(result.exitCode, 0, result.output);
  return result.output.trim();
}
async function writable(path: string): Promise<void> {
  const stat = await lstat(path);
  if (stat.isSymbolicLink()) return;
  await chmod(path, stat.isDirectory() ? 0o700 : 0o600);
  if (stat.isDirectory()) for (const entry of await readdir(path)) await writable(join(path, entry));
}
async function fixture(t: TestContext, options: GitWorkspaceOptions = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-sfd-workspace-'));
  const repo = join(root, 'repo');
  const stateRoot = join(root, 'state');
  await mkdir(repo);
  await git(repo, 'init', '-b', 'main');
  await git(repo, 'config', 'user.name', 'Workflow Test');
  await git(repo, 'config', 'user.email', 'workflow-test@example.invalid');
  await writeFile(join(repo, 'source.txt'), 'initial\n');
  await writeFile(join(repo, '.gitignore'), 'cache/\n');
  await git(repo, 'add', '.');
  await git(repo, 'commit', '-m', 'Initial source');
  const workspace = new GitWorkspace({ stateRoot, ...options });
  t.after(async () => { await workspace.dispose(); await writable(root); await rm(root, { recursive: true, force: true }); });
  const at = new Date().toISOString();
  const run: DevelopmentRun = {
    id: randomUUID(), schemaVersion: 1, workflowVersion: '1.1.0', revision: 0,
    controlEpoch: 1, inputContractVersion: 1, createdAt: at, updatedAt: at,
    goal: 'Implement a verified change.', requirementsHistory: [{ version: 1, goal: 'Implement a verified change.', at }],
    workspace: await workspace.inspect(repo), policy: createPolicy({ commit: false }),
    status: 'running', stage: 'sections', planRevision: 0, planRepairs: 0,
    planFeedback: [], sections: {}, candidates: {}, attempts: [], operations: [],
    reviews: [], decisions: [], featureChecks: [], decisionHistory: [], events: [],
  };
  return { root, repo, stateRoot, workspace, run };
}
const processExecutor: NonNullable<GitWorkspaceOptions['executeCheck']> = ({ cwd, spec, signal, timeoutMs }) => runProcess(spec.command, { cwd, signal, timeoutMs });

test('prepare preserves staged, unstaged and untracked inputs without changing the source branch or index', async (t) => {
  const { repo, workspace, run } = await fixture(t);
  await writeFile(join(repo, 'source.txt'), 'staged\n');
  await git(repo, 'add', 'source.txt');
  await writeFile(join(repo, 'source.txt'), 'working\n');
  await writeFile(join(repo, 'new file.txt'), 'untracked\n');
  await mkdir(join(repo, 'cache'));
  await writeFile(join(repo, 'cache', 'ignored.txt'), 'ignored');
  const status = await git(repo, 'status', '--porcelain=v1');
  const index = await git(repo, 'write-tree');
  run.workspace = await workspace.prepare(run);
  assert.equal(run.workspace.prepared, true);
  assert.equal(run.workspace.branch, `sfd/${run.id}`);
  assert.equal(await readFile(join(run.workspace.path, 'source.txt'), 'utf8'), 'working\n');
  assert.equal(await readFile(join(run.workspace.path, 'new file.txt'), 'utf8'), 'untracked\n');
  assert.equal(await git(repo, 'branch', '--show-current'), 'main');
  assert.equal(await git(repo, 'status', '--porcelain=v1'), status);
  assert.equal(await git(repo, 'write-tree'), index);
  const candidate = await workspace.capture(run);
  assert.deepEqual(candidate.changedFiles.sort(), ['new file.txt', 'source.txt']);
  assert.equal(await git(candidate.workspacePath, 'rev-parse', 'HEAD^{tree}'), candidate.treeHash);
});

test('candidate identity covers source, tests, configuration, deletion and untracked content, with a frozen reader', async (t) => {
  const { workspace, run } = await fixture(t);
  run.workspace = await workspace.prepare(run);
  await mkdir(join(run.workspace.path, 'tests'));
  await writeFile(join(run.workspace.path, 'tests', 'check.ts'), 'test();\n');
  await writeFile(join(run.workspace.path, 'config.json'), '{"version":1}\n');
  await rm(join(run.workspace.path, 'source.txt'));
  const before = await workspace.capture(run);
  await writeFile(join(run.workspace.path, 'config.json'), '{"version":2}\n');
  const after = await workspace.capture(run);
  assert.notEqual(before.id, after.id);
  assert.notEqual(before.treeHash, after.treeHash);
  assert.equal(await readFile(join(before.workspacePath, 'config.json'), 'utf8'), '{"version":1}\n');
  assert.deepEqual(before.changedFiles.sort(), ['config.json', 'source.txt', 'tests/check.ts']);
  assert.match(before.diff, /deleted file mode/);
  assert.equal((await workspace.capture(run)).id, after.id);
});

test('checks run in their own candidate worktree, persist evidence and reject a self-modifying test', async (t) => {
  const { workspace, run } = await fixture(t, { executeCheck: processExecutor });
  run.workspace = await workspace.prepare(run);
  const candidate = await workspace.capture(run);
  const specs = [
    { id: 'source', command: [process.execPath, '-e', "const fs=require('fs'); if(fs.readFileSync('source.txt','utf8')!=='initial\\n')process.exit(1); fs.writeSync(1,'candidate verified')"], required: true },
    { id: 'mutate', command: [process.execPath, '-e', "require('fs').writeFileSync('source.txt','faked result')"], required: true },
    { id: 'after', command: [process.execPath, '-e', "const fs=require('fs'); if(fs.readFileSync('source.txt','utf8')!=='initial\\n')process.exit(1)"], required: true },
  ];
  const evidence = await workspace.check(run, candidate, specs);
  assert.deepEqual(evidence.map((item) => item.status), ['passed', 'failed', 'passed']);
  assert.ok(evidence.every((item) => item.candidateId === candidate.id));
  assert.match(evidence[1].output, /changed the candidate source/);
  assert.match(await readFile(evidence[0].artifactRefs![0], 'utf8'), /candidate verified/);
  assert.equal(await readFile(join(run.workspace.path, 'source.txt'), 'utf8'), 'initial\n');
  assert.equal(await readFile(join(candidate.workspacePath, 'source.txt'), 'utf8'), 'initial\n');
});

test('without a DSH permission-aware executor checks remain unknown and cannot accidentally run', async (t) => {
  const { workspace, run } = await fixture(t);
  run.workspace = await workspace.prepare(run);
  const candidate = await workspace.capture(run);
  const [result] = await workspace.check(run, candidate, [{ id: 'no-executor', command: [process.execPath, '-e', 'process.exit(0)'], required: true }]);
  assert.equal(result.status, 'unknown');
  assert.equal(result.exitCode, null);
  assert.match(result.output, /permission-aware/);
});

test('check cwd cannot escape its candidate through traversal or an absolute path', async (t) => {
  let executions = 0;
  const { repo, workspace, run } = await fixture(t, { executeCheck: async () => { executions++; return { exitCode: 0, output: '', timedOut: false, cancelled: false }; } });
  run.workspace = await workspace.prepare(run);
  const candidate = await workspace.capture(run);
  const evidence = await workspace.check(run, candidate, [
    { id: 'absolute', command: ['true'], cwd: repo, required: true },
    { id: 'relative', command: ['true'], cwd: '..', required: true },
  ]);
  assert.deepEqual(evidence.map((item) => item.status), ['unknown', 'unknown']);
  assert.equal(executions, 0);
});

test('a symlinked check cwd is resolved before authorizing execution', async (t) => {
  let executions = 0;
  const { repo, workspace, run } = await fixture(t, { executeCheck: async () => { executions++; return { exitCode: 0, output: '', timedOut: false, cancelled: false }; } });
  run.workspace = await workspace.prepare(run);
  await symlink(repo, join(run.workspace.path, 'outside'));
  const candidate = await workspace.capture(run);
  const [result] = await workspace.check(run, candidate, [{ id: 'symlink', command: ['true'], cwd: 'outside', required: true }]);
  assert.equal(result.status, 'unknown');
  assert.match(result.output, /escapes/);
  assert.equal(executions, 0);
});

test('delivery requires explicit commit authority and rejects code changed after acceptance', async (t) => {
  const { repo, workspace, run } = await fixture(t);
  const sourceHead = await git(repo, 'rev-parse', 'HEAD');
  run.workspace = await workspace.prepare(run);
  await writeFile(join(run.workspace.path, 'source.txt'), 'accepted\n');
  const candidate = await workspace.capture(run);
  await assert.rejects(workspace.commit(run, candidate, 'Deliver'), /no authorization/);
  run.policy.commit = true;
  await writeFile(join(run.workspace.path, 'source.txt'), 'different\n');
  await assert.rejects(workspace.commit(run, candidate, 'Deliver'), /changed after acceptance/);
  await writeFile(join(run.workspace.path, 'source.txt'), 'accepted\n');
  const receipt = await workspace.commit(run, candidate, 'Deliver accepted candidate');
  assert.deepEqual(await workspace.commit(run, candidate, 'Deliver accepted candidate'), receipt);
  assert.equal(await git(run.workspace.path, 'rev-parse', 'HEAD^{tree}'), candidate.treeHash);
  assert.equal(await git(run.workspace.path, 'rev-parse', 'HEAD'), receipt.commit);
  assert.equal(await git(repo, 'rev-parse', 'HEAD'), sourceHead);
  assert.equal(await git(repo, 'status', '--porcelain'), '');
  assert.equal(await git(run.workspace.path, 'status', '--porcelain'), '');
});

test('another Host cannot take over a claimed workspace; graceful release permits verified reopening', async (t) => {
  const { workspace, run, stateRoot } = await fixture(t);
  run.workspace = await workspace.prepare(run);
  const second = new GitWorkspace({ stateRoot });
  t.after(() => second.dispose());
  await assert.rejects(second.prepare(run), /ownership is held or unreconciled/);
  await workspace.dispose();
  assert.deepEqual(await second.prepare(run), run.workspace);
});

test('recovery exposes changed candidates and unknown writer outcomes without replaying work', async (t) => {
  const { workspace, run } = await fixture(t);
  run.workspace = await workspace.prepare(run);
  const candidate = await workspace.capture(run);
  run.currentCandidateId = candidate.id;
  assert.equal((await workspace.reconcile(run)).safe, true);
  await writeFile(join(run.workspace.path, 'source.txt'), 'unexpected\n');
  const recovery = await workspace.reconcile(run);
  assert.equal(recovery.safe, false);
  assert.match(recovery.reason!, /differs from/);
  assert.notEqual(recovery.candidate!.id, candidate.id);
  run.operations.push({ id: 'unknown-commit', kind: 'commit', state: 'unknown', scopeKey: 'delivery', controlEpoch: 1, createdAt: new Date().toISOString() });
  assert.match((await workspace.reconcile(run)).reason!, /unknown outcome/);
});

test('a tampered review snapshot is detected before using or testing it', async (t) => {
  const { workspace, run } = await fixture(t);
  run.workspace = await workspace.prepare(run);
  const candidate = await workspace.capture(run);
  const file = join(candidate.workspacePath, 'source.txt');
  await chmod(file, 0o600);
  await writeFile(file, 'tampered\n');
  await assert.rejects(workspace.capture(run), /snapshot identity mismatch/);
  await assert.rejects(workspace.check(run, candidate, [{ id: 'must-not-run', command: ['true'], required: true }]), /unverified candidate/);
});

test('a source HEAD change between creation and preparation is not silently accepted', async (t) => {
  const { repo, workspace, run } = await fixture(t);
  await writeFile(join(repo, 'source.txt'), 'new baseline\n');
  await git(repo, 'commit', '-am', 'Changed baseline');
  await assert.rejects(workspace.prepare(run), /Source HEAD changed/);
});

test('preparation completed before state admission can be recovered from real manifest or durable intent', async (t) => {
  const { workspace, run } = await fixture(t);
  const prepared = await workspace.prepare(run);
  const fromManifest = await workspace.reconcile(run);
  assert.equal(fromManifest.safe, false);
  assert.deepEqual(fromManifest.workspace, prepared);
  assert.ok(fromManifest.candidate);
  await rm(join(prepared.path, '..', 'manifest.json'));
  const fromIntent = await workspace.reconcile(run);
  assert.equal(fromIntent.safe, false);
  assert.deepEqual(fromIntent.workspace, prepared);
  assert.equal(fromIntent.candidate!.treeHash, fromManifest.candidate!.treeHash);
  assert.deepEqual(await workspace.prepare(run), prepared);
});

test('a real commit written before state admission is recovered without creating a second commit', async (t) => {
  const { workspace, run } = await fixture(t);
  run.workspace = await workspace.prepare(run);
  await writeFile(join(run.workspace.path, 'source.txt'), 'accepted delivery\n');
  const candidate = await workspace.capture(run);
  run.currentCandidateId = candidate.id; run.candidates[candidate.id] = candidate; run.policy.commit = true;
  const receipt = await workspace.commit(run, candidate, 'Deliver accepted work');
  const recovery = await workspace.reconcile(run);
  assert.equal(recovery.safe, false);
  assert.deepEqual(recovery.commit, receipt);
  assert.equal(recovery.candidate!.head, receipt.commit);
  await rm(join(run.workspace.path, '..', 'commit.json'));
  const fromIntent = await workspace.reconcile(run);
  assert.deepEqual(fromIntent.commit, receipt);
  assert.deepEqual(await workspace.commit(run, candidate, 'Deliver accepted work'), receipt);
  assert.equal(await git(run.workspace.path, 'rev-list', '--count', 'HEAD'), '2');
});

test('undispatched intents are safe but a failed writer needs explicit reconciliation even before its first candidate', async (t) => {
  const { workspace, run } = await fixture(t);
  run.workspace = await workspace.prepare(run);
  const attempt = {
    id: 'write-one', state: 'intent' as const, createdAt: run.createdAt, infrastructureRetries: 0,
    task: { id: 'write-one', runId: run.id, kind: 'implementer' as const, inputContractVersion: 1, controlEpoch: 1, workspace: run.workspace, input: { goal: run.goal }, outputSchema: { type: 'object' }, timeoutMs: 1000 },
  };
  run.attempts.push(attempt);
  assert.equal((await workspace.reconcile(run)).safe, true);
  run.attempts[0] = { ...attempt, state: 'terminal', outcome: { status: 'failed', error: 'Writer stopped after a partial edit.', identity: { transport: 'test' } } };
  await writeFile(join(run.workspace.path, 'source.txt'), 'partial change\n');
  const recovery = await workspace.reconcile(run);
  assert.equal(recovery.safe, false); assert.ok(recovery.candidate);
  assert.match(recovery.reason!, /unknown outcome/);
  run.decisionHistory.push({ id: 'reviewed-recovery', question: 'Inspect partial write.', context: '', kind: 'recovery', createdAt: run.createdAt, answer: 'The writer is stopped and I inspected the partial change.' });
  run.attempts[0].recoveryDecisionId = 'reviewed-recovery'; run.attempts[0].reconciledAt = new Date().toISOString();
  assert.equal((await workspace.reconcile(run)).safe, true);
});

test('submodule working trees are rejected rather than represented by incomplete evidence', async (t) => {
  const { repo, workspace } = await fixture(t);
  const head = await git(repo, 'rev-parse', 'HEAD');
  await git(repo, 'update-index', '--add', '--cacheinfo', `160000,${head},module`);
  await assert.rejects(workspace.inspect(repo), /Submodules require/);
});

test('process deadlines and cancellation terminate actual commands', async () => {
  const timeout = await runProcess([process.execPath, '-e', 'setInterval(()=>{}, 1000)'], { cwd: tmpdir(), timeoutMs: 70 });
  assert.equal(timeout.timedOut, true);
  assert.notEqual(timeout.exitCode, 0);
  const abort = new AbortController();
  const pending = runProcess([process.execPath, '-e', 'setInterval(()=>{}, 1000)'], { cwd: tmpdir(), signal: abort.signal });
  abort.abort();
  assert.equal((await pending).cancelled, true);
});

test('unknown workflow and policy versions cannot silently reinterpret an existing Run', async (t) => {
  const { run } = await fixture(t);
  assert.equal(runSchema.safeParse(run).success, true);
  assert.equal(runSchema.safeParse({ ...run, workflowVersion: 'future-workflow' }).success, false);
  assert.equal(runSchema.safeParse({ ...run, policy: { ...run.policy, version: 'future-policy' } }).success, false);
  assert.throws(() => createPolicy({ version: 'future-policy' }), /Explicit migration/);
});

test('a Section writer may change its admitted scope but cannot silently modify another owner', async (t) => {
  const { workspace, run } = await fixture(t);
  run.plan = {
    title: 'Scope ownership', assumptions: [],
    features: [{ id: 'F1', title: 'Local edit', outcome: 'Update source', acceptanceCriteria: ['source reflects edit'], sectionIds: ['S1'], checks: [] }],
    sections: [{ id: 'S1', title: 'Local owner', featureIds: ['F1'], objective: 'Edit source', dependencies: [],
      writeScope: ['source.txt'], acceptanceCriteria: ['edit source'], implementation: 'standard', checks: [], subsections: [] }],
  };
  run.sections = { S1: { id: 'S1', stage: 'implementing', inputContractVersion: 1, lineageId: 'S1-original',
    materialRepairWaves: 0, diagnosticCount: 0, lenses: [], checks: [], reviewIds: [], decisionIds: [], aCoverageEvidenceIds: [] } };
  run.workspace = await workspace.prepare(run);
  await writeFile(join(run.workspace.path, 'source.txt'), 'in scope\n');
  const valid = await workspace.capture(run, 'S1');
  assert.ok(valid.treeHash);
  await writeFile(join(run.workspace.path, 'another-owner.txt'), 'out of scope\n');
  await assert.rejects(workspace.capture(run, 'S1'), /outside its admitted writeScope: another-owner\.txt/);
});


test('parent Section review receives its own base-to-head delta rather than previously accepted changes', async (t) => {
  const { workspace, run } = await fixture(t);
  run.workspace = await workspace.prepare(run);
  const makeState = (id: string, base: string) => ({
    id, stage: 'implementing' as const, inputContractVersion: 1, lineageId: id,
    materialRepairWaves: 0, diagnosticCount: 0, sectionBaseTreeHash: base,
    lenses: [], checks: [], reviewIds: [], decisionIds: [], aCoverageEvidenceIds: [],
  });
  run.plan = {
    title: 'Two independent parents', assumptions: [],
    features: [{ id: 'F1', title: 'Feature', outcome: 'Both increments work',
      acceptanceCriteria: ['End-to-end behavior'], sectionIds: ['S1', 'S2'], checks: [] }],
    sections: [
      { id: 'S1', title: 'First', featureIds: ['F1'], objective: 'First change', dependencies: [],
        writeScope: ['source.txt'], acceptanceCriteria: ['First works'],
        implementation: 'standard', checks: [], subsections: [] },
      { id: 'S2', title: 'Second', featureIds: ['F1'], objective: 'Second change', dependencies: ['S1'],
        writeScope: ['next.ts'], acceptanceCriteria: ['Second works'],
        implementation: 'standard', checks: [], subsections: [] },
    ],
  };
  run.sections.S1 = makeState('S1', run.workspace.initialTreeHash!);
  await writeFile(join(run.workspace.path, 'source.txt'), 'first parent\n');
  const first = await workspace.capture(run, 'S1');
  assert.deepEqual(first.sectionDelta?.changedFiles, ['source.txt']);
  run.candidates[first.id] = first; run.currentCandidateId = first.id;
  run.sections.S2 = makeState('S2', first.treeHash);
  await writeFile(join(run.workspace.path, 'next.ts'), 'second parent\n');
  const second = await workspace.capture(run, 'S2');
  assert.deepEqual(second.sectionDelta?.changedFiles, ['next.ts']);
  assert.ok(second.diff.includes('first parent'), 'Full candidate still retains earlier code context');
  assert.deepEqual(second.changedFiles.sort(), ['next.ts', 'source.txt']);
});

test('a Subsection cannot write outside its narrower scope even when the parent owns that path', async (t) => {
  const { workspace, run } = await fixture(t);
  run.plan = {
    title: 'Child scope', assumptions: [],
    features: [{ id: 'F1', title: 'Scoped feature', outcome: 'Child source is correct', acceptanceCriteria: ['Child owns source'], sectionIds: ['S1'], checks: [] }],
    sections: [{ id: 'S1', title: 'Parent', featureIds: ['F1'], objective: 'Child then consumer', dependencies: [],
      writeScope: ['source.txt', 'consumer.txt'], acceptanceCriteria: ['Parent complete'], implementation: 'standard', checks: [],
      subsections: [{ id: 'C1', objective: 'Child source', acceptanceCriteria: ['source updated'],
        writeScope: ['source.txt'], safeIntermediateState: 'Consumer not yet exposed', consumer: 'C2',
        checks: [{ id: 'child', command: ['true'], required: true }] }] }],
  };
  run.sections = { S1: { id: 'S1', stage: 'subsection-implementing', subsectionIndex: 0,
    inputContractVersion: 1, lineageId: 'S1-original', materialRepairWaves: 0, diagnosticCount: 0,
    lenses: [], checks: [], reviewIds: [], decisionIds: [], aCoverageEvidenceIds: [] } };
  run.workspace = await workspace.prepare(run);
  await writeFile(join(run.workspace.path, 'source.txt'), 'valid child edit\n');
  const accepted = await workspace.capture(run, 'S1');
  run.currentCandidateId = accepted.id;
  run.candidates[accepted.id] = accepted;
  await writeFile(join(run.workspace.path, 'consumer.txt'), 'premature consumer edit\n');
  await assert.rejects(workspace.capture(run, 'S1'), /outside its admitted writeScope: consumer\.txt/);
});
