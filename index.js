/**
 * @ibobbyts/dsh-sfd — Sectioned Feature Development host plugin (P0).
 *
 * P0 scope: `/sfd` command with state detection + cleanup decision table +
 * ES preflight. Later phases add plan review orchestration, ES dispatch
 * engine, code review waves, advisor, and the side panel.
 *
 * The command injects its result into the conversation for the main agent;
 * program flow beyond this gate stays with the state machine in later phases.
 */
import { loadState, detectWork, initialState, transition, renderBrief } from './lib/state.js';
import { preflight } from './lib/es.js';
import { runCleanup, inspect } from './lib/cleanup.js';

export const inject = ['commands', 'agents', 'userQuestions', 'gitCommit', 'workingDirectory'];

export function apply(ctx) {
  const t = (key) => {
    try {
      const dict = ctx.locale?.dict?.['dsh-sfd'] ?? {};
      const parts = key.split('.');
      let value = dict;
      for (const part of parts) value = value?.[part];
      return typeof value === 'string' ? value : key;
    } catch {
      return key;
    }
  };

  const askCard = async (agent, signal, question) => {
    // The user-questions request crosses the Remote gateway, which rejects any
    // non-lossless JSON property — including enumerable keys whose value is
    // undefined. Omit optional fields entirely when absent.
    const item = { id: question.id, question: question.question };
    if (question.header !== undefined) item.header = question.header;
    if (question.detail !== undefined) item.detail = question.detail;
    if (question.options !== undefined) item.options = question.options;
    const answer = await ctx.userQuestions.ask({ agent, signal, questions: [item] });
    return answer;
  };

  ctx.commands.register({
    name: 'sfd',
    description: 'Start or resume a sectioned-feature-development run in this repository.',
    recordInput: false,
    handler: async ({ agent, signal }) => {
      signal.throwIfAborted();
      if (ctx.agents.get(agent.id) !== agent || !ctx.agents.roots().includes(agent)) {
        return { kind: 'error', text: '/sfd requires the exact live root chat agent.' };
      }

      // Determine the repository root from the session's working directory.
      let cwd;
      try {
        cwd = await ctx.workingDirectory?.ensure(agent);
      } catch { cwd = undefined; }
      if (!cwd) return { kind: 'error', text: 'No working directory for this session.' };

      let facts;
      try {
        facts = await inspect(cwd);
      } catch {
        return { kind: 'error', text: t('state.notGit') };
      }
      const root = facts.root;

      // 1. ES preflight (hard requirement before any flow starts)
      const es = await preflight();
      if (!es.ok) {
        const text = es.blocking === 'es-missing'
          ? t('state.esMissing')
          : t('state.esProfileMissing').replace('{names}', (es.missingProfiles ?? []).join(', '));
        return { kind: 'error', text };
      }

      // 2. Detect existing SFD work
      const detection = await detectWork(root);

      if (detection.present && detection.kind === 'state') {
        const brief = renderBrief(detection.state, t);
        return { kind: 'success', text: brief };
      }
      if (detection.present && detection.kind === 'legacy-markers') {
        return {
          kind: 'success',
          text: [
            'Existing SFD work markers found (no plugin state):',
            `- ${detection.markers.join('\n- ')}`,
            '',
            'This may be an uncleaned previous run or a manual pre-plugin run.',
            'Decide: archive it and start fresh, continue it manually, or stop. The plugin cannot resume a run it did not record.',
          ].join('\n'),
        };
      }

      // 3. Fresh run: cleanup decision table
      const result = await runCleanup({
        cwd: root,
        inspect,
        aheadBehind: (r, base) => import('./lib/cleanup.js').then((m) => m.aheadBehind(r, base)),
        git: (r, args) => import('./lib/cleanup.js').then((m) => m.git(r, args)),
        gitCommit: ctx.gitCommit,
        ask: (question) => askCard(agent, signal, question),
        t,
        slug: 'request', // P1: derive from the actual request/feature slug
      });

      if (result.error) {
        return { kind: 'error', text: `${result.message ?? result.error}` };
      }
      if (result.stopped) {
        return { kind: 'success', text: 'SFD start stopped by user. Nothing was changed in the repository state machine.' };
      }

      // 4. Persist initial state and hand the planning phase to the agent
      let state = initialState(root);
      state = await transition(state, 'start', {
        phase: 'PLAN',
        git: { authority: { ...result.state } },
        es: { version: es.install.version ?? null, checkedAt: new Date().toISOString() },
      }, `cleanup done: startBranch=${result.state.startBranch}`);
      if (result.agentMerge) {
        state = await transition(state, 'hold', {
          hold: { kind: 'WAITING_USER', reason: 'Diverged branch: agent must merge and resolve conflicts before planning starts.', since: new Date().toISOString() },
        }, 'agent merge pending');
        return { kind: 'success', text: `${t('state.fresh')}\n\nHOLD: merge current branch with main and resolve conflicts first, then run /sfd again to resume.` };
      }
      return {
        kind: 'success',
        text: [
          t('state.fresh'),
          '',
          `Branch: ${result.state.startBranch} (base ${result.state.base})`,
          '',
          'Next: read the sectioned-feature-development skill, identify Feature(s) from the user request, and draft PLAN-FULL at .agent-work/PLAN-FULL.md. Automatic activation requires user approval of the first proportional plan before plan review.',
        ].join('\n'),
      };
    },
  });
}
