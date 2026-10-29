/**
 * @ibobbyts/dsh-sfd — Sectioned Feature Development host plugin.
 *
 * Why this plugin exists: the SFD skill kept being executed with reviews
 * skipped — a markdown procedure the agent read once loses to context
 * pressure in a long run. The fix is not a scheduler. The plugin is an
 * observer and injector:
 *
 *  - the main agent drives the whole flow itself per the bundled skill
 *    (v5.5.1), including every external_subagent_spawn(profile="…") dispatch
 *    copied literally from the skill's DSH routing table;
 *  - the plugin watches that tool traffic and `.agent-work/` writes into a
 *    run ledger (`.agent-work/sfd-run.json`, plugin-written);
 *  - while a run is active, each step of the main agent starts with an
 *    injected `[SFD]` block: observed facts plus the obligations the skill
 *    attaches to that moment. Facts and pointers only — no gates, no
 *    dispatch, no model routing (removed 2026-10-29; see REQUIREMENTS.md).
 */
import { loadRun, detectWork, recordSpawn, recordEvent, recordArtifact } from './lib/ledger.js';
import { inspect } from './lib/cleanup.js';
import { makeT } from './lib/i18n.js';
import { registerSfdTools } from './lib/tools.js';
import { sfdSkillProvider } from './lib/skill-provider.js';
import { resolveProjectRoot } from './lib/project.js';
import { createHandler, ROUTE } from './lib/rpc.js';
import { toolFamily, classifyEs, classifyFileWrite, resultToText } from './lib/observer.js';
import { deriveObligations } from './lib/obligations.js';
import { createRunInjector, renderResumeBrief } from './lib/context.js';
import { probeStatus } from './lib/es-status.js';
import { createUserMessage } from '@deepseek-ai/dsh-llm';

export const inject = ['commands', 'agents', 'workingDirectory', 'tools', 'skills'];

/** How long a daemon probe is reused by the panel without `force`. */
const ES_CACHE_MS = 30_000;

