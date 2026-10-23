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
import { makeT } from './lib/i18n.js';

export const inject = ['commands', 'agents', 'userQuestions', 'gitCommit', 'workingDirectory'];

export function apply(ctx) {
  // Host plugins have no ctx.locale (a browser-client service). lib/i18n.js
  // resolves the GUI language on the host side; the promise resolves before
  // any card is shown, and a rejection would surface as a command error.
  const tReady = makeT(ctx).catch(() => (key) => key);

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
      const t = await tReady;
      if (ctx.agents.get(agent.id) !== agent || !ctx.agents.roots().includes(agent)) {
        return { kind: 'error', text: t('state.notRootAgent') };
      }

      // Determine the repository root from the session's working directory.
      let cwd;
      try {
        cwd = await ctx.workingDirectory?.ensure(agent);
      } catch { cwd = undefined; }
      if (!cwd) return { kind: 'error', text: t('state.noCwd') };

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
            t('state.legacyTitle'),
            `- ${detection.markers.join('\n- ')}`,
            '',
            t('state.legacyBody'),
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
        return { kind: 'success', text: t('state.stopped') };
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
        return { kind: 'success', text: `${t('state.fresh')}\n\n${t('state.agentMergeHold')}` };
      }
      return {
        kind: 'success',
        text: [
          t('state.fresh'),
          '',
          t('state.cleanupDone', { branch: result.state.startBranch, base: result.state.base }),
          '',
          t('state.nextPlan'),
        ].join('\n'),
      };
    },
  });
}
