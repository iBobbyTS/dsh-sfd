# Integration and Proportional Testing

## Contents
- [Test ownership and oracle sensitivity](#test-execution-ownership-and-evidence)
- [Validation tiers](#validation-tiers)
- [Checkpoints](#checkpoint-triggers)
- [Feature acceptance](#feature-and-cross-feature-acceptance)
- [Residual integration review](#integration-review-boundary)
- [Evidence failures](#evidence-failures)
- [Evidence applicability](#evidence-applicability-and-repair-stage)
- [Final head and readiness](#final-head-evidence)

## Test execution ownership and evidence

**Main owns official validation** at implementation handoff, each admitted
repair and required final integration gate. Main selects the smallest applicable
Tier 1/2/3 checks, runs required test selections once against the frozen
source/test/config candidate and preserves **complete stdout/stderr,
test-process exit status, exact command/selector, covered cases, environment
and original log path** under the existing `.agent-work/evidence/{feature}/`
location. Index the results in FEATURE-STATE's existing Checks field: no new
test ledger or runner. Preserve the tested process's exit code through pipes
and filters; never truncate original output merely to reduce context.

**One review, one execution per applicable test selection.** Before Code A,
Closure, Code B or integration review, Main supplies its check inventory and
original evidence pointers. For identical candidate/test/config inputs, runner
options and relevant environment, subagent reviewers **must not reexecute**
cases Main or another reviewer covered (including a narrower selection from an
already-run suite). Fresh contexts demand independent analysis, not test repeats.
Reviewers may run **uncovered, narrowly selected** tests/probes with authorized
isolated side effects. Report the exact outcome to Main for central preservation;
never run overlapping checks concurrently. If complete evidence is missing,
stale, truncated, conflicting or unsafe to capture, request a specific Main-run
check rather than rerunning a broad suite from a reviewer. Main owns deliberate
repeat experiments for genuinely changed inputs/environment or flakiness and
retains both original and new results with their different experiment labels.

### Oracle sensitivity when adding or repairing tests

For materially changed tests/assertions, especially timeouts, retries,
event order, state transition and failure-path checks, **prove the test fails
for the named wrong behavior**, not only that correct code passes. Name the
smallest counterexample before the repair (e.g. a short backoff concealed by
scheduler wait). Main uses the cheapest safe discriminatory check: previous
failing baseline, controlled fake clock/ticks, negative fixture or temporary
mutation in a disposable isolated workspace. Do not ship mutation code. Keep
actual red/fail and green/pass results with their precise inputs. If running a
counterexample is unsafe or infeasible, record the remaining oracle gap and
falsify the assertion in source; never claim discrimination merely from
repeated green suites. This is triggered by meaningful oracle changes, **not**
mandatory mutation testing for every implementation edit.

## Validation tiers

### Tier 1 — targeted
After implementation/repair: exact regression and direct-owner tests, narrow lint/type/static checks and the smallest deterministic reproduction.

### Tier 2 — section/package
Before independent FINAL_BOUNDED: relevant package/service suite, build/lint/typecheck, representative Section integration and touched migration/schema checks.

### Tier 3 — feature/repository
At final integration or a repository-required gate: applicable full suite, application build, real browser/E2E path, deployment/migration dry run and cross-service checks. These prove existing acceptance obligations, not new flows or infrastructure.

Do not rerun Tier 3 after every local repair. Reuse successful checks on demonstrably identical relevant product/test/config inputs and environment; a new reviewer is not a new test requirement. Local test-only oracle edits use Tier 1/2 unless shared/global test infrastructure changes. Missing evidence stays explicit.

## Checkpoint triggers

When a later Section first consumes a changed serialized/public contract, schema/migration stage, permission/trust boundary, state/concurrency owner, queue/background workflow, deployment/flag or compatibility stage, exercise the producer→consumer composition. Use ordinary causal proof and scope limits; do not re-review every accepted local line.

## Feature and cross-Feature acceptance

Every Feature must prove its original complete business outcome, not just green constituent Sections. Start meaningful composed-path checks as soon as accepted/integrated dependencies exist. Include required failure, cancellation, reentry and lifetime outcomes; distinguish real dependencies from substitutes. Isolated mocks do not prove actual composition. One Section that already proves its entire Feature can supply the same evidence without duplicate contracts/reviewers.

For multiple Features, assess all required results on **one delivered product/test/config candidate**. Check supported combined/sequential use where identity, state, database, queue, cancellation or another shared resource creates a real interaction—even if that shared code did not change. Do not enumerate irrelevant Feature subsets.

Record each Feature's result/head and evidence pointers in existing FEATURE-STATE. Later changes invalidate only affected shared/consumer assumptions, not all predecessor review. The PLAN closes/archives only when **all authorized Features** and required cross-Feature checks close, not after the first Feature succeeds.

## Integration review boundary

Main names remaining **unproven_composition** per Feature: exact material cross-Section/runtime/process behavior not yet established by real tests or valid independent evidence. An empty list means no extra integration reviewer, **not** fewer required checks. Exact package publication plus actual consumer installation/build/tests may already suffice.

For a real gap, send a fresh reviewer one bounded risk face and causal neighbors through the existing Code A route in INTEGRATION mode, using the [integration request](../assets/INTEGRATION-REVIEW-REQUEST.template.md). It is not Section Code A or a Feature-wide A/B pair. Actor identity must be distinct from PLAN reviewers and product writers. Independent risk faces may overlap only on enforced immutable source with separate reports and isolated test effects; otherwise serialize with drift checks. No writer or incompatible reader is active on that candidate.

Check the assigned original journey, interface/state/error/permission interaction or required migration/cleanup/rollout behavior. Admit only change-caused composition defects, necessary faulty dependencies or gaps in existing required evidence. Do not repeat local style review, invent stronger promises, audit unrelated modules or reopen accepted work without concrete combined-behavior evidence. A specialist CLEAN covers only its face; Main assembles full Feature acceptance.

Each original independent Feature integration obligation keeps its cumulative **five-wave** budget across checkpoints and final integration. Shared defects have one causal owner/primary lineage; other Features reference it, not duplicate its budget. Renaming, repartition, moving a failed obligation or rerunning final checks does not replenish allowance. A local Section defect remains in that Section's original budget even when found here. After the integration cap, at most one bounded diagnosis/recovery event is allowed; if the next repair/final check cannot close, stop for the existing owner/Advisor process, not more automatic cycles.

## Evidence failures

Unavailable services/credentials/platforms, flaky environments, wrong selectors and broken harnesses are evidence failures. Correct the local oracle/selector or use a contract-appropriate probe; report remaining gaps. A necessary environment-specific check may be deferred to final integration, not silently waived there. Do not create a generic sandbox/interceptor/test framework without an existing requirement.

For a **costly required suite**, Main first captures complete original output or its complete runner artifact, command/runner, **test process exit status**, candidate and relevant environment/isolation in the existing evidence location. Preserve the tested process's exit code through console filtering. Inspect saved output before retrying; changing grep/tail is not a reason to rerun the same stable full suite. A different runner or missing isolation is a different experiment. Redact secrets without fabricating results.

Separate observation from cause: exit 137 / Killed alone does not prove OOM; current-candidate subset reruns do not prove a pre-existing failure. Use comparable base/candidate conditions or other decisive causal evidence when attribution affects a decision; otherwise leave cause UNKNOWN without a needless baseline rerun. Attribution does not turn a failed/unproven required gate into success. Obtain valid successful/equivalent verification or a genuinely authorized acceptance change. A confirmed material product defect is not-mergeable; inconclusive required validation is insufficient-evidence.

## Evidence applicability and repair stage

Reuse a result only while its actual source/test/config, runtime/environment and consumer assumptions remain applicable. A changed SHA alone is not invalidation; an old CLEAN alone is not current proof.

| Cause/stage | Required response |
|---|---|
| Current unaccepted Section repair | Restore affected A/checks and fresh complete blind B1 plus same-head B2 under [orchestration](reviewer-orchestration.md). |
| New Section legitimately evolving shared code | Its own complete A/B covers the new diff and affected consumers; restore impacted Feature evidence, not every historical predecessor pair. |
| Genuine composition-only defect | Bounded causal-owner repair and affected real-path checks; restore any Section coverage actually invalidated. Do not hide a local defect or reset its budget by labeling it integration. |
| Proven unresolved original accepted-Section contract defect | Return to that responsibility and inherited controls where necessary. If later authorized reviewed work already fixed it, retain the historical escape without synthetic additional passes. |

## Final-head evidence

Record the exact delivered candidate and applicable environment covered by acceptance. Docs/process-only edits do not change product evidence. Later product/test changes close the affected range and checks under the stage table above; a changed current unaccepted Section still needs full independent B, while unrelated accepted predecessors stay accepted.

## Merge readiness

Use **mergeable** only when required behavior, reviews and integration checks pass with no material blocker. Use **not-mergeable** for a known material defect, or **insufficient-evidence** when necessary validation is unavailable/inconclusive. Include base/final head, accepted Sections, Feature/shared results, repairs, checks run/not run, owner decisions and residual nonblocking limits through the existing evidence pointers.
