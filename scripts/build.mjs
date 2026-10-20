import { build } from 'esbuild';
import { rm } from 'node:fs/promises';

await rm('lib', { recursive: true, force: true });
const shared = {
  bundle: true,
  format: 'esm',
  sourcemap: true,
  target: 'es2022',
  external: ['@deepseek-ai/*', 'react', 'react/*', 'react-dom', 'react-dom/*', 'zod'],
  logLevel: 'info',
};
await Promise.all([
  build({ ...shared, platform: 'node', entryPoints: { index: 'src/index.ts', core: 'src/core/index.ts', role: 'src/dsh/role-policy.ts' }, outdir: 'lib' }),
  build({ ...shared, platform: 'browser', entryPoints: ['src/client/index.ts'], outfile: 'lib/client.js' }),
]);
