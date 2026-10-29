/**
 * Obligation derivation: what the latest skill says must not be skipped,
 * stated as observations plus pointers — never as gates.
 *
 * The source of truth is the bundled sectioned-feature-development skill
 * (v5.5.1). This module encodes only the few rules whose violation is
 * *observable in the ledger*: reviews dispatched vs implementers dispatched,
 * actors still running, terminal actors not closed. Everything semantic
 * (finding admission, wave budgets, acceptance) stays with the agent; the
 * derived list just keeps those obligations in front of it at every step.
 */

/**
 * Derive the current obligations from a run ledger.
 * @returns { phase, obligations: [{ id, severity: 'todo'|'warn', params }] }
 */
export function deriveObligations(run) {
  const actors = Object.entries(run.actors ?? {}).map(([id, a]) => ({ id, ...a }));
  const impl = actors.filter((a) => a.role === 'impl');
  const planReviews = actors.filter((a) => a.role === 'plan-review');
  const codeReviews = actors.filter((a) => a.role === 'code-review');
  const planSeen = (run.artifacts?.plan ?? []).length > 0;

  let phase = 'starting';
  if (run.run?.status === 'closed') phase = 'closed';
  else if (actors.length === 0 && !planSeen) phase = 'starting';
  else if (impl.length === 0) phase = 'plan-review';
  else if (codeReviews.length === 0) phase = 'implement';
  else phase = 'code-review';

  const obligations = [];
  if (phase === 'closed') return { phase, obligations };

  // Lifecycle hygiene: facts the agent can act on mechanically.
  const running = actors.filter((a) => a.status !== 'terminal');
  if (running.length > 0) {
    obligations.push({ id: 'await-actors', severity: 'todo', params: { ids: running.map((a) => a.id).join(' ') } });
  }
  const open = actors.filter((a) => a.status === 'terminal' && !a.closed);
  if (open.length > 0) {
    obligations.push({ id: 'close-actors', severity: 'todo', params: { ids: open.map((a) => a.id).join(' ') } });
  }

  // The plan-coverage rule: two independent PLAN reviews must close before
  // any implementer dispatch (reviewer-orchestration.md, "Two logical
  // coverages"). The ledger cannot see admission, so this is phrased as an
  // observation of dispatches, and a warning when the observable invariant
  // (≥2 completed plan-review coverages) is already violated.
  const planDone = planReviews.filter((a) => a.outcome === 'COMPLETED').length;
  if (phase === 'plan-review' && (planSeen || planReviews.length > 0) && planDone < 2) {
    obligations.push({
      id: 'plan-coverage',
      severity: 'todo',
      params: { dispatched: planReviews.length, done: planDone },
    });
  }
  if (impl.length > 0) {
    const done = planReviews.filter((a) => a.outcome === 'COMPLETED').length;
    if (done < 2) {
      obligations.push({
        id: 'plan-skip-warn',
        severity: 'warn',
        params: { done, impl: impl.length },
      });
    }
  }

  // Freeze + Code A before B; B1 stays blind (reviewer-orchestration.md).
  if (phase === 'implement') {
    obligations.push({ id: 'freeze-before-review', severity: 'todo', params: {} });
  }
  if (phase === 'code-review') {
    obligations.push({ id: 'code-coverage', severity: 'todo', params: { dispatched: codeReviews.length } });
  }

  return { phase, obligations };
}

/** True when any derived obligation is a warning (drives the re-inject nudge). */
export function hasWarning({ obligations }) {
  return (obligations ?? []).some((o) => o.severity === 'warn');
}
