import { createHash, randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, open, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep, matchesGlob } from 'node:path';
import type { WorkspacePort } from '../core/ports.js';
import type { Candidate, CheckEvidence, CheckSpec, CommitEvidence, DevelopmentRun, WorkspaceInfo, WorkspaceRecovery } from '../core/types.js';
import { runProcess, type ProcessResult } from './process.js';

export interface CheckExecution {
  run: DevelopmentRun;
  spec: CheckSpec;
  cwd: string;
  signal?: AbortSignal;
  timeoutMs: number;
}
export type CheckExecutor = (execution: CheckExecution) => Promise<ProcessResult>;
export interface GitWorkspaceOptions {
  /** Optional persistent absolute directory; the default is inside the common Git directory. */
  stateRoot?: string;
  maxOutputBytes?: number;
  checkTimeoutMs?: number;
  /** Required for production checks: the Host adapter must enforce DSH permissions/sandbox. */
  executeCheck?: CheckExecutor;
}
interface Manifest {
  version: 1; runId: string; source: string; commonGitDir: string;
  workspace: WorkspaceInfo; initialTree: string;
}
interface Owner { token: string; pid: number; host: string; since: string }
interface Claim { file: string; token: string }
const now = (): string => new Date().toISOString();
const safeId = (id: string): string => {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(id)) throw new Error('Invalid workflow identity.');
  return id;
};
const exists = async (path: string): Promise<boolean> => {
  try { await lstat(path); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
};
const inside = (parent: string, child: string): boolean => {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
};

/** Complete Git candidates and one explicit writer per Run. No source checkout mutations. */
export class GitWorkspace implements WorkspacePort {
  private readonly claims = new Map<string, Claim>();
  private readonly preparing = new Set<string>();
  constructor(private readonly options: GitWorkspaceOptions = {}) {
    if (options.stateRoot && !isAbsolute(options.stateRoot)) throw new Error('stateRoot must be absolute.');
  }

  private async git(cwd: string, args: string[], extra: { env?: NodeJS.ProcessEnv; input?: string; allowFailure?: boolean } = {}): Promise<string> {
    // Workflow plumbing must not execute repository-controlled checkout hooks.
    const result = await runProcess(['git', '-c', 'core.hooksPath=/dev/null', ...args], {
      cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...extra.env }, input: extra.input,
      timeoutMs: 60_000, maxOutputBytes: this.options.maxOutputBytes ?? 8_388_608,
    });
    if (!extra.allowFailure && (result.exitCode !== 0 || result.timedOut || result.truncated)) throw new Error(`git ${args[0]} failed: ${result.output.trim() || `exit ${result.exitCode}`}`);
    return result.output;
  }

  async inspect(path: string): Promise<WorkspaceInfo> {
    const location = await realpath(path);
    const root = (await this.git(location, ['rev-parse', '--show-toplevel'])).trim();
    const canonical = await realpath(root);
    const baseCommit = (await this.git(canonical, ['rev-parse', '--verify', 'HEAD^{commit}'])).trim();
    const branch = (await this.git(canonical, ['symbolic-ref', '--quiet', '--short', 'HEAD'], { allowFailure: true })).trim() || '(detached)';
    await this.rejectSubmodules(canonical);
    return { path: canonical, branch, baseCommit };
  }

  private async rejectSubmodules(path: string): Promise<void> {
    const files = await this.git(path, ['ls-files', '--stage', '-z']);
    if (files.split('\0').some((line) => line.startsWith('160000 '))) throw new Error('Submodules require a separately captured source contract; this version does not silently omit their working changes.');
  }

  private async paths(run: DevelopmentRun): Promise<{ common: string; root: string }> {
    const common = (await this.git(run.workspace.path, ['rev-parse', '--path-format=absolute', '--git-common-dir'])).trim();
    const identity = createHash('sha256').update(common).digest('hex').slice(0, 16);
    const root = this.options.stateRoot
      ? join(this.options.stateRoot, identity, safeId(run.id))
      : join(common, 'dsh-sfd', 'runs', safeId(run.id));
    return { common, root };
  }

  private async claim(run: DevelopmentRun): Promise<string> {
    const { root } = await this.paths(run);
    const key = join(root, 'owner.json');
    if (this.claims.has(key)) return root;
    await mkdir(root, { recursive: true, mode: 0o700 });
    const owner: Owner = { token: randomUUID(), pid: process.pid, host: hostname(), since: now() };
    try {
      const file = await open(key, 'wx', 0o600);
      try { await file.writeFile(JSON.stringify(owner)); await file.sync(); } finally { await file.close(); }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      let prior = 'Unreadable owner';
      try { prior = await readFile(key, 'utf8'); } catch { /* Preserve unknown ownership. */ }
      throw new Error(`Workspace ownership is held or unreconciled (${key}): ${prior}. Stop and reconcile the previous owner before explicitly removing this file. A stale timestamp is not proof that writers stopped.`);
    }
    this.claims.set(key, { file: key, token: owner.token });
    return root;
  }

  private async writeJson(path: string, value: unknown): Promise<void> {
    const temporary = `${path}.${randomUUID()}.tmp`;
    const file = await open(temporary, 'wx', 0o600);
    try { await file.writeFile(JSON.stringify(value, null, 2)); await file.sync(); } finally { await file.close(); }
    await rename(temporary, path);
    if (process.platform !== 'win32') {
      const directory = await open(dirname(path), 'r');
      try { await directory.sync(); } finally { await directory.close(); }
    }
  }

  private async tree(path: string, root: string): Promise<string> {
    await this.rejectSubmodules(path);
    const index = join(root, `index-${randomUUID()}`);
    const env = { GIT_INDEX_FILE: index };
    try {
      await this.git(path, ['read-tree', 'HEAD'], { env });
      await this.git(path, ['add', '--all', '--', '.'], { env });
      return (await this.git(path, ['write-tree'], { env })).trim();
    } finally { await rm(index, { force: true }); await rm(`${index}.lock`, { force: true }); }
  }

  private async snapshotCommit(path: string, tree: string, parent: string): Promise<string> {
    return (await this.git(path, ['commit-tree', tree, '-p', parent], {
      env: {
        GIT_AUTHOR_NAME: 'DSH SFD snapshot', GIT_AUTHOR_EMAIL: 'snapshot@dsh.invalid',
        GIT_COMMITTER_NAME: 'DSH SFD snapshot', GIT_COMMITTER_EMAIL: 'snapshot@dsh.invalid',
      }, input: 'Private immutable workflow candidate\n',
    })).trim();
  }

  async prepare(run: DevelopmentRun): Promise<WorkspaceInfo> {
    if (this.preparing.has(run.id)) throw new Error('Workspace preparation is already in progress.');
    this.preparing.add(run.id);
    try {
      const { common } = await this.paths(run);
      const root = await this.claim(run);
      const manifestFile = join(root, 'manifest.json');
      if (await exists(manifestFile)) {
        const manifest = JSON.parse(await readFile(manifestFile, 'utf8')) as Manifest;
        if (manifest.version !== 1 || manifest.runId !== run.id || manifest.commonGitDir !== common) throw new Error('Workspace manifest identity does not match this Run.');
        const actual = await this.inspect(manifest.workspace.path);
        if (actual.branch !== manifest.workspace.branch) throw new Error('Prepared worktree branch changed; reconcile before continuing.');
        return manifest.workspace;
      }
      const source = await this.inspect(run.workspace.path);
      if (source.baseCommit !== run.workspace.baseCommit) throw new Error('Source HEAD changed since the Run was created; revise or recreate the Run from current inputs.');
      const path = join(root, 'worktree');
      if (await exists(path)) throw new Error('An unrecorded worktree exists from interrupted preparation; reconcile it before retrying.');
      const branch = `sfd/${safeId(run.id)}`;
      const initialTree = await this.tree(source.path, root);
      const workspace: WorkspaceInfo = { path, branch, baseCommit: source.baseCommit, prepared: true };
      const manifest: Manifest = { version: 1, runId: run.id, source: source.path, commonGitDir: common, workspace, initialTree };
      await this.writeJson(join(root, 'prepare-intent.json'), manifest);
      await this.git(source.path, ['worktree', 'add', '-b', branch, path, source.baseCommit]);
      // Apply the complete starting tree without changing the original branch/index.
      const patch = await this.git(source.path, ['diff', '--binary', source.baseCommit, initialTree, '--']);
      if (patch) await this.git(path, ['apply', '--binary', '--whitespace=nowarn', '-'], { input: patch });
      if (await this.tree(path, root) !== initialTree) throw new Error('Prepared worktree does not reproduce the complete starting source tree.');
      await this.writeJson(manifestFile, manifest);
      return workspace;
    } finally { this.preparing.delete(run.id); }
  }

  private async assertPrepared(run: DevelopmentRun): Promise<string> {
    if (!run.workspace.prepared || !run.workspace.branch.startsWith('sfd/')) throw new Error('Writing requires a dedicated prepared workflow branch.');
    const root = await this.claim(run);
    const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8')) as Manifest;
    if (manifest.runId !== run.id || await realpath(manifest.workspace.path) !== await realpath(run.workspace.path)) throw new Error('Workspace is outside this Run ownership.');
    const currentBranch = (await this.git(run.workspace.path, ['symbolic-ref', '--short', 'HEAD'])).trim();
    if (currentBranch !== run.workspace.branch) throw new Error('Workflow branch changed outside the controller.');
    return root;
  }

  private sectionPlanScope(run: DevelopmentRun, sectionId: string): string[] {
    const section = run.plan?.sections.find((entry) => entry.id === sectionId);
    if (!section) throw new Error(`Section ${sectionId} has no admitted writeScope.`);
    for (const scope of section.writeScope) {
      const clean = scope.replaceAll('\\', '/');
      if (!clean.trim() || isAbsolute(clean) || clean.split('/').includes('..') || clean.includes('\0')) throw new Error('Invalid or escaping Section writeScope.');
    }
    if (run.sections[sectionId]?.stage === 'subsection-implementing') {
      const current = section.subsections[run.sections[sectionId]!.subsectionIndex ?? 0];
      if (!current) throw new Error(`Missing active Subsection writeScope for ${sectionId}.`);
      return current.writeScope;
    }
    return section.writeScope;
  }

  private async freeze(path: string): Promise<void> {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const full = join(path, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) await this.freeze(full);
      else { const mode = (await lstat(full)).mode; await chmod(full, mode & 0o111 ? 0o555 : 0o444); }
    }
    await chmod(path, 0o555);
  }

  async capture(run: DevelopmentRun, sectionId?: string): Promise<Candidate> {
    const root = await this.assertPrepared(run);
    const head = (await this.git(run.workspace.path, ['rev-parse', 'HEAD'])).trim();
    const treeHash = await this.tree(run.workspace.path, root);
    // The original SFD assigns each writer an explicit Section edit boundary.
    // Compare only the newly authored delta, not previously integrated Sections
    // or dirty user input copied into the worktree before implementation.
    const section = sectionId ? run.sections[sectionId] : undefined;
    if (section && ['implementing', 'repairing'].includes(section.stage)) {
      const previous = run.currentCandidateId ? run.candidates[run.currentCandidateId] : undefined;
      const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8')) as Manifest;
      const beforeTree = previous?.treeHash ?? manifest.initialTree;
      const changed = (await this.git(run.workspace.path, ['diff', '--name-only', '-z', beforeTree, treeHash, '--'])).split('\0').filter(Boolean);
      const allowed = this.sectionPlanScope(run, sectionId!);
      const outOfScope = changed.filter((file) => !allowed.some((entry) => {
        const pattern = entry.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/$/, '');
        return pattern === file || file.startsWith(`${pattern}/`) || matchesGlob(file, pattern);
      }));
      if (outOfScope.length) throw new Error(`Section ${sectionId} changed paths outside its admitted writeScope: ${outOfScope.join(', ')}. Replan the authorized ownership before accepting these edits.`);
    }
    const id = `candidate-${createHash('sha256').update(`${head}\0${treeHash}`).digest('hex').slice(0, 32)}`;
    const candidateDirectory = join(root, 'candidates');
    await mkdir(candidateDirectory, { recursive: true, mode: 0o700 });
    const workspacePath = join(candidateDirectory, id);
    if (!await exists(workspacePath)) {
      const commit = await this.snapshotCommit(run.workspace.path, treeHash, head);
      await this.git(run.workspace.path, ['worktree', 'add', '--detach', workspacePath, commit]);
      if (await this.tree(workspacePath, root) !== treeHash) throw new Error('Checkout filters changed the candidate source. An explicit filtered-source contract is required.');
      await this.freeze(workspacePath);
    } else if ((await this.git(workspacePath, ['rev-parse', 'HEAD^{tree}'])).trim() !== treeHash || await this.tree(workspacePath, root) !== treeHash) {
      throw new Error('Candidate snapshot identity mismatch.');
    }
    const diff = await this.git(run.workspace.path, ['diff', '--binary', run.workspace.baseCommit, treeHash, '--']);
    const changedFiles = (await this.git(run.workspace.path, ['diff', '--name-only', '-z', run.workspace.baseCommit, treeHash, '--'])).split('\0').filter(Boolean);
    const sectionBase = section?.sectionBaseCandidateId && run.candidates[section.sectionBaseCandidateId];
    if (sectionId && !sectionBase) throw new Error(`Parent Section ${sectionId} has no frozen starting candidate; refusing a cumulative Feature diff as Section coverage.`);
    const sectionDelta = sectionBase && sectionId ? {
      sectionId, baseTreeHash: sectionBase.treeHash,
      diff: await this.git(run.workspace.path, ['diff', '--binary', sectionBase.treeHash, treeHash, '--']),
      changedFiles: (await this.git(run.workspace.path, ['diff', '--name-only', '-z', sectionBase.treeHash, treeHash, '--'])).split('\0').filter(Boolean),
    } : undefined;
    const candidate: Candidate = { id, capturedAt: now(), workspacePath, head, treeHash, diff, changedFiles,
      ...(sectionDelta ? { sectionDelta } : {}) };
    await this.writeJson(join(candidateDirectory, `${id}.json`), candidate);
    return candidate;
  }

  async check(run: DevelopmentRun, candidate: Candidate, specs: CheckSpec[], signal?: AbortSignal): Promise<CheckEvidence[]> {
    if (!specs.length) return [];
    const root = await this.assertPrepared(run);
    const checksDirectory = join(root, 'checks');
    await mkdir(checksDirectory, { recursive: true, mode: 0o700 });
    const path = join(checksDirectory, randomUUID());
    if ((await this.git(candidate.workspacePath, ['rev-parse', 'HEAD^{tree}'])).trim() !== candidate.treeHash || await this.tree(candidate.workspacePath, root) !== candidate.treeHash) throw new Error('Cannot execute checks for an unverified candidate.');
    const commit = (await this.git(candidate.workspacePath, ['rev-parse', 'HEAD'])).trim();
    await this.git(run.workspace.path, ['worktree', 'add', '--detach', path, commit]);
    const evidence: CheckEvidence[] = [];
    try {
      for (const spec of specs) {
        const startedAt = now();
        let result: ProcessResult;
        try {
          if (signal?.aborted) result = { exitCode: null, output: 'Cancelled before check execution.', cancelled: true, timedOut: false };
          else if (!this.options.executeCheck) result = { exitCode: null, output: 'No permission-aware check executor was installed by the Host.', cancelled: false, timedOut: false };
          else {
            if (!spec.command.length || spec.command.some((part) => typeof part !== 'string' || part.includes('\0'))) throw new Error('Invalid check command argv.');
            if (spec.cwd && isAbsolute(spec.cwd)) throw new Error('Check cwd must be relative to the candidate.');
            const cwd = await realpath(resolve(path, spec.cwd ?? '.'));
            if (!inside(path, cwd)) throw new Error('Check cwd escapes the candidate.');
            result = await this.options.executeCheck({ run, spec, cwd, signal, timeoutMs: Math.min(spec.timeoutMs ?? this.options.checkTimeoutMs ?? 300_000, 3_600_000) });
          }
          if (await this.tree(path, root) !== candidate.treeHash) {
            result = { ...result, exitCode: result.exitCode === 0 ? 1 : result.exitCode, output: `${result.output}\nCheck changed the candidate source tree; its result does not prove the reviewed candidate.` };
            await this.git(path, ['reset', '--hard', commit]);
            // New nonignored files can affect later tests. Do not retain them as evidence.
            await this.git(path, ['clean', '-fd', '--']);
          }
        } catch (error) { result = { exitCode: null, output: (error as Error).message, cancelled: Boolean(signal?.aborted), timedOut: false }; }
        const id = `check-${randomUUID()}`;
        const artifact = join(checksDirectory, `${id}.log`);
        const output = result.output.slice(0, this.options.maxOutputBytes ?? 1_048_576);
        await writeFile(artifact, output, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
        evidence.push({
          id, candidateId: candidate.id, specId: spec.id,
          status: result.cancelled ? 'cancelled' : result.timedOut ? 'failed' : result.exitCode === 0 ? 'passed' : result.exitCode === null ? 'unknown' : 'failed',
          exitCode: result.exitCode, startedAt, endedAt: now(),
          output: result.timedOut ? `${output}\nCheck timed out.` : output, artifactRefs: [artifact],
        });
      }
    } finally {
      // Disposable check worktrees contain no user source. Keep log artifacts.
      await this.git(run.workspace.path, ['worktree', 'remove', '--force', path]).catch(() => undefined);
    }
    return evidence;
  }

  async commit(run: DevelopmentRun, candidate: Candidate, message: string): Promise<CommitEvidence> {
    if (!run.policy.commit) throw new Error('This Run has no authorization to create a commit.');
    const root = await this.assertPrepared(run);
    if (!message.trim() || message.includes('\0')) throw new Error('Commit message is required.');
    const receiptPath = join(root, 'commit.json');
    const intentPath = join(root, 'commit-intent.json');
    if (await exists(receiptPath) || await exists(intentPath)) {
      const prior = JSON.parse(await readFile(await exists(receiptPath) ? receiptPath : intentPath, 'utf8')) as CommitEvidence;
      const head = (await this.git(run.workspace.path, ['rev-parse', 'HEAD'])).trim();
      if (prior.candidateId === candidate.id && prior.branch === run.workspace.branch && await this.tree(run.workspace.path, root) === candidate.treeHash) {
        if (head === candidate.head && prior.message === message.trim()) {
          await this.git(run.workspace.path, ['update-ref', `refs/heads/${run.workspace.branch}`, prior.commit, candidate.head]);
          await this.git(run.workspace.path, ['reset', '--mixed', prior.commit]);
        } else if (head !== prior.commit) throw new Error('The delivery branch differs from the recorded commit intent.');
        await this.writeJson(receiptPath, prior);
        return prior;
      }
      throw new Error('This Run already has a different delivery commit.');
    }
    const current = await this.capture(run);
    if (current.id !== candidate.id || current.treeHash !== candidate.treeHash) throw new Error('The working candidate changed after acceptance; refusing to commit stale evidence.');
    // Plumbing commits the accepted immutable tree, not a racing staging area.
    // Repository hooks must be explicit, sandboxed required checks in the plan.
    const commit = (await this.git(run.workspace.path, ['commit-tree', candidate.treeHash, '-p', candidate.head], { input: `${message.trim()}\n` })).trim();
    const receipt: CommitEvidence = { commit, candidateId: candidate.id, branch: run.workspace.branch, createdAt: now(), message: message.trim() };
    await this.writeJson(intentPath, receipt);
    await this.git(run.workspace.path, ['update-ref', `refs/heads/${run.workspace.branch}`, commit, candidate.head]);
    await this.git(run.workspace.path, ['reset', '--mixed', commit]);
    await this.writeJson(receiptPath, receipt);
    return receipt;
  }

  async reconcile(run: DevelopmentRun): Promise<WorkspaceRecovery> {
    try {
      if (!run.workspace.prepared) {
        const { root } = await this.paths(run);
        if (await exists(join(root, 'manifest.json'))) {
          const workspace = await this.prepare(run);
          const candidate = await this.capture({ ...run, workspace });
          return { safe: false, workspace, candidate, reason: 'Preparation completed before its state was admitted. The verified existing worktree can be adopted by an explicit recovery decision; it is not recreated.' };
        }
        if (await exists(join(root, 'worktree'))) {
          await this.claim(run);
          const intentPath = join(root, 'prepare-intent.json');
          if (await exists(intentPath)) {
            const manifest = JSON.parse(await readFile(intentPath, 'utf8')) as Manifest;
            const actual = await this.inspect(join(root, 'worktree'));
            if (manifest.runId === run.id && manifest.workspace.path === actual.path && manifest.workspace.branch === actual.branch && await this.tree(actual.path, root) === manifest.initialTree) {
              await this.writeJson(join(root, 'manifest.json'), manifest);
              const candidate = await this.capture({ ...run, workspace: manifest.workspace });
              return { safe: false, workspace: manifest.workspace, candidate, reason: 'The complete prepared source matches its durable preparation intent. Explicitly adopt this existing worktree before continuing.' };
            }
          }
          return { safe: false, reason: `Preparation left an incomplete worktree. Inspect ${join(root, 'prepare-intent.json')} and restore the recorded initialTree before retrying recovery; preparation will not be replayed.` };
        }
        return { safe: true };
      }
      const root = await this.assertPrepared(run);
      const candidate = await this.capture(run);
      const receiptPath = await exists(join(root, 'commit.json')) ? join(root, 'commit.json') : join(root, 'commit-intent.json');
      if (await exists(receiptPath)) {
        const commit = JSON.parse(await readFile(receiptPath, 'utf8')) as CommitEvidence;
        const accepted = run.candidates[commit.candidateId];
        if (accepted && commit.branch === run.workspace.branch && candidate.head === commit.commit && candidate.treeHash === accepted.treeHash
          && (await this.git(run.workspace.path, ['rev-parse', `${commit.commit}^{tree}`])).trim() === accepted.treeHash
          && (await this.git(run.workspace.path, ['rev-parse', `${commit.commit}^`])).trim() === accepted.head) {
          return { safe: false, candidate, commit, reason: 'The accepted candidate was already committed before workflow state was admitted. An explicit recovery decision can adopt this verified Git receipt without another commit.' };
        }
      }
      const acknowledged = (item: { recoveryDecisionId?: string; reconciledAt?: string }): boolean => Boolean(item.reconciledAt && run.decisionHistory.some((decision) => decision.id === item.recoveryDecisionId && decision.kind === 'recovery' && decision.answer?.trim()));
      const unknownWrites = run.attempts.some((attempt) => attempt.task.kind === 'implementer' && (['started', 'unknown'].includes(attempt.state) || ['failed', 'cancelled'].includes(attempt.outcome?.status ?? '')) && !acknowledged(attempt));
      const unknownCommit = run.operations.some((operation) => operation.kind === 'commit' && ['started', 'unknown'].includes(operation.state) && !acknowledged(operation));
      if (unknownWrites || unknownCommit) return { safe: false, candidate, reason: 'Interrupted write or commit has an unknown outcome. Inspect actual source and Git history, then explicitly reconcile the recorded attempt; no write is automatically replayed.' };
      if (run.currentCandidateId && candidate.id !== run.currentCandidateId) return { safe: false, candidate, reason: 'Workspace differs from the last admitted candidate; its previous acceptance evidence cannot be reused automatically.' };
      return { safe: true, candidate };
    } catch (error) { return { safe: false, reason: (error as Error).message }; }
  }

  async dispose(): Promise<void> {
    for (const claim of this.claims.values()) {
      try {
        const owner = JSON.parse(await readFile(claim.file, 'utf8')) as Owner;
        if (owner.token === claim.token) await rm(claim.file);
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    this.claims.clear();
  }
}
