import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveProjectRoot } from '../lib/project.js';

const gitAvailable = (() => {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

test('a working directory without one resolves to no project', async () => {
  assert.equal(await resolveProjectRoot(undefined), null);
  assert.equal(await resolveProjectRoot(''), null);
  assert.equal(await resolveProjectRoot('/x', { run: async () => null }), null);
  assert.equal(await resolveProjectRoot('/x', { run: async () => '   ' }), null);
  assert.equal(await resolveProjectRoot('/x', { run: async () => { throw new Error('not a repository'); } }), null);
  assert.equal(await resolveProjectRoot('/x', { run: async () => '/repo\n' }), '/repo');
});

test('a subdirectory resolves to its repository root', { skip: !gitAvailable }, async () => {
  const directory = realpathSync(await mkdtemp(join(tmpdir(), 'dsh-sfd-project-')));
  execFileSync('git', ['init', '--quiet'], { cwd: directory });
  const nested = join(directory, 'packages', 'app');
  await mkdir(nested, { recursive: true });
  assert.equal(await resolveProjectRoot(nested), directory);
  assert.equal(await resolveProjectRoot(directory), directory);
});

test('a plain directory outside any repository has no project root', { skip: !gitAvailable }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-sfd-plain-'));
  // HOME/XDG guard: the temporary directory is not inside a work tree.
  assert.equal(await resolveProjectRoot(directory), null);
});
