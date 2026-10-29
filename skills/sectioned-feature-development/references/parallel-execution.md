# Branches, parallel execution and integration

## Branch contract

The commit/branch authority is [SKILL.md](../SKILL.md): every unit is EXECUTE_WITH_COMMIT work on a dedicated non-main feature branch, dirty user work is preserved, and destructive history changes need separate authority. This file adds only the parallel-specific infrastructure below.

`.agent-work` is locally excluded and never committed. For parallel work, add `/git-worktree/` to `.gitignore` before creating `./git-worktree`; preserve other ignore rules. This infrastructure setup is an explicit user requirement, not a new product feature.

## Ready-node scheduling

A producing Section can unblock its accepted contract for a Section in another Feature after acceptance and integration, without requiring its Feature's unrelated Sections to complete. Different Feature labels are not evidence of independent worktrees, mutable shared state, test resources, public interfaces or security assumptions. A Feature is not a dependency gate in place of an explicit Section edge and does not replace the final composed business acceptance.


Use one orchestrator as the readable schedule/state writer. Main checks the following dependency and isolation conditions before dispatch; no ready CLI or reservation database. Workers do not edit parent state or choose siblings. Repository primary-checkout/no-worktree restrictions take precedence.

A section is ready when all prerequisites are accepted and integrated on the feature branch. A sibling can run concurrently only if:
- both are explicitly named as permitted to overlap in the reviewed PLAN (a readable list/pair is enough; no new schema);
- neither depends transitively on the other;
- no write/write or write/read path overlap;
- no mutated/consumed contract collision;
- no shared mutable DB/schema/port/output/cache/credential test resource;
- each has a distinct canonical worktree/branch and a concrete validation environment.

Read-only shared source is safe if no active worker changes its contract. Unknown interference means serial, not optimistic parallelism. Start with two writers; resource capacity, not model price alone, limits concurrency.

## Worktree procedure

1. Record feature base/head, reserve section and branch names.
2. Ensure ignore entry, then `mkdir -p ./git-worktree`. Main may make this expressly authorized `.gitignore` setup edit and a narrow setup commit before worker dispatch; freeze worker bases after that commit. Use canonical scope paths, not symlink aliases.
3. `git worktree add -b <section-branch> ./git-worktree/<run-id>-<section-id> <accepted-feature-head>`.
4. Pass the absolute worktree path, base SHA and task packet to exactly one writer.
5. Before review, freeze **all** relevant product/test/config writes into the
   candidate, preferably as commits on the authorized feature/section branch;
   inspect staged, unstaged and untracked in-scope files and never treat
   `BASE..HEAD` as covering dirty content. If a commit is not possible, pin
   the content-addressed immutable snapshot defined in
   [reviewer-orchestration.md](reviewer-orchestration.md) and supply its
   manifest and exact comparison range to all reviewers. Keep unrelated user
   dirty work untouched. Concurrent reviewers require that enforced
   immutability and independent report sinks; otherwise review serially with
   drift checks and no hard-isolation claim.
A worktree worker's report file lives inside that worktree's dispatched `.agent-work` path; main collects the worker-authored file itself into the main checkout's `.agent-work/{handoffs,reviews}/{feature}/` at candidate freeze — collecting the authored file is not copying a returned report body.
6. Main serializes accepted section commits into the feature branch in PLAN integration order using normal local merge/cherry-pick. This is internal feature integration, not merge to main.
7. If the target feature head changed on a sibling's direct impact cone, rerun composition checks. A conflict requiring semantic changes returns to the relevant owner; don't silently accept an automatic conflict resolution.
8. Preserve worktrees unless cleanup was separately authorized. Do not run broad reset/clean/remove commands to tidy evidence.

Different worktrees still share Git common metadata, and tests may share external state. Branch separation alone proves neither test isolation nor semantic independence.

## Stage barrier

For a section: IMPLEMENT → CHECK → freeze candidate → risk-routed read-only Code A
discovery group → Main Verify/Rank → admitted REPAIR + CHECK → delta risk re-route and
required focused coverage → fresh targeted CLOSURE when changed (Bug and SIMP actions) → blind
complete Code B FINAL_BOUNDED B1 → same-head B2 repair reconciliation →
two logical current coverages + checks → ACCEPTED → INTEGRATED. With no change after
discovery, omit repair and closure. B-driven repair, wave accounting and
blind-B restart rules follow [reviewer-orchestration.md](reviewer-orchestration.md).

