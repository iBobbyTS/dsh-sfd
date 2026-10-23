import test from 'node:test';
import assert from 'node:assert/strict';
import { pickLocale, loadDict, translator } from '../lib/i18n.js';

test('pickLocale: explicit preference wins', () => {
  assert.equal(pickLocale({ preference: 'zh-Hans-CA', envLang: 'en_US.UTF-8', systemLang: 'en-CA', icu: 'en-US' }), 'zh');
});

test('pickLocale: LANG env before system language', () => {
  assert.equal(pickLocale({ preference: undefined, envLang: 'zh_CN.UTF-8', systemLang: 'en-CA', icu: 'en-US' }), 'zh');
});

test('pickLocale: system language before ICU', () => {
  assert.equal(pickLocale({ envLang: undefined, systemLang: 'zh-Hans-CA', icu: 'en-US' }), 'zh');
});

test('pickLocale: ICU before en fallback', () => {
  assert.equal(pickLocale({ icu: 'zh-CN' }), 'zh');
});

test('pickLocale: unsupported everywhere -> en', () => {
  assert.equal(pickLocale({ preference: 'fr', envLang: 'fr_FR', systemLang: 'fr-CA', icu: 'fr-FR' }), 'en');
});

test('pickLocale: unsupported preference falls through the chain', () => {
  assert.equal(pickLocale({ preference: 'ja', systemLang: 'zh-Hans-CA' }), 'zh');
});

test('dictionaries: zh covers every en key (no raw-key leak)', async () => {
  const en = await loadDict('en');
  const zh = await loadDict('zh');
  const missing = Object.keys(en).filter((k) => !(k in zh));
  assert.deepEqual(missing, [], `zh missing keys: ${missing.join(', ')}`);
});

test('translator: zh overlay with interpolation, unknown key renders key', async () => {
  const t = await translator('zh');
  assert.equal(t('cleanup.dirtyTitle'), '工作区不干净');
  assert.equal(t('state.esProfileMissing', { names: 'sfd-a, sfd-b' }).includes('sfd-a, sfd-b'), true);
  assert.equal(t('no.such.key'), 'no.such.key');
});

test('translator: en base resolves the keys used by cleanup cards', async () => {
  const t = await translator('en');
  for (const key of ['cleanup.dirtyTitle', 'cleanup.dirtyQuestion', 'cleanup.autoCommit', 'cleanup.stop',
    'cleanup.autoCommitDesc', 'cleanup.stopDesc',
    'tool.stoppedShort', 'tool.userNote', 'tool.createBranchFromMain', 'tool.createBranchFromCurrent',
    'tool.intent.create-from-main', 'tool.intent.new-from-main', 'tool.intent.new-from-current',
    'tool.intent.stay-current', 'tool.intent.ff-main-to-current', 'tool.intent.ff-to-main',
    'tool.intent.agent-merge', 'tool.intent.note-only']) {
    assert.equal(t(key) === key, false, `${key} rendered raw`);
  }
});

test('translator: unsupported language falls back to en', async () => {
  const t = await translator('fr');
  assert.equal(t('cleanup.dirtyTitle'), 'Workspace is dirty');
});
