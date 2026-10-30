import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sfdSkillProvider } from '../lib/skill-provider.js';
import { access } from 'node:fs/promises';
import { join } from 'node:path';

test('provider lists the flow skill with frontmatter parsed', async () => {
  const candidates = await sfdSkillProvider.list();
  assert.equal(candidates.length, 2);
  const c = candidates.find(c=>c.name==='sectioned-feature-development');
  assert.equal(c.name, 'sectioned-feature-development');
  assert.ok(c.description.length > 20);
  assert.equal(c.provider, 'dsh-sfd');
  assert.equal(c.resourceBase.kind, 'directory');
  // invocation MUST be the policy object; a string poisons the whole catalog
  assert.deepEqual(c.invocation, { modelInvocable: true, userInvocable: true });
  // rank MUST be a finite number (dsh-skill validateCandidate)
  assert.equal(typeof c.rank, 'number');
  assert.ok(Number.isFinite(c.rank));
  // mirror remaining validateCandidate rules so a malformed candidate never ships
  assert.ok(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(c.name), 'kebab-case name');
  assert.equal(typeof c.source, 'string');
  assert.equal(c.provider, sfdSkillProvider.name);
});

test('provider get() returns the body without frontmatter', async () => {
  const c = (await sfdSkillProvider.list()).find(c=>c.name==='sectioned-feature-development');
  const def = await sfdSkillProvider.get(c);
  assert.equal(def.name, 'sectioned-feature-development');
  assert.ok(!def.content.startsWith('---'), 'frontmatter must be stripped from body');
  assert.ok(def.content.includes('# Sectioned Feature Development'));
  assert.deepEqual(def.invocation, { modelInvocable: true, userInvocable: true });
  // mirror validateDefinition rules: content must be a non-empty string
  assert.equal(typeof def.content, 'string');
  assert.ok(def.content.length > 0);
});

test('references directory ships next to the skill', async () => {
  const c = (await sfdSkillProvider.list()).find(c=>c.name==='sectioned-feature-development');
  for (const ref of ['references/section-planning.md', 'references/reviewer-orchestration.md']) {
    await access(join(c.resourceBase.path, ref));
  }
});
