/** State-specific hints and first-role authority injection. Main edits graph status; this module only explains the next obligation. */
import { readFile } from 'node:fs/promises';

const done = (node) => ['done', 'skipped_by_user'].includes(node?.status);
const actorRef = (actor) => actor ? { agent_id: actor.id, session_id: actor.sessionId ?? 'UNKNOWN' } : null;
const roundOf = (actor) => actor?.rounds?.at(-1);

export function nodePurpose(node) {
  if (!node) return 'unknown';
  if (node.id === 'plan:initial') return 'initial-plan-review';
  if (node.id === 'plan:final') return 'final-plan-review';
  if (node.id === 'delivery') return 'delivery';
  if (node.id.endsWith(':checkpoint')) return 'subsection-checkpoint';
  if (node.id.endsWith(':reconcile')) return 'parent-reconciliation';
  if (node.id.endsWith(':behavior')) return node.kind === 'main' ? 'section-a-confirmation' : 'behavior-review';
  if (node.id.endsWith(':risk')) return 'risk-selection';
  if (node.id.endsWith(':blind')) return 'blind-review';
  if (node.id.endsWith(':reconciliation')) return 'section-reconciliation';
  if (node.id.endsWith(':accept')) return node.section ? 'section-acceptance' : 'feature-acceptance';
  if (node.kind === 'implementation') return 'implementation';
  if (node.kind === 'review') return node.role === 'final-review' ? 'blind-review' : 'review';
  return 'main';
}

export function instructionKey(node, actor) {
  return `${actor?.role ?? node.role ?? node.kind}:${node.unit && node.unit !== node.section ? 'child' : 'owner'}`;
}

export function readyNodes(graph, state) {
  const live = (id) => Object.values(state?.actors ?? {}).some((actor) => actor.node === id && !['completed', 'failed', 'cancelled', 'timed_out', 'runtime_lost', 'result_invalid', 'closed'].includes(roundOf(actor)?.status));
  return Object.values(graph.nodes).filter((node) => !done(node) && node.needs.every((id) => done(graph.nodes[id])) && !live(node.id));
}

function continuationActor(node, state) {
  const actors = Object.values(state?.actors ?? {});
  if (node.id.startsWith('plan:')) return actors.find((actor) => actor.rounds?.some((round) => round.node === node.id));
  if (node.id.endsWith(':checkpoint') || node.id.endsWith(':reconcile')) return actors.find((actor) => actor.section === node.section && actor.role === 'behavior-review');
  if (node.kind === 'implementation') return actors.find((actor) => actor.kind === 'implementation' && actor.unit === node.unit);
  if (node.role === 'final-review' && !node.id.endsWith(':blind')) return actors.find((actor) => actor.role === 'final-review' && actor.section === node.section);
  return null;
}

function nextAction(node, state) {
  if (node.kind === 'main') return { action: 'edit-graph', node: node.id, note: 'set status=done with evidence.reason after inspecting evidence' };
  const prior = continuationActor(node, state);
  if (prior) return { action: 'sfd_subagent_send', node: node.id, ...actorRef(prior), note: 'continue the established session' };
  return { action: 'sfd_subagent_spawn', node: node.id, role: node.role, mandatory: node.mandatory === true };
}

function reminderFor(node) {
  if (!node) return '';
  if (node.id.endsWith(':blind')) return 'Code B blind review is mandatory; Section acceptance cannot be marked done before this review has a settled authored report.';
  if (node.id.endsWith(':behavior') && node.kind === 'review') return 'Code A behavior review is mandatory; do not advance to Code B or acceptance without it.';
  if (node.id.endsWith(':checkpoint')) return 'A declared subsection requires its real R01 checkpoint review; do not release the next child without it.';
  return '';
}

export function navigation(node, actor, graph, state) {
  const round = roundOf(actor);
  const successors = Object.values(graph.nodes)
    .filter((candidate) => candidate.needs.some((need) => (round?.node ?? actor.node) === need) && !done(candidate))
    .map((candidate) => ({ node: candidate.id, missing: candidate.needs.filter((need) => !done(graph.nodes[need])), next: nextAction(candidate, state) }));
  const next = readyNodes(graph, state).filter((candidate) => candidate.id !== node.id).map((candidate) => nextAction(candidate, state));
  const upcomingReview = Object.values(graph.nodes).find((candidate) => candidate.id !== node.id && !done(candidate) && candidate.kind === 'review' && candidate.needs.every((need) => done(graph.nodes[need])));
  const common = 'Read the actual authored report/diff/check evidence. COMPLETED is never CLEAN. Edit SFD-GRAPH.json to record progress; a review is done only with its real actor/round/report. ';
  let hint;
  switch (nodePurpose(node)) {
    case 'initial-plan-review':
      hint = 'Finish admitted Plan A corrections in the original reviewer session, then ensure independent Plan B reviews the complete current plan. No implementation before both plan reviews are done.';
      break;
    case 'final-plan-review':
      hint = 'Complete Plan B; if Plan B corrections invalidate A, recheck A in its original session. Implementation cannot start before both plan reviews are done.';
      break;
    case 'implementation':
      hint = 'Inspect the returned implementation, diff, checks and real consumer interface. The next required review is Code A/behavior or the child checkpoint; do not mark Section acceptance done before reviews.';
      break;
    case 'subsection-checkpoint':
      hint = 'This is the required subsection checkpoint review. Mark it done only after reading its report; no next child until it is done, and parent reconciliation remains separate.';
      break;
    case 'parent-reconciliation':
      hint = 'This is the cumulative parent R01 reconciliation, not a new per-child A/B pair. After it, required risk selection and the independent complete Section Code B still apply.';
      break;
    case 'behavior-review':
      hint = 'Code A covers the complete Section behavior baseline plus required specialists. Code B blind review remains mandatory; do not accept the Section from Code A alone.';
      break;
    case 'blind-review':
      hint = 'Code B is a complete independent review. Mark it done only after freezing and reading its report. If repairs are needed, add explicit repair/closure/B2 nodes to the graph and require those before Section acceptance; do not accept from a repair narrative.';
      break;
    case 'section-reconciliation':
      hint = 'If repairs/actions/invalidations remain, add or use an explicit same-head B2 review node and gate Section acceptance on it. With no remaining repair impact, record the main decision in the graph.';
      break;
    case 'risk-selection':
      hint = 'Main selects risks from the frozen candidate and adds any required specialist nodes directly to the graph. Specialist CLEAN is local; complete blind Code B remains mandatory.';
      break;
    case 'section-acceptance':
    case 'feature-acceptance':
    case 'delivery':
      hint = 'Set this main node done only when every required prerequisite is done/skipped_by_user and the actual Feature journey/checks were inspected. skipped_by_user is a user-authorized bypass, not CLEAN.';
      break;
    default:
      hint = 'Reconcile this evidence with the owning contract. Update the graph only after reading the real authored report; add explicit review/repair gates rather than deleting mandatory nodes.';
  }
  const nextHint = upcomingReview ? ` Next required review: ${upcomingReview.id}. ${reminderFor(upcomingReview)}` : '';
  return {
    actor_id: actor.id,
    session_id: actor.sessionId ?? 'UNKNOWN',
    node: node.id,
    purpose: nodePurpose(node),
    round: round?.number,
    scope: { unit: node.unit ?? null, section: node.section ?? null, feature: node.feature ?? null },
    successors,
    next,
    instruction: `${common}${hint}${nextHint}`,
  };
}

