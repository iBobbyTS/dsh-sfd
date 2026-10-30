---
name: code-review
description: "Evidence-based review of a PR, commit range, section or repair delta. In delegated sectioned-feature-development mode, execute one bounded checkpoint, reconciliation or full pass and return candidates/coverage without taking over admission, implementation or acceptance."
---
# Code Review

## Select execution context first

- DELEGATED_PASS: parent provides a frozen packet; read
  [delegated-pass.md](references/delegated-pass.md). This path overrides
  standalone loops/acceptance. The SFD Main selects lenses using
  [review routing](references/review-routing.md); child reviewers follow
  the assigned lens and consult only its matching evidence checks.
- `STANDALONE`: direct user review request; follow [standalone-workflow.md](references/standalone-workflow.md). Default review-only; no repairs without authorization.

In a delegated pass, no product/test/worktree writes **except the single
explicitly authorized .agent-work review report file**; no nested reviewers,
changed requirements, invented test authority or acceptance verdict.
Report candidates, causal evidence, checks and inspected boundaries.
One code-review invocation is one pass, not a second orchestrator.

Load [review-coverage.md](references/review-coverage.md) for the assigned
coverage and [ai-agent-risk-catalog.md](references/ai-agent-risk-catalog.md)
only for triggered patterns. Do not read every lens or treat a
specialist no-finding result as full-candidate CLEAN. Historical review loop documentation is standalone-only.

## Role, provider and parent handoff

`$code-review` is this review method, not a provider alias. Never forward a delegated task to another reviewer or transport, and never relabel a result as another provider's. Main owns dispatch, rounds, admission and the release of successors.
