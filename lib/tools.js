/**
 * Agent-facing tools for SFD. P0 ships `sfd_start`: the agent determines the
 * task (asking the user when the session has no context), then calls this
 * tool once with the task summary; the tool runs the programmatic cleanup
 * gate — including automatic feature-branch creation from the real slug —
 * and persists the initial state. The `/sfd` command itself only detects
 * existing work and hands off; it never starts the flow silently.
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { initialState, transition, loadState, renderBrief, AGENT_WORK } from './state.js';
import { preflight } from './es.js';
import { runCleanup, inspect } from './cleanup.js';
import { branchSlug } from './slug.js';

export function registerSfdTools(ctx, { askCard, t: tLazy }) {
  ctx.tools.register(defineTool({
    name: 'sfd_start',
    description:
      'Start a sectioned-feature-development (SFD) run in this repository after the task is known. '
      + 'Runs the programmatic workspace cleanup gate (dirty-workspace handling, branch base decision, '
      + 'automatic feature branch creation named from the task) and persists the initial SFD state. '
      + 'Call this exactly once per run, after you know what the user wants built; do not call it to '
      + 'resume an existing run (that is `/sfd`). If a run already exists, this tool returns its brief instead.',
    parameters: {
      taskSummary: {
        type: 'string',
        required: true,
        description:
          'One short sentence describing the feature/task to build, in the language the user used. '
          + 'It is only used to derive the feature branch name and to record the task; it is not a plan.',
      },
      slug: {
        type: 'string',
        description:
          'Optional explicit feature slug (letters/digits/hyphens) for the branch name. '
          + 'Use it when the user or the task naming already implies one; otherwise it is derived from taskSummary.',
      },
    },
    output: {
      schema: { type: 'json' },
    },
    render: (args, value) => [{
      type: 'text',
      text: typeof value?.brief === 'string' ? value.brief : JSON.stringify(value ?? {}),
    }],
    async execute(args, exec) {
      const t2 = await tLazy().catch(() => (key) => key);
      const agent = exec.agent;
      if (!agent) throw new Error('sfd_start requires a calling agent (exec.agent was undefined)');
      if (exec.signal) exec.signal.throwIfAborted();

      let cwd;
      try {
        cwd = await ctx.workingDirectory?.ensure(agent);
      } catch { cwd = undefined; }
      if (!cwd) return { ok: false, error: 'no-cwd', message: t2('state.noCwd') };

      let facts;
      try {
        facts = await inspect(cwd);
      } catch {
        return { ok: false, error: 'not-git', message: t2('state.notGit') };
      }
      const root = facts.root;

      // Existing run: never restart; return the resume brief.
      const existing = await loadState(root);
      if (existing) {
        return { ok: false, error: 'already-running', brief: renderBrief(existing, t2), message: t2('tool.existingRun') };
      }

      const es = await preflight();
      if (!es.ok) {
        const message = es.blocking === 'es-missing'
          ? t2('state.esMissing')
          : t2('state.esProfileMissing').replace('{names}', (es.missingProfiles ?? []).join(', '));
        return { ok: false, error: es.blocking, message };
      }

      const result = await runCleanup({
        cwd: root,
        inspect,
        aheadBehind: (r, base) => import('./cleanup.js').then((m) => m.aheadBehind(r, base)),
        git: (r, a) => import('./cleanup.js').then((m) => m.git(r, a)),
        gitCommit: ctx.gitCommit,
        ask: (question) => askCard(agent, exec.signal, question),
        t: t2,
        slug: branchSlug({ slug: args.slug, taskSummary: args.taskSummary }),
      });

      if (result.error) {
        return { ok: false, error: result.error, message: result.message ?? result.error };
      }
      if (result.stopped) {
        return { ok: false, error: 'stopped', message: t2('state.stopped') };
      }

      let state = initialState(root);
      state = await transition(state, 'start', {
        phase: 'PLAN',
        task: { summary: args.taskSummary, slug: branchSlug({ slug: args.slug, taskSummary: args.taskSummary }) },
        git: { authority: { ...result.state } },
        es: { version: es.install.version ?? null, checkedAt: new Date().toISOString() },
      }, `cleanup done: startBranch=${result.state.startBranch}`);
      if (result.agentMerge) {
        state = await transition(state, 'hold', {
          hold: { kind: 'WAITING_USER', reason: 'Diverged branch: agent must merge and resolve conflicts before planning starts.', since: new Date().toISOString() },
        }, 'agent merge pending');
        return {
          ok: true,
          brief: [t2('state.fresh'), '', t2('tool.agentMergeTask')].join('\n'),
          state: { branch: result.state.startBranch, base: result.state.base, held: true },
        };
      }
      return {
        ok: true,
        brief: [
          t2('state.fresh'),
          '',
          t2('state.cleanupDone', { branch: result.state.startBranch, base: result.state.base }),
          '',
          t2('state.nextPlan'),
        ].join('\n'),
        state: { branch: result.state.startBranch, base: result.state.base, workDir: AGENT_WORK },
      };
    },
  }));
}
