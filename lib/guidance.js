/** Instructions follow the effective graph. Main decides every dispatch session; the program never redirects one. */
import { readFile } from 'node:fs/promises';
import { missingPrerequisites } from './graph-store.js';
import { implementationCycle } from './session-store.js';

const done = (node) => ['done', 'skipped_by_user'].includes(node?.status);
const actorRef = (actor) => actor ? { agent_id: actor.id, session_id: actor.sessionId ?? 'UNKNOWN' } : null;
const roundOf = (actor) => actor?.rounds?.at(-1);

export function nodePurpose(node) {
  if (!node) return 'unknown';
  if (node.purpose) return node.purpose;
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
  return node.kind === 'review' ? 'review' : 'main';
}

export function instructionKey(node, actor) {
  return `${actor?.role ?? node.role ?? node.kind}:${node.unit && node.unit !== node.section ? 'child' : 'owner'}`;
}

export function readyNodes(graph, state) {
  const live = (id) => Object.values(state?.actors ?? {}).some((actor) => actor.node === id
    && (roundOf(actor)?.unresolved || !['completed', 'failed', 'cancelled', 'timed_out', 'runtime_lost', 'result_invalid', 'closed'].includes(roundOf(actor)?.status)));
  return Object.values(graph.nodes).filter((node) => !done(node) && !missingPrerequisites(graph, node).length && !live(node.id));
}

export function stageInstruction(node) {
  if (node.status === 'skipped_by_user') return 'Preserve this user-authorized skipped step. It is not CLEAN and must not be dispatched unless that decision changes.';
  switch (nodePurpose(node)) {
    case 'initial-plan-review':
      return 'Inspect Plan A and finish admitted plan corrections. Main chooses fresh spawn or send and its reviewer; preserve the intended review scope and independence.';
    case 'final-plan-review':
      return 'Inspect Plan B and reconcile material corrections with affected earlier evidence. Change PLAN-FULL, compile and reconcile if the plan changes. Main chooses each review session and whether to spawn or send.';
    case 'implementation':
    case 'repair':
      return 'Inspect the implementation diff, checks and real consumer interface. Declare new implementation versus repair explicitly. During this cycle, std repairs use one escalated large session; large repairs reuse the original session. Follow effective review gates; do not reinstate any user-waived step.';
    case 'subsection-checkpoint':
      return 'Inspect the real child delta, safe intermediate state, parent invariants, admitted finding closure and required checks before releasing its successor. The final child report may also support parent reconciliation when it separately authors both conclusions.';
    case 'parent-reconciliation':
      return 'Reconcile cumulative child coverage, joint oracles, consumer interfaces and admitted closures. This completes the parent baseline, not a new per-child A/B pair. A shared final-checkpoint report needs this separately authored conclusion.';
    case 'section-a-confirmation':
      return 'Confirm that child checkpoints and parent reconciliation establish the complete current Section behavior baseline, including affected findings and checks. Reuse valid evidence instead of dispatching a duplicate baseline review.';
    case 'behavior-review':
      return 'Inspect complete Section behavior coverage and admitted finding closure. Before acceptance, follow the remaining effective specialist and independent review gates.';
    case 'blind-review':
      return 'Inspect the complete independent review on the frozen candidate. B1 uses a fresh isolated session, blind to A findings and repair history; B2 continues its own B1 session. If admitted repairs remain, add repair, discovering-reviewer closure and a fresh blind B1 restart before acceptance; do not substitute a repair narrative for required evidence.';
    case 'section-reconciliation':
      return 'Inspect admitted closures, repair actions and invalidated evidence on the current candidate. If repair reconciliation remains, add a same-head B2 obligation and gate acceptance on it; when none remains, record that reason without an empty review call.';
    case 'risk-selection':
      return 'Freeze and inspect the complete source/test/config candidate, route its actual risks and add any required specialist review nodes with acceptance/review prerequisites. Reuse still-valid evidence. Only then record the risk-selection decision; specialist CLEAN is local.';
    case 'section-acceptance':
      return 'Check current behavior and independent review evidence, each admitted finding closure, required test outputs and producer integration. Record Section acceptance only when the effective prerequisites and current candidate checks are satisfied.';
    case 'feature-acceptance':
      return 'Prove the original Feature journey, producer/consumer composition and cross-Feature obligations on the delivered candidate. Reuse valid Section evidence; add an integration review only for residual composition gaps and gate this node on its result. Missing required evidence prevents acceptance.';
    case 'delivery':
      return 'Verify every authorized Feature journey, required checks and explicit waivers on the final candidate. Report unresolved failures/gaps honestly; close owned actors and archive only when the whole authorized plan is complete. A waiver is not CLEAN.';
    default:
      return 'Inspect the actual contract, report, findings and checks for this obligation. Main decides whether evidence satisfies it and adds any required repair/review gates before acceptance.';
  }
}

