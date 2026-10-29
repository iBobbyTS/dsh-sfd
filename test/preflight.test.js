import test from 'node:test';
import assert from 'node:assert/strict';
import { preflight } from '../lib/es.js';

const status = (subagents) => async () => ({
  ok: true,
  daemon_status: { mcp_version: '0.6.6', subagents },
});

const row = (subagent, { enabled = true, spawn_supported = true, configured = true } = {}) => ({
  subagent, enabled, spawn_supported, configured,
});

test('preflight accepts any single spawnable subagent, not a fixed pair', async () => {
  const result = await preflight({
    run: status([row('zcode'), row('dsh', { enabled: false }), row('agy', { spawn_supported: false })]),
  });
  assert.equal(result.ok, true);
  assert.equal(result.blocking, null);
  assert.deepEqual(result.spawnable, ['zcode']);
  assert.equal(result.install.version, '0.6.6');
  assert.deepEqual(result.problems, []);
});

test('preflight blocks when ES answers but nothing can spawn', async () => {
  const result = await preflight({ run: status([row('zcode', { enabled: false })]) });
  assert.equal(result.ok, false);
  assert.equal(result.blocking, 'es-subagents');
  assert.deepEqual(result.spawnable, []);
  assert.match(result.problems[0], /no external subagent is enabled for spawn/);
});

test('preflight blocks when the daemon is unreachable, without profile wording', async () => {
  const result = await preflight({ run: async () => { throw new Error('socket closed'); } });
  assert.equal(result.ok, false);
  assert.equal(result.blocking, 'es-missing');
  assert.equal(result.install.error, 'socket closed');
  assert.equal(Object.hasOwn(result, 'missingProfiles'), false);
  assert.equal(Object.hasOwn(result, 'profiles'), false);
});
