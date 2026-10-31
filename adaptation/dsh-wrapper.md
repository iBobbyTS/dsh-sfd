# DSH editable-graph addendum

The preceding body is the exact canonical skill snapshot. This addendum adapts execution decisions to DSH and the current user contract; it does not extend Git permissions. Load the skill, write PLAN-FULL and call sfd_workflow_compile. Compilation checks structure, never semantic approval.

## Plan changes versus process steps

Skip **any** user-waived process step with `status:"skipped_by_user"` and `evidence:{user_source,reason}`. This applies to reviews, implementations and Main decisions, not a special review slot. Successors still await unfinished non-waived ancestors. A skip is not CLEAN.

Removing/changing a Feature, Section, child, implementation scope/tier or declared dependency belongs in PLAN-FULL first. Then compile and reconcile the new graph with the saved previous graph. Do not remove functionality only from the graph. Main may add custom review/repair obligations and extra prerequisites directly to the graph.

## Tools and progress

Tools are sfd_workflow_compile and sfd_subagent_spawn/wait/result/send/respond/cancel/observe. There is no confirm/status/update tool. Main edits the returned per-session SFD-GRAPH.json path directly.

- review/implementation done: `evidence:{actor_id,round,report}` references a real settled successful authored report;
- Main done: `evidence:{reason}` after the concrete stage checks;
- when one report actually supplies conclusions for multiple obligations, record each cross-node `evidence.conclusion` explicitly, alongside the same actor/round/report. The final child checkpoint and parent reconciliation can share one call with both authored conclusions. Do not infer extra conclusions from a terminal status.

Unchanged compile validates/returns navigation without writing progress. Changed compile saves SFD-GRAPH.prev.json, creates a pending graph and sets reconciled=false. Restore only still-valid evidence and applicable step waivers, leave affected work pending and set reconciled=true before dispatch. Reopen errors return a complete reset_nodes/preserve_skips recipe; Main makes the edits, not the plugin.

## Dynamic review decisions

The canonical skill remains the norm for **who reviews when**; this wrapper is only the DSH execution flow. Main chooses the transport for each review (fresh spawn versus send) and names the actual target; the program checks only pending status, graph prerequisites, task kind, real session identity and live-work safety, and never enforces reviewer continuity itself. That program neutrality does not relax the canonical session obligations, which still bind Main:

- first-pass discovery and every blind B1 (including each post-repair restart) use a fresh isolated context; B stays distinct from every writer and A reviewer, and PLAN reviewers never code-review the same Feature;
- B2 continues its own B1 session; it is not a new reviewer or another discovery pass;
- CLOSURE_VERIFY, REPAIR_DELTA and PLAN_DELTA rechecks return to the reviewer session that produced the finding or frozen report;
- one parent-slot R01 session spans all child checkpoints of a Section.

Supply each reviewer exactly the scope its stage allows: withhold A findings, dispositions and repair history from B1 until its own findings are frozen. When a session can no longer continue, apply the canonical recorded-gap fallback: exactly one new same-route session receives the frozen report/finding IDs, and the lineage break is recorded (graph note or ACTORS lineage); never report different actual agents as one session. Preserve true identities and old reports.

Pending-node prerequisites, task kind, real session identity and live-work/reader-writer safety still apply. Wait/result instructions follow the effective graph and do not restore waived steps. Their current report must first be read and recorded; a pending graph status alone is not a reason to repeat the dispatch.

## Section scheduling

This wrapper serializes Sections in the shared workspace: while any Section has live work, dispatch for another Section is rejected (`no parallel Sections`), and no review overlaps a live implementation. The canonical parallel-execution reference (independent worktrees) is not provided by this wrapper; if parallel Sections are requested, report that capability gap instead of bypassing the wrapper.

## Dispatch profiles

SFD role law reaches workers through profile developer instructions, never through the dispatch prompt: the prompt stays bounded TASK facts (node, logical role, purpose, assignment, report path). `sfd-dsh-dispatch` is this plugin's baseline DSH profile, carrying the complete role bundle mirrored from the snapshot's ROLE-INSTRUCTIONS.md; role-specific installed profiles (for example tiered implementer routes, sfd-codex-code-review, sfd-zcode-plan-review) remain the preferred choice when they fit. Route a spawn with `route:{profile:"..."}`. With a profile route the wrapper keeps the prompt task-facts-only; with an inline route the assignment itself must carry the applicable role law and report convention.

## Implementation repair routing

The wrapper never selects or redirects a dispatch session: **spawn always creates a fresh actor; send continues exactly the named actor.** Declare `purpose:"implementation"` for a new implementation and `purpose:"repair"` for fixes. Spawn defaults to new implementation; send defaults to repair unless a custom node declares its own purpose. Reopen affected completed nodes or add pending repair nodes before dispatch. Repair nodes name their owning unit/section/feature; their purpose can also be recorded on the node.

Canonical repair routing (model-routing.md) binds Main; ACTORS.json only records the lineage facts each unit's cycle needs:

- original impl_std: repairs go to **one impl_large repair session** — the first repair spawn creates and records it, later repairs send to that recorded actor;
- original impl_large: repairs return to the **original implementer session**;
- a later repair spawn replaces the recorded repair actor as the recorded-gap fallback when that session can no longer continue; the previous actor remains history;
- the next actual new-implementation dispatch starts a new cycle; children have separate cycles.

Provide the configured large `repair_route` with the new implementation, or `route`/`repair_route` for a repair spawn; a repair spawn without any route is rejected. Do not invent models or silently reuse std for repairs. **Use the returned actual IDs/actions for wait/result.** Route arguments apply to spawns only.

Unknown dispatch results must be reconciled against actual ES facts before another implementation spawn. A new implementation must be explicitly declared, never used as a disguised repair fallback.

## Stage navigation and runtime

Ready Main actions and report successors include concrete instructions for risk selection/specialist gates, repair reconciliation, Section closure/checks/integration, Feature journey/composition and final delivery/actor cleanup. Add necessary obligations to the effective graph before acceptance; the plugin does not parse findings, auto-accept or schedule repairs.

Spawn prevalidates batches; partial dispatch retains known IDs and uncertain/not-attempted operations without retry/cancel. Wait covers batch peers, lists remaining IDs and preserves diagnostic paths. Use observe for suspected loops/no progress/abnormal exits, not blind polling.

Pending requests lead to respond: permission allow/deny, user_input answer with content. Obtain human authority where needed, inspect effective policy outcomes and wait for fresh state. Respond/cancel/observe do not change graph completion and remain usable during graph repair.

Activation hides raw ES tools/skill only in the current agent scope. Other sessions are unaffected. Unsupported host hiding/session identity capabilities fail honestly; prior prompt content, shell calls and residual MCP instructions are not hidden.
