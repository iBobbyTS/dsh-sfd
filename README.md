# @ibobbyts/dsh-sfd

A thin PLAN-FULL compiler and current-session external-subagent wrapper for DeepSeek Harness. Main owns scope, scheduling, finding admission, model routes, checks and semantic acceptance. Terminal `COMPLETED` is execution evidence, never CLEAN.

Load the bundled `sectioned-feature-development` skill, or use `/sfd` to queue that instruction. Write the canonical plan, then call `sfd_compile_workflow`. Compilation checks structure and source locations, not semantic approval. Both independent Plan coverages must close before implementation.

## Tools

| Tool | Purpose |
| --- | --- |
| `sfd_compile_workflow` | Compile/update the latest canonical plan |
| `sfd_workflow_status` | Inspect current graph, actors, rounds and Main dispositions |
| `sfd_workflow_update` | Main explicitly adds or revises bounded current review/repair obligations |
| `sfd_subagent_spawn` | Prevalidate and dispatch `tasks: [{node, assignment, route, covers?}]` |
| `sfd_subagent_wait` | Wait for all requested actors and their batch peers; list remaining IDs |
| `sfd_subagent_result` | Read the next result page with its actual byte offset |
| `sfd_subagent_observe` | Diagnose suspected loops, lack of progress or abnormal exits |
| `sfd_subagent_send` | Continue the actual established session for a declared recheck or repair |
| `sfd_subagent_cancel` | Request cancellation of one explicitly named actor |
| `sfd_cancel` | Request cancellation only of Main's explicit `agent_ids`, with a reason |
| `sfd_workflow_confirm` | Record Main's structural disposition and evidence |

The old `sfd_subagent_cencel` spelling remains a deprecated compatibility alias, not the documented canonical API. No respond, automatic retry, actor close, peer cancellation, rollback, Git operation or model-route selection is provided.

## Routes, batches and actual results

Main passes either `route: {profile: "configured-profile"}` or an inline `route: {subagent: "chosen-runtime", model: "caller-selected-model", effort: "high"}`. These forms are mutually exclusive. Inline routes use yolo; profiles retain their own permission setting. The wrapper does not read/edit profiles or pretend yolo is filesystem isolation.

Spawn returns actual created IDs and a wait instruction. Partial dispatch retains created IDs and uncertain/unattempted items without retry or cancellation. Wait expands all batch peers, supplies no result-processing guidance before every peer has ended, and preserves actionable requests and real failure evidence. Pending input, failed/cancelled actors, empty/partial reports and unread result pages cannot count as successful evidence. Investigate uncertainty before resolving a dispatch through `sfd_workflow_confirm(action="resolve", group_id=..., node=..., reason=...)`; missing tasks remain required.

Sections are serial. Writers never overlap readers or other writers. Overlapping reviewers require Main's declaration of enforced immutable source and independent report/test effects. Long waits poll outside the run lock, so diagnostics and explicit cancellation remain usable. Cancellation does not itself change ledger status; wait learns the actual outcome.

## Main-authored dynamic obligations

Runtime obligations are added **because Main identified the need**, not because the plugin parsed a report or decided to repair. Use semantic IDs and name the actual owner, prerequisites and blocked successors:

```js
sfd_workflow_update({
  reason: "Main identified a remaining Feature composition risk",
  obligations: [{
    id: "consumer-composition-proof",
    purpose: "integration",
    feature: featureId,
    needs: acceptedSectionNodes,
    before: [featureAcceptanceNode]
  }]
})
```

Supported purposes are `integration`, `focused-review`, `verify-finding`, `repair`, `closure`, `repair-delta`, `plan-delta` and `repair-reconciliation`. Ownership uses `unit` or `feature`; `before` is required. Declarations are atomic and cycle checked. Existing dynamic IDs can change dependencies, but changing their purpose/owner requires a new semantic ID so old actors/reports are not reinterpreted. Plan-source revision and runtime declarations are stored separately; a declaration does not pretend the plan text changed.

