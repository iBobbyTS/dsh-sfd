import test from 'node:test';
import assert from 'node:assert/strict';
import { ENDPOINT, ROUTE, createHandler } from '../lib/rpc.js';

const service = {
  async status(payload) { return { echo: 'status', payload }; },
};

const post = (body, headers = { 'content-type': 'application/json' }) => new Request(`http://127.0.0.1${ROUTE}`, {
  method: 'POST',
  headers,
  body: typeof body === 'string' ? body : JSON.stringify(body),
});

const envelope = (method, payload = {}, rpcId = 'rpc-1') => ({ type: 'client-request', method: ENDPOINT, rpcId, payload: { method, payload } });

test('a valid request runs the status method and answers in the transport envelope', async () => {
  const handler = createHandler(service);
  const response = await handler(post(envelope('status', { cwd: '/example/repo' })));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.json();
  assert.equal(body.type, 'server-response');
  assert.equal(body.rpcId, 'rpc-1');
  assert.deepEqual(body.result, { ok: true, value: { echo: 'status', payload: { cwd: '/example/repo' } } });
});

test('a service failure is a result error, not a transport error', async () => {
  const failing = { async status() { throw new Error('ledger exploded'); } };
  const handler = createHandler(failing);
  const response = await handler(post(envelope('status')));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.result.ok, false);
  assert.equal(body.result.error.code, 'SFD_ERROR');
  assert.match(body.result.error.message, /ledger exploded/);
});

test('retired panel methods are gone: only status exists', async () => {
  const handler = createHandler(service);
  for (const method of ['settings', 'saveSettings', 'catalog']) {
    const body = await (await handler(post(envelope(method)))).json();
    assert.equal(body.result.ok, false, `${method} must no longer be a panel method`);
    assert.equal(body.result.error.code, 'NOT_FOUND');
  }
});

test('the route rejects everything that is not a Connection request', async () => {
  const handler = createHandler(service);
  assert.equal((await handler(new Request(`http://127.0.0.1${ROUTE}`, { method: 'GET' }))).status, 405);
  assert.equal((await handler(post(envelope('status'), { 'content-type': 'text/plain' }))).status, 415);
  assert.equal((await handler(post('{ broken'))).status, 400);
  assert.equal((await handler(post({ type: 'client-request', method: 'other', rpcId: 'x', payload: {} }))).status, 400);
  assert.equal((await handler(post({ type: 'client-request', method: ENDPOINT, rpcId: '', payload: {} }))).status, 400);
  assert.equal((await handler(post({ type: 'client-request', method: ENDPOINT, rpcId: 'x', payload: { method: 5 } }))).status, 400);
  assert.equal((await handler(post({ type: 'client-request', method: ENDPOINT, rpcId: 'x', payload: { method: 'status' } }, { 'content-type': 'application/json' }))).status, 200);
});

test('an oversized request is refused before parsing', async () => {
  const handler = createHandler(service);
  const huge = JSON.stringify({ ...envelope('status'), padding: 'x'.repeat(300_000) });
  assert.equal((await handler(post(huge))).status, 413);
});
