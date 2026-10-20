import type { ActorKind, Attempt, DevelopmentRun, RunStatus, SectionStage } from '../core/types.js';
import type { RunAction } from './controller.js';

export const STATUS_LABELS: Record<RunStatus, string> = {
  draft: 'Ready to start', running: 'Working', pausing: 'Pausing', paused: 'Paused',
  blocked: 'Blocked', 'waiting-user': 'Needs your decision', cancelled: 'Cancelled', completed: 'Completed',
};
export const SECTION_LABELS: Record<SectionStage, string> = {
  pending: 'Waiting on dependencies', 'subsection-implementing': 'Implementing child checkpoint', 'subsection-review': 'R01 child checkpoint', 'subsection-adjudicating': 'Reconciling child evidence', implementing: 'Implementing', reroute: 'Rechecking repair-delta risks', 'review-selection': 'Selecting risk lenses',
  'review-a': 'Independent A review', 'adjudicating-a': 'Reconciling A evidence', repairing: 'Repairing',
  closure: 'Checking repair closure', 'review-b': 'Blind B review', 'adjudicating-b': 'Reconciling B evidence',
  accepted: 'Accepted', integrated: 'Integrated',
};
export const ROLE_LABELS: Record<ActorKind, string> = {
  planner: 'Planner', 'plan-review-a': 'Plan A', 'plan-review-b': 'Plan B', implementer: 'Implementation',
  'review-selector': 'Risk selection', 'reviewer-a': 'Code A', 'reviewer-b': 'Blind Code B',
  adjudicator: 'Evidence adjudication', 'closure-reviewer': 'Repair closure',
  'feature-verifier': 'Feature acceptance', diagnostician: 'Diagnosis', 'advisor-notice': 'Advisor notice fields',
};

export function phaseLabel(run: DevelopmentRun): string {
  if (run.stage === 'done' && run.intent === 'review-only') return 'Read-only review complete (no commits)';
  if (run.stage === 'done' && run.intent === 'plan-handoff') return 'Reviewed plan ready (no code changes)';
  if (run.stage === 'sections') {
    const section = run.activeSectionId && run.sections[run.activeSectionId];
    return section ? `${section.id} · ${SECTION_LABELS[section.stage]}` : 'Section scheduling';
  }
  return {
    planning: 'Planning', 'plan-review-a': 'Independent plan A', 'plan-review-b': 'Independent plan B',
    'feature-verification': 'Composed Feature acceptance', delivery: 'Delivery', done: 'Delivered',
  }[run.stage];
}

/** UI availability is a hint; the Host validates every state transition again. */
export function availableActions(run: DevelopmentRun): RunAction[] {
  switch (run.status) {
    case 'draft': return ['start', 'cancel'];
    case 'running': return ['pause', 'cancel'];
    case 'pausing': return ['cancel'];
    case 'paused': return ['resume', 'recover', 'cancel'];
    case 'blocked': return ['recover', 'cancel'];
    case 'waiting-user': return ['cancel'];
    case 'cancelled':
    case 'completed': return [];
  }
}

export function observedIdentity(attempt: Attempt): string {
  const observed = attempt.outcome?.identity.observed;
  if (!observed) {
    const admitted = attempt.outcome?.identity.external;
    return admitted?.admittedModel
      ? `External ${admitted.subagent} / ${admitted.admittedModel} (admitted; runtime echo unavailable)`
      : 'Not recorded';
  }
  const parts = [observed.provider, observed.model, observed.effort].filter(Boolean);
  return parts.length ? parts.join(' / ') : 'Not recorded';
}

export function requestedIdentity(attempt: Attempt): string {
  const route = attempt.outcome?.identity.requested ?? attempt.task.route;
  if (!route) return 'Host configuration';
  return [route.transport, route.provider, route.model, route.effort, route.preset].filter(Boolean).join(' / ');
}

export function shorten(value: string | undefined, size = 12): string {
  return value ? value.length > size ? `${value.slice(0, size)}…` : value : '—';
}

export function dateLabel(iso: string | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.valueOf()) ? iso : date.toLocaleString();
}
