# Editable-graph wrapper requirements

The user's current contract and the canonical SFD skill govern behavior. This document records the implementation boundary; it cannot redefine a user-requested tool name or silently approve a workflow deviation.

- Compile canonical Feature → Section → Subsection Markdown with located grammar/dependency/ownership errors. Compilation is never semantic approval.
- Every declared subsection always has a real R01 checkpoint review. A final child checkpoint may share a call with parent reconciliation, but not omit review. Children do not create extra A/B pairs.
- Keep Plan A/B, Section Code A/complete blind Code B, child checkpoints, parent reconciliation, Section/Feature acceptance and delivery in the canonical graph.
- The graph is the progress authority. Main edits status/evidence/note directly. `done` review/implementation requires a real actor/round/report; `done` Main node requires a reason.
- `skipped_by_user` is the only skip, requires user provenance and reason, and may be recorded upfront. A waiver removes its task, not unfinished non-waived upstream work; it is never CLEAN.
- Canonical nodes and canonical prerequisites cannot be removed. Main may add custom review/repair nodes and extra prerequisites; the plugin validates cycles, owners and status.
- Compile with an existing unchanged graph returns `already up to date, do not compile again` without writing or resetting progress.
- Compile with a changed plan/structure backs the old graph up to `SFD-GRAPH.prev.json` (overwriting an earlier backup), writes a new pending graph to the original filename, sets `reconciled=false`, and instructs Main to compare both graphs and PLAN-FULL.
- No automatic invalidation, evidence-cone retention, hold/risk controller, finding parser, model router, repair scheduler or competing acceptance state.
- Tools are exactly: `sfd_workflow_compile`, `sfd_subagent_spawn`, `sfd_subagent_wait`, `sfd_subagent_result`, `sfd_subagent_send`, `sfd_subagent_respond`, `sfd_subagent_cancel`, `sfd_subagent_observe`.
- Spawn prevalidates all tasks; partial dispatch preserves actual IDs and uncertain/unattempted failures without blind retry or automatic cancellation.
- Wait covers all requested actors and batch peers, withholds result instructions until all end, lists remaining IDs and preserves diagnostic branches. It never marks graph status.
- Pending input, failure/cancellation, empty/partial/paginated evidence and terminal process status cannot masquerade as review approval. Main reads the actual authored report and edits graph status.
- First role/layer return supplies applicable canonical authority; later returns are short state-specific hints with real actor/session IDs and graph successors. The next mandatory review is named before acceptance.
- Activation hides raw ES tools and the ES skill in the current agent scope; other sessions remain unchanged. Resume/dispose boundaries are supported; unsupported capabilities fail honestly.
- Canonical SFD 5.6.0 and sibling code-review resource bytes remain unchanged snapshots; the DSH adaptation is separate and verifiable.
- Verification uses fake ES, actual Cordis integration, canonical byte comparison and package inspection. Real installed DSH/ES end-to-end behavior remains unverified until separately observed.

- Reopen errors include the complete transitive reset_nodes recipe and preserve_skips. Main owns affected-evidence decisions and graph edits; the plugin never automatically resets progress.
- An unavailable terminal reviewer can be explicitly replaced with replacement:{agent_id,reason}; preserve old rounds, require role/scope continuity and no live/uncertain overlap, and select the replacement in later navigation.
- Pending requests return an actionable respond instruction. Respond forwards permission decisions or user-input answers, preserves effective policy/idempotency facts, works during graph repair and requires fresh wait before evidence can settle.
- Success and execution-error instructions follow the effective graph, acknowledge user waivers and guide plan reconciliation without reinstating waived reviews.
