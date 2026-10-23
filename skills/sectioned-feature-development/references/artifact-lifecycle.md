# Artifact lifecycle

## One authority per concern

Main owns requirements and PLAN-FULL; FEATURE-STATE is the current evidence index, not a second plan or copies of reports. One active PLAN may contain several business Features. Use one stable **artifact slug** for sections, handoffs, reviews, evidence and archive directories; business F IDs live inside the documents. The archive helper's historical `--feature-id` argument means that slug, and its VIEW_FEATURE_MISMATCH protection stays in force.

```text
.agent-work/REQUIREMENTS.md
.agent-work/PLAN-FULL.md
.agent-work/FEATURE-STATE.md
.agent-work/sections/{feature}/{id}-TASK.md
.agent-work/handoffs/{feature}/<unit>-HANDOFF.md
.agent-work/reviews/{feature}/<pass>.md
.agent-work/evidence/{feature}/<check>.log
```

Generate each TASK from PLAN-FULL with `section_plan.py extract --output`; prepend only missing runtime facts from the [TASK template](../assets/TASK-PACKET.template.md). Preserve authority, applicable Feature/Section/child invariants, examples and checks; omit Main-only routing metadata. Never hand-maintain another Section contract. Children share their Section's evidence/repair lineage, not a new state hierarchy.

Keep **original worker/reviewer-authored reports** at their dispatched paths. Main records real transport, raw task/session ID, requested/observed identity and outcome once, with actual finding dispositions and closure links. Failed/cancelled attempts must remain visible. Do not save raw spawn/wait/close/final payloads or turn returned prose into an invented authored report. Reports keep detailed findings; STATE references them. Per-pass arithmetic totals and cost commentary are optional.

Main collects actual command/build/test output under evidence with its exit status, including long worker-run output referenced by HANDOFF. Workers write only their authorized HANDOFF/report; its check fields contain command, status and key lines. This is command evidence, not transport payload archival. [Testing](integration-and-testing.md#evidence-failures) owns first-run capture and failure attribution. Keep secrets redacted and unknown results explicit.

## Bootstrap and planning

Preserve dirty user work, exclude `.agent-work` locally, and resolve already-tracked workflow files separately. Save original requirements, examples and superseding decisions. Use installed `installation.json` / [model routing](model-routing.md), not another host's guessed transport. Role definitions stay self-contained; Main sends curated task facts, not inherited whole conversations.

Use the existing [planning](section-planning.md) authority and matched guides for the sole PLAN. Basic validation is structural, not permission. Automatic activation pauses after the first proportional plan before review; explicit invocation only skips that pause. EXECUTE_WITH_COMMIT applies to execution; PLAN_HANDOFF / REVIEW_ONLY alone authorize no product write or synthetic commit. Optional [efficiency notes](efficiency-checkpoints.md) are not an entry requirement.

## Review and dispatch

[Reviewer orchestration](reviewer-orchestration.md) owns ordering, closure and budgets. At real transitions, current state must identify the last satisfied prerequisite and next allowed action: actual PLAN results/admitted corrections complete; required producer Section accepted/integrated or internal child CHECKPOINT_VERIFIED; correct actor; no conflicting live writer/reader. Code availability, early CLEAN, cancelled review, BLOCKED or ABANDONED does not release dependent work.

A current-unit repair may start after its reviewer terminates and Main admits/fixes its scope; it does not need that unit's final acceptance or authorize a successor. Main makes narrow commits from the worker's finished worktree diff and checks, without rewriting product changes. No worker commits or manages branches; [SKILL.md](../SKILL.md#boundaries-and-authority) owns commit authorization. For approved overlap, follow [parallel execution](parallel-execution.md).

Record actual actor, candidate, results, findings/closure and invalidated evidence at transitions, not every poll. Reuse unaffected results. Do not reconstruct missing original facts from a completion narrative or fabricate a report to fill a field.

## Completion and archive

Complete only after **all authorized Features**, required Section A/B and real integration/checks hold on the final candidate, all admitted blockers/invalidations close and owned actors terminate. First-Feature success cannot close a multi-Feature PLAN. An incomplete, blocked, Advisor-held or plan-only task is not COMPLETED. A stop/abort retains the true unresolved state; do not fake completion to invoke cleanup.

Mark PLAN-FULL COMPLETED with final product head, outcome and evidence references, and align the existing current STATE conclusion before archiving. Move the completed PLAN and irreplaceable evidence into:

```text
.agent-work/archive/{YYYYMMDD-HHMM_feature-id}/
```

Retain original [requirements](../assets/REQUIREMENTS.template.md), final [state](../assets/FEATURE-STATE.template.md), worker HANDOFFs, reviewer-authored reports and raw check outputs. Preserve existing optional efficiency notes, but do not manufacture them to finish.

Before moving/deleting, inventory the owned paths, kinds, sizes and live references. The normal completion instruction authorizes only archival of this completed task and removal of its **unreferenced generated** `*-TASK.md` views or legacy plan/contract extracts. Do not recursively delete the task tree, overwrite an archive, discard evidence or touch unrelated files. Live references block cleanup rather than being deleted to make it pass. The optional `archive_plan.py` helper takes explicit keep/view paths and `--apply`; default is inventory-only and does not prove semantic acceptance.

Leave a small pointer to the archive, not another active plan. Later requests may read it as context but need independent scope/acceptance unless the user explicitly reopens the task; they do not inherit its CLEAN. Historical numbering, evidence and completed archive contents remain unchanged by a Skill update.
