/**
 * Activation-approval prompt traceability (2026-10-28 ruling):
 * self-activation requires user approval BEFORE the start (preparation and
 * sfd_start); the retired rule — pausing after the first proportional plan
 * for user approval before plan review — must not survive anywhere the
 * agent can read (skill bundle + locale).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const skillDir = join(root, 'skills', 'sectioned-feature-development');

function textFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...textFiles(p));
    else if (/\.(md|json)$/.test(name)) out.push(p);
  }
  return out;
}

test('SKILL.md: self-activation approval sits before the start, not after the first plan', () => {
  const skill = readFileSync(join(skillDir, 'SKILL.md'), 'utf8');
  for (const fragment of ['Only on **self-activation** must the user approve starting SFD',
    'before any workspace preparation or `sfd_start` call',
    'already carries that approval',
    'without a user-approval pause']) {
    assert.ok(skill.includes(fragment), `SKILL.md missing activation-approval rule fragment: ${fragment}`);
  }
});

test('skill bundle + locale: no retired first-plan-approval pause wording remains', () => {
  const retired = ['first proportional plan', 'stop before plan review for user approval',
    '自动激活需要用户先批准', '首个比例适中的计划'];
  const files = [...textFiles(skillDir), join(root, 'locale', 'en.json'), join(root, 'locale', 'zh.json')];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    for (const fragment of retired) {
      assert.ok(!text.includes(fragment), `${file} still contains retired activation-approval wording: ${fragment}`);
    }
  }
});
