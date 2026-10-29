import test from 'node:test';
import assert from 'node:assert/strict';
import { ENDPOINT, ROUTE, createHandler } from '../lib/rpc.js';

const service = {
  async settings(payload) { return { echo: 'settings', payload }; },
  async saveSettings(payload) {
    if (payload.stage === 'boom') throw new Error('stage exploded');
    return { echo: 'saveSettings', payload };
  },
  async catalog(payload) { return { echo: 'catalog', payload }; },
};

const post = (body, headers = { 'content-type': 'application/json' }) => new Request(`http://127.0.0.1${ROUTE}`, {
  method: 'POST',
  headers,
  body: typeof body === 'string' ? body : JSON.stringify(body),
});

const envelope = (method, payload = {}, rpcId = 'rpc-1') => ({ type: 'client-request', method: ENDPOINT, rpcId, payload: { method, payload } });

test('a valid request runs the named service method and answers in the transport envelope', async () => {
  const handler = createHandler(service);
  const response = await handler(post(envelope('settings', { cwd: '/example/repo' })));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.json();
  assert.equal(body.type, 'server-response');
  assert.equal(body.rpcId, 'rpc-1');
  assert.deepEqual(body.result, { ok: true, value: { echo: 'settings', payload: { cwd: '/example/repo' } } });
});

test('a service failure is a result error, not a transport error', async () => {
  const handler = createHandler(service);
  const response = await handler(post(envelope('saveSettings', { stage: 'boom' })));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.result.ok, false);
  assert.equal(body.result.error.code, 'SFD_ERROR');
  assert.match(body.result.error.message, /stage exploded/);
});

test('an unknown method is answered without running anything', async () => {
  const handler = createHandler(service);
  const body = await (await handler(post(envelope('deleteEverything')))).json();
  assert.deepEqual(body.result, { ok: false, error: { code: 'NOT_FOUND', message: 'Unknown method', details: {} } });
});

test('the route rejects everything that is not a Connection request', async () => {
  const handler = createHandler(service);
  assert.equal((await handler(new Request(`http://127.0.0.1${ROUTE}`, { method: 'GET' }))).status, 405);
  assert.equal((await handler(post(envelope('settings'), { 'content-type': 'text/plain' }))).status, 415);
  assert.equal((await handler(post('{ broken'))).status, 400);
  assert.equal((await handler(post({ type: 'client-request', method: 'other', rpcId: 'x', payload: {} }))).status, 400);
  assert.equal((await handler(post({ type: 'client-request', method: ENDPOINT, rpcId: '', payload: {} }))).status, 400);
  assert.equal((await handler(post({ type: 'client-request', method: ENDPOINT, rpcId: 'x', payload: { method: 5 } }))).status, 400);
  assert.equal((await handler(post({ type: 'client-request', method: ENDPOINT, rpcId: 'x', payload: { method: 'settings' } }, { 'content-type': 'application/json' }))).status, 200);
});

test('an oversized request is refused before parsing', async () => {
  const handler = createHandler(service);
  const huge = JSON.stringify({ ...envelope('settings'), padding: 'x'.repeat(300_000) });
  assert.equal((await handler(post(huge))).status, 413);
});
