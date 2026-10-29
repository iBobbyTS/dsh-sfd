# Risk-routed code review

This is a *selection index*, not a new test gate or an additional role registry.
The parent SFD orchestrator selects lenses **after seeing the frozen implementation diff**.
Selection uses (1) intended change and its original accepted behavior, and
(2) semantic changes actually visible in the diff and direct consumers.
Language, framework, file count, model price or a list of imports alone do
not determine risk. The [coverage method](review-coverage.md) and
[agent risk catalog](ai-agent-risk-catalog.md) supply concrete checks; a lens
is a hypothesis family, not a license to invent a new requirement.

## Feature-composition risk handoff

Feature identification happens before Section planning; after the real Section diff is frozen, Main retains the existing R01–R12 router. R01 plus triggered risk-qualified checks remain mandatory **per Section**, not per Feature. A trust boundary arising from combining independently safe Sections/Features can first become inspectable at the actual consumer handoff or Feature INTEGRATION: obtain concrete R06-qualified source/probe evidence or a focused security review before accepting that business path. An earlier independent focused risk review can be reused only while the relevant source/contract/environment assumptions are unchanged; changed later consumer paths require new targeted coverage. No thirteenth lens, fixed Feature roster or security review for every text change.

## Twelve candidate lenses

| ID | Focus | Trigger from actual changed behavior | Coverage guide |
|---|---|---|---|
| R01 | Intent, behavior, causal correctness | Any nontrivial behavior change, including bug fixes | [Baseline lens](review-coverage.md#baseline-lens) + [domain semantics](review-coverage.md#intent-and-domain-semantics) |
| R02 | Simplification, reuse, abstraction altitude | Added or reworked implementation mechanisms, layers, duplication or state | [Architecture and maintainability](review-coverage.md#architecture-and-maintainability) |
| R03 | State, async, concurrency | Shared mutable state, async event ordering, cancellation, queues or caches | [State, async, and concurrency](review-coverage.md#state-async-and-concurrency) |
| R04 | Data integrity, representation, persistence | Schemas, migrations, identity mappings, serialization or stored state | [Data and persistence](review-coverage.md#data-and-persistence) |
| R05 | API contracts, producer-consumer, E2E integration | Cross-owner/module/service/process calls, public contracts, consumer changes | [Interface and consumer contracts](review-coverage.md#interface-consumer-and-end-to-end-contracts) |
| R06 | Security, authorization, privacy | Trust boundaries, sensitive inputs, credentials, permissions or secrets | [Security, privacy, and trust boundaries](review-coverage.md#security-privacy-and-trust-boundaries) |
| R07 | Failure, resilience, operations | Partial failure, retry, timeout, restart, cleanup, rollback or release | [Reliability, operations, and release safety](review-coverage.md#reliability-operations-and-release-safety) |
| R08 | Performance, capacity, resource use | Hot path, query volume, allocation, scheduling, resource lifecycle | [Performance, capacity, and cost](review-coverage.md#performance-capacity-and-cost) |
| R09 | UI interaction, accessibility, workflow | UI state, forms, navigation, focus or user-facing affordances | [UI, accessibility, and product workflow](review-coverage.md#ui-accessibility-and-product-workflow) |
| R10 | Test oracles, CI validity, controls | Changed tests/mocks/fixtures, build/CI rules, automated success claims | [Tests, CI, and validation integrity](review-coverage.md#tests-ci-and-validation-integrity) |
| R11 | Dependencies, builds, platform compatibility | Dependencies, packaging, cross-OS/runtime installation or deployment support | [Dependencies and supply chain](review-coverage.md#dependencies-and-supply-chain) |
| R12 | Agent and automation control-plane integrity | Agent dispatch, privileges, model routing, provenance or workflow authorization changes (AI authorship alone is not a trigger) | [Agent and automation changes](review-coverage.md#agent-and-automation-changes) |

R01–R10 are broad risk families; R11 and R12 are specialized triggers.
These are **twelve knowledge categories**, not twelve executable agents, and
not twelve independent guarantees. A domain-specific numerical/ML invariant
belongs in the suitable lens (often R01), informed by the plan's already
selected domain knowledge, rather than an automatic thirteenth agent.
E2E source-path analysis (R05) does not substitute for running required E2E tests.
AI-authored ordinary product code is screened for AI-specific failure patterns through R01
and genuinely triggered lenses; authorship alone does not select R12.

## Selecting and allocating discovery

Main first maps the actual diff and original contract to triggered risks and
available deterministic evidence. Identify owners, changed producer→consumer
paths, state coupling, supported actor/environment, and missing or invalidated
oracles. Compare the intended contract with actual implementation so a required
but **absent** producer, consumer, authorization or test change can trigger
R05/R06/R10 even when its expected file is not in the diff. Consider the plan's selected domain knowledge only for those paths;
do not reread the entire planning library or turn playbook advice into scope.

- Include a complete R01 behavioral/contract baseline on all substantive
  implementation parents. For internal children, cumulative R01 checkpoint
  reconciliation may supply this baseline if its real source coverage is complete.
- Include a **distinct R02 simplification pass** for substantive new or changed
  implementation structure; do not manufacture it for purely documentation or
  mechanical changes without meaningful complexity risk.
- Select other lenses for *distinct material failure mechanisms* where focused
  analysis adds more than a narrowly decisive test or another assigned lens.
  An actually changed or newly exposed authentication, authorization, tenant,
  secret or trust boundary requires explicit R06-qualified evidence: an
  independently focused security pass or equivalent concrete security
  source/probe evidence. Generic R01 CLEAN does not alone close that gap.
  One reviewer can cover a primary lens and one tightly coupled secondary lens
  (e.g., R03 with R07) when the causal path is inseparable.
- If Main substitutes an existing **decisive oracle or source-level proof**
  for an otherwise triggered focused lens, identify the precise failure
  mechanism and show what evidence covers it: actual executed/controlled
  interleavings, a proven code invariant, and the supported environment.
  Concurrent execution with one final-state assertion (for example
  `Promise.all`) does not by itself demonstrate both lock acquisition
  orders. A sound lock proof or controlled-order probe can be sufficient;
  do not automatically add R03. A planned test, a confidence assertion or
  softer PLAN wording is not executed proof. Keep an uncovered material
  mechanism explicit and obtain targeted evidence; changes to an accepted
  required contract follow the existing bounded PLAN delta/owner policy,
  not retroactive relabeling of missing evidence.
- There is **no Code A instance minimum beyond complete R01**. A narrow atomic change may use R01 alone if no substantive R02 complexity, distinct specialist risk or mandatory R06 security coverage is triggered; Main records why additional discovery would only duplicate existing evidence. Independent complete Code B is still required.
- Use 2–3 as a **typical target for multi-risk changes**, never as a quota; normal maximum 4. Allow 5–6 only after
  Main records the additional distinct high-risk path and why the first four
  reviewers or available tests cannot cover it sufficiently. Six is a provisional
  exceptional dispatch ceiling, **not** a correctness theorem. Do not silently
  leave required risk unchecked merely to satisfy the ceiling: escalate the
  unresolved coverage/owner decision or revise an invalid section boundary.
- Select lenses and reviewer count from the *frozen* diff, not the earlier
  draft plan alone. Do not ask each reviewer independently to choose the whole
  set: that produces duplicative coverage and blind gaps. Main records chosen
  lenses, compact reasons, inspected cone, merged/skipped risks and which
  deterministic checks will cover unassigned risks in the existing feature state.

Examples (illustrative, not mandatory patterns):
- Async-state repair: R01 + R02 + R03 + R07.
- Cross-service persistence change: R01 + R02 + R04 + R05.
- UI-only interaction correction: R01 + R02 + R09; R05 if real consumer
  composition is unproven, R06 if an actual trust boundary changes.
- Multi-runtime/Windows support: R01 + R02 + R05 + R11; add R10 if
  platform test claims need independent verification.
- Major concurrent, persisted, permissioned workflow: R01 + R02 + R03 +
  R04 + R05 + R06 *only when each extra lens has a distinct high-risk path*.

## Post-repair delta risk re-routing

After **every admitted product/test repair**, Main compares the new repair delta
and its direct consumer paths with the previous Code A risk map. Record
newly triggered lenses, changed assumptions and uncovered causal paths.
This is a **routing decision**, not an automatic extra reviewer, new full A
group or expanded business promise.

- Reuse unaffected coverage when the repair leaves its source assumptions intact.
- If the repair creates/exposes a distinct material mechanism outside existing
  coverage, dispatch one bounded fresh FOCUSED_FIND on the **new** frozen
  candidate (or obtain equally decisive existing executable evidence).
  Treat security boundary changes under the R06 requirement above.
- If the repair materially invalidates the complete R01 baseline under the
  bounded-review reset rules, rebuild that affected baseline; do not pretend
  a local delta reviewer replaces a required reset.
- A new delta-root-cause Finding is admitted through Main's normal proof and
  deduplication rules and consumes the original parent repair budget.
- For every landed `SAFE_SIMPLIFICATION`, reroute its changed consumers and
  newly triggered R02/other risks, and verify its `SIMP-###` preservation oracle.
  Routine repairs without newly triggered risk do not rerun unchanged lenses.
- Required rerouting/coverage is not suppressed by the optional
  no-progress rediscovery rule or by the ordinary reviewer-count target;
  explain a material uncovered risk rather than claiming an artificial CLEAN.

## R02 simplification is a constrained deletion-first review

Inspect new abstractions, extra state/owners, unnecessary compatibility promises,
duplicate helpers, generalized policy/test infrastructure and stacks of local
workarounds that mask one canonical rule. Trace every questionable mechanism to
original user intent, established production contract, repository policy or
an unavoidable correctness dependency. Ask whether the feature remains correct
when the mechanism is removed and which actual consumer/oracle would prove it.

Report a **specific removable or collapsible mechanism**, the simpler existing
path, proof of preserved requirements, and affected tests/owners. Prefer deletion
or collapsing layers over replacing one speculative framework with another.
Do not maximize fewer lines at the expense of clarity, safety or a real shared
invariant. Reviewer output never edits source or creates requirement authority.

A proven material maintainability defect follows existing blocking proof.
Otherwise Main may admit an optional `SAFE_SIMPLIFICATION` action with a
stable `SIMP-###` ID, the removable mechanism, preserved authoritative
invariants, affected consumers and an explicit preservation oracle.
This is **not** the hard-cap `SIMPLIFY_CURRENT` recovery classification or
a new severity. Batch optional simplification with an already admitted
material repair, never start a mandatory repair wave for it alone.
Without an approved repair, retain it as nonblocking NIT_DEBT/SCOPE_PROPOSAL.
An explicitly owner-authorized standalone edit still consumes the existing
cumulative repair-wave budget and requires delta and closure verification.

## Independence and evidence

Each discovery instance receives only the frozen candidate, original approved
contract, constraints, shared relevant checks, its assigned lens and a distinct
report path; it starts in a fresh context and must not see peer conclusions
or the author's persuasive analysis. A specialist CLEAN means no supported
findings *within its stated lens*, not full product acceptance.
Read-only reviewers may inspect one immutable snapshot concurrently only
under the parent SFD orchestrator's immutable-candidate and reader-isolation rules.
Main owns Verify, Rank, Fix dispatch and Close admission. Fresh targeted
verification/closure does not count as an additional independent final reviewer.
The independent full Code B reviewer must still cover the complete final
bounded diff and its direct semantic neighbors.

Assess future changes to lens selection against historical confirmed defects,
clean controls, duplicate/false-positive suggestions, unique admitted root
causes and physical calls. This is optional retrospective evaluation, not a
per-feature audit, benchmark harness or additional merge gate.