function nextAction(node, state) {
  const instruction = stageInstruction(node);
  if (node.kind === 'main') return { action: 'edit-graph', node: node.id, purpose: nodePurpose(node), instruction,
    note: 'After these checks, record status=done with evidence.reason; otherwise add the missing obligations or preserve an explicit user skip.' };
  if (node.kind === 'review') {
    const candidates = Object.values(state?.actors ?? {}).filter((actor) => actor.kind === 'review'
      && (actor.node === node.id || actor.section === node.section && actor.feature === node.feature));
    return { action: 'choose-review-dispatch', node: node.id, tools: ['sfd_subagent_spawn', 'sfd_subagent_send'],
      actor_candidates: candidates.map(actorRef), instruction: instruction + ' Main chooses spawn/send and, for send, the actual target actor. Candidate IDs are suggestions, not a dispatch restriction.' };
  }
  const cycle = implementationCycle(state, node.unit);
  return { action: 'dispatch-implementation', node: node.id, tool: 'sfd_subagent_spawn', purpose: node.purpose ?? 'implementation',
    original: actorRef(cycle.original), repair: actorRef(cycle.repair), role: node.role,
    instruction: instruction + ' Spawn always creates a fresh actor: purpose=implementation starts a new cycle; purpose=repair records the new actor as this cycle\'s repair session (the recorded-gap replacement when the previous one died). Send continues exactly the actor you name and defaults to repair. Canonical routing: an impl_std cycle repairs in the recorded impl_large session, an impl_large cycle in the original implementer session. Supply an impl_large route for a repair spawn when none was saved.' };
}

/** Concise navigation derived from the edited graph, including arbitrary explicit step waivers. */
export function workflowNavigation(graph, state, { exclude = null, section = null } = {}) {
  const nodes = Object.values(graph.nodes);
  const excluded = new Set(Array.isArray(exclude) ? exclude : [exclude]);
  const scoped = nodes.filter((node) => !section || node.section === section);
  const skipped = scoped.filter((node) => node.status === 'skipped_by_user').map((node) => ({ node: node.id, ...node.evidence }));
  const next = readyNodes(graph, state).filter((node) => !excluded.has(node.id)).map((node) => nextAction(node, state));
  const waivers = skipped.length ? ' User-authorized skipped nodes: ' + skipped.map((item) => item.node).join(', ') + '; preserve these waivers; they are not CLEAN.' : '';
  const reviews = scoped.filter((node) => node.kind === 'review' && !done(node)).map((node) => node.id);
  const instruction = graph.reconciled !== true
    ? 'Compare the previous graph, current graph and PLAN-FULL; restore only applicable evidence and user waivers, leave affected work pending, then set reconciled=true.'
    : next.length ? 'Next ready actions: ' + next.map((item) => item.action + ' ' + item.node).join('; ') + '. Follow each action\'s instruction below.'
    : nodes.every(done) ? 'The effective graph is satisfied. Inspect final journey/check evidence before claiming delivery; a user waiver is not CLEAN.'
    : 'No other node is ready. Record the current report if applicable, finish live work, or repair pending dependencies in the graph; do not infer completion.';
  return { next, skipped, remaining_reviews: reviews, instruction: instruction + waivers + (reviews.length ? ' Remaining effective reviews: ' + reviews.join(', ') + '.' : '') };
}

export function errorInstruction(error) {
  if (error.instruction) return error.instruction;
  if (error.code === 'PLAN_INVALID' || error.code === 'GRAPH_MISSING' || /PLAN-FULL changed/.test(error.message)) return 'For removed/changed Features, Sections or implementation scope, correct PLAN-FULL first, call sfd_workflow_compile and reconcile both graphs. Restore only valid evidence and step waivers, set reconciled=true, then retry. Do not change functionality only in the graph.';
  if (error.code?.startsWith('GRAPH_')) return 'Edit the indicated graph fields to resolve this error, preserving valid evidence and user-authorized step skips, then retry. Feature/scope changes belong in PLAN-FULL followed by compile/reconciliation; do not recompile for status-only edits.';
  return 'Resolve the reported argument, actor or transport issue before retrying. Use sfd_subagent_wait/respond for live work or pending requests. A review session that cannot continue uses the canonical recorded-gap fallback: one same-route replacement carrying the frozen report/finding IDs, with the lineage break recorded. Impl repairs retain the program-selected cycle session. Never blindly retry an uncertain dispatch.';
}

export function navigation(node, actor, graph, state) {
  const round = roundOf(actor);
  const successors = Object.values(graph.nodes)
    .filter((candidate) => candidate.needs.includes(round?.node ?? actor.node) && !done(candidate))
    .map((candidate) => ({ node: candidate.id, missing: missingPrerequisites(graph, candidate), next: nextAction(candidate, state) }));
  const dynamic = workflowNavigation(graph, state, { exclude: node.id, section: node.section });
  return {
    actor_id: actor.id, session_id: actor.sessionId ?? 'UNKNOWN', node: node.id,
    purpose: round?.purpose ?? nodePurpose(node), round: round?.number,
    scope: { unit: node.unit ?? null, section: node.section ?? null, feature: node.feature ?? null },
    report_action: { action: 'inspect-and-record-report', node: node.id, ...actorRef(actor), round: round?.number,
      instruction: 'Read the actual authored report/diff/checks first. If its conclusions satisfy this obligation, record evidence:{actor_id,round,report}. When sharing it with another obligation, also record that separately authored evidence.conclusion. COMPLETED is never CLEAN; do not redispatch merely because progress is still pending.' },
    successors, next: dynamic.next, skipped: dynamic.skipped,
    instruction: 'Read the actual report and record progress only after inspection. ' + stageInstruction(node) + ' ' + dynamic.instruction,
  };
}

