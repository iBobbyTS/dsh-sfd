/**
 * ES daemon status for the panel (display only).
 *
 * The plugin no longer routes spawns, so it no longer needs a model catalog —
 * but the panel still answers "is external-subagent alive and what runtimes
 * are spawnable", which is the same `subagents status --probe` source the CLI
 * and MCP expose. Read-only, best-effort: a failure is a status row, never a
 * panel crash.
 */
import { runEs } from './es-cli.js';

const PROBE_TIMEOUT_MS = 30_000;

/**
 * Parse one `subagents status --probe` document into panel rows.
 * @param source - raw stdout.
 * @returns `{ ok: true, subagents: [...] }`.
 * @throws on non-JSON or an `ok:false` document.
 */
export function parseStatus(source) {
  let data;
  try {
    data = JSON.parse(source);
  } catch (error) {
    throw new Error(`external-subagent status is not JSON: ${error.message}`);
  }
  if (!data || data.ok !== true || !Array.isArray(data.subagents)) {
    throw new Error('external-subagent status returned an unexpected shape');
  }
  const subagents = data.subagents
    .filter((row) => typeof row?.subagent === 'string' && row.subagent.length > 0)
    .map((row) => ({
      subagent: row.subagent,
      enabled: row.enabled === true,
      spawnSupported: row.spawn_supported === true,
      spawnBlocked: row.enabled !== true
        ? 'disabled'
        : row.spawn_supported !== true
          ? 'unsupported'
          : row.transport_support?.spawn === false ? 'transport' : null,
      version: typeof row.version === 'string' ? row.version : null,
    }));
  return { ok: true, subagents, probedAtMs: Date.now() };
}

/** Probe the daemon now; errors are returned, not thrown. */
export async function probeStatus() {
  try {
    const stdout = await runEs(['subagents', 'status', '--probe'], { timeoutMs: PROBE_TIMEOUT_MS });
    return parseStatus(stdout);
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error), subagents: [], probedAtMs: Date.now() };
  }
}
