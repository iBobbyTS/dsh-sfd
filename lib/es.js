/** Historical read-only diagnostics; not used by wrapper activation or dispatch. */
/**
 * external-subagent static checks (P0: install + enabled + profiles).
 *
 * The plugin does not own the ES daemon; these are read-only probes. The CLI
 * is invoked without a shell (`execFile`) and every failure degrades to a
 * reportable fact, never an implicit downgrade.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

const run = promisify(execFile);

export function profilesDir() {
  return process.env.EXTERNAL_SUBAGENT_PROFILES_DIR
    ?? join(homedir(), 'Library', 'Application Support', 'external-subagent', 'profiles');
}

/** Probe the ES CLI. Returns { installed, ok, version, subagents, error }. */
export async function checkInstall() {
  try {
    const { stdout } = await run('external-subagent', ['status'], { timeout: 15000, maxBuffer: 8 * 1024 * 1024 });
    const parsed = JSON.parse(stdout);
    const subs = new Map();
    for (const s of parsed?.daemon_status?.subagents ?? []) {
      subs.set(s.subagent, { configured: !!s.configured, enabled: !!s.enabled, spawnSupported: !!s.spawn_supported });
    }
    return { installed: true, ok: true, version: parsed?.daemon_status?.mcp_version ?? null, subagents: subs, error: null };
  } catch (error) {
    return { installed: false, ok: false, version: null, subagents: new Map(), error: String(error?.message ?? error) };
  }
}

/** List installed ES profile names (JSON files present in the profiles dir). */
export async function listProfiles() {
  const dir = profilesDir();
  const names = [];
  try {
    const { readdir } = await import('node:fs/promises');
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.json')) names.push(entry.name.slice(0, -5));
    }
  } catch { /* unreadable directory -> no profiles visible */ }
  return { dir, names };
}

/** Full preflight: install + required subagents enabled + required profiles present. */
export async function preflight(requiredRoutes = []) {
  const install = await checkInstall();
  if (!install.ok) return { ok: false, blocking: 'es-missing', install, problems: ['external-subagent not installed or daemon not reachable'] };
  const { names } = await listProfiles();
  const problems = [];
  const neededSubs = [...new Set(requiredRoutes.map(route => { if (!route || typeof route !== 'object') throw new Error('Main-selected route required'); return route.subagent; }).filter(Boolean))];
  for (const name of neededSubs) {
    const s = install.subagents.get(name);
    if (!s || !s.configured || !s.enabled || !s.spawnSupported) {
      problems.push(`subagent "${name}" not enabled/configured for spawn`);
    }
  }
  const missingProfiles = [];
  for (const route of requiredRoutes) {
    const profile = route.profile;
    if (profile && !names.includes(profile)) missingProfiles.push(profile);
  }
  if (missingProfiles.length > 0) problems.push(`missing profiles: ${missingProfiles.join(', ')}`);
  return {
    ok: problems.length === 0,
    blocking: problems.length === 0 ? null : (missingProfiles.length > 0 ? 'es-profiles' : 'es-subagents'),
    install,
    profiles: names,
    missingProfiles,
    problems,
  };
}

/** Read one profile's non-instruction fields, for panel display and drift checks. */
export async function readProfile(name) {
  try {
    const raw = JSON.parse(await readFile(join(profilesDir(), `${name}.json`), 'utf8'));
    return { ok: true, name, subagent: raw.subagent ?? null, model: raw.model ?? null, effort: raw.effort ?? null, permissionMode: raw.permission_mode ?? null };
  } catch (error) {
    return { ok: false, name, error: String(error?.message ?? error) };
  }
}