export async function fullGuidance(node) {
  const purpose = nodePurpose(node);
  const refs = new Set();
  if (node.kind === 'implementation') refs.add('assets/SECTION-HANDOFF.template.md');
  if (node.kind === 'review' || ['section-a-confirmation', 'section-reconciliation'].includes(purpose)) refs.add('references/reviewer-orchestration.md');
  if (['subsection-checkpoint', 'parent-reconciliation'].includes(purpose)) refs.add('references/subsections.md');
  if (['feature-acceptance', 'delivery'].includes(purpose) || node.kind === 'implementation') refs.add('references/integration-and-testing.md');
  const chunks = [];
  for (const name of refs) chunks.push(`Authority: ${name}\n${await readFile(new URL('../skills/sectioned-feature-development/' + name, import.meta.url), 'utf8')}`);
  return 'Applicable canonical references below supply defaults; the already-loaded skill remains the general authority. Current user step waivers take precedence. Main dynamically chooses every review spawn/send and target; the wrapper does not enforce reviewer continuity or infer it from node names, and never redirects a dispatch: spawn always creates a fresh actor, send continues exactly the named actor. Canonical repair routing binds Main per implementation cycle. Feature/scope changes require PLAN-FULL plus compile/reconciliation, not graph-only removal.\n\n' + chunks.join('\n\n');
}

export function pendingInstruction(requests, ids) {
  return { tool: 'sfd_subagent_respond', requests,
    instruction: 'Handle these pending requests before waiting again. Use agent_id and request_id with decision=allow|deny for permission or decision=answer with non-empty content for user_input. Main obtains human input/authority where needed; never invent an answer or grant authority. If ES says a request is unsupported/already resolved, inspect that response and wait for fresh state; do not blindly repeat it.',
    after_response: { tool: 'sfd_subagent_wait', arguments: { agent_ids: ids, wait_time: 290 } } };
}

export function waitInstruction(ids) {
  return { tool: 'sfd_subagent_wait', arguments: { agent_ids: ids, wait_time: 290 },
    instruction: 'Continue waiting for every remaining ID. If a loop, lack of progress or abnormal exit is suspected, use sfd_subagent_observe and inspect terminal failure evidence; do not blindly poll or claim success. Main decides cancellation or process changes.' };
}

export function standing(node) {
  if (node.kind === 'implementation') return 'Implement only the assigned owner/write boundary and regression tests. Do not commit, manage branches, review or accept your own work. Return the dispatched SECTION-HANDOFF report.';
  if (nodePurpose(node) === 'subsection-checkpoint') return 'Inspect the real SUBSECTION_DELTA, safe intermediate state, parent invariants and checks. Do not edit product/tests or accept the Section. Return your authored checkpoint report, and separately author parent reconciliation if assigned.';
  if (nodePurpose(node) === 'blind-review') return 'Inspect the complete frozen Section candidate and actual contract independently. Do not receive peer findings or repair history before freezing your own blind report. Never edit product/tests or accept the Section.';
  if (node.id.startsWith('plan:')) return 'Review the complete current PLAN-FULL, find structural/semantic gaps and return your authored review. Do not implement or accept the plan.';
  return 'Read the assigned frozen candidate and actual contract; do not edit product/tests or accept work. Return your authored report. Main records graph progress after inspecting it.';
}

export function compileInstruction({ upToDate = false, graphPath, backupPath, planPath = '.agent-work/PLAN-FULL.md', reconciled = true } = {}) {
  const base = `Graph: ${graphPath}. Plan: ${planPath}.`;
  const boundary = ' Skip any user-waived process step with skipped_by_user and its source/reason. To remove or change a Feature, Section or implementation scope, edit PLAN-FULL first, then compile and reconcile; never remove functionality only from the graph.';
  if (upToDate) return `${base} already up to date, do not compile again.${reconciled ? '' : ' Compare SFD-GRAPH.prev.json and PLAN-FULL, then set reconciled=true.'} Read the current effective next actions below; report completion requires real actor/round/report evidence.${boundary}`;
  return `${base} Previous graph (if any): ${backupPath ?? 'none'}. Compare the previous graph, new graph and PLAN-FULL. Copy only still-valid evidence and step waivers; leave affected work pending. Shared reports need each separately authored conclusion. Set reconciled=true before dispatch. Then process the next ready mandatory review in the effective graph, excluding user-waived steps.${boundary}`;
}
