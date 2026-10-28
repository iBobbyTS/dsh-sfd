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
  assert.equal(t('state.notGit'), '当前目录不是 Git 仓库。');
  assert.equal(t('state.esProfileMissing', { names: 'sfd-a, sfd-b' }).includes('sfd-a, sfd-b'), true);
  assert.equal(t('no.such.key'), 'no.such.key');
});

test('translator: en base resolves the keys used by the /sfd handoff and sfd_start', async () => {
  const t = await translator('en');
  for (const key of ['state.fresh', 'state.prepare', 'state.handoff', 'state.nextPlan',
    'state.notGit', 'state.notRootAgent', 'state.noCwd', 'state.esMissing', 'state.esProfileMissing',
    'state.resume', 'state.legacyTitle', 'state.legacyBody', 'state.readSkillFirst',
    'tool.existingRun', 'tool.started', 'tool.startedDirty']) {
    assert.equal(t(key) === key, false, `${key} rendered raw`);
  }
  // the mandatory decision table must be traceable case by case in the handoff
  const prepare = t('state.prepare');
  for (const fragment of ['Dirty workspace', 'on main/master', 'ahead/behind', '0/0',
    'ahead>0,behind=0', 'ahead=0,behind>0', 'ahead>0,behind>0', 'detached HEAD']) {
    assert.ok(prepare.includes(fragment), `state.prepare missing decision-table case: ${fragment}`);
  }
});

test('translator: unsupported language falls back to en', async () => {
  const t = await translator('fr');
  assert.equal(t('state.notGit'), 'The working directory is not a Git repository.');
});
