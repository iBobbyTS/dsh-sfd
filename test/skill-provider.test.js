import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sfdSkillProvider } from '../lib/skill-provider.js';
import { access } from 'node:fs/promises';
import { join } from 'node:path';

test('provider lists the SFD skill and its code-review companion', async () => {
  const candidates = await sfdSkillProvider.list();
  assert.equal(candidates.length, 2);
  const byName = new Map(candidates.map((c) => [c.name, c]));
  const sfd = byName.get('sectioned-feature-development');
  const review = byName.get('code-review');
  assert.ok(sfd, 'SFD skill present');
  assert.ok(review, 'code-review companion present');
  for (const c of candidates) {
    assert.ok(c.description.length > 20);
    assert.equal(c.provider, 'dsh-sfd');
    assert.equal(c.resourceBase.kind, 'directory');
    // invocation MUST be the policy object; a string poisons the whole catalog
    assert.deepEqual(c.invocation, { modelInvocable: true, userInvocable: true });
    // rank MUST be a finite number (dsh-skill validateCandidate)
    assert.equal(typeof c.rank, 'number');
    assert.ok(Number.isFinite(c.rank));
    assert.ok(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(c.name), 'kebab-case name');
    assert.equal(typeof c.source, 'string');
    assert.equal(c.provider, sfdSkillProvider.name);
  }
});

test('provider get() returns the body without frontmatter', async () => {
  const [c] = (await sfdSkillProvider.list()).filter((x) => x.name === 'sectioned-feature-development');
  const def = await sfdSkillProvider.get(c);
  assert.equal(def.name, 'sectioned-feature-development');
  assert.ok(!def.content.startsWith('---'), 'frontmatter must be stripped from body');
  assert.ok(def.content.includes('# Sectioned Feature Development'));
  assert.ok(def.content.includes('## DSH host addendum'), 'the DSH addendum ships in the skill body');
  assert.deepEqual(def.invocation, { modelInvocable: true, userInvocable: true });
  assert.equal(typeof def.content, 'string');
  assert.ok(def.content.length > 0);
});

test('the full upstream skill surface ships: references, dispatch, scripts, assets', async () => {
  const [c] = (await sfdSkillProvider.list()).filter((x) => x.name === 'sectioned-feature-development');
  for (const rel of [
    'references/section-planning.md',
    'references/reviewer-orchestration.md',
    'references/dispatch/dsh.md',
    'references/dispatch/codex.md',
    'references/dispatch/zcode.md',
    'scripts/section_plan.py',
    'scripts/advisor_pack.py',
    'assets/PLAN-FULL.template.md',
    'assets/TASK-PACKET.template.md',
  ]) {
    await access(join(c.resourceBase.path, rel));
  }
});
