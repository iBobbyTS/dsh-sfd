/**
 * Agent-facing tools for SFD. Two anchors, nothing else.
 *
 * The plugin does not dispatch, gate or schedule: spawning (with the skill's
 * named profiles), waiting, reading reports and closing actors are the main
 * agent's own external-subagent MCP calls, exactly as the bundled skill says.
 * What the plugin owns is the run ledger those calls are observed into, and
 * the `[SFD]` obligations injection that keeps reviews from being skipped.
 *
 * - `sfd_start`: called once after the agent finished workspace preparation
 *   (per the skill's mandatory decision table). No git operations — it only
 *   records the git facts it observes and creates the ledger.
 * - `sfd_finish`: called once the whole authorized plan is complete and
 *   archived; closes the ledger and stops the injection.
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { inspect } from './cleanup.js';
import { initialRun, loadRun, flush, closeRun, AGENT_WORK } from './ledger.js';
import { branchSlug } from './slug.js';
import { renderObligationBlock } from './context.js';

/**
 * Register the model-visible SFD tools.
 *
 * @param ctx - Host context with `tools` and `workingDirectory`.
 * @param options.t - localized copy (`() => Promise<translate>`).
 */
export function registerSfdTools(ctx, { t: tLazy }) {
  ctx.tools.register(defineTool({
    name: 'sfd_start',
    description:
      'Start a sectioned-feature-development (SFD) run in this repository after the task is known and '
      + 'workspace preparation is done. You perform workspace preparation yourself first (per the '
      + "skill's mandatory DSH start decision table: dirty-workspace handling, branch-base decision, "
      + 'feature-branch creation); this tool performs no git operations and no dispatch — it records '
      + 'the git facts it observes and creates the run ledger the plugin observes actors into. From '
      + 'then on dispatch is yours: copy the literal external_subagent_spawn(profile="…") rows from '
      + "the skill's DSH dispatch profile; the plugin watches those calls and injects an [SFD] "
      + 'obligations block into your steps. Call this exactly once per run; to resume an existing '
      + 'run use /sfd instead.',
    parameters: {
      taskSummary: {
        type: 'string',
        required: true,
        description:
          'One short sentence describing the feature/task to build, in the language the user used. '
          + 'It is only used to name the run and derive the slug; it is not a plan.',
      },
      slug: {
        type: 'string',
        description:
          'Optional explicit feature slug (letters/digits/hyphens). Use it when the user or the task '
          + 'naming already implies one; otherwise it is derived from taskSummary.',
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

      // An existing run is never restarted; hand back the observed brief.
      const existing = await loadRun(root);
      if (existing) {
        return {
          ok: false,
          error: 'already-running',
          brief: renderObligationBlock(existing, t2),
          message: t2('tool.existingRun'),
        };
      }

      const branch = (args.branch ?? '').trim() || facts.branch;
      const run = initialRun(root, {
        taskSummary: args.taskSummary,
        slug: branchSlug({ slug: args.slug, taskSummary: args.taskSummary }),
        branch,
        git: { base: facts.branch, dirty: facts.dirty, detached: facts.detached, midMerge: facts.midMerge },
      });
      await flush(run);

      const briefLines = [t2('tool.started', { branch, slug: run.run.slug })];
      if (facts.dirty) briefLines.push('', t2('tool.startedDirty'));
      briefLines.push('', t2('state.nextPlan'));
      return {
        ok: true,
        brief: briefLines.join('\n'),
        run: { branch, base: facts.branch, slug: run.run.slug, workDir: AGENT_WORK },
      };
    },
  }));

  ctx.tools.register(defineTool({
    name: 'sfd_finish',
    description:
      'Close the SFD run for this repository after the whole authorized plan is complete and archived '
      + 'per the skill (artifact lifecycle). Reconcile every actor first — a terminal-but-unclosed or '
      + 'still-running actor is called out in the result. After this the plugin stops injecting the '
      + '[SFD] obligations block. Do not call it to abandon a run midway; a mid-run stop is a user '
      + 'decision recorded in the conversation, and the ledger stays as evidence either way.',
    parameters: {},
    output: {
      schema: { type: 'json' },
      render: (args, value) => [{
        type: 'text',
        text: typeof value?.brief === 'string' ? value.brief : JSON.stringify(value ?? {}),
      }],
    },
    async execute(_args, exec) {
      const t2 = await tLazy().catch(() => (key) => key);
      const agent = exec.agent;
      if (!agent) throw new Error('sfd_finish requires a calling agent (exec.agent was undefined)');
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

      const run = await loadRun(facts.root);
      if (!run) return { ok: false, error: 'no-run', message: t2('tool.finishNoRun') };

      const actors = Object.entries(run.actors ?? {}).map(([id, a]) => ({ id, ...a }));
      const unfinished = actors.filter((a) => a.status !== 'terminal' || !a.closed);
      const closed = await closeRun(run, unfinished.length === 0
        ? 'run closed; all observed actors reconciled'
        : `run closed; ${unfinished.length} actor(s) not fully reconciled`);

      const briefLines = [t2('tool.finished')];
      if (unfinished.length > 0) {
        briefLines.push(t2('tool.finishOpen', { ids: unfinished.map((a) => a.id).join(' ') }));
      }
      briefLines.push('', t2('tool.finishArchive'));
      return { ok: true, brief: briefLines.join('\n'), revision: closed.revision };
    },
  }));
}
