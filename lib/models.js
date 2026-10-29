/**
 * SFD stage model routing: the host-owned configuration behind the right-side
 * panel.
 *
 * Facts:
 * - One file outside Git holds both scopes: `$DSH_HOME/dsh-sfd.json`.
 *   `global.stages` applies to every project; `projects[root].stages` applies
 *   to one project. Both use the same stage vocabulary, so a project value is
 *   a plain override of the global one — the panel never has to reconcile two
 *   shapes.
 * - A stage value is either `null` (nothing chosen) or `{ subagent, model }`.
 *   `model` is the token external-subagent accepts for that subagent, which is
 *   why the two fields travel together: a token is only meaningful inside its
 *   subagent's catalog.
 * - Writes go through one serialized queue per process and are atomic
 *   (tmp + rename), so a reader never observes a half-written file and two
 *   concurrent panel saves cannot interleave.
 */
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/** Every stage the panel configures. Order is the panel's row order. */
export const STAGES = Object.freeze([
  'planReviewA',
  'planReviewB',
  'implementationStandard',
  'implementationLarge',
  'codeReviewA',
  'codeReviewB',
]);

/** The two writable scopes. */
export const SCOPES = Object.freeze(['global', 'project']);

/** DSH home, which owns the settings file. */
export const DSH_HOME = () => process.env.DSH_HOME || join(homedir(), '.dsh');

/** Settings file for this plugin (kept outside every project directory). */
export const settingsPath = () => join(DSH_HOME(), 'dsh-sfd.json');

const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, field, limit) => {
  if (typeof value !== 'string' || value.length === 0 || value.length > limit) {
    throw new Error(`${field} must be a non-empty string of at most ${limit} characters`);
  }
  return value;
};

/** A stored selection, or null. Unknown/invalid stored shapes degrade to null. */
export function readSelection(value) {
  if (!plain(value)) return null;
  if (typeof value.subagent !== 'string' || value.subagent.length === 0 || value.subagent.length > 64) return null;
  if (typeof value.model !== 'string' || value.model.length === 0 || value.model.length > 400) return null;
  return { subagent: value.subagent, model: value.model };
}

/** A caller-supplied selection: null clears it, anything else must be complete. */
export function checkedSelection(value) {
  if (value === null) return null;
  if (!plain(value)) throw new Error('selection must be null or { subagent, model }');
  return {
    subagent: text(value.subagent, 'selection.subagent', 64),
    model: text(value.model, 'selection.model', 400),
  };
}

/** The empty stage map every scope starts from. */
export function emptyStages() {
  return Object.fromEntries(STAGES.map((stage) => [stage, null]));
}

/** One scope's stages, defaults filled in and unknown stored stages dropped. */
function readStages(value) {
  const source = plain(value) ? value : {};
  const stages = emptyStages();
  for (const stage of STAGES) stages[stage] = readSelection(source[stage]);
  return stages;
}

const defaults = () => ({ version: 1, global: { stages: emptyStages() }, projects: {} });

/**
 * Read the file into its normalized shape. A missing file is the default; a
 * corrupt or foreign-version file is an error the panel can show, never a
 * silent overwrite of whatever the user had.
 */
function normalize(data) {
  if (!plain(data) || data.version !== 1) throw new Error('Unsupported dsh-sfd settings version');
  const projects = {};
  if (plain(data.projects)) {
    for (const [root, scope] of Object.entries(data.projects)) {
      if (typeof root !== 'string' || root.length === 0) continue;
      projects[root] = { stages: readStages(scope?.stages) };
    }
  }
  return { version: 1, global: { stages: readStages(data.global?.stages) }, projects };
}

/**
 * The stage configuration of both scopes.
 *
 * `project` is null when the caller has no project root, which is how the panel
 * knows to disable that section instead of writing settings nobody can reach.
 */
export class ModelSettingsStore {
  /** @param path - settings file override (tests); defaults to the DSH home. */
  constructor(path = settingsPath()) {
    this.path = path;
    /** Serializes load-modify-write cycles. */
    this.writes = Promise.resolve();
  }

  async read() {
    try {
      return normalize(JSON.parse(await readFile(this.path, 'utf8')));
    } catch (error) {
      if (error?.code === 'ENOENT') return defaults();
      if (error instanceof SyntaxError) throw new Error(`dsh-sfd settings are not valid JSON: ${error.message}`);
      throw error;
    }
  }

  /**
   * Both scopes as the panel renders them.
   * @param root - project root, or null when the session has no project.
   */
  async get(root) {
    const data = await this.read();
    const hasRoot = typeof root === 'string' && root.length > 0;
    return {
      root: hasRoot ? root : null,
      global: { stages: data.global.stages },
      // A project root without a saved scope still answers with empty stages:
      // "no settings yet" is editable, while a null scope means no project.
      project: hasRoot ? { stages: readStages(data.projects[root]?.stages) } : null,
    };
  }

  /**
   * Set one stage's selection in one scope.
   * @param root - project root; required for the project scope, ignored for global.
   * @param scope - 'global' or 'project'.
   * @param stage - one of STAGES.
   * @param selection - { subagent, model } or null.
   */
  async save(root, scope, stage, selection) {
    if (!SCOPES.includes(scope)) throw new Error('scope must be "global" or "project"');
    if (!STAGES.includes(stage)) throw new Error('Unknown SFD stage');
    const next = checkedSelection(selection);
    const key = scope === 'project' ? root : null;
    if (scope === 'project' && (typeof key !== 'string' || key.length === 0)) {
      throw new Error('Project settings require a project root');
    }
    const apply = async () => {
      const data = await this.read();
      const target = scope === 'project'
        ? (data.projects[key] ??= { stages: emptyStages() })
        : data.global;
      target.stages[stage] = next;
      if (scope === 'project' && STAGES.every((name) => target.stages[name] === null)) delete data.projects[key];
      data.global.stages = readStages(data.global.stages);
      await mkdir(dirname(this.path), { recursive: true });
      const tmp = `${this.path}.${randomUUID()}.tmp`;
      try {
        await writeFile(tmp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
        await rename(tmp, this.path);
      } finally {
        await rm(tmp, { force: true });
      }
      return this.get(key);
    };
    const pending = this.writes.then(apply);
    this.writes = pending.catch(() => {});
    return pending;
  }
}
