/**
 * Plugin-owned spawn for SFD stages.
 *
 * Facts:
 * - The agent never assembles an ES spawn request. Which subagent and model a
 *   stage runs on is the panel's configuration, what that actor is told is this
 *   plugin's role text, and whether it may write follows the stage's role. All
 *   of that is decided here, so the model cannot drift the route by choosing
 *   arguments ad hoc.
 * - No ES profile is involved. `developer_instructions` carries the role text,
 *   which keeps the execution target a free per-stage choice (a profile pins
 *   target, mode and effort together).
 * - The plugin's ownership stops at spawn. Waiting, reading the report and
 *   closing the task stay with the agent through ES's own tools: a durable ES
 *   task outlives one model turn, and the agent is the one that must survive the
 *   gap.
 * - Refusals happen before task creation: an unconfigured stage, an unknown
 *   stage or a subagent that cannot spawn is a configuration fact the tool can
 *   explain, not a runtime failure to retry.
 */
import { EsError, runEsJson } from './es-cli.js';
import { ROLES, STAGE_ROLE } from './roles.js';

/** A spawn the configuration or the target forbids. */
export class StageConfigError extends Error {
  /**
   * @param code - stable reason the tool maps to localized text.
   * @param message - the same reason in English, for logs and callers without copy.
   * @param detail - structured facts the copy needs (the target subagent).
   */
  constructor(code, message, detail = null) {
    super(message);
    this.name = 'StageConfigError';
    this.code = code;
    this.detail = detail;
  }
}

/**
 * Resolve what a stage should run on.
 * @param store - the panel's model settings (`ModelSettingsStore`).
 * @param root - the project root (repository) the stage belongs to.
 * @param stage - one of the configured stage ids.
 * @returns the resolved route and the role text to send with it.
 * @throws {StageConfigError} for an unknown stage or an unconfigured model.
 */
export async function resolveStageTarget(store, root, stage) {
  const roleId = STAGE_ROLE[stage];
  if (roleId === undefined) throw new StageConfigError('unknown-stage', `Unknown SFD stage: ${stage}`);
  const settings = await store.get(root);
  const project = settings.project?.stages?.[stage] ?? null;
  const global = settings.global.stages[stage] ?? null;
  const selection = project ?? global;
  if (selection === null) {
    throw new StageConfigError('not-configured', `No model is configured for stage ${stage}`);
  }
  const role = ROLES[roleId];
  return {
    stage,
    role: roleId,
    subagent: selection.subagent,
    model: selection.model,
    permissionMode: role.permissionMode,
    effort: role.effort[selection.subagent] ?? null,
    instructions: role.instructions,
    /** Where the target came from, so the actor record explains the route. */
    source: project === null ? 'global' : 'project',
  };
}

/**
 * The exact ES request for one stage.
 * @param options.repository - absolute repository the actor works in.
 * @param options.target - the resolved stage target.
 * @param options.prompt - the task body (the caller inlines the material).
 */
export function spawnRequest({ repository, target, prompt }) {
  const request = {
    repository,
    prompt,
    subagent: target.subagent,
    model: target.model,
    permission_mode: target.permissionMode,
    developer_instructions: target.instructions,
  };
  if (target.effort !== null && target.effort !== undefined) request.effort = target.effort;
  return request;
}

/**
 * Refuse a target ES cannot spawn, before task creation.
 * @param subagent - the configured subagent name.
 * @param options.run - ES JSON caller (tests).
 */
export async function assertSpawnable(subagent, { run = runEsJson } = {}) {
  const value = await run(['subagents', 'list'], { timeoutMs: 15_000 });
  const row = (Array.isArray(value.subagents) ? value.subagents : []).find((entry) => entry?.subagent === subagent);
  if (row === undefined) {
    throw new StageConfigError('subagent-unknown', `external-subagent does not know the subagent ${subagent}`, { subagent });
  }
  if (row.enabled !== true || row.spawn_supported !== true) {
    throw new StageConfigError('subagent-unavailable', `subagent ${subagent} is not enabled for spawn`, { subagent });
  }
}

/**
 * The plugin's spawn owner.
 * @param options.store - panel model settings.
 * @param options.run - ES JSON caller (tests); defaults to the CLI boundary.
 */
export function createStageSpawner({ store, run = runEsJson }) {
  return {
    /**
     * Spawn one stage's actor.
     * @param options.repository - absolute repository root.
     * @param options.stage - configured stage id.
     * @param options.prompt - task body; the role text is added by this plugin.
     * @param options.signal - aborts the spawn call.
     * @returns `{ agentId, sessionId, status, target, request }`.
     */
    async spawn({ repository, stage, prompt, signal }) {
      if (typeof prompt !== 'string' || prompt.trim().length === 0) {
        throw new StageConfigError('empty-prompt', 'A spawn needs a non-empty task prompt');
      }
      const target = await resolveStageTarget(store, repository, stage);
      await assertSpawnable(target.subagent, { run });
      const request = spawnRequest({ repository, target, prompt });
      const value = await run(['create', '--json', JSON.stringify(request)], { timeoutMs: 60_000, signal });
      const result = value.result !== null && typeof value.result === 'object' ? value.result : {};
      if (!Number.isInteger(result.agent_id)) {
        throw new EsError('external-subagent did not return an agent id', { code: 'ES_OUTPUT' });
      }
      return {
        agentId: result.agent_id,
        sessionId: typeof result.session_id === 'string' ? result.session_id : null,
        status: typeof result.status === 'string' ? result.status : null,
        target,
        request,
      };
    },
  };
}