- Feature integration defaults to accepted member Sections and blocks Feature acceptance; cross-Feature integration can omit `feature` and blocks delivery. It is not a third full review pair.
- Fresh focused discovery and skeptical finding verification use new sessions. They can run early on a real frozen path with Main-selected prerequisites; no automatic final-baseline wait is added.
- A `repair` names `implementation_actor_id` for the original owning implementer, plus the discovering `source_actor_id` when applicable. Actual impl_large work returns to that original session. Actual impl_std work opens one logical impl_large repair session; later repairs reuse it. Main still supplies its actual route and assignment.
- `closure`, `repair-delta` and `plan-delta` name the real discovering `source_actor_id` and continue it. If a later attempt failed, `source_round` can explicitly select its real historical successful report; a failed attempt itself is not report evidence. For a prior child checkpoint, `repair-delta` may additionally name `review_node` from that same reviewer's real recorded coverage. Checkpoint repair deltas can restore the corresponding checkpoint only after Main separately confirms both conclusions.
- `repair-reconciliation` names the **current Main-confirmed blind reviewer** and continues its own B1 session as B2. It cannot borrow an older candidate's reviewer; update the declaration after fresh B1 changes the source session.

Main must declare all actually required closures, invalidated evidence and checks. For admitted code repairs: hold affected baseline nodes, declare repair and finding-author closure/repair-delta dependencies, inspect the repair/checks and reroute risks, then close each admitted ID in its discovering session. A B-driven product/test repair requires that closure, fresh complete blind B1 and necessary same-head B2. A continuation is never new blind discovery. Do not declare or dispatch an empty B2 when no repair/action/invalidation obligation remains.

If the harness/provider cannot continue a required session, Main may explicitly pass `continuity_gap: {actor_id, reason, evidence}` on spawn. This allows exactly one same-recorded-route replacement after the old actor terminates, carries frozen report/finding or failed-attempt evidence into its prompt, and records both actual IDs separately. It is not automatic retry or uninterrupted continuity. Future sends target the real replacement; a second replacement in that lineage or route substitution is rejected. Live work cannot be silently replaced.

## Evidence, updates and instructions

For actor nodes, confirm with `{node, action:"accept", actor_id, round, reason}` after inspecting the real authored report. Main-only nodes require satisfied prerequisites and an evidence-bearing reason. Required official checks, current candidate, per-ID closure and Feature/cross-Feature composition remain Main-owned; a report keyword is not parsed into acceptance.

Other confirmation actions are `hold`, `risks`, `resolve`, `retain` and `waive`. `risks` takes Main-selected specialist labels without selecting or dispatching reviewers. It preserves separately declared dynamic prerequisite edges. `waive` requires explicit user authorization provenance. `retain` is limited to previously accepted, genuinely unaffected Plan evidence: it requires the original actor/round and Main's reason, preserves the original report revision and creates no synthetic review. Affected Plan A returns to its own session; Plan B then completes its current review in its continuing session.

Trailing blank lines alone do not invalidate plan reviews. Actual plan changes invalidate affected code evidence and provisionally reopen Plan coverage; Main can explicitly retain unaffected Plan evidence or obtain the bounded deltas required by the skill. Removing accepted work preserves its historical acceptance without ghost Section occupancy. Unmet removed obligations remain visible; live actors are never silently removed or cancelled.

One real final-child checkpoint invocation may also author parent cumulative reconciliation by passing `covers: [parentReconciliationNode]`. Main confirms the checkpoint and reconciliation separately in graph order using the same actual actor/round. An ordinary earlier checkpoint, unrelated task or report without that declared coverage cannot claim reconciliation.

First results supply the applicable canonical handling text. Short navigation names actual actor/session IDs, owning hierarchy, appropriate original/escalated repair sessions and graph successors. Follow-ups do not repeat the initial text. Main-stage guidance is also returned before the next ready acceptance gate. Pending groups retain a specific diagnostic branch, not just blind polling instructions.

## Scope and packaging

Activation hides inherited raw ES MCP tools and shadows the ES skill only in the current agent scope; other sessions remain unaffected. Resume uses supported existing session events. Per-session/repository records preserve actual identities, message UUIDs, rounds, pages and batch facts. Unknown/same-layer host restrictions or unsupported/replaced continuations fail honestly. Older incompatible schemas and legacy state are preserved, not migrated or accepted.

This is not a shell sandbox, prompt eraser or live installation mechanism. It does not remove already-seen content or residual MCP server instructions. The package ships only modules reachable from the current entry point; historical source/tests remain in the repository but are not a second supported runtime or part of the shipped execution path.

Canonical SFD 5.6.0 and sibling code-review resources remain byte-for-byte snapshots; the DSH adaptation is a separate [addendum](skills/dsh-wrapper.md). Verify with `npm test` and `npm run verify:skills`; optionally pass `-- --source <canonical sibling skill root>`. Fake-ES and actual Cordis scope tests do not substitute for a real installed DSH/ES end-to-end check. See [design](DESIGN.md) and [requirements](REQUIREMENTS.md).
