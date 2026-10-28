/**
 * Agent-facing tools for SFD. P0 ships `sfd_start`: the agent determines the
 * task (asking the user when the session has no context), performs workspace
 * preparation itself per the skill's mandatory decision table (dirty-workspace
 * handling, branch-base choice, feature-branch creation), then calls this
 * tool once to record the initial state. The tool performs NO git writes —
 * it only probes the repository read-only and persists the SFD state with the
 * git facts it observes (branch, base, cleanliness). The `/sfd` command
 * itself only detects existing work and hands off; it never starts the flow
 * silently.
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { initialState, transition, loadState, renderBrief, AGENT_WORK } from './state.js';
import { preflight } from './es.js';
import { inspect } from './cleanup.js';

export function registerSfdTools(ctx, { t: tLazy }) {
  ctx.tools.register(defineTool({
    name: 'sfd_start',
    description:
      'Start a sectioned-feature-development (SFD) run in this repository after the task is known and '
      + 'workspace preparation is done. You perform workspace preparation yourself first (per the '
      + "skill's mandatory start decision table: dirty-workspace handling, branch-base decision, "
      + 'feature-branch creation); this tool performs no git operations — it verifies the ES preflight, '
      + 'records the git facts it observes (branch, base, cleanliness), and persists the initial SFD '
      + 'state. Call this exactly once per run, after you know what the user wants to build and the '
      + 'workspace is ready; do not call it to resume an existing run (that is `/sfd`). '
      + 'If a run already exists, this tool returns its brief instead.',
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
      branch: {
        type: 'string',
        description:
          'Name of the feature branch you created (or the current branch you decided to stay on) during '
          + 'workspace preparation. Optional: when omitted, the branch currently checked out is recorded.',
      },
    },
    output: {
      schema: { type: 'json' },
      render: (args, value) => [{
        type: 'text',
        text: typeof value?.brief === 'string' ? value.brief : JSON.stringify(value ?? {}),
      }],
    },
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

      // Record the git facts observed at start. `sfd_start` performs no git
      // operations — workspace preparation (dirty handling, base decision,
      // branch creation) already happened in the agent's own session tools.
      const branch = (args.branch ?? '').trim() || facts.branch;
      let state = initialState(root);
      state = await transition(state, 'start', {
        phase: 'PLAN',
        task: { summary: args.taskSummary, slug: args.slug ?? null },
        git: {
          authority: {
            intent: 'agent-managed',
            branch,
            base: facts.branch,
            facts: {
              inspectedBranch: facts.branch,
              detached: facts.detached,
              dirty: facts.dirty,
              midMerge: facts.midMerge,
            },
          },
        },
        es: { version: es.install.version ?? null, checkedAt: new Date().toISOString() },
      }, `started on ${branch} (base ${facts.branch}); workspace preparation managed by agent`);

      const briefLines = [
        t2('tool.started', { branch }),
      ];
      if (facts.dirty) briefLines.push('', t2('tool.startedDirty'));
      briefLines.push('', t2('state.nextPlan'));
      return {
        ok: true,
        brief: briefLines.join('\n'),
        state: { branch, base: facts.branch, workDir: AGENT_WORK },
      };
    },
  }));
}
