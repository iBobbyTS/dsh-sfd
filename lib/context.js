/**
 * The obligation injector — the reason this plugin exists.
 *
 * The skill kept getting executed with reviews skipped: long runs drift, and
 * a markdown procedure the agent read once loses to context pressure. The
 * fix chosen by the user is not a scheduler but injection: while a run is
 * active, every step of the main agent starts with a compact `[SFD]` block of
 * observed facts (actors, counts, artifacts) plus the obligations the latest
 * skill attaches to that moment. Facts and pointers only — the block never
 * authorizes, never gates, never replaces reading the skill.
 *
 * Gating: the block is injected when the ledger revision moved, or when a
 * warning obligation stays unacknowledged for several steps (the anti-drift
 * nudge). Steady steps with nothing new inject nothing.
 */
import { deriveObligations } from './obligations.js';
import { resolveProjectRoot } from './project.js';

/** Steps a warning may sit unobserved before it is re-injected. */
export const WARN_NUDGE_STEPS = 6;
/** Actor lines shown before the list is elided. */
const ACTOR_LINE_CAP = 8;

/** Render the `[SFD]` block for one ledger state. Pure. */
export function renderObligationBlock(run, t) {
  const { phase, obligations } = deriveObligations(run);
  const actors = Object.entries(run.actors ?? {}).map(([id, a]) => ({ id, ...a }));
  const lines = [];
  lines.push(t('ctx.header', {
    slug: run.run?.slug ?? run.run?.taskSummary ?? '-',
    branch: run.run?.branch ?? '-',
    rev: run.revision ?? 0,
    phase: t(`phase.${phase}`),
  }));

  if (actors.length > 0) {
    const running = actors.filter((a) => a.status !== 'terminal').length;
    const unclosed = actors.filter((a) => a.status === 'terminal' && !a.closed).length;
    lines.push(t('ctx.actorsSummary', { total: actors.length, running, unclosed }));
    for (const a of actors.slice(-ACTOR_LINE_CAP)) {
      const outcome = a.status === 'terminal' ? (a.outcome ?? 'TERMINAL') : (a.status ?? 'running');
      const report = a.reportHint ? ` · ${a.reportHint}` : '';
      const closed = a.closed ? ' · closed' : '';
      lines.push(t('ctx.actorLine', { id: a.id, role: a.role, outcome, extra: `${report}${closed}` }));
    }
  }
  const counts = Object.entries(run.counts ?? {});
  if (counts.length > 0) {
    lines.push(t('ctx.counts', { items: counts.map(([role, n]) => `${role} ${n}`).join(' · ') }));
  }
  const reports = run.artifacts?.reports ?? [];
  if (reports.length > 0) lines.push(t('ctx.reports', { count: reports.length }));

  lines.push(t('ctx.obligations'));
  if (obligations.length === 0) lines.push(t('ctx.none'));
  for (const o of obligations) {
    lines.push(t(`obl.${o.id}`, o.params ?? {}));
  }
  lines.push(t('ctx.pointer'));
  return lines.join('\n');
}

/** Render the `/sfd` resume brief from the ledger. */
export function renderResumeBrief(run, t) {
  return [
    `# SFD ${t('state.resume')}`,
    '',
    renderObligationBlock(run, t),
    '',
    t('state.readSkillFirst'),
  ].join('\n');
}

/**
 * Create the per-session injector.
 * @param options.loadRun - `(root) => Promise<run|null>` (tests inject a stub).
 * @param options.resolveRoot - `(cwd) => Promise<string|null>` override.
 */
export function createRunInjector({ loadRun, resolveRoot = resolveProjectRoot } = {}) {
  if (typeof loadRun !== 'function') throw new Error('createRunInjector requires loadRun');
  const seen = new Map(); // sessionId -> { revision, step, lastInjectStep }

  async function textFor({ sessionId, cwd, t }) {
    if (typeof sessionId !== 'string' || typeof cwd !== 'string') return null;
    let root;
    try {
      root = await resolveRoot(cwd);
    } catch {
      return null;
    }
    if (root === null) return null;
    let run;
    try {
      run = await loadRun(root);
    } catch {
      return null; // an unreadable ledger must never break the step
    }
    if (!run || run.run?.status !== 'active') {
      seen.delete(sessionId);
      return null;
    }
    const state = seen.get(sessionId) ?? { revision: 0, step: 0, lastInjectStep: 0 };
    state.step += 1;
    const { obligations } = deriveObligations(run);
    const warn = obligations.some((o) => o.severity === 'warn');
    const revisionMoved = (run.revision ?? 0) !== state.revision;
    const nudge = warn && state.step - state.lastInjectStep >= WARN_NUDGE_STEPS;
    seen.set(sessionId, state);
    if (!revisionMoved && !nudge) return null;
    seen.set(sessionId, { ...state, revision: run.revision ?? 0, lastInjectStep: state.step });
    return renderObligationBlock(run, t);
  }

  return { textFor, seen };
}
