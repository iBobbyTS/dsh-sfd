# DSH editable-graph addendum

The preceding body is the exact canonical skill snapshot. This addendum adapts transport and progress to DSH, not Main's authority or Git permissions. Load it in the current session, write the canonical plan and call `sfd_workflow_compile`. Compilation checks structure, never semantic approval.

## Tools and graph progress

Available tools:

- `sfd_workflow_compile`
- `sfd_subagent_spawn`
- `sfd_subagent_wait`
- `sfd_subagent_result`
- `sfd_subagent_send`
- `sfd_subagent_respond`
- `sfd_subagent_cancel`
- `sfd_subagent_observe`

There is no confirm/status/update tool. Main edits `SFD-GRAPH.json` directly. The graph is per session under `.agent-work/sfd-graphs/<session-digest>/`; compile returns its absolute path.

Each node has `status`, `evidence` and `note`. Use `status:"done"` only after reading the actual authored report:

- review/implementation: `evidence:{actor_id,round,report}` must name a settled successful report;
- Main node: `evidence:{reason}`;
- `skipped_by_user`: the only skip; `evidence:{user_source,reason}`; may be applied upfront to all user-waived steps. Successors still await unfinished non-waived ancestors. It is not CLEAN.

Do not delete mandatory nodes or remove canonical prerequisites. Add custom review/repair nodes and extra prerequisites when an admitted finding requires work; give custom review/repair nodes `unit`, `section` and `feature`. The plugin validates graph topology before dispatch.

## Compile, backup and reconciliation

If the plan and canonical structure are unchanged, compile returns **already up to date, do not compile again** and leaves progress untouched. Do not recompile for status-only edits.

When the plan/structure changes, the old graph is saved as `SFD-GRAPH.prev.json` (overwriting the previous backup), a new pending graph is written at the original path, and `reconciled` becomes false. Compare the previous graph, new graph and `PLAN-FULL.md`; copy only evidence and user waivers that still apply, mark affected work pending, set `reconciled:true`, and then continue. No automatic invalidation is provided.

## Mandatory reviews

Plan A/B, every Section's Code A and complete blind Code B, every subsection's real R01 checkpoint, parent reconciliation and Section/Feature acceptance remain mandatory. A subsection is never just implementation: it has its checkpoint. The last child checkpoint and reconciliation may share one real call only if both conclusions are actually authored; that does not make review optional.

Wait and result return the next mandatory review with actual actor/session IDs. Code review is not replaced by a terminal status, a keyword or a Main guess. If repairs are needed, add explicit repair/closure/B2 nodes and require them before acceptance; first-pass blind B1 and fresh discovery use a new session, not a relabeled continuation.

## Dispatch, wait and cancellation

Spawn validates all tasks before the first RPC. Partial dispatch preserves real created IDs and uncertain/unattempted failures; never blindly retry a non-idempotent spawn. Wait covers every requested actor and batch peer, withholds result instructions until all end, lists remaining IDs and preserves observe/diagnostic paths for loops/no progress/abnormal exits.

Use `sfd_subagent_send` for the same real session recheck/repair. It requires a pending graph node, satisfied prerequisites, settled actor group and matching kind/role/unit; base blind and first-pass Plan reviews require a fresh spawn. Cancellation and observation never change graph progress.

## Host scope

Activation hides raw ES tools and shadows the ES skill only in the current agent scope; other sessions stay unchanged. Supported session events restore membership; unsupported/same-layer host capabilities and replaced session identity fail honestly. Raw shell calls, prior prompt content and residual MCP instructions remain outside these guarantees.

## User-directed changes and recovery

Explicit user waivers override the corresponding default mandatory-step reminders above. Record all affected skips upfront with provenance; do not treat their unfinished ancestors as waived. The current effective graph, not a fixed reminder, determines remaining review work.

To redo work, reopen the changed node and the affected completed descendants (status=pending, evidence=null). Tool errors return recovery.reset_nodes for a complete dependency-based edit and recovery.preserve_skips for waivers to retain. Main judges impact and edits the graph; no automatic evidence invalidation is performed. After a plan change, compile, restore still-valid evidence and applicable waivers, and reconcile before dispatch.

Prefer the original reviewer session. If unavailable, explicitly spawn the pending review with replacement:{agent_id,reason}, full current contract and closure scope. The old actor must be terminal with no uncertain work; cancel and wait otherwise. Old facts remain historical, and later guidance uses the replacement. This recovery exception takes precedence over default same-session-only reminders.

When wait returns pending requests, use sfd_subagent_respond with agent_id/request_id and permission decision allow|deny or user_input decision answer plus content. Obtain human-owned input/authority rather than inventing it. Inspect the actual effective_decision and policy override facts, then wait again. Respond does not mark graph work done and remains available during plan/graph repair.
