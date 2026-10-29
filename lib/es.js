/**
 * external-subagent static checks (install + spawnability).
 *
 * Facts:
 * - The plugin does not own the ES daemon; these are read-only probes through
 *   the one CLI boundary in `es-cli.js`. Every failure degrades to a reportable
 *   fact, never an implicit downgrade.
 * - Which subagent a stage runs on is the panel's choice, so the preflight no
 *   longer demands a fixed pair of subagents. It only requires that ES answers
 *   and that at least one subagent is enabled for spawn; a specific stage's
 *   target is checked at spawn time (`assertSpawnable`).
 * - No ES profiles exist in this design: role text travels with this plugin
 *   (`lib/roles.js`) and reaches ES as per-spawn `developer_instructions`.
 */
import { runEsJson } from './es-cli.js';

export const PREFLIGHT_TIMEOUT_MS = 15_000;

/**
 * Probe the ES daemon.
 * @param options.run - ES JSON caller (tests); defaults to the CLI boundary.
 * @returns `{ installed, ok, version, subagents, error }`; `subagents` maps name → facts.
 */
export async function checkInstall({ run = runEsJson } = {}) {
  try {
    const parsed = await run(['status'], { timeoutMs: PREFLIGHT_TIMEOUT_MS });
    const subagents = new Map();
    for (const row of parsed?.daemon_status?.subagents ?? []) {
      subagents.set(row.subagent, {
        configured: row.configured === true,
        enabled: row.enabled === true,
        spawnSupported: row.spawn_supported === true,
      });
    }
    return { installed: true, ok: true, version: parsed?.daemon_status?.mcp_version ?? null, subagents, error: null };
  } catch (error) {
    return { installed: false, ok: false, version: null, subagents: new Map(), error: String(error?.message ?? error) };
  }
}

/**
 * Full preflight: ES reachable and at least one spawnable subagent.
 * @param options.run - ES JSON caller (tests).
 * @returns `{ ok, blocking, install, spawnable, problems }`.
 */
export async function preflight({ run = runEsJson } = {}) {
  const install = await checkInstall({ run });
  if (!install.ok) {
    return {
      ok: false,
      blocking: 'es-missing',
      install,
      spawnable: [],
      problems: ['external-subagent is not installed or its daemon is unreachable'],
    };
  }
  const spawnable = [...install.subagents.entries()]
    .filter(([, facts]) => facts.enabled && facts.spawnSupported)
    .map(([name]) => name);
  if (spawnable.length === 0) {
    return {
      ok: false,
      blocking: 'es-subagents',
      install,
      spawnable,
      problems: ['no external subagent is enabled for spawn'],
    };
  }
  return { ok: true, blocking: null, install, spawnable, problems: [] };
}