PLAN review finishes, its actual reports are read/saved, and main admission/delta closure completes before **any** product/test implementer is spawned, including all parallel roots. No writer changes a reviewed snapshot.

Default is serial: if S01 is under review, do not spawn S02 merely to fill idle time.
S02 may overlap only if the already reviewed PLAN explicitly names S01/S02 as parallel, both have accepted/integrated prerequisites, and their worktrees/paths/contracts/resources are independent.
A missing dependency label or different files is not authorization.
S03 consuming S01 always waits for acceptance+integration, not code availability, initial CLEAN, BLOCKED or ABANDONED.
Existing explicit parallel plans need no format migration.

Reserve each parent’s native/external reviewer routes from its embedded profile before parallel dispatch; A/B keep the fixed roles in that profile, not alternating providers by a feature-wide counter. Failed dispatch retries keep the same reservation. Delta checks keep their original review ID. Actual agent IDs/provider errors and cancellation/reap status are recorded.

## Sequence-gate violations

If a writer starts early, interrupt that actual writer and wait for it to stop; do not merely change its state label or let it finish "to save work", and never retroactively declare the work parallel after a premature spawn.
Retain its partial diff uncommitted and do not reset/revert user work.
Record SEQUENCE_GATE_VIOLATION with the real actors/candidate.
If the reviewed plan or product candidate changed, that in-flight pass cannot bless the changed snapshot: retain useful findings and close only the affected gap.
If no reviewed input changed, preserve its valid result.
Close the original prerequisite first, then reassess the held partial diff against the final plan/head before resuming.
Do not create another recovery section, replay the feature or reset budgets.

BLOCKED or ABANDONED is a stop, not a successful prerequisite. Main may separately schedule an explicitly independent parent within an approved parallel plan; it must not release a dependent successor.

## Acceptance and completion

Reviewer output is not admission. Main verifies findings/checks/provenance and both current logical coverages' evidence at the candidate head. Empty findings do not override missing required checks.

Merged candidate checks prove composition.
The `unproven_composition` list and the integration-reviewer exemption rule are owned by [integration-and-testing.md](integration-and-testing.md): an empty list plus still-valid parent coverage means no extra composition reviewer — never fewer required current coverages or build/live gates.
Relevant interface/state/environment changes invalidate evidence; a doc-only edit does not.

Broad suites once per appropriate stable gate. If logs truncate, save original output and summarize mechanically, not rerun the entire suite merely to recount tests. No old green check can bless later unreviewed product edits.

A blocked environment is reported separately from product defects.
Feature closure records final head and outcome, then immediately archives the completed task under `archive/{YYYYMMDD-HHMM_feature-id}/` as [artifact-lifecycle.md](artifact-lifecycle.md) requires.
Main must not append to a completed plan without an explicit user reopen request; retain its closure and classify later work independently.

## Internal checkpoints

Parent section DAG remains authoritative.
Serial child commits stay on the parent branch; CHECKPOINT_VERIFIED only enables the next local child, and no other parent may depend on that child ID as an accepted contract. Checkpoint review, workspace freeze and blocked-dispatch rules are owned by [subsections.md](subsections.md); no metadata validator grants a child or acceptance transition.

## What counts as parallel development

Two live workers writing even disjoint files in the same worktree are concurrent writers, not isolated parent development.
Their shared tests, build outputs and Git index can conflict.
Record actual shared-worktree overlap as a deviation; never report that no parallel development occurred.
Native resume can replace metadata timestamps with its last activation; reconstruct earlier overlap from dispatch/resume events and task usage, not metadata alone.
Concurrent read-only Code A reviewers on one frozen candidate are explicitly
allowed by reviewer-orchestration.md and are not parallel *development*;
never treat concurrent readers, parallel test processes or reviewer calls
as implementation parallelism.
The existing plan carries one bounded decision; independent parents may overlap only with approved isolated worktrees and explicit resource ownership.
