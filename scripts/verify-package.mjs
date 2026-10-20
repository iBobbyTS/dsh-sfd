import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const execute = promisify(execFile);
const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const filename = `${manifest.name.replace(/^@/, '').replace('/', '-')}-${manifest.version}.tgz`;
const files = new Set((await execute('tar', ['-tzf', filename], { cwd: root, encoding: 'utf8' })).stdout.trim().split('\n').map(path => path.replace(/^package\//, '')));
const packedManifest = JSON.parse((await execute('tar', ['-xOf', filename, 'package/package.json'], { cwd: root, encoding: 'utf8' })).stdout);
assert.deepEqual(packedManifest, manifest, 'Packaged manifest must match the verified source.');
for (const required of ['lib/index.js', 'lib/client.js', 'lib/core.js', 'lib/role.js', 'lib/types/index.d.ts', 'cordis.patch.yml', 'README.md', 'LICENSE', 'docs/IMPLEMENTATION-PLAN.md']) {
  assert.ok(files.has(required), `Missing packaged artifact: ${required}`);
}
for (const file of files) assert.ok(!file.startsWith('node_modules/') && !file.startsWith('tests/'), `Unexpected packaged source: ${file}`);
for (const [name, entry] of Object.entries(manifest.exports)) {
  if (typeof entry === 'string') { assert.ok(files.has(entry.replace(/^\.\//, '')), name); continue; }
  for (const path of Object.values(entry)) assert.ok(files.has(path.replace(/^\.\//, '')), `${name}: ${path}`);
}
assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml');
assert.ok(!manifest.scripts.prepare && !manifest.scripts.install && !manifest.scripts.postinstall && !manifest.scripts.prepack, 'The committed distribution must install without lifecycle build hooks.');
const host = await import(new URL('../lib/index.js', import.meta.url));
const role = await import(new URL('../lib/role.js', import.meta.url));
const core = await import(new URL('../lib/core.js', import.meta.url));
const client = await import(new URL('../lib/client.js', import.meta.url));
assert.equal(typeof host.apply, 'function');
assert.equal(typeof role.apply, 'function');
assert.equal(typeof core.WorkflowController, 'function');
assert.equal(typeof client.apply, 'function');
console.log(`Verified ${filename}: ${files.size} packaged files; all Host, role, core and client exports load.`);
