import test from 'node:test';
import assert from 'node:assert/strict';
import { createCatalog, parseCatalog, spawnBlocker } from '../lib/catalog.js';
import { resolveBinary } from '../lib/es-cli.js';

const row = (overrides = {}) => ({
  subagent: 'zcode',
  enabled: true,
  spawn_supported: true,
  transport_support: { probe: true, spawn: true },
  models: { supported: true, tokens: ['zai/GLM-5.3', 'deepseek/deepseek-flash'] },
  local: { version: '0.17.0' },
  ...overrides,
});

const document = (subagents) => JSON.stringify({ ok: true, product: 'external-subagent', subagents });

test('only spawnable subagents with usable tokens reach the panel', () => {
  const parsed = parseCatalog(document([
    row(),
    row({ subagent: 'dsh', enabled: false }),
    row({ subagent: 'codex', spawn_supported: false }),
    row({ subagent: 'agy', transport_support: { probe: true, spawn: false } }),
    row({ subagent: 'partial', models: { supported: true, tokens: ['good', '', 7, 'x'.repeat(401)] } }),
    row({ subagent: 'nomodels', models: { supported: false } }),
  ]));
  assert.deepEqual(parsed.subagents.map((entry) => entry.subagent), ['zcode', 'partial', 'nomodels']);
  assert.deepEqual(parsed.subagents[0].models, ['zai/GLM-5.3', 'deepseek/deepseek-flash']);
  assert.equal(parsed.subagents[0].version, '0.17.0');
  assert.deepEqual(parsed.subagents[1].models, ['good']);
  assert.deepEqual(parsed.subagents[2].models, []);
  assert.equal(typeof parsed.probedAtMs, 'number');
});

test('a malformed or failed status document is an error, not an empty catalog', () => {
  assert.throws(() => parseCatalog('not json'), /not JSON/);
  assert.throws(() => parseCatalog(JSON.stringify({ ok: false })), /unexpected shape/);
  assert.throws(() => parseCatalog(JSON.stringify({ ok: true })), /unexpected shape/);
});

test('spawnBlocker names the reason a configured subagent is unusable', () => {
  assert.equal(spawnBlocker(row()), null);
  assert.equal(spawnBlocker(row({ enabled: false })), 'disabled');
  assert.equal(spawnBlocker(row({ spawn_supported: false })), 'unsupported');
  assert.equal(spawnBlocker(row({ transport_support: { spawn: false } })), 'transport');
  assert.equal(spawnBlocker(null), 'unknown');
});

test('probes are cached, shared while in flight, and bypassed by force', async () => {
  let calls = 0;
  let now = 1000;
  const catalog = createCatalog({
    ttlMs: 500,
    now: () => now,
    run: async () => { calls += 1; return document([row()]); },
  });
  await Promise.all([catalog.get(), catalog.get()]);
  assert.equal(calls, 1, 'concurrent mounts share one probe');
  now = 1200;
  await catalog.get();
  assert.equal(calls, 1, 'a fresh cache is reused');
  now = 1600;
  await catalog.get();
  assert.equal(calls, 2, 'the cache expires');
  await catalog.get({ force: true });
  assert.equal(calls, 3, 'force probes again');
  assert.equal(catalog.cached().subagents[0].subagent, 'zcode');
});

test('a failed probe rejects and leaves no stale catalog behind', async () => {
  let fail = false;
  const catalog = createCatalog({
    run: async () => {
      if (fail) throw new Error('external-subagent status failed: socket closed');
      return document([row()]);
    },
  });
  await catalog.get();
  fail = true;
  await assert.rejects(() => catalog.get({ force: true }), /socket closed/);
  assert.equal(catalog.cached().subagents.length, 1, 'the last good answer survives a failed refresh');
});

test('an explicit binary override wins over install-location discovery', () => {
  assert.equal(resolveBinary({ EXTERNAL_SUBAGENT_BIN: '/custom/subagent' }), '/custom/subagent');
  assert.match(resolveBinary({}), /external-subagent$/);
});
