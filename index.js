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
import { ModelSettingsStore } from './lib/models.js';
import { createCatalog } from './lib/catalog.js';
import { resolveProjectRoot } from './lib/project.js';
import { createHandler, ROUTE } from './lib/rpc.js';
import { createStageSpawner } from './lib/spawn.js';
import { createStageContext } from './lib/context.js';
import { createUserMessage } from '@deepseek-ai/dsh-llm';

export const inject = ['commands', 'agents', 'workingDirectory', 'tools', 'skills'];

export function apply(ctx) {
  // One settings store for both faces: the panel edits it, and stage spawn
  // reads the same instance, so a save is visible to the next dispatch.
  const models = new ModelSettingsStore();
  const spawner = createStageSpawner({ store: models });
  // Stage context: one block per plugin-owned state change, pushed into the
  // agent's own step. This is what keeps a long run on the skill without the
  // plugin owning the procedure.
  const stageContext = createStageContext();
  // The right-side panel's data channel: stage model routing plus the
  // spawnable external-subagent catalog. It rides Connection's authenticated
  // /api transport, so it is registered in its own injection scope — a Host
  // without a web client keeps the command and tools and simply has no panel.
  ctx.inject(['connection'], (rpcCtx) => {
    const catalog = createCatalog();
    const service = {
      /** Both scopes for the Session's project (see lib/models.js). */
      async settings(payload) {
        return models.get(await resolveProjectRoot(payload.cwd));
      },
      /** One stage's selection; the project scope needs a repository root. */
      async saveSettings(payload) {
        const root = await resolveProjectRoot(payload.cwd);
        if (payload.scope === 'project' && root === null) throw new Error('Project settings require a repository');
        await models.save(root, payload.scope, payload.stage, payload.selection);
        return models.get(root);
      },
      /** Spawnable subagents and their usable model tokens. */
      async catalog(payload) {
        return catalog.get({ force: payload.force === true });
      },
    };
    try {
      rpcCtx.effect(() => rpcCtx.connection.fetch.register({
        path: ROUTE,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: createHandler(service),
      }), 'sfd: panel RPC route');
    } catch (error) {
      try { ctx.logger?.warn?.('sfd: panel RPC route unavailable', { error: String(error) }); } catch { /* noop */ }
    }
  });

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
          : t('state.esNoSpawnable');
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

  // Inject the stage block before a step of a root agent that has an SFD run.
  // `agent/pre-step` is the only seam that survives an agent forgetting what it
  // read: the block is part of the step's own input. Failure here must never
  // break a turn, so everything is contained.
  ctx.effect(() => ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next();
    try {
      if (decision?.kind === 'reject' || payload?.signal?.aborted) return decision;
      const agent = payload?.agent;
      if (!agent || !ctx.agents.roots().includes(agent)) return decision;
      let cwd;
      try {
        cwd = ctx.workingDirectory?.get?.(agent.session);
      } catch { return decision; }
      const t = await tReady.catch(() => (key) => key);
      const text = await stageContext.textFor({ sessionId: agent.id, cwd, t });
      if (typeof text !== 'string' || text.length === 0) return decision;
      return {
        ...decision,
        messages: [...decision.messages, createUserMessage({
          content: [{ type: 'text', text }],
          source: { kind: 'user' },
        })],
      };
    } catch {
      return decision;
    }
  }), 'sfd: stage context');

  registerSfdTools(ctx, {
    t: () => tReady,
    store: models,
    spawner,
    context: stageContext,
  });
}
