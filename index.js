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
import { loadState, detectWork, renderBrief } from './lib/state.js';
import { preflight } from './lib/es.js';
import { inspect } from './lib/cleanup.js';
import { makeT } from './lib/i18n.js';
import { registerSfdTools } from './lib/tools.js';
import { createUserMessage } from '@deepseek-ai/dsh-llm';

export const inject = ['commands', 'agents', 'userQuestions', 'gitCommit', 'workingDirectory', 'tools'];

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

      // Every success result must ALSO reach the model: command results are
      // log-only, so deliver the text as a followup user message that wakes
      // the agent (the /goal command pattern).
      const deliver = (text) => {
        try {
          agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }));
        } catch { /* followup unavailable: the log-only card still shows */ }
        return { kind: 'success', text };
      };

      // 2. Detect existing SFD work
      const detection = await detectWork(root);

      if (detection.present && detection.kind === 'state') {
        return deliver(renderBrief(detection.state, t));
      }
      if (detection.present && detection.kind === 'legacy-markers') {
        return deliver([
          t('state.legacyTitle'),
          `- ${detection.markers.join('\n- ')}`,
          '',
          t('state.legacyBody'),
        ].join('\n'));
      }

      // 3. Fresh run: hand the flow to the agent. `/sfd` never starts the
      // cleanup gate or writes state itself — the agent must first know the
      // task (it asks the user when the session has no context) and then
      // call sfd_start, which runs cleanup and creates the real branch.
      return deliver([t('state.fresh'), '', t('state.handoff')].join('\n'));
    },
  });

  registerSfdTools(ctx, {
    askCard,
    t: () => tReady,
  });
}
