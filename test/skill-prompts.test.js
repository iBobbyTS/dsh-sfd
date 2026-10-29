/**
 * Prompt traceability over the bundled skill:
 *  - the 2026-10-28 activation ruling (self-activation approval sits BEFORE
 *    the start; no first-plan pause) must be the only activation story the
 *    agent can read in the bundle;
 *  - the DSH addendum must carry the plugin-contract rules (injection is
 *    facts+pointers, dispatch stays with the agent, ledger is
 *    plugin-written);
 *  - the fat-plugin era wording (plugin owns dispatch/commits/reports) must
 *    not survive anywhere in the bundle.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const skillDir = join(root, 'skills', 'sectioned-feature-development');
const bundleDir = join(root, 'skills');

function textFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name === '.DS_Store') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...textFiles(p));
    else if (/\.(md|json)$/.test(name)) out.push(p);
  }
  return out;
}

test('SKILL.md: self-activation approval sits before the start, not after the first plan', () => {
  const skill = readFileSync(join(skillDir, 'SKILL.md'), 'utf8');
  for (const fragment of ['Only on self-activation must the user approve starting SFD',
    'before any workspace preparation or `sfd_start` call',
    'already carries that approval',
    'without another approval pause']) {
    assert.ok(skill.includes(fragment), `SKILL.md missing activation-approval rule fragment: ${fragment}`);
  }
});

test('skill bundle + locale: no retired first-plan-approval pause wording remains', () => {
  const retired = ['first proportional plan', 'stop before plan review for user approval',
    '自动激活需要用户先批准', '首个比例适中的计划'];
  const files = [...textFiles(bundleDir), join(root, 'locale', 'en.json'), join(root, 'locale', 'zh.json')];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    for (const fragment of retired) {
      assert.ok(!text.includes(fragment), `${file} still contains retired activation-approval wording: ${fragment}`);
    }
  }
});

test('the DSH addendum states the thin-plugin contract', () => {
  const skill = readFileSync(join(skillDir, 'SKILL.md'), 'utf8');
  const addendum = skill.slice(skill.indexOf('## DSH host addendum'));
  for (const fragment of [
    'observation and injection only',
    'never author or edit it',
    'not authorization, not a gate',
    'this skill wins',
    'The plugin has no dispatch',
    'sfd_start',
    'sfd_finish',
  ]) {
    assert.ok(addendum.includes(fragment), `DSH addendum missing rule fragment: ${fragment}`);
  }
});

test('the fat-plugin era wording is gone from the whole bundle', () => {
  const retired = [
    'sfd_spawn_stage',
    'wave counting',
    'hard gates',
    'commits via dsh-git-commit',
    'ctx.gitCommit',
    'reports to disk',
    'evidence bundles pre-assembled',
    'Dispatch is yours',
  ];
  for (const file of textFiles(bundleDir)) {
    const text = readFileSync(file, 'utf8');
    for (const fragment of retired) {
      assert.ok(!text.includes(fragment), `${file} still contains fat-plugin wording: ${fragment}`);
    }
  }
});

test('the bundle carries no changelog-era noise for the runtime agent', () => {
  for (const file of textFiles(bundleDir)) {
    const text = readFileSync(file, 'utf8');
    assert.ok(!/\(2026-\d{2}-\d{2}[^)]*ruling\)/.test(text), `${file} carries a dated ruling reference; rulings belong in REQUIREMENTS.md`);
  }
});

test('the DSH dispatch profile names installed sfd-* profiles for A=zcode B=codex', () => {
  const dispatch = readFileSync(join(skillDir, 'references', 'dispatch', 'dsh.md'), 'utf8');
  for (const profile of ['sfd-dsh-impl-std', 'sfd-codex-impl-large', 'sfd-zcode-plan-review',
    'sfd-codex-plan-review', 'sfd-zcode-code-review', 'sfd-codex-code-review']) {
    assert.ok(dispatch.includes(profile), `dsh.md missing profile: ${profile}`);
  }
  assert.ok(dispatch.includes('never send those fields alongside `profile`'));
});