export async function fullGuidance(node) {
  const purpose = nodePurpose(node);
  const refs = new Set();
  if (node.kind === 'implementation') refs.add('assets/SECTION-HANDOFF.template.md');
  if (['initial-plan-review', 'final-plan-review', 'behavior-review', 'blind-review', 'review', 'section-acceptance', 'section-reconciliation'].includes(purpose)) refs.add('references/reviewer-orchestration.md');
  if (['subsection-checkpoint', 'parent-reconciliation'].includes(purpose)) { refs.add('references/subsections.md'); refs.add('references/reviewer-orchestration.md'); }
  if (['feature-acceptance', 'delivery'].includes(purpose)) refs.add('references/integration-and-testing.md');
  if (node.kind === 'implementation') refs.add('references/integration-and-testing.md');
  const chunks = [];
  for (const name of ['SKILL.md', ...refs]) {
    chunks.push(`Authority: ${name}\n${await readFile(new URL('../skills/sectioned-feature-development/' + name, import.meta.url), 'utf8')}`);
  }
  return chunks.join('\n\n');
}

export function waitInstruction(ids) {
  return {
    tool: 'sfd_subagent_wait',
    arguments: { agent_ids: ids, wait_time: 290 },
    instruction: 'Continue waiting for every remaining ID. If a loop, lack of progress or abnormal exit is suspected, use sfd_subagent_observe and inspect terminal failure evidence; do not blindly poll or claim success. Main decides cancellation or process changes.',
  };
}

export function spawnInstruction(node) {
  return {
    tool: 'sfd_subagent_spawn',
    node: node.id,
    instruction: `Dispatch this required ${node.kind} node only after its prerequisites are done. ${reminderFor(node)}`.trim(),
  };
}

export function standing(node) {
  if (node.kind === 'implementation') {
    return 'Implement only the assigned owner/write boundary and regression tests. Do not commit, manage branches, review or accept your own work. Return the dispatched SECTION-HANDOFF report.';
  }
  if (node.id.endsWith(':checkpoint')) {
    return 'You are the parent R01 checkpoint reviewer. Inspect the real SUBSECTION_DELTA, safe intermediate state, parent invariants and checks. Do not edit product/tests or accept the Section. Return your authored checkpoint report.';
  }
  if (node.id.endsWith(':blind')) {
    return 'You are the independent blind Code B reviewer. Inspect the complete frozen Section candidate and actual contract. Do not receive Code A findings or repair history before freezing your own report. Never edit product/tests or accept the Section.';
  }
  if (node.id.startsWith('plan:')) {
    return 'You are an independent plan reviewer. Read the complete current PLAN-FULL, find structural/semantic gaps and return your authored review. Do not implement or accept the plan.';
  }
  return 'You are an independent reviewer. Read the frozen candidate and actual contract; do not edit product/tests or accept work. Return your authored report. Main edits graph progress only after inspecting your report.';
}

export function compileInstruction({ upToDate = false, graphPath, backupPath, planPath = '.agent-work/PLAN-FULL.md', reconciled = true } = {}) {
  const base = `Graph: ${graphPath}. Plan: ${planPath}.`;
  if (upToDate) {
    return `${base} already up to date, do not compile again.${reconciled ? '' : ' The graph is not reconciled; compare it with SFD-GRAPH.prev.json and PLAN-FULL, then set reconciled=true.'} Load the graph, mark completed work as done only with real actor/round/report evidence, and continue the next ready mandatory review.`;
  }
  return `${base} Previous graph (if any): ${backupPath ?? 'none'}. Compare the previous graph, the new graph and PLAN-FULL. Copy only completed work whose evidence still applies; mark affected work pending; review nodes need actor/round/report; skipped_by_user is the only skip and needs user_source. Set reconciled=true before dispatch. Then process the next ready mandatory review (Plan A/B, Code A, subsection checkpoint or Code B).`;
}
