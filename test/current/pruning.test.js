import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import { compilePlan } from '../../lib/compiler.js';
import { buildGraph, structuralSame, validateGraph } from '../../lib/graph-store.js';
import { stageInstruction } from '../../lib/guidance.js';
import { prepareWait, pollWait, finishWait } from '../../lib/execution.js';
import { fixture, plan, markDone } from './fixtures.js';

const route = { subagent: 'fake', model: 'configured-reviewer' };
const task = node => ({ node, assignment: 'complete current review contract', route });
async function setup(t) {
  const f = await fixture();
  t.after(() => rm(f.repo, { recursive: true, force: true }));
  return f;
}

test('compiler keeps plan synchronization and source identities without retired evidence metadata', () => {
  const text = plan(); const base = compilePlan(text);
  assert.match(base.digest, /^[a-f0-9]{64}$/);
  assert.notEqual(compilePlan(text + '\n').digest, base.digest);
  assert.equal('evidenceDigest' in base, false);
  assert.equal('commonFingerprint' in base, false);
  for (const owner of [...base.units, ...base.features]) {
    assert.equal('fingerprint' in owner, false);
    assert.equal('end' in owner, false);
    assert.ok(Number.isInteger(owner.line));
  }
  const graph = buildGraph(base, { sessionId: 'test-session', repo: '/test-repo' });
  assert.equal(graph.plan.digest, base.digest);
  assert.equal(validateGraph(graph, base, { actors: {}, groups: {} }), graph);
});

test('unchanged detection and validation share canonical comparisons while allowing custom workflow gates', () => {
  const base = compilePlan(plan());
  const initial = buildGraph(base, { sessionId: 'test-session', repo: '/test-repo' });
  const implementation = Object.values(initial.nodes).find(node => node.kind === 'implementation').id;
  for (const [key, value] of [['mandatory', false], ['kind', 'review'], ['role', 'other'], ['unit', 'other'], ['section', 'other'], ['feature', 'other'], ['needs', []]]) {
    const graph = structuredClone(initial); graph.nodes[implementation][key] = value;
    assert.equal(structuralSame(graph, base), false, key);
    assert.throws(() => validateGraph(graph, base, {}, { file: 'current-graph' }), error => error.code === 'GRAPH_INVALID' && error.locations[0].startsWith('current-graph:') && !Object.hasOwn(error, 'node'), key);
  }
  const missing = structuredClone(initial); delete missing.nodes[implementation];
  assert.equal(structuralSame(missing, base), false);
  assert.throws(() => validateGraph(missing, base, {}), /required node/);
  const extended = structuredClone(initial);
  extended.nodes['custom-check'] = { id: 'custom-check', kind: 'main', mandatory: false, status: 'pending', needs: [] };
  extended.nodes[implementation].needs.push('custom-check');
  assert.equal(structuralSame(extended, base), true);
  validateGraph(extended, base, {});
});

test('compile emits each ready-stage instruction once and still supplies actionable navigation', async (t) => {
  const f = await setup(t); const response = await f.compile();
  const node = response.graph.nodes['plan:initial'];
  const text = JSON.stringify(stageInstruction(node)).slice(1, -1);
  assert.equal(JSON.stringify(response).split(text).length - 1, 1);
  assert.match(response.instruction, /Next ready actions:.*plan:initial/);
  assert.equal(response.navigation.next[0].instruction.includes(stageInstruction(node)), true);
});

test('first-role authority retains applicable references without resending the loaded root skill', async (t) => {
  const f = await setup(t); await f.compile();
  const first = await f.spawn([task('plan:initial')]);
  const report = await f.wait(first.agent_ids[0]);
  const authority = report.instructions[0].fullInstructions;
  const canonical = await readFile(new URL('../../skills/sectioned-feature-development/SKILL.md', import.meta.url), 'utf8');
  assert.ok(authority.includes('Authority: references/reviewer-orchestration.md'));
  assert.ok(!authority.includes('Authority: SKILL.md'));
  assert.ok(!authority.includes(canonical));
  assert.equal(report.instructions[0].report_action.agent_id, first.agent_ids[0]);
  await markDone(f, 'plan:initial', first.agent_ids[0], 1);
  const later = await f.spawn([task('plan:final')]);
  const next = await f.wait(later.agent_ids[0]);
  assert.equal(next.instructions[0].fullInstructions, undefined);
  assert.ok(next.instructions[0].instruction.length > 0);
});

test('wait snapshots only actor facts and returns latest plan-repair guidance after polling', async (t) => {
  const f = await setup(t); await f.compile();
  const spawned = await f.spawn([task('plan:initial')]);
  const poll = await prepareWait(f.repo, f.session, { agent_ids: spawned.agent_ids, wait_time: 0 });
  assert.equal('graph' in poll, false);
  await f.setPlan(plan().replace('Foundation', 'Changed implementation scope'));
  const body = await pollWait(poll, f.rpc);
  const response = await finishWait(f.repo, f.session, poll, body);
  assert.equal(response.complete, true);
  assert.match(response.graphWarning, /PLAN-FULL changed/);
  assert.match(response.instruction, /sfd_workflow_compile/);
  assert.deepEqual(response.instructions, []);
  assert.equal((await f.state()).actors[spawned.agent_ids[0]].rounds[0].reportComplete, true);
});

test('locale resources retain host metadata without retired startup and Git-operation messages', async () => {
  for (const language of ['en', 'zh']) {
    const value = JSON.parse(await readFile(new URL('../../locale/' + language + '.json', import.meta.url), 'utf8'));
    assert.deepEqual(Object.keys(value), ['meta']);
    assert.ok(value.meta.title.length > 0);
    assert.ok(value.meta.description.length > 0);
  }
});
