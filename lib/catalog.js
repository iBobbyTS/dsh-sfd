/**
 * Spawnable external-subagent targets for the SFD panel.
 *
 * Facts:
 * - The catalog is owned by the external-subagent daemon, not by this plugin;
 *   the panel shows exactly what a spawn would be able to select. The CLI
 *   `external-subagent subagents status --probe` is the same source behind
 *   MCP's `external_subagent_status(probe=true)`, and it answers over the
 *   daemon socket, so no MCP client has to be alive in the page.
 * - Only spawnable rows are offered: enabled, `spawn_supported`, and a
 *   transport that admits spawn. A model token is only usable together with its
 *   subagent, which is why the catalog is grouped by subagent rather than
 *   flattened into one model list.
 * - Probing launches runtimes, so results are cached briefly and concurrent
 *   panel mounts share one in-flight probe. `force` bypasses the cache for the
 *   panel's refresh control.
 */
import { runEs } from './es-cli.js';

/** How long a probe result is reused without `force`. */
export const CATALOG_TTL_MS = 30_000;
/** Bounded wait: a hung runtime must not hang the panel forever. */
const PROBE_TIMEOUT_MS = 30_000;

const tokensOf = (row) => {
  if (row?.models?.supported !== true || !Array.isArray(row.models.tokens)) return [];
  return row.models.tokens.filter((token) => typeof token === 'string' && token.length > 0 && token.length <= 400);
};

/** Why a configured subagent cannot be spawned right now, or null when it can. */
export function spawnBlocker(row) {
  if (!row || typeof row !== 'object') return 'unknown';
  if (row.enabled !== true) return 'disabled';
  if (row.spawn_supported !== true) return 'unsupported';
  if (row.transport_support?.spawn === false) return 'transport';
  return null;
}

/**
 * Parse one `subagents status --probe` JSON document into what the panel shows.
 * @param source - raw stdout.
 * @returns `{ subagents: [{ subagent, models, version }], probedAtMs }`.
 */
export function parseCatalog(source) {
  let data;
  try {
    data = JSON.parse(source);
  } catch (error) {
    throw new Error(`external-subagent status is not JSON: ${error.message}`);
  }
  if (!data || data.ok !== true || !Array.isArray(data.subagents)) {
    throw new Error('external-subagent status returned an unexpected shape');
  }
  const subagents = [];
  for (const row of data.subagents) {
    if (spawnBlocker(row) !== null) continue;
    if (typeof row.subagent !== 'string' || row.subagent.length === 0) continue;
    subagents.push({
      subagent: row.subagent,
      models: tokensOf(row),
      version: typeof row.local?.version === 'string' ? row.local.version : null,
    });
  }
  return { subagents, probedAtMs: Date.now() };
}

/** Probe every subagent through the one ES CLI boundary. */
async function runCli() {
  return runEs(['subagents', 'status', '--probe'], { timeoutMs: PROBE_TIMEOUT_MS });
}

/**
 * One process-wide catalog reader.
 * @param options.run - stdout producer override (tests).
 * @param options.now - clock override (tests).
 * @param options.ttlMs - cache lifetime override (tests).
 */
export function createCatalog({ run = runCli, now = Date.now, ttlMs = CATALOG_TTL_MS } = {}) {
  let cached = null;
  let inFlight = null;
  return {
    /** Current or freshly probed catalog. */
    async get({ force = false } = {}) {
      if (!force && cached !== null && now() - cached.at < ttlMs) return cached.value;
      if (inFlight === null) {
        const pending = (async () => {
          try {
            const value = parseCatalog(await run());
            cached = { at: now(), value };
            return value;
          } finally {
            inFlight = null;
          }
        })();
        inFlight = pending;
        return pending;
      }
      return inFlight;
    },
    /** Last successful probe, or null. */
    cached() {
      return cached?.value ?? null;
    },
    /** Drop the cache (a failed refresh must not keep serving stale rows). */
    invalidate() {
      cached = null;
    },
  };
}
