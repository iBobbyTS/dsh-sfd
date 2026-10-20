import assert from 'node:assert/strict';
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { WorkflowController } from '../src/core/controller.js';
import { runSchema } from '../src/core/schemas.js';
import type { ActorRunner, RunStore } from '../src/core/ports.js';
import type { ActorOutcome, DevelopmentPlan, DevelopmentRun } from '../src/core/types.js';
import { GitWorkspace } from '../src/workspace/git-workspace.js';
import { runProcess } from '../src/workspace/process.js';

test('two dependent Sections compose and deliver through the actual Git/check adapters while the source checkout stays untouched', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-sfd-integration-'));
  const repo = join(directory, 'project');
  await mkdir(repo);
  const git = async (...args: string[]) => {
    const result = await runProcess(['git', ...args], { cwd: repo });
    assert.equal(result.exitCode, 0, result.output); return result.output.trim();
  };
  await git('init', '-b', 'main');
  await git('config', 'user.name', 'Workflow integration test');
  await git('config', 'user.email', 'integration@example.invalid');
  await writeFile(join(repo, 'package.json'), '{"name":"fixture","private":true,"type":"module"}\n');
  await git('add', '.'); await git('commit', '-m', 'Initial fixture');
  const originalHead = await git('rev-parse', 'HEAD');
  const records = JSON.stringify([{ id: 'one', owner: 'alice' }, { id: 'two', owner: 'bob' }]);
  const plan: DevelopmentPlan = {
    title: 'Owner-scoped export', assumptions: [],
    features: [{
      id: 'F01', title: 'Export owned records', outcome: 'A user exports only their own records.',
      acceptanceCriteria: ['Alice receives only her record in the composed export.'], sectionIds: ['S01', 'S02'],
      checks: [{ id: 'journey', command: [process.execPath, '--input-type=module', '-e', `import assert from 'node:assert/strict'; import { exportIds } from './export.js'; assert.equal(exportIds(${records},'alice'),'one');`], required: true }],
    }],
    sections: [
      { id: 'S01', title: 'Ownership filter', objective: 'Filter records by the current owner.', featureIds: ['F01'], dependencies: [], writeScope: ['filter.js'], acceptanceCriteria: ['Filtering excludes other owners.'], implementation: 'standard', subsections: [], checks: [{ id: 'filter', command: [process.execPath, '--input-type=module', '-e', `import assert from 'node:assert/strict'; import { owned } from './filter.js'; assert.deepEqual(owned(${records},'bob').map(x=>x.id),['two']);`], required: true }] },
      { id: 'S02', title: 'Export composition', objective: 'Compose the filter into the export path.', featureIds: ['F01'], dependencies: ['S01'], writeScope: ['export.js'], acceptanceCriteria: ['Export uses the ownership filter.'], implementation: 'standard', subsections: [], checks: [{ id: 'empty', command: [process.execPath, '--input-type=module', '-e', "import assert from 'node:assert/strict'; import { exportIds } from './export.js'; assert.equal(exportIds([],'alice'),'');"], required: true }] },
    ],
  };
  const saved = new Map<string, DevelopmentRun>();
  let writes: Promise<unknown> = Promise.resolve();
  const store: RunStore = {
    async list() { return [...saved.values()].map(value => structuredClone(value)); },
    async get(id) { const value = saved.get(id); return value && structuredClone(value); },
    async create(run) { saved.set(run.id, runSchema.parse(structuredClone(run))); },
    update(id, transform) {
      const pending = writes.then(() => {
        const current = saved.get(id); if (!current) throw new Error('Missing test Run.');
        const next = runSchema.parse(transform(structuredClone(current))); saved.set(id, next); return structuredClone(next);
      }); writes = pending.catch(() => undefined); return pending;
    },
  };
  const workspace = new GitWorkspace({
    stateRoot: join(directory, 'state'),
    executeCheck: ({ spec, cwd, signal, timeoutMs }) => runProcess(spec.command, { cwd, signal, timeoutMs }),
  });
  const observed: { kind: string; sectionId?: string; cwd: string }[] = [];
  const actors: ActorRunner = {
    async start(task) {
      observed.push({ kind: task.kind, sectionId: task.sectionId, cwd: task.workspace.path });
      const result: Promise<ActorOutcome> = (async () => {
        let output: unknown;
        if (task.kind === 'planner') output = { plan, explanation: 'Two parent Sections with a composed business acceptance check.' };
        else if (task.kind === 'implementer') {
          if (task.sectionId === 'S01') await writeFile(join(task.workspace.path, 'filter.js'), 'export function owned(records,owner){return records.filter(record=>record.owner===owner)}\n');
          else {
            const run = await store.get(task.runId);
            assert.equal(run?.sections.S01.stage, 'integrated', 'Dependent writer must wait for actual integration.');
            await writeFile(join(task.workspace.path, 'export.js'), "import {owned} from './filter.js';\nexport function exportIds(records,owner){return owned(records,owner).map(record=>record.id).join(',')}\n");
          }
          output = { summary: 'Fixture implementation written.', completedCriteria: plan.sections.find(section => section.id === task.sectionId)!.acceptanceCriteria, remainingWork: [], changedInterfaces: [] };
        } else if (task.kind === 'review-selector') output = { lenses: [{ id: 'R01', name: 'Behavior', focus: 'Requirement and ownership behavior.' }], rationale: 'One bounded implementation risk.' };
        else if (task.kind === 'adjudicator') output = { resolution: 'accept', summary: 'Deterministic fixture admits the recorded coverage.', coverageSufficient: true, dispositions: [], repairInstructions: '', material: false, invalidatedSectionIds: [], missingCoverage: [], evidenceReuse: [] };
        else if (task.kind === 'feature-verifier') {
          const checks = task.input.checks as { id: string; status: string }[];
          assert.ok(checks.every(check => check.status === 'passed'), 'Actual composed journey must pass.');
          output = { verdict: 'accepted', summary: 'The actual composed journey passed on the delivered snapshot.', criteria: [{ featureId: 'F01', criterion: plan.features[0].acceptanceCriteria[0], evidenceIds: [checks[0].id], satisfied: true }], repairSectionIds: [], repairInstructions: '' };
        } else output = { verdict: 'clean', summary: 'Deterministic fixture coverage.', coverage: ['Current bounded contract.'], limitations: [], findings: [] };
        return { status: 'completed', output, identity: { transport: 'test', sessionId: task.id } };
      })();
      return { id: task.id, result, async dispose() {} };
    },
  };
  const controller = new WorkflowController({ store, actors, workspace });
  t.after(async () => {
    await controller.dispose();
    const unfreeze = async (path: string): Promise<void> => {
      const stat = await lstat(path); if (stat.isSymbolicLink()) return;
      await chmod(path, stat.isDirectory() ? 0o700 : 0o600);
      if (stat.isDirectory()) for (const entry of await readdir(path)) await unfreeze(join(path, entry));
    };
    await unfreeze(directory); await rm(directory, { recursive: true, force: true });
  });
  const initial = await controller.create({ goal: 'Export only records belonging to the current user.', workspacePath: repo });
  const done = new Promise<DevelopmentRun>((resolve, reject) => {
    const timeout = setTimeout(() => { unsubscribe(); reject(new Error('The real Git/check workflow did not finish.')); }, 15_000);
    const unsubscribe = controller.subscribe(run => {
      if (run.id === initial.id && ['completed', 'blocked', 'waiting-user'].includes(run.status)) { clearTimeout(timeout); unsubscribe(); resolve(run); }
    });
  });
  await controller.start(initial.id);
  const finished = await done;
  assert.equal(finished.status, 'completed', finished.blockedReason);
  assert.equal(finished.delivery?.mode, 'worktree');
  assert.equal(finished.commit, undefined);
  assert.equal(finished.sections.S01.stage, 'integrated'); assert.equal(finished.sections.S02.stage, 'integrated');
  assert.equal(finished.featureChecks.length, 1); assert.equal(finished.featureChecks[0].status, 'passed');
  assert.equal(await git('rev-parse', 'HEAD'), originalHead);
  assert.equal(await git('status', '--porcelain'), '');
  assert.match(await readFile(join(finished.workspace.path, 'export.js'), 'utf8'), /owned/);
  assert.ok(observed.filter(call => call.kind.startsWith('reviewer-')).every(call => call.cwd !== finished.workspace.path));
});
