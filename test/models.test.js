import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { STAGES, ModelSettingsStore, emptyStages, readSelection } from '../lib/models.js';

const temporary = () => mkdtemp(join(tmpdir(), 'dsh-sfd-models-'));
const selection = (model = 'deepseek/deepseek-flash') => ({ subagent: 'zcode', model });

test('an empty store answers both scopes without inventing a project', async () => {
  const store = new ModelSettingsStore(join(await temporary(), 'dsh-sfd.json'));
  const global = await store.get(null);
  assert.deepEqual(global, { root: null, global: { stages: emptyStages() }, project: null });
  const project = await store.get('/example/repo');
  assert.deepEqual(project.project, { stages: emptyStages() });
});

test('a global selection never leaks into a project scope', async () => {
  const store = new ModelSettingsStore(join(await temporary(), 'dsh-sfd.json'));
  await store.save(null, 'global', 'planReviewA', selection());
  const before = await store.get('/example/repo');
  assert.equal(before.global.stages.planReviewA.model, 'deepseek/deepseek-flash');
  assert.equal(before.project.stages.planReviewA, null);

  await store.save('/example/repo', 'project', 'codeReviewB', selection('zai/GLM-5.3'));
  const after = await store.get('/example/repo');
  assert.equal(after.project.stages.codeReviewB.model, 'zai/GLM-5.3');
  assert.equal(after.global.stages.codeReviewB, null);
  // Another project keeps its own empty scope.
  const other = await store.get('/example/other');
  assert.equal(other.project.stages.codeReviewB, null);
});

test('every stage is writable and clearing the last project stage drops the project', async () => {
  const file = join(await temporary(), 'dsh-sfd.json');
  const store = new ModelSettingsStore(file);
  for (const stage of STAGES) await store.save('/example/repo', 'project', stage, selection());
  const filled = await store.get('/example/repo');
  assert.deepEqual(Object.keys(filled.project.stages), [...STAGES]);
  for (const stage of STAGES) assert.notEqual(filled.project.stages[stage], null);

  for (const stage of STAGES) await store.save('/example/repo', 'project', stage, null);
  const cleared = await store.get('/example/repo');
  assert.deepEqual(cleared.project.stages, emptyStages());
  const data = JSON.parse(await readFile(file, 'utf8'));
  assert.deepEqual(data.projects, {}, 'an empty project scope is not persisted');
});

test('the file is versioned JSON written with owner-only permissions', async () => {
  const file = join(await temporary(), 'dsh-sfd.json');
  const store = new ModelSettingsStore(file);
  await store.save(null, 'global', 'implementationLarge', selection());
  const data = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(data.version, 1);
  assert.deepEqual(Object.keys(data.global.stages), [...STAGES]);
  const mode = (await stat(file)).mode & 0o777;
  assert.equal(mode, 0o600);
});

test('invalid scopes, stages and selections are refused', async () => {
  const store = new ModelSettingsStore(join(await temporary(), 'dsh-sfd.json'));
  await assert.rejects(() => store.save(null, 'workspace', 'planReviewA', null), /scope/);
  await assert.rejects(() => store.save(null, 'global', 'planReviewC', null), /stage/);
  await assert.rejects(() => store.save(null, 'global', 'planReviewA', { subagent: 'zcode' }), /selection/);
  await assert.rejects(() => store.save(null, 'project', 'planReviewA', null), /project root/);
  await assert.rejects(() => store.save(null, 'global', 'planReviewA', { subagent: '', model: 'm' }), /subagent/);
});

test('concurrent saves serialize instead of overwriting each other', async () => {
  const store = new ModelSettingsStore(join(await temporary(), 'dsh-sfd.json'));
  await Promise.all([
    store.save(null, 'global', 'planReviewA', selection('a')),
    store.save(null, 'global', 'planReviewB', selection('b')),
    store.save(null, 'global', 'codeReviewA', selection('c')),
  ]);
  const state = await store.get(null);
  assert.equal(state.global.stages.planReviewA.model, 'a');
  assert.equal(state.global.stages.planReviewB.model, 'b');
  assert.equal(state.global.stages.codeReviewA.model, 'c');
});

test('a corrupt settings file is reported, not silently replaced', async () => {
  const directory = await temporary();
  const file = join(directory, 'dsh-sfd.json');
  await import('node:fs/promises').then(({ writeFile }) => writeFile(file, '{ not json', 'utf8'));
  const store = new ModelSettingsStore(file);
  await assert.rejects(() => store.get(null), /not valid JSON/);
});

test('readSelection drops shapes a spawn could not use', () => {
  assert.deepEqual(readSelection({ subagent: 'zcode', model: 'm' }), { subagent: 'zcode', model: 'm' });
  assert.equal(readSelection(null), null);
  assert.equal(readSelection({}), null);
  assert.equal(readSelection({ subagent: 'zcode', model: '' }), null);
  assert.equal(readSelection({ subagent: 'zcode', model: 'm', extra: 1 }).extra, undefined);
});
