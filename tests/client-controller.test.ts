import assert from 'node:assert/strict';
import test from 'node:test';
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol';
import { createPolicy } from '../src/core/policy.js';
import type { DevelopmentRun } from '../src/core/types.js';
import type { DevelopmentWorkflowRemote } from '../src/dsh/remote-contract.js';
import { DevelopmentClientController } from '../src/client/controller.js';
import { availableActions, observedIdentity } from '../src/client/presentation.js';

const at = '2026-10-19T09:00:00.000Z';
function run(id = 'run-one', revision = 1): DevelopmentRun {
  return {
    id, schemaVersion: 1, workflowVersion: '1.0.0', revision, controlEpoch: 1,
    inputContractVersion: 1, createdAt: at, updatedAt: at, goal: 'Retain the original outcome.',
    requirementsHistory: [{ version: 1, goal: 'Retain the original outcome.', at }],
    workspace: { path: '/repo', branch: 'sfd/run-one', baseCommit: 'base' },
    policy: createPolicy({ commit: false }), status: 'draft', stage: 'planning',
    planRevision: 0, planRepairs: 0, planFeedback: [], sections: {}, candidates: {},
    attempts: [], operations: [], reviews: [], decisions: [], featureChecks: [], decisionHistory: [], events: [],
  };
}
function ok<T>(value: T): RemoteResult<T> { return { ok: true, value }; }
function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => { resolve = settle; });
  return { promise, resolve };
}
function remote(overrides: Partial<DevelopmentWorkflowRemote> = {}): DevelopmentWorkflowRemote {
  const noAction = async (): Promise<RemoteResult<DevelopmentRun>> => { throw new Error('Unexpected mutation'); };
  return {
    list: async () => ok([run()]), create: noAction, status: noAction,
    start: noAction, pause: noAction, resume: noAction, cancel: noAction,
    recover: noAction, decide: noAction, revise: noAction, ...overrides,
  };
}
async function settle(): Promise<void> { await new Promise<void>((resolve) => setImmediate(resolve)); }

test('owner switching fences late reads and never reassigns another owner Run', async () => {
  const old = deferred<RemoteResult<DevelopmentRun[]>>();
  const calls: string[] = [];
  const controller = new DevelopmentClientController(remote({ list: async ({ sessionId }) => {
    calls.push(sessionId);
    return sessionId === 'owner-old' ? old.promise : ok([run('new-owner-run')]);
  } }), 0);
  controller.setSession('owner-old');
  controller.setSession('owner-new');
  old.resolve(ok([run('old-owner-run')]));
  await settle();
  assert.equal(controller.getSnapshot().sessionId, 'owner-new');
  assert.deepEqual(controller.getSnapshot().runs.map((row) => row.id), ['new-owner-run']);
  assert.deepEqual(calls, ['owner-old', 'owner-new']);
  controller.dispose();
});

test('a stale list response cannot roll back an admitted pause', async () => {
  let reads = 0;
  const delayed = deferred<RemoteResult<DevelopmentRun[]>>();
  const initial = { ...run(), status: 'running' as const };
  const paused = { ...initial, revision: 5, status: 'paused' as const };
  const controller = new DevelopmentClientController(remote({
    list: async () => ++reads === 1 ? ok([initial]) : reads === 2 ? delayed.promise : ok([paused]),
    pause: async ({ sessionId, runId }) => { assert.equal(sessionId, 'owner'); assert.equal(runId, initial.id); return ok(paused); },
  }), 0);
  controller.setSession('owner');
  await settle();
  const pendingRead = controller.refresh();
  assert.equal(await controller.act('pause', initial.id), true);
  assert.equal(controller.getSnapshot().runs[0]?.status, 'paused');
  delayed.resolve(ok([initial]));
  await pendingRead;
  await settle();
  assert.equal(controller.getSnapshot().runs[0]?.revision, 5);
  assert.equal(controller.getSnapshot().runs[0]?.status, 'paused');
  controller.dispose();
});

test('a duplicate click cannot dispatch twice and mutation keeps its captured owner', async () => {
  const result = deferred<RemoteResult<DevelopmentRun>>();
  const calls: string[] = [];
  const controller = new DevelopmentClientController(remote({ start: async ({ sessionId }) => {
    calls.push(sessionId); return result.promise;
  } }), 0);
  controller.setSession('owner-one');
  await settle();
  const first = controller.act('start', 'run-one');
  assert.equal(await controller.act('start', 'run-one'), false);
  assert.throws(() => controller.setSession('owner-two'), /current action/);
  result.resolve(ok({ ...run(), revision: 2, status: 'running' }));
  assert.equal(await first, true);
  assert.deepEqual(calls, ['owner-one']);
  controller.dispose();
});

test('an observation error after a successful mutation is distinct from an action failure', async () => {
  let reads = 0;
  const controller = new DevelopmentClientController(remote({
    list: async () => { if (++reads > 1) throw new Error('Connection interrupted'); return ok([run()]); },
    start: async () => ok({ ...run(), revision: 2, status: 'running' }),
  }), 0);
  controller.setSession('owner');
  await settle();
  assert.equal(await controller.act('start', 'run-one'), true);
  await settle();
  assert.equal(controller.getSnapshot().error, undefined);
  assert.match(controller.getSnapshot().readError ?? '', /Connection interrupted/);
  assert.equal(controller.getSnapshot().runs[0]?.status, 'running');
  controller.dispose();
});

test('closing the observer never cancels the durable Host workflow', async () => {
  let cancellations = 0;
  const controller = new DevelopmentClientController(remote({ cancel: async () => { cancellations++; return ok(run()); } }), 0);
  controller.setSession('owner');
  const unsubscribe = controller.subscribe(() => {});
  await settle();
  unsubscribe();
  controller.dispose();
  assert.equal(cancellations, 0);
});

test('blocked and completed UI states do not advertise unauthorized continuation', () => {
  assert.deepEqual(availableActions({ ...run(), status: 'blocked' }), ['recover', 'cancel']);
  assert.deepEqual(availableActions({ ...run(), status: 'completed', stage: 'done' }), []);
  assert.deepEqual(availableActions({ ...run(), status: 'waiting-user' }), ['cancel']);
});

test('requested route never becomes observed identity in the UI', () => {
  assert.equal(observedIdentity({
    id: 'task', state: 'terminal', createdAt: at, infrastructureRetries: 0,
    task: { id: 'task', runId: 'run-one', kind: 'reviewer-a', inputContractVersion: 1, controlEpoch: 1,
      workspace: run().workspace, route: { preset: 'sfd-reviewer-a', provider: 'requested-provider', model: 'requested-model' },
      input: {}, outputSchema: {}, timeoutMs: 60_000 },
    outcome: { status: 'completed', identity: { transport: 'dsh-native' } },
  }), 'Not recorded');
});
