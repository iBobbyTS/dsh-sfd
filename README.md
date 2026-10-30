# @ibobbyts/dsh-sfd

A thin PLAN-FULL graph compiler and current-session external-subagent wrapper for DeepSeek Harness. The graph is the checklist; Main edits progress and dynamically chooses review sessions. The plugin checks current prerequisites, records real task facts and gives concrete next-step instructions. Only implementation repair-session selection is program-owned.

Load the bundled sectioned-feature-development skill or use `/sfd`, write PLAN-FULL, then call sfd_workflow_compile.

## Tools

| Tool | Purpose |
| --- | --- |
| sfd_workflow_compile | Compile/reconcile the editable graph; unchanged compile validates/returns navigation without resetting progress |
| sfd_subagent_spawn | Dispatch graph nodes; review spawn is freely chosen by Main; impl repair may continue an existing actor |
| sfd_subagent_wait | Wait for requested actors and batch peers; return reports, remaining IDs and current/successor instructions |
| sfd_subagent_result | Read the next current-round report page |
| sfd_subagent_send | Send to Main's chosen review actor, or program-select the current impl repair actor |
| sfd_subagent_respond | Answer pending questions/permission requests, then wait for fresh state |
| sfd_subagent_cancel | Request cancellation of one named actor |
| sfd_subagent_observe | Read diagnostics without changing graph progress |

There is no confirm/status/update tool or workflow-wide cancel/rollback controller.

## Plan changes versus skipping steps

Skip any user-waived **process step** with `skipped_by_user` and source/reason. Reviews, implementations and Main decisions use exactly the same mechanism. Skipping a task does not waive its unfinished upstream tasks and is never CLEAN.

Remove/change **functionality** in PLAN-FULL first: Feature/Section/child membership, scope, planned implementation tier or declared dependencies. Then compile and reconcile. Do not remove functionality only from the graph, leaving the plan out of sync. Custom review/repair obligations and extra prerequisites can be edited directly in the graph.

Each session stores:

```text
.agent-work/sfd-graphs/<session-digest>/SFD-GRAPH.json
.agent-work/sfd-graphs/<session-digest>/SFD-GRAPH.prev.json
.agent-work/sfd-graphs/<session-digest>/ACTORS.json
```

Main edits status/evidence/note:

- pending / failed: unsatisfied;
- done review/implementation: `evidence:{actor_id,round,report}` names a real complete successful report;
- done Main decision: `evidence:{reason}` after its stage checks;
- skipped_by_user: `evidence:{user_source,reason}`, allowed upfront for any step.

One report may support several obligations when it actually authors each conclusion. For a cross-node reference, add `evidence.conclusion` for that separately authored conclusion. A final child checkpoint and parent reconciliation can therefore share one real call without losing either result. This does not allow a reviewer report to stand in for implementation work.

Changed compile backs up the old graph, creates a pending graph and sets reconciled=false. Main restores only applicable evidence/step waivers and sets reconciled=true. No automatic semantic invalidation or evidence-retention controller is introduced. Reopen errors describe affected completed descendants and preserved skips; Main edits them explicitly.

## Dynamic reviews

Main chooses fresh spawn versus send and each actual review target. An older reviewer does not prohibit a fresh spawn; role/Section or node names do not select or restrict a send target. No replacement declaration is required. The original skill explains independence and continuity considerations, but the wrapper leaves the decision to Main.

Graph prerequisites, pending status, real actor/session identity, complete batch settlement and no live writer/reader overlap still apply. Review and implementation task kinds remain distinct. Old rounds/reports stay historical facts even when Main chooses a new reviewer.

## Implementation and repair cycles

Each implementation unit, including each child, has its own current cycle. Dispatch with purpose=implementation for new work, purpose=repair for fixes. Spawn defaults to implementation; send defaults to repair, unless the node explicitly declares its purpose.

| Original implementation | Repair selection in that cycle |
| --- | --- |
| impl_std | Spawn one impl_large actor at first repair; send every later repair to that same actor/session |
| impl_large | Send every repair to the original implementation actor/session |

The next new implementation resets the cycle; it does not erase history or rewrite the plan's tier. The plugin chooses the actor, not a guessed concrete model. Supply the configured large route as optional repair_route on new implementation, or as route/repair_route at the first std repair.

Example dispatch shapes (replace node and configured profile names with the actual plan/host values):

```json
{"tasks":[{"node":"<unit>:implement","assignment":"new implementation","route":{"profile":"configured-standard"},"repair_route":{"profile":"configured-large"}}]}
```

```json
{"tasks":[{"node":"<pending-repair-node>","purpose":"repair","assignment":"fix admitted findings"}]}
```

A custom repair node has kind=implementation, purpose=repair and its owning unit/section/feature. To repair a completed canonical implementation node instead, first reopen it and reconcile affected descendants. Calling spawn for a repair may send to the cycle actor; calling send with the original std ID may spawn the first large repair actor or redirect to its recorded ID. **Read the returned actual IDs/actions and wait on those IDs.** Subsequent route arguments do not replace the selected repair actor.

Missing large-route configuration gives an actionable error. Unknown spawn outcomes must be reconciled against actual ES task facts before retry. Unsupported repair continuation reports a capability gap rather than silently creating another repair session. Genuinely new implementation requires an explicit declaration, not a hidden repair fallback.

## Reports, stage instructions and host scope

Wait/result first ask Main to inspect and record returned reports, not to redispatch their still-pending nodes. Successors and ready Main actions include concrete risk/specialist selection, repair reconciliation, Section finding/check/integration closure, Feature journey/composition and delivery/actor-cleanup duties. The effective graph and explicit arbitrary step waivers take precedence over default reminders. COMPLETED is never CLEAN.

Pending questions direct Main to respond; inspect ES's effective permission decision and wait for fresh state. Cancel/observe/respond never mark graph completion. Batch validation and checkpoints retain actual IDs, message UUIDs and cycle facts across partial dispatch. Wait runs outside the state write queue so diagnostics/cancel remain usable.

Activation hides raw ES tools and its skill only in the current session; other sessions are unaffected. Supported resume/dispose boundaries restore those effects. Only the nine active library modules remain. Retired implementations/tests were removed; all supported tests are in [the current suite](test/current/).

## Verification

```bash
npm test
npm run verify:skills -- --source /Users/ibobby/Projects/skills/sectioned-feature-development/skill
npm pack --dry-run
```

Tests use fake ES plus actual Cordis registry/scope integration. Canonical SFD 5.6.0 and sibling code-review resources remain byte-for-byte snapshots; only the DSH addendum changes. Real installed DSH/ES activation/resume/CLI behavior requires a separately observed end-to-end run. Local tests are not a deployment claim.
