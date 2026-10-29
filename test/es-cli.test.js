import test from 'node:test';
import assert from 'node:assert/strict';
import { EsError, parseEsJson, resolveBinary, runEs } from '../lib/es-cli.js';

test('a successful envelope is returned as decoded', () => {
  const value = parseEsJson('{"ok":true,"result":{"agent_id":10000001}}');
  assert.deepEqual(value.result, { agent_id: 10000001 });
});

test('an ok:false envelope raises the daemon code and keeps its detail', () => {
  assert.throws(
    () => parseEsJson('{"ok":false,"error":{"code":"INVALID_ARGUMENT","message":"create requires non-empty repository and prompt strings"}}'),
    (error) => error instanceof EsError
      && error.code === 'INVALID_ARGUMENT'
      && /non-empty repository/.test(error.message)
      && error.detail.message === 'create requires non-empty repository and prompt strings',
  );
});

test('non-JSON and non-object answers are output errors', () => {
  assert.throws(() => parseEsJson('not json'), (error) => error.code === 'ES_OUTPUT');
  assert.throws(() => parseEsJson('[]'), (error) => error.code === 'ES_OUTPUT');
  assert.throws(() => parseEsJson('null'), (error) => error.code === 'ES_OUTPUT');
  assert.throws(() => parseEsJson('{"ok":false}'), (error) => error.code === 'ES_ERROR');
});

test('the binary resolves from the override before install locations', () => {
  assert.equal(resolveBinary({ EXTERNAL_SUBAGENT_BIN: '/custom/external-subagent' }), '/custom/external-subagent');
  assert.match(resolveBinary({}), /external-subagent$/);
});

test('a missing binary is a launcher failure, not a crash', async () => {
  const previous = process.env.EXTERNAL_SUBAGENT_BIN;
  process.env.EXTERNAL_SUBAGENT_BIN = '/nonexistent/external-subagent';
  try {
    await assert.rejects(() => runEs(['status']), (error) => error.code === 'ES_MISSING' && /not found/.test(error.message));
  } finally {
    if (previous === undefined) delete process.env.EXTERNAL_SUBAGENT_BIN;
    else process.env.EXTERNAL_SUBAGENT_BIN = previous;
  }
});

test('an aborted call is reported as aborted', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () => runEs(['status'], { signal: controller.signal }),
    (error) => error.code === 'ES_ABORTED',
  );
});
