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

Main chooses **every** plan/code/custom review spawn versus send and the actual send target. The wrapper does not refuse fresh spawn because an old reviewer exists, enforce replacement declarations, or infer continuation from names/roles. Canonical independence/continuity text is decision guidance, not a hard session selector. Supply the chosen reviewer its actual current contract and closure scope; preserve true identities and old reports.

Pending-node prerequisites, task kind, real session identity and live-work/reader-writer safety still apply. Wait/result instructions follow the effective graph and do not restore waived steps. Their current report must first be read and recorded; a pending graph status alone is not a reason to repeat the dispatch.

## Program-owned implementation repair routing

Declare `purpose:"implementation"` for a new implementation and `purpose:"repair"` for fixes. Spawn defaults to new implementation; send defaults to repair unless a custom node declares its own purpose. Reopen affected completed nodes or add pending repair nodes before dispatch. Repair nodes name their owning unit/section/feature; their purpose can also be recorded on the node.

Each unit has one current implementation cycle:

- original impl_std: first repair spawns **one impl_large actor**; every later repair in this cycle continues the same actor/session;
- original impl_large: every repair continues the original actor/session;
- the next actual new-implementation dispatch starts a new cycle; children have separate cycles.

Provide the configured large `repair_route` with the new implementation, or `route`/`repair_route` at the first std repair. Do not invent models or silently reuse std for repairs. Later repair calls reuse the saved actor rather than the supplied route. Calling spawn for a repair may therefore send instead; calling send with the original std ID may spawn the first large worker or redirect to its saved ID. **Use the returned actual IDs/actions for wait/result.**

Unknown dispatch results must be reconciled against actual ES facts before another implementation spawn. An unavailable repair session is a capability gap, not permission to silently create another repair actor; Main resolves the gap with the user. A new implementation must be explicitly declared, never used as a disguised repair fallback.

## Stage navigation and runtime

Ready Main actions and report successors include concrete instructions for risk selection/specialist gates, repair reconciliation, Section closure/checks/integration, Feature journey/composition and final delivery/actor cleanup. Add necessary obligations to the effective graph before acceptance; the plugin does not parse findings, auto-accept or schedule repairs.

Spawn prevalidates batches; partial dispatch retains known IDs and uncertain/not-attempted operations without retry/cancel. Wait covers batch peers, lists remaining IDs and preserves diagnostic paths. Use observe for suspected loops/no progress/abnormal exits, not blind polling.

Pending requests lead to respond: permission allow/deny, user_input answer with content. Obtain human authority where needed, inspect effective policy outcomes and wait for fresh state. Respond/cancel/observe do not change graph completion and remain usable during graph repair.

Activation hides raw ES tools/skill only in the current agent scope. Other sessions are unaffected. Unsupported host hiding/session identity capabilities fail honestly; prior prompt content, shell calls and residual MCP instructions are not hidden.
