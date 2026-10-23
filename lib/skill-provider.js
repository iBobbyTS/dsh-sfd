/**
 * Plugin-owned skill provider: serves the sectioned-feature-development flow
 * skill (and its references) from this package's `skills/` directory, so the
 * skill installs/ungrades/uninstalls together with the plugin instead of
 * living as loose files in ~/.dsh.
 *
 * Provider contract (ctx.skills.registerProvider): { name, list(), get() }.
 * Candidates carry a `directory` resourceBase so the skill body's relative
 * references resolve inside the package.
 */
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = join(HERE, '..', 'skills');

/** Parse YAML-ish frontmatter (name/description + flags) from a SKILL.md body. */
function parseFrontmatter(text) {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!match) return null;
  const meta = {};
  for (const line of match[1].split('\n')) {
    const kv = /^([a-zA-Z-]+):\s*(.*)$/.exec(line.trim());
    if (kv) meta[kv[1]] = kv[2].replace(/^"(.*)"$/, '$1');
  }
  return meta;
}

/**
 * Invocation policy per the dsh-skill provider contract: an OBJECT
 * { modelInvocable: boolean, userInvocable: boolean } — a string here throws
 * "non-object invocation policy" and poisons the whole skill catalog.
 * Frontmatter flags follow the filesystem provider's semantics:
 * `disable-model-invocation`, `user-invocable`; absent flags default true.
 */
function invocationPolicy(meta) {
  const disableModel = meta['disable-model-invocation'] === 'true';
  const userInvocable = meta['user-invocable'] === undefined ? true : meta['user-invocable'] !== 'false';
  return { modelInvocable: !disableModel, userInvocable };
}

/**
 * Candidate rank per the dsh-skill contract (finite number, lower wins):
 * 100 project-dsh, 200 project-agents, 300 custom dirs, 400 user-dsh,
 * 500 user-agents, 600 bundled, 250 runtime. A packaged plugin provider sits
 * between custom and user roots: 350.
 */
const PLUGIN_SKILL_RANK = 350;

export const sfdSkillProvider = {
  name: 'dsh-sfd',
  async list() {
    const candidates = [];
    let entries;
    try {
      entries = await readdir(SKILLS_DIR, { withFileTypes: true });
    } catch {
      return [];
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillDir = join(SKILLS_DIR, entry.name);
      let text;
      try {
        text = await readFile(join(skillDir, 'SKILL.md'), 'utf8');
      } catch { continue; }
      const meta = parseFrontmatter(text);
      if (!meta?.name || !meta?.description) continue;
      candidates.push({
        name: meta.name,
        description: meta.description,
        invocation: invocationPolicy(meta),
        source: `plugin:@ibobbyts/dsh-sfd:${entry.name}`,
        provider: 'dsh-sfd',
        rank: PLUGIN_SKILL_RANK,
        resourceBase: { kind: 'directory', path: skillDir },
      });
    }
    return candidates;
  },
  async get(candidate) {
    const skillDir = candidate.resourceBase?.path;
    if (!skillDir) return undefined;
    const text = await readFile(join(skillDir, 'SKILL.md'), 'utf8');
    const meta = parseFrontmatter(text);
    if (!meta?.name) return undefined;
    const body = text.replace(/^---\n[\s\S]*?\n---\n/, '');
    return {
      name: meta.name,
      description: meta.description,
      invocation: invocationPolicy(meta),
      source: candidate.source,
      provider: 'dsh-sfd',
      content: body,
      resourceBase: candidate.resourceBase,
    };
  },
};
