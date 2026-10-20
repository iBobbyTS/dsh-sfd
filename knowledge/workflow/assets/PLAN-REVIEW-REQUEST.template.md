# PLAN review request

Review `{plan path}` at `{candidate reference}` against `{original requirements and repository constraints}`.

- Feature partition / shared owner / journey: {one or more observable business outcomes, member Sections, actual end-to-end oracles, independent shared producers and cross-Feature constraints}.
- Scope / exclusions: `{business outcome, owners, supported environment}`.
- Evidence: `{source base, selected boundary examples, relevant guide links}`. Inspect source to falsify suspected defects; do not reread all catalogs or prescribe new requirements.
- Mode: {full bounded PLAN review / PLAN_DELTA}.
- For PLAN_DELTA only: `{previous candidate → current, admitted IDs, changed owners and invalidated conclusions}`. Do not reopen unchanged scope. Use the existing [finite recheck rule](../references/section-planning.md#finite-recheck-rule); the report below uses the same signals and [candidate classes/evidence](../references/section-planning.md#candidate-classes-and-admission).
- Report: write the full review to `{dispatched report path}` (your only writable `.agent-work` location) — signal, candidate reference, covered boundaries, gaps and batched root causes; separate PLAN_BLOCKER / OWNER_DECISION from PLAN_SCOPE_EXPANSION / PLAN_NIT; do not invent private helper names as requirements. Final answer: signal, report path and one-line status.

Check that peer Sections retain independent Code A/B, only true internal Subsections are checkpoints, no Feature-wide A/B is manufactured, and each Feature has its actual composed acceptance path. State missing evidence rather than manufacturing a completed check.
