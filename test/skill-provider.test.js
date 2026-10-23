import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sfdSkillProvider } from '../lib/skill-provider.js';
import { access } from 'node:fs/promises';
import { join } from 'node:path';

test('provider lists the flow skill with frontmatter parsed', async () => {
  const candidates = await sfdSkillProvider.list();
  assert.equal(candidates.length, 1);
  const c = candidates[0];
  assert.equal(c.name, 'sectioned-feature-development');
  assert.ok(c.description.length > 20);
  assert.equal(c.provider, 'dsh-sfd');
  assert.equal(c.resourceBase.kind, 'directory');
  // invocation MUST be the policy object; a string poisons the whole catalog
  assert.deepEqual(c.invocation, { modelInvocable: true, userInvocable: true });
});

test('provider get() returns the body without frontmatter', async () => {
  const [c] = await sfdSkillProvider.list();
  const def = await sfdSkillProvider.get(c);
  assert.equal(def.name, 'sectioned-feature-development');
  assert.ok(!def.content.startsWith('---'), 'frontmatter must be stripped from body');
  assert.ok(def.content.includes('# Sectioned Feature Development'));
  assert.deepEqual(def.invocation, { modelInvocable: true, userInvocable: true });
});

test('references directory ships next to the skill', async () => {
  const [c] = await sfdSkillProvider.list();
  for (const ref of ['references/section-planning.md', 'references/reviewer-orchestration.md']) {
    await access(join(c.resourceBase.path, ref));
  }
});
