/**
 * Stage context injection for the main agent.
 *
 * Facts:
 * - The plugin's job in a run is to keep the agent on the flow, not to run it.
 *   The most reliable carrier for "where we are and what is allowed next" is a
 *   short block pushed into the model's own step, so it cannot be forgotten the
 *   way a skill read three turns ago can.
 * - Injection is revision-gated, not step-gated: the block appears once after
 *   each plugin-owned state change (`sfd_start`, a spawn) and once per session
 *   when a run already exists. Steady steps cost nothing and no file is read.
 * - The block carries facts and pointers only — phase, plan/units/actors,
 *   holds, and a one-line next-step hint that sends the agent back to the skill.
 * - The plugin never reads an actor's report: the block names the `agent_id`
 *   and the route, and the agent waits, reads, and continues on its own.
 */
import { loadState } from './state.js';
import { renderCounts } from './counts.js';
import { inspect } from './cleanup.js';

/** Phase → localized hint key. Pointers only; the skill owns the procedure. */
export const PHASE_HINT = Object.freeze({
  CLEANUP: 'ctx.hintCleanup',
  PLAN: 'ctx.hintPlan',
  PLAN_REVIEW: 'ctx.hintPlanReview',
  IMPL: 'ctx.hintImpl',
  COMMIT: 'ctx.hintCommit',
  CODE_REVIEW: 'ctx.hintCodeReview',
  ACCEPT: 'ctx.hintAccept',
  ARCHIVE: 'ctx.hintArchive',
  DONE: 'ctx.hintDone',
});

/** Resolve the repository root of a working directory, or null outside Git. */
export async function resolveRepoRoot(cwd) {
  try {
    const facts = await inspect(cwd);
    return facts.root;
  } catch {
    return null;
  }
}

const minutesAgo = (iso, now) => {
  if (typeof iso !== 'string') return null;
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return null;
  return Math.max(0, Math.round((now - at) / 60_000));
};

/**
 * Render the block for one run.
 * @param state - the loaded SFD state.
 * @param t - host translator.
 * @param options.now - clock (tests).
 */
export function renderStageContext(state, t, { now = Date.now() } = {}) {
  const lines = [t('ctx.header', { phase: state.phase, root: state.repoRoot })];
  if (state.task?.summary) lines.push(t('ctx.task', { summary: state.task.summary }));
  const review = state.plan?.review ?? {};
  const slot = (id) => review[id]?.state ?? t('ctx.none');
  lines.push(t('ctx.plan', { file: state.plan?.file ?? '.agent-work/PLAN-FULL.md', a: slot('A'), b: slot('B') }));
  const units = Object.entries(state.units ?? {});
  if (units.length > 0) {
    lines.push(t('ctx.units', {
      items: units.map(([id, unit]) => `${id}: ${unit.status ?? '?'} waves ${unit.wavesUsed ?? 0}/5${unit.accepted ? ' accepted' : ''}`).join('; '),
    }));
  }
  const actors = Object.entries(state.actors ?? {});
  if (actors.length > 0) {
    lines.push(t('ctx.actors', {
      items: actors.map(([id, actor]) => {
        const age = minutesAgo(actor.spawnedAt, now);
        const route = actor.route ? ` ${actor.route.subagent}/${actor.route.model}` : '';
        return `${id}${route} (${actor.role}${age === null ? '' : `, ${age}m`})`;
      }).join('; '),
    }));
  }
  const counts = renderCounts(state.counts);
  if (counts !== null) lines.push(t('ctx.counts', { items: counts }));
  if (state.hold) lines.push(t('ctx.hold', { kind: state.hold.kind, reason: state.hold.reason ?? '' }));
  lines.push(t('ctx.next', { hint: t(PHASE_HINT[state.phase] ?? 'ctx.hintPlan') }));
  lines.push(t('ctx.tools'));
  lines.push(t('ctx.skill', { skill: 'sectioned-feature-development' }));
  return lines.join('\n');
}

/**
 * One injector per plugin instance.
 *
 * @param options.readState - state reader (tests).
 * @param options.resolveRoot - repository-root resolver (tests).
 */
export function createStageContext({ readState = loadState, resolveRoot = resolveRepoRoot } = {}) {
  /** Bumped on every plugin-owned state write, so one change injects once. */
  let revision = 0;
  const seen = new Map();
  const roots = new Map();
  return {
    /** Record a plugin-owned state write; the next step re-injects. */
    noteStateChange() {
      revision += 1;
    },
    /** Current revision, for diagnostics and tests. */
    get revision() {
      return revision;
    },
    /**
     * The block this session should see now, or null.
     * @param options.sessionId - session identity (cache key).
     * @param options.cwd - the session's working directory.
     * @param options.t - host translator.
     */
    async textFor({ sessionId, cwd, t }) {
      if (typeof sessionId !== 'string' || sessionId.length === 0) return null;
      if (seen.get(sessionId) === revision) return null;
      if (typeof cwd !== 'string' || cwd.length === 0) return null;
      // Keyed by the pair: a session's directory can change, and a stale
      // "not a repository" answer must not survive that change.
      const key = `${sessionId}\u0000${cwd}`;
      let root = roots.get(key);
      if (root === undefined) {
        root = await resolveRoot(cwd);
        roots.set(key, root);
      }
      if (!root) return null;
      const state = await readState(root);
      // Checked at this revision either way: a missing run keeps the step free,
      // and a later `sfd_start` bumps the revision and injects.
      seen.set(sessionId, revision);
      if (!state) return null;
      return renderStageContext(state, t);
    },
  };
}
