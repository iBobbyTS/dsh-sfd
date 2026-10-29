/**
 * The right-side panel's data channel.
 *
 * Facts:
 * - The panel is browser code; it cannot read the settings file or run the
 *   external-subagent CLI. Both go through DSH Connection's already
 *   authenticated `/api` RPC transport, registered as one exact Fetch route —
 *   the same seam DSH's own `/api/file` uses. The route carries no session
 *   identity of its own: the panel sends the Session's working directory, and
 *   the Host resolves it to a project root.
 * - The transport envelope (`client-request` / `server-response`, `rpcId`) is
 *   Connection's contract, so it is validated here before any service runs.
 */
export const ROUTE = '/api/dsh-sfd';
export const ENDPOINT = 'dsh-sfd';

const METHODS = new Set(['status']);
const MAX_REQUEST_CHARS = 262_144;
const HEADERS = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };

const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const ok = (rpcId, value) => Response.json(
  { type: 'server-response', rpcId, result: { ok: true, value } },
  { headers: HEADERS },
);

const failed = (rpcId, error, code = 'SFD_ERROR') => Response.json(
  {
    type: 'server-response',
    rpcId,
    result: {
      ok: false,
      error: { code, message: error instanceof Error ? error.message : String(error), details: {} },
    },
  },
  { headers: HEADERS },
);

/**
 * Build the Fetch handler for the panel's RPC route.
 * @param service - `{ status }`; the method receives the validated payload.
 */
export function createHandler(service) {
  return async function serve(request) {
    const contentType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: HEADERS });
    if (contentType !== 'application/json') return new Response('JSON required', { status: 415, headers: HEADERS });
    let input;
    try {
      const body = await request.text();
      if (body.length > MAX_REQUEST_CHARS) return new Response('Request too large', { status: 413, headers: HEADERS });
      input = JSON.parse(body);
    } catch {
      return new Response('Invalid JSON', { status: 400, headers: HEADERS });
    }
    if (!record(input) || input.type !== 'client-request' || input.method !== ENDPOINT
      || typeof input.rpcId !== 'string' || input.rpcId.length === 0 || input.rpcId.length > 256
      || !record(input.payload) || typeof input.payload.method !== 'string') {
      return new Response('Invalid Connection request', { status: 400, headers: HEADERS });
    }
    const { method } = input.payload;
    if (!METHODS.has(method)) return failed(input.rpcId, new Error('Unknown method'), 'NOT_FOUND');
    const payload = record(input.payload.payload) ? input.payload.payload : {};
    try {
      return ok(input.rpcId, await service[method](payload));
    } catch (error) {
      return failed(input.rpcId, error);
    }
  };
}
