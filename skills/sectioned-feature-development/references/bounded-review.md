# Bounded Patchset Review

## Contents
- [Roles and assurance](#review-roles)
- [Causality](#causality-boundary)
- [Finding classes](#finding-classes)
- [Blocking proof](#blocking-proof)
- [Initial review](#initial-bounded-review)
- [Repair scope](#repair-delta-review)
- [Code B](#closing-logical-b-b1b2)
- [Evidence reuse](#sticky-coverage)
- [Reset rules](#reset-rules)
- [Final head](#final-head-evidence)
- [Packets](#review-packets)

## Review roles

This reference owns **what can block and what must be proved**. [Reviewer orchestration](reviewer-orchestration.md) owns actor independence, candidate freeze, sequence and budgets; [delegated-pass.md](../../code-review/references/delegated-pass.md) owns one reviewer invocation. A reviewer does not repair, expand scope, delegate another review or run its own acceptance loop. Main alone admits findings and releases work.

## Review assurance

Each peer Section has current logical A and independent complete B. A Feature is the complete business outcome, not a replacement Code-review parent; a child only has an internal checkpoint. A focused CLEAN covers its assigned risk, not the whole Section. Actual terminal results and the complete frozen source/test/config candidate are required. New Sections reviewing changes to shared code do not automatically reopen all accepted predecessors; unresolved original-contract defects retain their owner and budget.

## Causality boundary

Ask: **what material defect did this change introduce, necessarily depend on, expose or make reachable?** Do not ask what else could be improved in the repository.

Unchanged code may establish a concrete caller/callee, data/control/serialization path, authoritative owner, side effect or affected consumer. Follow that causal chain only as far as needed for the claim; proximity to changed files does not authorize a wider audit. Unrelated historical defects are PREEXISTING_OUT_OF_SCOPE.

## Finding classes

An admitted Bug ID is a blocking DIFF_CAUSED, MERGE_BLOCKING_DEPENDENCY or EVIDENCE_GAP. A SIMP-### simplification action is not a Bug ID.

### `DIFF_CAUSED`
The current change creates incorrect behavior, a regression, unsafe transition, contract mismatch or material maintainability defect.

### `MERGE_BLOCKING_DEPENDENCY`
A pre-existing defect is now activated or required on a necessary acceptance path. Incidental traversal, proximity or increased visibility is insufficient. Repair only the dependency needed for safe acceptance.

### `PREEXISTING_OUT_OF_SCOPE`
The old defect is independent of the change's behavior/reachability and does not block this task.

### `SCOPE_PROPOSAL`
The concern requires a new product promise, supported environment, threat actor, compatibility/durability guarantee, framework or governance. It does not block without owner authority.

### `DEFERRED_OWNER`
The behavior belongs to a named later unit and the present intermediate state is correct. A currently unsafe state cannot be deferred this way.

### `EVIDENCE_GAP`
A previously required behavior or repository gate lacks adequate evidence. Cite its existing acceptance-criterion/gate; request the smallest decisive check, not a generalized harness. A reviewer's preference for stronger proof is not new authority.

### `NIT_DEBT`
Style, polish, preference or bounded debt without material acceptance risk. Preserve its disposition, but do not make it a mandatory repair.

## Blocking proof

| Question | Evidence required |
|---|---|
| Cause | Changed hunk/contract, or newly necessary faulty dependency |
| Reachability | Concrete trigger in the supported environment |
| Authority | Existing requirement, invariant, repository rule or established behavior |
| Materiality | Actual correctness, security, data, reliability, compatibility or maintainability consequence |
| Bounded repair | Smallest fix within authorized owners; no unapproved guarantee |

Reject or downgrade unsupported assertions, not a genuine required evidence gap. A high-impact claim with remaining material uncertainty follows the existing skeptical VERIFY_FINDING policy. A needed new edit owner or competing shared semantic owner returns to Main's scope/owner decision; reviewers cannot expand the manifest. Cosmetic helper extraction remains nonblocking.

For security, identify the protected asset, supported actor/capability, entry/data flow, trust boundary, preconditions and deployment. Do not assume arbitrary same-UID attackers, malicious in-process objects, multi-tenancy, hostile filesystem rebinding, multi-process writers or untrusted archives without project authority. Use the assigned [coverage guide](../../code-review/references/review-coverage.md), including actual public input allocation/deployment limits when applicable.

## Initial bounded review

INITIAL_BOUNDED/R01 examines the full Section diff and relevant behavior contract. FOCUSED_FIND first locates its assigned risk in that candidate, then examines only that risk and causal neighbors. [Risk routing](../../code-review/references/review-routing.md) selects the lens; specialists do not repeat R01.

Trace a high-risk changed path for nontrivial work, form and try to falsify hypotheses, batch root causes, and record the inspected files/symbols/contracts, actual checks and gaps. If inspection leaves the declared cone, name the causal path rather than recursively searching neighbors. No unrelated hardening, new architecture, repository audit or product edits.

## Repair-delta review

Inspect the previous reviewed head→current repair, open Bug/SIMP obligations, invalidated conclusions and direct new behavior. Main reroutes newly triggered risks and preserves unaffected coverage. A NEW_DELTA_FINDING requires a distinct defect caused/activated by that delta or its invalidation, not a previously unrelated area the reviewer happened to read.

For each Bug ID establish closure; for each SAFE_SIMPLIFICATION SIMP-### action establish PRESERVED / REGRESSED / INSUFFICIENT_EVIDENCE even when there are no Bug IDs. Check consumers and targeted oracles. Never reset simply because HEAD changed.

[Orchestration's closure table](reviewer-orchestration.md#verify-rank-fix-close) determines the actor: unfinished SUBSECTION_DELTA / R01 PARENT_RECONCILIATION may continue **their own** checkpoint IDs through REPAIR_DELTA; independent focused and later Section A/B findings require fresh CLOSURE_VERIFY. Complete new required risk coverage before releasing a checkpoint. A targeted repair pass does not replace complete independent B.

## Closing logical B (B1/B2)

Use [Code B sequencing](reviewer-orchestration.md#code-b-blind-full-discovery-then-repair-impact-reconciliation): FINAL_BOUNDED starts with blind complete B1, freezes its findings, then same-head B2 reconciles repair evidence. Product/test repairs from either stage require fresh A closure/routing and new complete blind B1 followed by B2. This is the Section's existing B obligation, not an extra Feature review.

## Sticky coverage

Keep evidence in its authored report/check output and link it from current state. Reuse deterministic checks while relevant inputs and environment remain unchanged; a new context or different lens does not itself require a rerun. Prior review is an opinion, not proof that in-scope code is forever correct: independent full B can discover a missed defect. Preserve unaffected conclusions across repairs and explicitly close invalidated ones.

## Reset rules

Rebuild affected initial coverage only when repair materially changes public/serialized API or schema, auth/trust, persistence/migration/durability, state ownership/concurrency, destructive/deployment/rollback behavior, supported environment/goal, or most of the Section architecture.

Local fixes, targeted tests, line movement, document/plan formatting, hashes, Skill updates, reviewer preference or evidence placement in ancestry do not alone reset it. New required specialist risks are still routed on the repair delta; a valid reset is not suppressed for cost reasons.

## Final-head evidence

Readiness references the exact reviewed product/test/config candidate and applicable check environment. Process/docs-only changes do not invalidate product evidence. Later product/test edits to a **current unaccepted Section** require affected A closure/checks and full current B. Changes in another Section do not mechanically reopen all predecessors; use [integration evidence applicability](integration-and-testing.md#evidence-applicability-and-repair-stage).

## Review packets

Use [the Section request](../assets/SECTION-REVIEW-REQUEST.template.md); send candidate, authority, scope and actual checks, not a second copy of scheduling law. Mode details and result types have one reviewer-side owner: [delegated scope](../../code-review/references/delegated-pass.md#scope).

### Initial
INITIAL_BOUNDED: full R01 behavior/contract baseline.

### Focused discovery
FOCUSED_FIND: assigned primary risk, optionally one tightly coupled secondary; local coverage only.

### Skeptical verification
VERIFY_FINDING: disprove specified claims against source/trigger/authority; CONFIRMED / REFUTED / UNRESOLVED.

### Repair closure
CLOSURE_VERIFY: fresh targeted Bug/SIMP verification, repair range, consumer evidence and separate NEW_DELTA_FINDING when justified.

### Delta
REPAIR_DELTA: continuing bounded repair/invalidated scope where the existing stage permits it, not a new independent final review.

### Final
FINAL_BOUNDED: blind complete B1 before any history, then same-head B2 under orchestration. No complete-diff substitution by a targeted pass.

## Delegated companion contract

Use context=DELEGATED_PASS. Discovery/FINAL_BOUNDED returns CLEAN, MATERIAL_CANDIDATES or INSUFFICIENT_EVIDENCE for its actual inspected scope; Verify/Close use target-specific outcomes. Main retains acceptance. The Feature's unproven_composition determines whether another INTEGRATION reviewer is useful, never whether required checks run.

## Retrospective analysis boundary

Review current required behavior and real consumers. Retrospective cost/quality analysis is optional and separate from acceptance; no extra audit, benchmark or reporting gate.
