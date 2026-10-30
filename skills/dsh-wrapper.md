# DSH wrapper addendum

The preceding body is the exact canonical skill snapshot. This addendum adapts transport to DSH, not Main's authority or Git permissions. Load it in the current session, write the canonical full plan and call `sfd_compile_workflow`. Compilation validates structure, never semantic approval. `sfd_workflow_status` exposes the current graph on demand.

## Dispatch and wait

Use `sfd_subagent_spawn` with `tasks: [{node, assignment, route, covers?}]`. Main chooses `{profile}` OR inline `{subagent, model?, effort?, developer_instructions?}`. Inline permission is yolo; profiles keep their own permission setting. The wrapper neither chooses models nor edits profiles. Sections are serial; no writer/reviewer overlap. Concurrent reviewers require enforced immutable source and isolated report/test effects; yolo is not isolation.

Wait on every returned ID through `sfd_subagent_wait`. Partial dispatch preserves created IDs and uncertain/unattempted tasks without retry or cancellation. Wait includes all batch peers and withholds result handling until all end. Read pending requests, real failures and every result page. Suspected loops, lack of progress or abnormal exits call for `sfd_subagent_observe` and actual terminal diagnostics, not blind polling. No respond tool is exposed; waiting input is not completion.

First role/layer results supply applicable full authority. Later rounds give concrete short hints, actual actor/session IDs and graph successors without repeating the first text. Ready Main-only successors also provide handling guidance before acceptance. COMPLETED is never CLEAN. Main reads real reports and checks, admits findings, verifies closure IDs and controls acceptance.

## Declare runtime obligations, not automatic decisions

Use `sfd_workflow_update` with `reason` and `obligations: [{id, purpose, unit?, feature?, needs?, before, source_actor_id?, implementation_actor_id?, review_node?}]`. IDs are semantic names. Purposes are integration, focused-review, verify-finding, repair, closure, repair-delta, plan-delta and repair-reconciliation. Main decides which obligations actually apply; the wrapper atomically checks owners, dependency order and real session relationships. Existing dynamic dependencies may be revised without rewriting old actors as different owners or purposes. Runtime obligations survive plan reload and specialist selection.

Feature residual `unproven_composition` gets an actual integration obligation before Feature acceptance; cross-Feature work can block delivery. Do not reopen unrelated accepted Sections or add a Feature A/B pair merely to dispatch it. Early focused evidence can use Main-selected real frozen-path prerequisites.

For admitted repairs, Main holds invalidated baseline nodes and declares the repair plus its required discovering-reviewer closure/repair-delta dependencies before successors. Name the actual original `implementation_actor_id`. Original impl_large work returns there; original impl_std work opens one logical impl_large repair session and reuses it thereafter. The actual route remains Main-selected. Main inspects the returned scope/checks and reroutes genuinely uncovered risks.

Closure, child repair-delta and plan-delta name the actual discovering `source_actor_id` and use `sfd_subagent_send`. Child checkpoints and parent reconciliation continue one parent R01 session. `review_node` can name a prior checkpoint this same reviewer actually covered. No next child until the checkpoint and required invalidations close. Independent focused findings close in their own sessions, not under the parent R01 label.

After a B-driven product/test repair: finding-author closure, risk rerouting, **fresh blind complete B1**, then necessary same-head B2. First-pass blind discovery always spawns; send cannot relabel a continuation as independent discovery. Once Main confirms the frozen current B1, declare repair-reconciliation with that reviewer's actual source ID; B2 continues that same session. Update its source after a fresh B1 restart. No repairs/actions/invalidations means no empty B2 call. This wrapper does not parse reports or invent findings/repair budgets; Main must declare all actual obligations.

Plan A/B first passes are independent. Plan B corrections recheck affected A in A's original session and then complete B in B's continuing session. `plan-delta` supports the bounded original-session recheck. Main can explicitly `retain` previously accepted unaffected plan coverage with actual actor/round and reason; it is not new review evidence. Trailing blank lines alone do not invalidate plan reviews.

When a required session truly cannot continue, Main can explicitly spawn one same-route replacement with `continuity_gap: {actor_id, reason, evidence}`. The old actor must be terminal; both real IDs and the frozen-report/finding or failed-attempt pointer remain recorded. The prompt names the break, never uninterrupted continuity. Later sends use the real replacement; no automatic replacement or second fallback is added. A historical successful discovery report can be explicitly selected with `source_round` after a later attempt failed; failure itself is not successful evidence.

## Confirmation, evidence and changes

Use `sfd_workflow_confirm` for accept, hold, risks, resolve, retain or explicit user-authorized waive. Actor acceptance requires the successful current round and actual report. Main-only acceptance still requires real checks and semantic evidence. Hold invalidates the affected cone; user-source waiver is provenance, not authentication or CLEAN.

The last child checkpoint may declare `covers: [parentReconciliationNode]` on spawn/send when the real reviewer will author both skill-required conclusions. Main confirms checkpoint and parent reconciliation separately, in graph order, with that one actual actor/round. Ordinary checkpoints or undeclared reports cannot claim this sharing.

Main controls cancellation timing, plan edits and treatment of existing changes. `sfd_subagent_cancel` requests cancellation only for one named actor. `sfd_cancel` takes Main's explicit `agent_ids` and reason; it does not infer peers, edit the graph, roll back, add questions or mark tasks completed. The old misspelled `sfd_subagent_cencel` is only a deprecated compatibility alias. Always wait to learn the actual outcome; cancellation supplies no acceptance evidence.

Completed work removed from the plan keeps historical acceptance without ghost occupancy. Unmet removed obligations and actual live actors remain visible. No automatic cancellation, close, rollback, retry, replacement or ledger migration occurs. UUID-bound send receipts, original session identity and result-page facts survive uncertain replies; resolved transport delivery never implies semantic acceptance.

Activation hides raw ES MCP tools and shadows only the ES skill in this agent scope. Other sessions stay unchanged. Supported session events restore membership; per-session/repository records own execution. Unsupported/same-layer host capability and replaced identity fail honestly. Raw shell calls, prior prompt content and residual MCP instructions remain outside these guarantees. No installation, restart, Git cleanup or replacement GUI is performed.
