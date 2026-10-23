import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugify, branchSlug } from '../lib/slug.js';

test('slugify kebab-cases english, drops stopwords', () => {
  assert.equal(slugify('Add a dark-mode toggle to the settings page'), 'dark-mode-toggle-settings-page');
});

test('slugify treats each CJK char as a word', () => {
  assert.equal(slugify('暗黑模式切换'), '暗-黑-模-式-切-换');
});

test('slugify caps words and length', () => {
  assert.equal(slugify('one two three four five six seven eight').split('-').length, 6);
  assert.ok(slugify('a'.repeat(200)).length <= 64);
});

test('slugify empty/garbage yields empty string', () => {
  assert.equal(slugify(''), '');
  assert.equal(slugify('???'), '');
  assert.equal(slugify(null), '');
});

test('branchSlug: explicit slug wins, else derived, else feature', () => {
  assert.equal(branchSlug({ slug: 'my-slug', taskSummary: 'whatever' }), 'my-slug');
  assert.equal(branchSlug({ taskSummary: 'Add dark mode support' }), 'dark-mode-support');
  assert.equal(branchSlug({}), 'feature');
});
