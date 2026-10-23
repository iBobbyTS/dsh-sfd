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

/** Parse YAML-ish frontmatter (name/description) from a SKILL.md body. */
function parseFrontmatter(text) {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!match) return null;
  const meta = {};
  for (const line of match[1].split('\n')) {
    const kv = /^([a-zA-Z]+):\s*(.*)$/.exec(line.trim());
    if (kv) meta[kv[1]] = kv[2].replace(/^"(.*)"$/, '$1');
  }
  return meta;
}

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
        invocation: 'model',
        source: `plugin:@ibobbyts/dsh-sfd:${entry.name}`,
        provider: 'dsh-sfd',
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
      invocation: 'model',
      source: candidate.source,
      provider: 'dsh-sfd',
      content: body,
      resourceBase: candidate.resourceBase,
    };
  },
};
