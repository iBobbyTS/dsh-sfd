# Delegated bounded review

`context=DELEGATED_PASS`; this reference is the single-pass method. Plain Markdown is valid; no JSON registry, signed receipt or matching-hash approval is required.

Parent owns scope, admission, repair assignments, budgets, provider selection,
acceptance and integration. `SAFE_SIMPLIFICATION` is an optional
`SIMP-###` action, not the hard-cap `SIMPLIFY_CURRENT` recovery class. Discovery/FINAL_BOUNDED returns one signal:
CLEAN, MATERIAL_CANDIDATES or INSUFFICIENT_EVIDENCE. A CLEAN covers only
the assigned lens/range and checks, not a whole-parent acceptance.
VERIFY_FINDING and CLOSURE_VERIFY use the narrower outcome types below.

## Scope

For SFD, Section is the independent Code A/B acceptance boundary, Feature is the separate complete-business-path/combination decision, and Subsection is the Section's R01 increment. A peer Section in the same Feature cannot skip its own independent B. A bounded INTEGRATION review addresses one unproven composition risk, and its CLEAN does not claim whole-Feature or Section A/B coverage. Multiple independent read-only INTEGRATION passes may share an enforced immutable candidate and distinct output paths, never a concurrent writer. The last child's real SUBSECTION_DELTA checkpoint and parent reconciliation may share one call only when both conclusions and coverage are established.



INITIAL_BOUNDED (R01) and FINAL_BOUNDED (independent Code B) inspect the
specified complete parent base→candidate and its direct impact cone,
applying the [full baseline](review-coverage.md#baseline-lens) and
triggered risk checks. R01 means a complete behavioral/contract baseline,
not just the "Intent and Domain Semantics" subsection.
FOCUSED_FIND inspects the same frozen candidate for one assigned R02–R12
primary risk lens, optionally paired with one tightly coupled secondary lens
assigned by Main, **without re-performing the generic baseline**. Read only
the assigned coverage-guide anchors supplied from the risk router. A focused CLEAN is only local coverage, not a complete logical A or B coverage;
the parent assembles Code A from the R01 baseline, selected focused reports,
and any necessary closure evidence.
VERIFY_FINDING independently attempts to falsify particular ambiguous
finding IDs, returning CONFIRMED, REFUTED or UNRESOLVED with a specific
source/probe/authority reason.
CLOSURE_VERIFY uses fresh context for old admitted Bug IDs (any admitted
blocking-class finding; see [finding classes](../../sectioned-feature-development/references/bounded-review.md#finding-classes)) and accepted
`SIMP-###` actions, repair range, consumers and invalidated coverage.
For Bug IDs return VERIFIED_CLOSED / STILL_OPEN / REGRESSION /
INSUFFICIENT_EVIDENCE; for SIMP return PRESERVED / REGRESSED /
INSUFFICIENT_EVIDENCE with its behavior, consumer and test oracle even
when no Bug ID exists.
A **distinct** newly introduced/exposed repair defect must additionally be
reported as NEW_DELTA_FINDING with its own new ID and ordinary five-part
blocking proof, not buried under an old ID's REGRESSION outcome.
REPAIR_DELTA inspects frozen Bug/SIMP IDs, repair diff, newly triggered
risks and invalidated coverage only; it may also report NEW_DELTA_FINDING. No targeted pass may relabel itself as independent Code B.
FINAL_BOUNDED starts with B1 blind independent full diff, contract,
consumer and check discovery without A findings, SIMP IDs, closure history
or repair-delta boundaries. Freeze B1 findings in child-authored report
before any such history. B1 CLEAN is provisional until Main completes
B2 repair-impact reconciliation, optionally assisted by a real same-lineage
B continuation. Main performs B2 if continuation is unavailable. B2 is
not another independent reviewer; later product/test changes demand
fresh blind B1.
SUBSECTION_DELTA includes new child implementation and parent invariants, safe intermediate state and planned consumer.
Unimplemented later behavior is not a defect unless this checkpoint falsely exposes it or violates an existing invariant.
PARENT_RECONCILIATION completes reconciliation coverage on the final parent: cross-child interactions, changed prior paths, real consumer and joint oracles.
INTEGRATION covers emergent cross-section/runtime/process composition on the integrated feature when the packet names a non-empty `unproven_composition`.
Local green checkpoints alone are not proof.

## Causality

Each material candidate names changed-code cause, supported reachable trigger, prior authority, consequence and smallest bounded repair.
A candidate blocks only as DIFF_CAUSED, a tightly proven MERGE_BLOCKING_DEPENDENCY, or an EVIDENCE_GAP anchored to an existing acceptance criterion; NIT_DEBT, new guarantees, unrelated old defects and speculative guarantees are non-blocking.
Inspect dependencies only along the causal path.
Missing candidate stability or required evidence yields INSUFFICIENT_EVIDENCE, not invented CLEAN.

Never forward this pass to another reviewer or transport, and never relabel a result as another provider's. The shared skill name is methodology, not transport identity. Apply the curated task constraints and this self-contained role instruction. No edits, repairs, commits or delegation.

## Report

Write pass/parent/child IDs from the packet, assigned lens and candidate
anchor, coverage, checks reused/run/gaps, evidence for each reported ID,
pending behavior and invalidations into the dispatched report file.
For verification/closure include separate Bug and SIMP dispositions,
preservation checks and counterevidence; keep independently caused
NEW_DELTA_FINDING entries separate with their own
source/trigger/authority/effect/repair evidence. This is a finding event, not
a new severity or automatic blocker; Main still verifies/adopts it.
The final answer carries only the applicable signal or compact outcome,
the report path and one-line status. Successful runtime exit or a valid artifact hash is not a semantic CLEAN. Only main decides the next allowed unit.
