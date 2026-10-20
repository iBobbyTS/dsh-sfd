import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile, readFile, chmod, lstat, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkflowController } from '../src/core/controller.js';
import { runSchema } from '../src/core/schemas.js';
import { GitWorkspace } from '../src/workspace/git-workspace.js';
import { runProcess } from '../src/workspace/process.js';
import type { ActorRunner, RunStore } from '../src/core/ports.js';
import type { ActorOutcome, DevelopmentPlan, DevelopmentRun } from '../src/core/types.js';

test('REVIEW_ONLY freezes the actual dirty diff, completes independent A/B, and neither writes code nor creates a branch', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-sfd-review-only-'));
  const repo = join(root, 'source');
  await mkdir(repo);
  const git = async (...args: string[]) => {
    const r = await runProcess(['git', ...args], { cwd: repo, timeoutMs: 10000 });
    assert.equal(r.exitCode, 0, r.output);
    return r.output.trim();
  };
  await git('init', '-b', 'main');
  await git('config', 'user.name', 'Review Test');
  await git('config', 'user.email', 'review@example.invalid');
  await writeFile(join(repo, 'source.txt'), 'baseline\n');
  await git('add', 'source.txt'); await git('commit', '-m', 'baseline');
  const head = await git('rev-parse', 'HEAD');
  await writeFile(join(repo, 'source.txt'), 'changed and reviewable\n');
  const originalStatus = await git('status', '--porcelain');

  const plan: DevelopmentPlan = {
    title: 'Read-only review', assumptions: [],
    features: [{ id: 'F1', title: 'Existing delta', outcome: 'Validate current changes',
      acceptanceCriteria: ['Current changed source was independently inspected'], sectionIds: ['S1'], checks: [] }],
    sections: [{ id: 'S1', title: 'Review existing edit', featureIds: ['F1'], objective: 'Review without implementation',
      dependencies: [], writeScope: ['source.txt'], acceptanceCriteria: ['Changed source is inspected'],
      implementation: 'standard', subsections: [], checks: [] }],
  };
  const records = new Map<string, DevelopmentRun>();
  let updates: Promise<unknown> = Promise.resolve();
  const store: RunStore = {
    async list() { return [...records.values()].map(x => structuredClone(x)); },
    async get(id) { const x = records.get(id); return x && structuredClone(x); },
    async create(run) { records.set(run.id, runSchema.parse(structuredClone(run))); },
    update(id, modify) {
      const next = updates.then(() => {
        const current = records.get(id); if (!current) throw new Error('Missing run.');
        const value = runSchema.parse(modify(structuredClone(current)));
        records.set(id, value); return structuredClone(value);
      });
      updates = next.catch(() => {}); return next;
    },
  };
  const observed: {kind:string; delta?:string}[] = [];
  const actors: ActorRunner = {
    async start(task) {
      if (task.kind === 'implementer') throw new Error('REVIEW_ONLY dispatched an unauthorized product writer.');
      observed.push({ kind: task.kind, delta: (task.input.candidate as { sectionDelta?: {diff?:string}} | undefined)?.sectionDelta?.diff });
      let output: unknown;
      if (task.kind === 'planner') output = { plan, explanation: 'One reviewed Section from current uncommitted user edits.' };
      else if (task.kind === 'review-selector') output = { lenses: [{ id: 'R01', name: 'Full behavior', focus: 'Changed source' }], rationale: 'The bounded user edit.' };
      else if (task.kind === 'adjudicator') output = {
        resolution: 'accept', summary: 'Complete independent evidence.', coverageSufficient: true,
        dispositions: [], repairInstructions: '', material: false, invalidatedSectionIds: [], missingCoverage: [], evidenceReuse: [],
      };
      else if (task.kind === 'feature-verifier') {
        const run = await store.get(task.runId);
        const id = run?.reviews.find(r => r.sectionId === 'S1' && r.lensId === 'R01')?.id;
        assert.ok(id);
        output = { verdict: 'accepted', summary: 'Reviewed existing candidate.', criteria: [{
          featureId: 'F1', criterion: plan.features[0].acceptanceCriteria[0], evidenceIds: [id], satisfied: true,
        }], repairSectionIds: [], repairInstructions: '' };
      } else output = { verdict: 'clean', summary: 'Real code inspected.', coverage: ['Existing tracked file and changed lines'], limitations: [], findings: [] };
      const result: Promise<ActorOutcome> = Promise.resolve({ status: 'completed', output, identity: { transport: 'test' } });
      return { id: task.id, result, async dispose() {} };
    },
  };
  const workspace = new GitWorkspace({ stateRoot: join(root, 'state') });
  const controller = new WorkflowController({ store, actors, workspace });
  t.after(async () => {
    await controller.dispose();
    const unfreeze = async (path:string): Promise<void> => {
      const stat = await lstat(path); if (stat.isSymbolicLink()) return;
      await chmod(path, stat.isDirectory() ? 0o700 : 0o600);
      if (stat.isDirectory()) for (const item of await readdir(path)) await unfreeze(join(path,item));
    };
    await unfreeze(root); await rm(root, {recursive:true,force:true});
  });
  const initial = await controller.create({ intent: 'review-only', goal: 'Review current dirty changes', workspacePath: repo });
  const complete = new Promise<DevelopmentRun>((resolve, reject) => {
    const timeout = setTimeout(() => { unsub(); reject(new Error('REVIEW_ONLY did not reach a terminal disposition.')); }, 20000);
    const unsub = controller.subscribe(run => {
      if (run.id === initial.id && ['completed', 'waiting-user', 'blocked'].includes(run.status)) {
        clearTimeout(timeout); unsub(); resolve(run);
      }
    });
  });
  await controller.start(initial.id);
  const final = await complete;
  assert.equal(final.status, 'completed', final.blockedReason);
  assert.equal(final.workspace.branch, '(detached)');
  assert.equal(final.commit, undefined);
  assert.equal(final.delivery?.mode, 'worktree');
  assert.equal(final.sections.S1.stage, 'integrated');
  assert.ok(observed.some(x => x.kind === 'reviewer-b' && x.delta?.includes('changed and reviewable')));
  assert.equal(await git('rev-parse', 'HEAD'), head);
  assert.equal(await git('status', '--porcelain'), originalStatus);
  assert.equal(await readFile(join(repo, 'source.txt'), 'utf8'), 'changed and reviewable\n');
});
