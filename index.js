/**
 * @ibobbyts/dsh-sfd — Sectioned Feature Development host plugin (P0).
 *
 * P0 scope: `/sfd` command with state detection + ES preflight. Workspace
 * preparation (dirty handling, branch-base decision, feature-branch creation)
 * is the main agent's job, driven by the skill's mandatory decision table;
 * `sfd_start` only records git facts and persists state. Later phases add
 * plan review orchestration, ES dispatch engine, code review waves, advisor,
 * and the side panel.
 *
 * The command injects its result into the conversation for the main agent;
 * program flow beyond this gate stays with the state machine in later phases.
 */
import { loadState, detectWork, renderBrief } from './lib/state.js';
import { preflight } from './lib/es.js';
import { inspect } from './lib/cleanup.js';
import { makeT } from './lib/i18n.js';
import { registerSfdTools } from './lib/tools.js';
import { sfdSkillProvider } from './lib/skill-provider.js';
import { createUserMessage } from '@deepseek-ai/dsh-llm';

export const inject = ['commands', 'agents', 'workingDirectory', 'tools', 'skills'];

export function apply(ctx) {
  // Serve the flow skill from this package's skills/ directory so it
  // installs/upgrades/uninstalls together with the plugin.
  try {
    ctx.skills?.registerProvider?.(() => sfdSkillProvider);
  } catch { /* skills service absent or provider rejected: skill cards unavailable */ }
  // Host plugins have no ctx.locale (a browser-client service). lib/i18n.js
  // resolves the GUI language on the host side; a rejection degrades to raw
  // keys rather than failing the command.
  const tReady = makeT(ctx).catch(() => (key) => key);

  ctx.commands.register({
    name: 'sfd',
    description: 'Start or resume a sectioned-feature-development run in this repository.',
    recordInput: false,
    handler: async ({ agent, signal }) => {
      // Diagnostic beacon: proves whether the handler runs at all when a
      // fresh-session /sfd appears to do nothing.
      try { ctx.logger?.info?.('sfd: /sfd handler entered'); } catch { /* logger absent */ }
      signal.throwIfAborted();
      const t = await tReady;
      try { ctx.logger?.info?.('sfd: root-agent check', { id: agent?.id }); } catch { /* noop */ }
      if (ctx.agents.get(agent.id) !== agent || !ctx.agents.roots().includes(agent)) {
        return { kind: 'error', text: t('state.notRootAgent') };
      }

      // Determine the repository root from the session's working directory.
      let cwd;
      try {
        cwd = await ctx.workingDirectory?.ensure(agent);
      } catch { cwd = undefined; }
      try { ctx.logger?.info?.('sfd: cwd resolved', { cwd: cwd ?? null }); } catch { /* noop */ }
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
          try { ctx.logger?.info?.('sfd: followup delivered'); } catch { /* noop */ }
        } catch (error) {
          // followup unavailable: the log-only card still shows
          try { ctx.logger?.warn?.('sfd: followup failed', { error: String(error) }); } catch { /* noop */ }
        }
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
      // flow itself — the agent must first know the task (it asks the user
      // when the session has no context), perform workspace preparation per
      // the skill's mandatory decision table, and then call sfd_start, which
      // records the git facts and creates the state.
      return deliver([t('state.fresh'), '', t('state.prepare'), '', t('state.handoff')].join('\n'));
    },
  });

  registerSfdTools(ctx, {
    t: () => tReady,
  });
}
