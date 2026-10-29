/**
 * ES daemon status parsing for the panel (display only).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStatus } from '../lib/es-status.js';

const doc = (rows) => JSON.stringify({ ok: true, subagents: rows });

test('parseStatus keeps every named row and computes its spawn blocker', () => {
  const value = parseStatus(doc([
    { subagent: 'zcode', enabled: true, spawn_supported: true, version: '0.17.0' },
    { subagent: 'dsh', enabled: true, spawn_supported: true, transport_support: { spawn: false } },
    { subagent: 'agy', enabled: false, spawn_supported: true },
    { subagent: 'codex', enabled: true, spawn_supported: false },
  ]));
  assert.equal(value.ok, true);
  assert.deepEqual(value.subagents, [
    { subagent: 'zcode', enabled: true, spawnSupported: true, spawnBlocked: null, version: '0.17.0' },
    { subagent: 'dsh', enabled: true, spawnSupported: true, spawnBlocked: 'transport', version: null },
    { subagent: 'agy', enabled: false, spawnSupported: true, spawnBlocked: 'disabled', version: null },
    { subagent: 'codex', enabled: true, spawnSupported: false, spawnBlocked: 'unsupported', version: null },
  ]);
});

test('parseStatus rejects non-JSON and ok:false documents', () => {
  assert.throws(() => parseStatus('not json'), /not JSON/);
  assert.throws(() => parseStatus('{"ok":false}'), /unexpected shape/);
  assert.throws(() => parseStatus('{"ok":true,"subagents":{}}'), /unexpected shape/);
});
