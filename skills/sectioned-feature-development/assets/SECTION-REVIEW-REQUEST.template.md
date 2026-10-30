# Bounded code review request

Review {BASE..HEAD} in {repository} against the owning Section contract (Feature supplies relevant business intent, not another A/B parent).

Omit untriggered fields; missing evidence remains UNKNOWN.

- Mode: {INITIAL_BOUNDED / FOCUSED_FIND / VERIFY_FINDING / CLOSURE_VERIFY / REPAIR_DELTA / SUBSECTION_DELTA / PARENT_RECONCILIATION / FINAL_BOUNDED}.
- Lens: {primary R01–R12, optionally one tightly coupled secondary; NOT_APPLICABLE for Verify/Close/B}.
- Coverage guide (with Lens): {assigned anchors from [risk routing](../../code-review/references/review-routing.md#twelve-candidate-lenses)}.
- Candidate: {pinned base/head or content-addressed immutable source/test/config manifest, staged/unstaged/untracked reconciliation, edit/inspect cone}; BASE..HEAD alone excludes dirty work.
- Authority: {business Feature ID and relevant journey, independently accepted Section ID/contract, inherited child scope when used, shared invariants, non-goals, supported environment, repository rules}.
- Checks: {exact head/environment, results and gaps}.
- VERIFY_FINDING: {claim IDs, source/trigger, authority, requested disproof}.
- CLOSURE_VERIFY / REPAIR_DELTA: {Bug IDs, accepted SIMP-### actions, triggers/preservation oracles, repair delta, consumers, invalidations, newly triggered risks}; report distinct NEW_DELTA_FINDING separately from old Bug/SIMP outcomes.
- SUBSECTION_DELTA: {Section/child, new delta, shared invariants, safe intermediate state, consumer, R01 coverage}. PARENT_RECONCILIATION: {cumulative children, changed prior paths, joint oracle, consumer}; both may share a real last-child call when each result is proven (see [subsections](../references/subsections.md)).
- FINAL_BOUNDED B1: {complete latest diff/contract/checks}; no A findings, SIMP IDs, repair-delta bounds or narratives. Freeze B1 first.
- B2 in the B1 session's continuation: {same candidate, frozen B1 report, Bug/SIMP IDs, closure evidence, repair impact and invalidations}; a fresh B-route session with recorded gap only when it cannot continue. No new mode, reviewer or file.
- Report: {unique path}; [delegated fields](../../code-review/references/delegated-pass.md#report) and mode-specific outcomes.

For INTEGRATION use the separate [request](INTEGRATION-REVIEW-REQUEST.template.md) and [delegated scope](../../code-review/references/delegated-pass.md#scope).