export function apply(ctx) {
  // Serve the flow skill from this package's skills/ directory so it
  // installs/upgrades/uninstalls together with the plugin. The bundle carries
  // the upstream skill (v5.5.1) plus the DSH host addendum.
  try {
    ctx.skills?.registerProvider?.(() => sfdSkillProvider);
  } catch { /* skills service absent or provider rejected: skill cards unavailable */ }
  // Host plugins have no ctx.locale (a browser-client service). lib/i18n.js
  // resolves the GUI language on the host side; a rejection degrades to raw
  // keys rather than failing the command.
  const tReady = makeT(ctx).catch(() => (key) => key);

  // The run injector: one `[SFD]` obligations block per ledger change (plus
  // an anti-drift nudge while a warning is open), pushed into the agent's own
  // step input.
  const injector = createRunInjector({ loadRun });

  ctx.commands.register({
    name: 'sfd',
    description: 'Start or resume a sectioned-feature-development run in this repository.',
    recordInput: false,
    handler: async ({ agent, signal }) => {
      try { ctx.logger?.info?.('sfd: /sfd handler entered'); } catch { /* logger absent */ }
      signal.throwIfAborted();
      const t = await tReady;
      try { ctx.logger?.info?.('sfd: root-agent check', { id: agent?.id }); } catch { /* noop */ }
      if (ctx.agents.get(agent.id) !== agent || !ctx.agents.roots().includes(agent)) {
        return { kind: 'error', text: t('state.notRootAgent') };
      }

      const cwd = await ctx.workingDirectory?.ensure(agent).catch(() => undefined);
      try { ctx.logger?.info?.('sfd: cwd resolved', { cwd: cwd ?? null }); } catch { /* noop */ }
      if (!cwd) return { kind: 'error', text: t('state.noCwd') };

      let facts;
      try {
        facts = await inspect(cwd);
      } catch {
        return { kind: 'error', text: t('state.notGit') };
      }

      // Every success result must ALSO reach the model: command results are
      // log-only, so deliver the text as a followup user message that wakes
      // the agent (the /goal command pattern).
      const deliver = (text) => {
        try {
          agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }));
          try { ctx.logger?.info?.('sfd: followup delivered'); } catch { /* noop */ }
        } catch (error) {
          try { ctx.logger?.warn?.('sfd: followup failed', { error: String(error) }); } catch { /* noop */ }
        }
        return { kind: 'success', text };
      };

      const detection = await detectWork(facts.root);

      if (detection.present && detection.kind === 'run') {
        return deliver(detection.run.run?.status === 'closed'
          ? [t('state.runClosed'), '', t('state.readSkillFirst')].join('\n')
          : renderResumeBrief(detection.run, t));
      }
      if (detection.present && detection.kind === 'legacy-markers') {
        return deliver([
          t('state.legacyTitle'),
          `- ${detection.markers.join('\n- ')}`,
          '',
          t('state.legacyBody'),
        ].join('\n'));
      }

      // Fresh run: hand the flow to the agent. `/sfd` never starts the flow
      // itself — the agent must first know the task (it asks the user when the
      // session has no context), perform workspace preparation per the skill's
      // mandatory decision table, and then call sfd_start.
      return deliver([t('state.fresh'), '', t('state.prepare'), '', t('state.handoff')].join('\n'));
    },
  });

  // --- The observer: ledger facts from completed tool calls. ---
  async function observe(exec, result) {
    const family = toolFamily(exec?.name);
    if (!family) return;
    const agent = exec?.agent;
    let cwd = null;
    try {
      cwd = agent ? await ctx.workingDirectory?.get?.(agent.session) : null;
    } catch { cwd = null; }
    if (typeof cwd !== 'string' || cwd.length === 0) return;
    const root = await resolveProjectRoot(cwd);
    if (root === null) return;
    let run = await loadRun(root);
    if (!run || run.run?.status !== 'active') return;
    if (family.family === 'es') {
      const observations = classifyEs(family.op, exec.arguments, resultToText(result));
      for (const obs of observations) {
        if (obs.kind === 'spawn') {
          run = await recordSpawn(run, obs);
        } else {
          run = await recordEvent(run, obs);
        }
      }
      return;
    }
    const write = classifyFileWrite(exec.arguments, root);
    if (write) run = await recordArtifact(run, write.path, write.kind);
  }

  ctx.effect(() => ctx.on('tools/post-execute', async (exec, result, next) => {
    const downstream = await next();
    try {
      await observe(exec, result);
    } catch (error) {
      try { ctx.logger?.warn?.('sfd: observer error', { error: String(error) }); } catch { /* noop */ }
    }
    return downstream;
  }), 'sfd: ledger observer');

  // --- The injector: `[SFD]` obligations block before a root-agent step. ---
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
      if (typeof cwd !== 'string' || cwd.length === 0) return decision;
      const t = await tReady.catch(() => (key) => key);
      const text = await injector.textFor({ sessionId: agent.id, cwd, t });
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
  }), 'sfd: obligations injector');

  registerSfdTools(ctx, { t: () => tReady });

  // --- The panel's data channel: read-only status over the same facts. ---
  ctx.inject(['connection'], (rpcCtx) => {
    let esCache = { at: 0, value: null };
    const esStatus = async (force) => {
      if (!force && esCache.value !== null && Date.now() - esCache.at < ES_CACHE_MS) return esCache.value;
      const value = await probeStatus();
      esCache = { at: Date.now(), value };
      return value;
    };
    const service = {
      /** One snapshot: run ledger (sans journal), derived obligations, ES probe. */
      async status(payload) {
        const es = await esStatus(payload.force === true).catch((error) => ({
          ok: false, error: String(error?.message ?? error), subagents: [], probedAtMs: Date.now(),
        }));
        const root = await resolveProjectRoot(typeof payload.cwd === 'string' ? payload.cwd : '');
        if (root === null) return { noRepo: true, run: null, phase: null, obligations: [], es };
        let run = null;
        try {
          run = await loadRun(root);
        } catch (error) {
          return { run: null, phase: null, obligations: [], error: String(error?.message ?? error), es };
        }
        if (run === null) return { run: null, phase: null, obligations: [], es };
        const { phase, obligations } = deriveObligations(run);
        const { journal, ...slim } = run;
        return { run: slim, phase, obligations, es };
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
}
