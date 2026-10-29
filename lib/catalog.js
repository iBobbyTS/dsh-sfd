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
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

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

/**
 * Locate the CLI. A GUI-launched Host inherits a minimal PATH on other
 * machines, so known install locations are checked before falling back to the
 * PATH lookup the name implies.
 */
export function resolveBinary(env = process.env) {
  if (typeof env.EXTERNAL_SUBAGENT_BIN === 'string' && env.EXTERNAL_SUBAGENT_BIN.length > 0) return env.EXTERNAL_SUBAGENT_BIN;
  const candidates = [
    '/opt/homebrew/bin/external-subagent',
    '/usr/local/bin/external-subagent',
    join(homedir(), '.local/bin/external-subagent'),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? 'external-subagent';
}

/** Run the CLI and return its stdout. */
function runCli() {
  const bin = resolveBinary();
  return new Promise((resolve, reject) => {
    execFile(bin, ['subagents', 'status', '--probe'], {
      timeout: PROBE_TIMEOUT_MS,
      maxBuffer: 8 * 1024 * 1024,
      env: process.env,
    }, (error, stdout, stderr) => {
      if (error) {
        const detail = String(stderr || error.message).trim().slice(0, 400);
        reject(new Error(error.code === 'ENOENT'
          ? 'external-subagent CLI not found; install it to list spawnable subagents'
          : `external-subagent status failed: ${detail}`));
        return;
      }
      resolve(stdout);
    });
  });
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
