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
      });

      if (result.error) {
        return { ok: false, error: result.error, message: result.message ?? result.error };
      }
      if (result.stopped) {
        // Minimal result: the user stopped. The agent must not continue the
        // SFD flow; say nothing else so no further context is injected.
        return { ok: false, error: 'stopped', brief: t2('tool.stoppedShort') };
      }

      let state = initialState(root);
      state = await transition(state, 'start', {
        phase: result.agentMerge ? 'CLEANUP' : 'PLAN',
        task: { summary: args.taskSummary, slug: args.slug ?? null },
        git: {
          authority: {
            intent: result.intent,
            branch: result.state.branch,
            base: result.state.base,
            decisions: result.state.decisions,
          },
          ...(result.userNote ? { userNote: result.userNote } : {}),
        },        es: { version: es.install.version ?? null, checkedAt: new Date().toISOString() },
      }, `cleanup done: intent=${result.intent} branch=${result.state.branch}`);

      // The agent-facing brief names the machine-resolved intent and the task
      // left to the agent (branch creation / merge / user note handling).
      const intentLine = t2(`tool.intent.${result.intent}`) !== `tool.intent.${result.intent}`
        ? t2(`tool.intent.${result.intent}`)
        : result.intent;
      const briefLines = [
        t2('state.fresh'),
        '',
        intentLine,
      ];
      if (result.userNote) briefLines.push('', t2('tool.userNote', { note: result.userNote }));
      if (result.agentMerge) {
        state = await transition(state, 'hold', {
          hold: { kind: 'WAITING_USER', reason: 'Diverged branch: agent must merge and resolve conflicts before planning starts.', since: new Date().toISOString() },
        }, 'agent merge pending');
        briefLines.push('', t2('tool.agentMergeTask'));
        return { ok: true, brief: briefLines.join('\n'), state: { branch: result.state.branch, base: result.state.base, held: true, intent: result.intent } };
      }
      if (result.agentTask === 'createBranchFromMain') briefLines.push('', t2('tool.createBranchFromMain'));
      if (result.agentTask === 'createBranchFromCurrent') briefLines.push('', t2('tool.createBranchFromCurrent', { branch: result.state.branch }));
      briefLines.push('', t2('state.nextPlan'));
      return {
        ok: true,
        brief: briefLines.join('\n'),
        state: { branch: result.state.branch, base: result.state.base, intent: result.intent, workDir: AGENT_WORK },
      };
    },
  }));
}
