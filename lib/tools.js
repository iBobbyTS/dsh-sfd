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
import { initialState, transition, loadState, renderBrief, gate, AGENT_WORK } from './state.js';
import { preflight } from './es.js';
import { inspect } from './cleanup.js';
import { STAGE_ROLE } from './roles.js';
import { bumpCount, checkedUnit, countKey } from './counts.js';

/**
 * Register the model-visible SFD tools.
 *
 * @param ctx - Host context with `tools`, `workingDirectory`, and `agents`.
 * @param options.t - localized copy (`() => Promise<translate>`).
 * @param options.store - the panel's model settings; only spawn reads it.
 * @param options.spawner - plugin-owned ES spawn (`createStageSpawner`).
 * @param options.context - stage-context injector; told about state writes.
 */
export function registerSfdTools(ctx, { t: tLazy, store, spawner, context }) {
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
        const message = es.blocking === 'es-missing' ? t2('state.esMissing') : t2('state.esNoSpawnable');
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
      context?.noteStateChange?.();

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

  /**
   * Dispatch one stage's actor. Which target, which role text and which
   * permission mode apply are the plugin's decisions; the caller supplies only
   * the task body. Waiting and collecting the report stay with the agent.
   */
  ctx.tools.register(defineTool({
    name: 'sfd_spawn_stage',
    description:
      'Spawn the external actor for one SFD stage. The plugin owns this dispatch: it resolves the stage\'s '
      + 'subagent, model, permission mode and effort from the right-side panel configuration (Current Project '
      + 'first, then Global) and sends the stage\'s role instructions itself, so never restate or invent them. '
      + 'You supply only the task body: the material to inline (contract, plan, candidate diff, findings), the '
      + 'exact report path the actor must write, and what the pass must decide. This tool returns the '
      + 'external-subagent agent id and stops there — waiting, reading the report and closing the task are '
      + 'yours: call external_subagent_wait with that id, then external_subagent_result, then '
      + 'external_subagent_close. Refusals name missing configuration or a gated run; they are not retryable '
      + 'runtime failures. Stage order is not enforced here: call it only for the stage the flow phase has '
      + 'reached. Every successful spawn increments this stage\'s review counter (per unit when you name one) '
      + 'and records it with the actor — the count is the plugin\'s, the flow judgment is yours.',
    parameters: {
      stage: {
        type: 'string',
        required: true,
        enum: Object.keys(STAGE_ROLE),
        description:
          'The stage whose role and configured route apply. Plan Review A/B run read-only; Implementation '
          + 'Standard/Large run in build mode; Code Review A/B run read-only.',
      },
      prompt: {
        type: 'string',
        required: true,
        description:
          'Complete task body for the actor: the inlined material (with its path and "re-read only when the '
          + 'main line is forgotten"), the exact .agent-work report path to write, and the decision or output '
          + 'the pass must produce. Keep the role rules out of it — the plugin prepends them.',
      },
      unit: {
        type: 'string',
        description:
          'Optional unit/section id this actor works on (for example a section slug from the plan). The review '
          + 'counter is kept per unit when given, so later waves and the panel can see "this section used n '
          + 'rounds". Omit for a run-wide pass such as the plan review.',
      },
    },
    output: {
      schema: { type: 'json' },
      render: (args, value) => [{
        type: 'text',
        text: typeof value?.brief === 'string' ? value.brief : (value?.message ?? JSON.stringify(value ?? {})),
      }],
    },
    async execute(args, exec) {
      const t2 = await tLazy().catch(() => (key) => key);
      const agent = exec.agent;
      if (!agent) throw new Error('sfd_spawn_stage requires a calling agent (exec.agent was undefined)');
      if (exec.signal) exec.signal.throwIfAborted();

      // `parameters.stage.enum` already rejects an unknown stage, so a value
      // reaching here is one of the registered stages.
      const stage = args.stage;
      let unit;
      try {
        unit = checkedUnit(args.unit);
      } catch (error) {
        return { ok: false, error: 'invalid-unit', message: t2('tool.spawnBadUnit', { reason: String(error?.message ?? error) }) };
      }
      if (spawner === undefined) {
        return { ok: false, error: 'spawn-unavailable', message: t2('tool.spawnUnavailable') };
      }

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

      const state = await loadState(root);
      if (!state) return { ok: false, error: 'no-run', message: t2('tool.spawnNoRun') };
      const allowed = gate(state);
      if (!allowed.allowed) return { ok: false, error: 'gated', message: allowed.reason };

      let spawned;
      try {
        spawned = await spawner.spawn({ repository: root, stage, prompt: args.prompt, signal: exec.signal });
      } catch (error) {
        const code = typeof error?.code === 'string' ? error.code : 'spawn-failed';
        if (code === 'not-configured') {
          return { ok: false, error: code, message: t2('tool.spawnNoModel', { stage }) };
        }
        if (code === 'subagent-unavailable' || code === 'subagent-unknown') {
          return { ok: false, error: code, message: t2('tool.spawnSubagent', { stage, subagent: error?.detail?.subagent ?? '' }) };
        }
        if (code === 'empty-prompt') return { ok: false, error: code, message: t2('tool.spawnEmptyPrompt') };
        return { ok: false, error: code, message: t2('tool.spawnFailed', { reason: String(error?.message ?? error) }) };
      }

      const route = {
        subagent: spawned.target.subagent,
        model: spawned.target.model,
        permissionMode: spawned.target.permissionMode,
        effort: spawned.target.effort,
        source: spawned.target.source,
      };
      // The actor record is what reconciliation reads after a restart: it ties
      // the ES id to the stage and the exact route that was requested.
      const actor = {
        role: stage,
        unit: null,
        route,
        attempt: 1,
        report: null,
        state: 'running',
        sessionId: spawned.sessionId,
        spawnedAt: new Date().toISOString(),
      };
      // Counting is the plugin's job and happens in the same atomic write as
      // the actor record: one successful spawn, one increment.
      const counter = countKey(stage, unit);
      const counts = bumpCount(state.counts, counter);
      await transition(state, 'spawn', {
        actors: { ...(state.actors ?? {}), [String(spawned.agentId)]: actor },
        counts,
      }, `spawned ${stage} on ${route.subagent}/${route.model} (${route.permissionMode}, ${route.source}); ${counter}=${counts[counter]}`);
      context?.noteStateChange?.();

      const brief = [
        t2('tool.spawned', {
          stage,
          subagent: route.subagent,
          model: route.model,
          mode: route.permissionMode,
          source: route.source,
          id: spawned.agentId,
        }),
        t2('tool.spawnCount', { key: counter, value: counts[counter] }),
        t2('tool.spawnNext', { id: spawned.agentId }),
      ].join('\n');
      return {
        ok: true,
        brief,
        agentId: spawned.agentId,
        sessionId: spawned.sessionId,
        stage,
        unit,
        role: spawned.target.role,
        route,
        counts: { key: counter, value: counts[counter] },
      };
    },
  }));
}
