---
name: sectioned-feature-development
description: "Use for nontrivial implementation or repair with cross-owner, state or interface changes, unclear impact, or failed whole-change convergence. Supports one or several business features. Not for an exact local fix solely because its file is risky."
---

# Sectioned Feature Development

Deliver the requested business outcome with bounded work, real delegated implementation and independent acceptance. Reduce duplicate work, not authorization, correctness or evidence.

## Boundaries and authority

A **Feature** is a complete observable business outcome. A **Section** is an independently accepted implementation contract; peer Sections in one Feature each keep their own reviews. A **Subsection** is an optional internal increment checked inside one Section, never an external dependency or another acceptance pair.

Main owns the plan, scope, finding admission, scheduling, commits and acceptance. Workers implement; reviewers inspect. Main does not replace a required implementer with its own product/test edits. Workers edit the assigned worktree directly, never commit/manage branches or deliver patch files.

Resolve the installed host route from [model-routing.md](references/model-routing.md) and `installation.json`. A missing required route is a capability blocker, not permission to invent a proxy or relabel a model. User-authorized route substitutions follow that reference. Preserve actual transport/session identity separately from requested/observed model; unavailable observations stay UNKNOWN.

Every SFD execution uses **EXECUTE_WITH_COMMIT** on an authorized non-main branch, even one Section. Preserve unrelated dirty work. Branching from main needs no extra approval; on an unrelated branch resolve the base choice once. PLAN_HANDOFF / REVIEW_ONLY do not authorize product edits or synthetic commits. Push, PR, merge to main, destructive cleanup and history changes require their own authority. An explicit no-commit execution request conflicts with this mode; resolve it before writes. Keep `.agent-work/` locally excluded; already tracked workflow files need an index-cleanup decision.

## Execute the current stage

Read the named authority when that stage first applies. Reuse text still available and unchanged; after compaction, takeover or a version change, reacquire the needed source instead of guessing. A reference is not an instruction to load its entire dependency graph.

| Stage | Action and exit condition | Read |
|---|---|---|
| Plan | Identify Feature(s) from the current request and corrections, then Section owners, dependencies, shared constraints and decisive checks. Use the existing plan template and explicit implementation tiers. Validate structure, then close the serial independent PLAN reviews before dispatch. | [Section planning](references/section-planning.md), [planning router](references/planning/router.md) and only matched guides; [PLAN review sequence](references/reviewer-orchestration.md#two-logical-coverages-different-plan-and-code-scheduling) |
| Implement | Generate the selected TASK from PLAN-FULL with `section_plan.py extract --output`. Add missing runtime facts, dispatch the assigned implementer, await its terminal result and inspect the returned diff/checks/real consumer interface. | [TASK](assets/TASK-PACKET.template.md), [dispatch](assets/DISPATCH-PROMPT.template.md), [handoff](assets/SECTION-HANDOFF.template.md) |
| Review and repair | Freeze the complete source/test/config candidate. Obtain Code A's complete behavior baseline and triggered specialist evidence; admit proven findings, repair and independently verify their closure. Then obtain blind complete Code B and reconcile repair evidence on that same candidate. Any B-driven product/test repair requires fresh A closure/risk routing and a new complete blind B. | [Review sequence](references/reviewer-orchestration.md), [finding boundaries](references/bounded-review.md), [risk selection](../code-review/references/review-routing.md), [request](assets/SECTION-REVIEW-REQUEST.template.md) |
| Accept and integrate | Accept a Section only when current A/B, admitted findings and required checks are closed. Dependent Sections also await producer integration; an unfinished producer Feature's unrelated Sections do not block a satisfied Section dependency. | [Review sequence](references/reviewer-orchestration.md), [integration/testing](references/integration-and-testing.md) |
| Deliver | Prove each original Feature journey and relevant cross-Feature obligations at the delivered candidate. Reuse valid evidence; dispatch only residual composition risks. Required failures/gaps prohibit a successful readiness claim. Close owned actors and archive only when the whole authorized plan is complete. | [Integration/testing](references/integration-and-testing.md), [lifecycle](references/artifact-lifecycle.md), [current state](assets/FEATURE-STATE.template.md) |

For automatic activation, present the first proportional plan and obtain user approval before PLAN review. Explicit invocation skips that routine pause, not unresolved product/owner decisions. Validators check structure, never semantic approval.

## Review handoffs that cannot be skipped

A report's CLEAN covers its assigned range, not automatic acceptance. Read the actual terminal result and reviewer-authored report; queued calls, cancellation, early text, tool success or a matching hash are not review evidence.

Before review, reconcile **staged, unstaged and untracked** in-scope changes. A commit range omitting dirty code is incomplete. Concurrent readers require enforced immutable source and isolated reports/test effects; otherwise serialize with drift checks. No writer changes a live reviewed candidate. Wait for all readers and reconcile results before writes resume.

Main checks admitted finding IDs against their actual closure scope, not the number of reports. Code A must be complete before independent Code B; B starts blind, without A's findings or repair narrative. Required tests and final-head evidence are separate obligations, not consequences of reviewer CLEAN. Preserve the original five-wave Section repair budget, including children and B repairs.

Use one report path per dispatch. Task packets contain relevant authority, candidate, constraints, checks and needed handoff facts, not peer discoveries, all other Features or Main's cost notes. The installed role already supplies its own instructions; the complete [role bundle](assets/ROLE-INSTRUCTIONS.md) is for role-definition changes or contradictions, not a prerequisite to every first dispatch.

## Load only when triggered

| Condition | Authority |
|---|---|
| A Section has real internal increments with a joint acceptance contract | [Subsections](references/subsections.md): actual child checkpoint, cumulative reconciliation, one Section A/B |
| Approved independent work overlaps | [Parallel execution](references/parallel-execution.md): separate worktrees and real path/contract/resource independence |
| Genuine multi-session program | [Long horizon](references/long-horizon.md) |
| Proposed extra owner, guarantee or mechanism | [Scope control](references/scope-control.md) |
| Mid-task adoption or exhausted repair allowance | [Recovery](references/recovery-and-migration.md) |
| An existing escalation trigger fires | [Advisor](references/advisor-escalation.md): external result plus real human adoption before releasing the hold |
| External transport contract is uncertain | [Client discipline](references/external-subagent.md) and the installed external-subagent skill; do not invent fields or downgrade on auth/tool failure |
| User requests cost/process analysis | [Optional efficiency notes](references/efficiency-checkpoints.md); no routine cost diary or automatic general-audit |

Retain one canonical PLAN, concise current state and original reports/check outputs. Record facts at real transitions; derive optional totals from them rather than maintaining competing summaries. Completed plans remain closed; later work may read their archive but cannot inherit CLEAN.
