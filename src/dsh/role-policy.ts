import type { Context } from '@deepseek-ai/cordis';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, relative, isAbsolute } from 'node:path';
import { defineTool } from '@deepseek-ai/dsh-tools';
import Schema from '@deepseek-ai/schemastery';
import { setSandboxMode } from '@deepseek-ai/dsh-sandbox-policy';
import { setApprovalPolicy } from '@deepseek-ai/dsh-user-approval';
import type {} from '@deepseek-ai/dsh-tools';
import type {} from '@deepseek-ai/dsh-agent';
import { ROLE_SPECS } from '../roles/index.js';
import type { ActorKind } from '../core/types.js';

export const name = 'sfd-role-policy';
export const inject = ['tools', 'sandboxPolicy', 'approval'];
export interface Config { kind: ActorKind }
export const Config: Schema<Config> = Schema.object({
  kind: Schema.union(Object.keys(ROLE_SPECS) as ActorKind[]).required(),
});

/** Installed in a preset generation, so capability restrictions precede publication. */
export function apply(ctx: Context, config: Config): void {
  const role = ROLE_SPECS[config.kind];
  if (role === undefined) throw new Error(`Unknown SFD role: ${String(config.kind)}`);
  const allowed = new Set<string>(role.toolNames);
  // A native, read-only and path-bounded index of the original SFD knowledge.
  // Compiled presets live in lib/; source presets in src/dsh/.
  ctx.tools.register(defineTool({
    name: 'sfd_knowledge',
    description: 'Read a selected, packaged SFD planning, review or workflow reference. Begin with planning/router.md or review/review-routing.md; load only material applicable to the current task.',
    parameters: { path: { type: 'string', required: true, description: 'Repository-relative knowledge path such as planning/router.md.' } },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args) {
      if (!/^(planning|review|workflow)\/[A-Za-z0-9_./-]+\.md$/.test(args.path) || args.path.includes('..')) throw new Error('Unsupported SFD knowledge path.');
      const bases = [resolve(dirname(fileURLToPath(import.meta.url)), '../../knowledge'), resolve(dirname(fileURLToPath(import.meta.url)), '../knowledge')];
      for (const base of bases) {
        const target = resolve(base, args.path);
        const rel = relative(base, target);
        if (rel === '..' || rel.startsWith('../') || isAbsolute(rel)) throw new Error('Knowledge path escapes its package.');
        try { return await readFile(target, 'utf8'); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      }
      throw new Error('The named SFD knowledge reference is not bundled.');
    },
  }));
  // Guard own/scoped tools too. The PTC carrier remains available; every
  // underlying tool still crosses this guard independently.
  ctx.tools.guard(exec => allowed.has(exec.name) || exec.name === 'run_code'
    ? undefined : `The ${role.title} role cannot execute ${exec.name}.`);
  ctx.on('agent/created', ({ agent }) => {
    // At preset-definition time the generation's own tools are not globals.
    // Mask inherited capabilities on the actual child after it joins the
    // generation, while its own structured-output tool remains exempt.
    const inherited = agent.ctx.tools.schemas(agent).map(tool => tool.name)
      .filter(tool => allowed.has(tool) && tool !== 'structured_output' && tool !== 'run_code');
    agent.ctx.tools.restrict({ allow: inherited });
    if (role.access === 'reader') setSandboxMode(agent.session, 'read-only');
    setApprovalPolicy(agent.session, 'never');
    return undefined;
  });
}
