# @ibobbyts/dsh-sfd

A thin PLAN-FULL graph compiler and current-session external-subagent wrapper for DeepSeek Harness. The graph is the checklist; Main edits its progress. The plugin enforces mandatory review order and records actual subagent facts, but does not decide what the reports mean.

Load the bundled `sectioned-feature-development` skill, or use `/sfd` to queue that instruction. Write the canonical plan, then call `sfd_workflow_compile`.

## Tools

| Tool | Purpose |
| --- | --- |
| `sfd_workflow_compile` | Compile PLAN-FULL into `SFD-GRAPH.json`; back up an existing graph and report already-up-to-date when the plan/structure is unchanged |
| `sfd_subagent_spawn` | Prevalidate and dispatch one or more graph nodes |
| `sfd_subagent_wait` | Wait for every requested actor and batch peer; list remaining IDs and next review |
| `sfd_subagent_result` | Read the next report page for the current actor round |
| `sfd_subagent_send` | Continue an existing session for a declared recheck or repair |
| `sfd_subagent_respond` | Answer a pending question or allow/deny a permission request, then wait for fresh state |
| `sfd_subagent_cancel` | Request cancellation of one explicitly named actor |
| `sfd_subagent_observe` | Read actor diagnostics without changing progress |

There is no `sfd_workflow_confirm`, `sfd_workflow_update`, `sfd_workflow_status`, `sfd_cancel` or `sfd_subagent_cencel` in the active surface.

## Editable graph and progress

Each session gets its own graph:

```text
.agent-work/sfd-graphs/<session-digest>/SFD-GRAPH.json
.agent-work/sfd-graphs/<session-digest>/SFD-GRAPH.prev.json   # backup, if recompiled
.agent-work/sfd-graphs/<session-digest>/ACTORS.json           # actual actor/round facts
```

Nodes carry `kind`, `role`, `needs`, `mandatory`, `status` and `evidence`. Main edits status/evidence/note directly; the plugin validates the graph on every dispatch or continuation.

```json
{
  "id": "S01.A:checkpoint",
  "kind": "review",
  "role": "behavior-review",
  "needs": ["S01.A:implement"],
  "mandatory": true,
  "status": "done",
  "evidence": { "actor_id": "10000003", "round": 1, "report": "path/to/report.md" }
}
```

- `done` on a review/implementation node requires a real `actor_id`, `round` and `report`; the actor record must have a settled successful authored report.
- `done` on a Main node requires `evidence.reason`.
- `skipped_by_user` is the **only** skip. It requires `evidence.user_source` and `evidence.reason` and may be recorded upfront for all user-waived reviews. It removes that task, not its unfinished prerequisites: successors still await non-waived upstream work. It is never CLEAN.
- `pending`/failed nodes do not satisfy successors.
- The compiler-generated mandatory nodes and their canonical `needs` are immutable. Main may add custom review/repair nodes and extra prerequisites, but cannot remove a required Code A/B/checkpoint review. Custom review/repair nodes should carry `unit`, `section` and `feature` so continuation identity can be checked.

## Compile, backup and reconciliation

If `SFD-GRAPH.json` already exists and the plan plus canonical structure are unchanged, compile returns:

> already up to date, do not compile again

and does not write or reset progress.

If the plan/structure changed, the previous graph is copied to `SFD-GRAPH.prev.json` (overwriting an earlier backup), a new pending graph is written to `SFD-GRAPH.json`, `reconciled` becomes `false`, and compile returns an instruction to compare the previous graph, the new graph and `PLAN-FULL.md`. Main copies only still-valid `done` evidence and still-applicable user waivers, leaves affected work pending, sets `reconciled: true`, and continues.

No automatic invalidation, no automatic evidence cone, no `retain`/hold/risk controller.

## Mandatory reviews

The compiled graph always contains the reviews required by the skill:

- serial Plan A and independent Plan B;
- every Section's behavior/Code A and complete blind Code B;
- every declared subsection's real R01 checkpoint;
- parent cumulative reconciliation;
- Section, Feature and delivery acceptance gates;
- code review cannot be replaced by a report keyword or terminal status.

A subsection always has at least one review: its checkpoint. A final child checkpoint may share a call with parent reconciliation, but not omit review. `skipped_by_user` is the only user-authorized exception.

## Dispatch and wait

Spawn checks that the node is not done/skipped, every prerequisite is done/skipped, no live actor owns the node, and the graph is reconciled. Partial dispatch returns real created IDs and uncertain/not-attempted failures without retrying or canceling. Wait expands batch peers, withholds result instructions until every target ends, lists remaining IDs, and preserves diagnostic paths for loops/no progress/abnormal exits.

Wait never marks a node done. After reading the actual report, Main edits the graph itself. The tool returns the next mandatory review (for example Code B blind review or subsection checkpoint) and the actual actor/session IDs.

## Session scope

Activation hides inherited raw ES MCP tools and shadows the ES skill only in the current agent scope. Other sessions remain unaffected. The graph is per session and repository; session logs own membership, actor facts own actual rounds/pages/batches.

## Verification

```bash
npm test
npm run verify:skills -- --source /Users/ibobby/Projects/skills/sectioned-feature-development/skill
```

`npm test` covers the current graph/status/dispatch contract with fake ES. Canonical SFD 5.6.0 and sibling code-review resources are byte-for-byte snapshots. Real installed DSH/ES activation/resume/CLI behavior still requires a separately observed end-to-end run; this repository cannot substitute for it.

## Dynamic changes and recovery

Main may record an explicit request such as “skip all blind reviews” on every affected node immediately, even before planning or implementation finishes. Tool navigation names the effective remaining reviews and acknowledges waived nodes instead of restoring default reminders.

To reopen completed work, set the changed node and the completed descendants whose evidence must be re-established to pending with evidence=null. A dispatch/continuation attempted too early returns recovery.changed_nodes, recovery.reset_nodes and recovery.preserve_skips plus an instruction to repair the graph in one edit. This is a dependency-based repair recipe, not automatic semantic invalidation; Main still judges the actual impact. The plugin never resets statuses itself.

If an original reviewer cannot continue, spawn the pending review with an explicit replacement declaration:

```json
{"tasks":[{"node":"plan:initial","assignment":"Complete current plan and all required closure scope", "route":{"profile":"caller-selected-reviewer"},"replacement":{"agent_id":"10000001","reason":"original reviewer cannot resume"}}]}
```

The prior reviewer must not have live/uncertain work; cancel and wait if needed. The replacement keeps the review role and owning scope. Old rounds and reports remain recorded; future continuation guidance selects the replacement. Prefer continuity when available; never relabel an old report as the new review.

When wait returns pending_requests, its instruction points to sfd_subagent_respond, not another blind wait. For permission use allow/deny; for user_input use answer with non-empty content. Preserve any human-owned decision. The response contains ES disposition, requested_decision, effective_decision and policy override facts; already_responded/in_flight are not new approvals. Always wait for fresh task state afterwards. Respond remains usable while a graph or plan is being repaired and never marks work complete.
