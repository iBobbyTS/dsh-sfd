# Reviewer orchestration

## Contents
- [PLAN and CODE](#two-logical-coverages-different-plan-and-code-scheduling)
- [Code A and candidate isolation](#code-a-select-and-dispatch-independent-discovery)
- [Verify, rank, fix, close](#verify-rank-fix-close)
- [Code B: blind review, then reconciliation](#code-b-blind-full-discovery-then-repair-impact-reconciliation)
- [Progress and budgets](#review-progress-check-no-repeated-unproductive-work)
- [PLAN-only retirement](#plan-only-silent-slot-retirement)
- [Identity and failures](#budgets-identity-and-candidate-safety)

## Acceptance scope

This file owns **who reviews when**. [Bounded review](bounded-review.md) owns finding scope and proof; [risk routing](../../code-review/references/review-routing.md) owns lens selection. Each peer **Section**, not its containing Feature, needs Code A and independent complete Code B. Children accumulate R01 checkpoints inside their Section; they have no extra A/B. Feature acceptance proves the business combination using [integration/testing](integration-and-testing.md), not a third full review.

## Two logical coverages, different PLAN and CODE scheduling

A and B are independent valid **coverage records**, not two calls or a consecutive-CLEAN counter. Main alone admits findings, closes gaps and releases successors.

**PLAN:** run A, finish its admitted corrections, then let unprimed B review the entire current plan. If B finds material issues, repair them, recheck invalidated A evidence and obtain B's complete final plan review. NITs do not restart it. Both results and necessary deltas must close before any implementer dispatch, except the explicit PLAN-only retirement policy below. PLAN has at most two material correction waves before diagnosis; [section-planning.md](section-planning.md#finite-recheck-rule) owns bounded delta limits.

**CODE:** A combines complete R01 behavior coverage, selected independent specialists and required repair closure. A focused CLEAN is local, never full-Section approval. Only after all A blockers and invalidated evidence close does B independently inspect the complete final Section diff. Its blind discovery and same-head reconciliation are B1/B2, defined below.

## Code A: select and dispatch independent discovery

Main maps original intent **and the frozen diff**, including missing required behavior, through the [risk router](../../code-review/references/review-routing.md). Retain complete R01, distinct R02 when substantive structure changes, and required specialist/R06 evidence. The router owns R01-alone eligibility and the usual/exceptional ceilings; no duplicate roster here.

Every CODE discovery/verification/closure context is distinct from all implementer/repair contexts. PLAN reviewers never code-review the same Feature. Each discovery uses the installed A route and a fresh isolated context: approved contract, exact candidate, causal source neighbors, relevant checks, one primary lens (at most one tightly coupled secondary), guide anchors and its own report path. Do not pass peer conclusions or the author's persuasive history. Multiple same-model opinions are not votes proving a defect.

A decomposed Section can supply R01 through real SUBSECTION_DELTA checkpoints and final PARENT_RECONCILIATION. Early independent specialists remain valid only while their inspected assumptions do; reroute the final diff and fill actual gaps. The last child checkpoint and reconciliation can share a real call only under [subsections.md](subsections.md), with both conclusions established.

### Freeze before dispatch

Reconcile all in-scope **staged, unstaged and untracked** source, tests and relevant configuration. Prefer a pinned committed tree; otherwise supply a content-addressed immutable snapshot/manifest covering those bytes. Preserve and exclude unrelated dirty user work. BASE..HEAD alone does not cover dirty content.

Read-only A instances may overlap only on **enforced immutable source**, with separate report sinks and isolated test side effects. A Write tool, yolo mode or read-only prompt is not filesystem protection. Without demonstrable isolation, use fresh contexts serially and check source content/status before and after each pass; this reduces risk, not a claim of hard isolation. Missing supported routes block, not authorize fabricated actors. Omission or drift prevents CLEAN.

No writer or B begins until the entire A group terminates and Main reconciles the reports. Keep every live reader ID rather than overwriting one slot. Candidate source stays frozen through terminal results; cancellation supplies no coverage. Parallel readers are not parallel implementation workers.

## Verify, rank, fix, close

**Verify — Main:** establish causality, supported reachable trigger, authoritative requirement, material consequence and smallest permitted repair. For high-impact claims still materially uncertain after source/probe checks, obtain fresh independent VERIFY_FINDING, batching related claims. It returns CONFIRMED / REFUTED / UNRESOLVED. Decisive evidence needs no redundant verifier; confidence/agreement is not decisive. An unresolved high-impact risk on a required path remains a gap/owner decision. Unanchored reviewer preferences cannot become blockers.

**Rank — Main:** cluster by root cause and record each admitted/rejected/duplicate disposition, owner and necessary oracle through the existing state/report references. Use the existing finding taxonomy. Optional SAFE_SIMPLIFICATION actions have stable SIMP-### IDs and preservation oracles; they are not severities or the hard-cap SIMPLIFY_CURRENT recovery.

**Fix — assigned implementer:** batch compatible admitted defects and authorized simplifications within the edit boundary. Optional simplification alone does not start a mandatory wave; explicitly authorized standalone edits still consume the original budget. Main never writes product fixes; reviewers never repair. **Main** runs and preserves targeted consumer/preservation checks under [test ownership](integration-and-testing.md#test-execution-ownership-and-evidence); reviewers read that evidence instead of repeating the suite.

For an admitted defect in a **shared semantic owner**, name its invariant in the repair task. Inspect the bounded same-root-cause family of reachable writers and direct consumers, not just reported line numbers. Distinguish real change/no-op, initialization/restore and failure/late-result paths where applicable. Repair relevant siblings or rule them out with source/probe evidence; one proven invariant may cover several sites. Main checks the returned scope. No whole-repository inventory, per-site test quota or silent scope expansion.

**Close — after any review-driven product/test repair:** Main reroutes the delta for new risks, obtaining focused evidence only for genuinely uncovered material mechanisms. Apply [baseline reset rules](bounded-review.md#reset-rules) when semantics materially change; carry forward unaffected evidence. Use this existing stage distinction:

| Origin of finding | Required verification |
|---|---|
| Ongoing child checkpoint or unfinished R01 PARENT_RECONCILIATION | Continue that R01 lineage with REPAIR_DELTA for **its own IDs** and invalidated invariants; new required risk evidence closes before checkpoint release. |
| Independent focused discovery, including during a child checkpoint | Fresh CLOSURE_VERIFY for those IDs; the R01 lineage also checks any of its invalidated assumptions. |
| Other Section-level A findings or admitted B1/B2 findings | Fresh CLOSURE_VERIFY on the repaired head after risk rerouting. B-driven repair then requires **new blind complete B1 and same-head B2**. |

A fresh closure receives Bug IDs, SIMP-### actions, triggers/preservation oracles, repair range, exact head, affected consumers and invalidations. Old Bug outcomes: VERIFIED_CLOSED / STILL_OPEN / REGRESSION / INSUFFICIENT_EVIDENCE. SIMP outcomes: PRESERVED / REGRESSED / INSUFFICIENT_EVIDENCE, even without Bug IDs. Independent repair regressions get separate NEW_DELTA_FINDING IDs and normal admission; do not bury them under an old finding.

Closure examines the repair and affected prior evidence, not a fresh whole-Section hunt. Main checks real evidence **for each admitted ID** before recognizing closure. Report counts or a later B1 cannot fill a missing A closure. No edit after discovery means no closure call; closure contributes to A, never replaces B. All child/focused/Section repairs share their original Section lineage.

## Code B: blind full discovery, then repair-impact reconciliation

After A and required checks close, use a fresh independent context on the installed B route, distinct from every writer and A reviewer. It is not another A instance. Plan reviewers cannot code-review the same Feature.

**B1 — FINAL_BOUNDED:** provide the complete Section base→latest diff, original contract/non-goals, direct semantic neighbors and real check evidence. Withhold A findings/dispositions, closure/SIMP IDs, repair-delta boundaries and persuasive history. B independently checks all changed behavior, the highest-risk consumer path, unnecessary mechanisms and proportional tests. Freeze B's own findings/coverage in its authored report **before** any repair-history input. If B1 has admitted material findings, repair before spending B2 work on that candidate.

**B2 — same-head repair reconciliation:** after clean/nonmaterial B1 is frozen, Main checks the actual A closure IDs, SIMP preservation, repair impact and invalidations against that same candidate. A genuine continuation of the same B lineage may assist; otherwise Main performs it from source/contracts/checks. Do not fabricate continuation or expose history to B1. B2 is not a new mode, independent reviewer or substitute for B1. With no repairs/actions/invalidations, note that no obligation remains; do not dispatch an empty continuation.

An admitted B1 **or B2** defect goes through bounded repair, delta risk routing and fresh A closure; then restart **complete blind B1** on the new candidate and finish B2. Unaffected A evidence can carry forward; material structural change resets affected R01. An earlier B1 CLEAN cannot bless a later product/test head. Acceptance needs current A, complete independent B1, B2 and required checks.

## Review-progress check: no repeated unproductive work

Before an optional repeat pass, name the open finding, invalidated conclusion, new risk or missing oracle it will resolve. Duplicate/rejected claims without new evidence, closed findings and NITs alone do not justify repeated discovery. A newly established defect in previously seen code is still progress when the current diff depends on/exposes it.

Required risk rerouting, new high-risk evidence, valid R01 reset, complete B1 and B2 are **not** optional repeats. **Before the second repair attempt for a failure whose first fix failed its original oracle**, Main invokes installed `$adaptive-debugging`: capture the original failure, earlier patch/result, isolate the failing causal boundary and falsify a root-cause hypothesis before the next edit. Also invoke the skill immediately for an initially complex or flaky failure under its own triggers. A skill invocation is diagnosis, **not** another reviewer or reset of the five-wave budget. If unavailable, report the missing capability and hold speculative repeated patches until decisive root-cause evidence exists; never claim the skill ran. At the third material repair wave, still inspect strategy/owner/plan assumptions. These checks remain mandatory even when optional cost notes are disabled.

## PLAN-only silent-slot retirement

Only in PLAN: if one slot is CLEAN in two consecutive rounds while the other finds material issues, or its two consecutive invalidated-cone rechecks are unproductive across material waves, retire the silent slot for that candidate. Record report IDs and the trade in final-head independence. The productive reviewer still completes the current bounded plan. An owner-approved scope change resets the affected slots. Never apply this exception to CODE B.

## Budgets, identity and candidate safety

CODE retains five attempted admitted repair waves per original Section, including children and B repairs. One compatible repair batch is one wave; failed closure followed by another repair is another attempt. NITs do not start waves. A new name, model, context or child does not replenish allowance. Integration keeps its own original obligation under [integration/testing](integration-and-testing.md); recovery/Advisor limits remain in their existing references. An authorized scope change creates a new candidate only for the changed portion.

Preserve phase/mode/lens, base/head, actual transport/task ID, requested versus observed model/effort (UNKNOWN where unobserved), report, result and relevant closure/invalidation references. Keep physical attempts distinct from logical A/B; detailed totals and cost commentary are optional, but failed/cancelled actors must not disappear. Preserve reviewer-authored reports, not raw spawn/wait payload files.

Missing terminal evidence, wrong identity, unknown route, changed snapshot or unsupported permissions are not CLEAN. Reconcile failed actors and allow at most one bounded same-route retry; runtime/auth/model errors are not semantic downgrade authority. A continuation is not a fresh independent actor. Only Main closes the handoff; BLOCKED, ABANDONED and child CHECKPOINT_VERIFIED never satisfy an external Section dependency. Default serial successors wait for current acceptance and required integration; only approved independent worktrees may overlap.
