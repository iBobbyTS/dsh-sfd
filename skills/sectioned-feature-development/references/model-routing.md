# Task–model routing

The dispatch profile embedded below is this host's only execution route.
Main chooses a **logical implementation tier**; the embedded profile fixes each concrete route — native rows name the host agent, external rows name an installer-managed spawn preset carrying subagent, model, effort, permission mode and the role's developer instructions ([external-subagent.md](external-subagent.md)).
This is a requested policy, not a claim of cost-optimal capability.

<!-- installer: begin dispatch-profile embed -->
This host's profile is [dispatch/dsh.md](dispatch/dsh.md), distributed by the
`@ibobbyts/dsh-sfd` plugin: every external row names an installer-managed
spawn preset (`sfd-*`), A on the zcode runtime and B on the codex runtime.
<!-- installer: end dispatch-profile embed -->

## Logical implementation tiers

| Tier | Task family | Selection |
|---|---|---|
| impl_std | The acceptance contract is frozen at real owner/consumer boundaries; each governing invariant has a decisive per-path oracle, or a complete feasible joint oracle for a single-owner state bundle; implementation choices and false-clean repair stay local to that owner. An in-repo analogue is useful evidence, not a prerequisite. | the embedded profile's impl_std route |
| impl_large | The accepted contract is frozen, but novel correctness-critical structure or algorithms still require reasoning not bounded by a decisive oracle, the coupled state bundle lacks a complete joint oracle, or a false clean would cause cross-owner rework. | the embedded profile's impl_large route |

Three risk questions set the tier; speed, price, token rate, file count and implementation novelty *alone* do not.
(1) **Decision authority**: unresolved user/owner semantics go back to PLAN/owner, not to either implementer to invent.
Freezing observable behavior and real consumer contracts does not freeze private helper types, library calls or internal code structure; normal implementation choices do not force impl_large.
Novel correctness-critical architecture or algorithm decisions *not bounded by the available oracle* do.
(2) **Invariant visibility**: independently falsifiable paths favor impl_std.
An inseparable state bundle may also be impl_std when it has one state owner and a pre-dispatch, decisive and feasible joint oracle covering the relevant ordered events, state transitions and failure/late/cancel outcomes.
A vague promise of integration testing or a partial joint oracle is not sufficient.
Cross-owner async or transactional invariants without such containment select impl_large.
(3) **False-clean rework radius**: when a missed defect can be repaired inside the same owner without changing consumer contracts, impl_std risk is contained; when it forces cross-owner rework, select impl_large.
Evaluate multiple requirements mutating one state lifecycle as a bundle, not as separately green paths.

Decide the tier only after assessing the achievable contract and oracle.
Prefer impl_std for any qualifying bounded unit, including a first implementation without an in-repo analogue or a multi-file change.
Frozen input×state×outcome tables, event fixtures or accepted precedents can establish a decisive oracle; a precedent is optional.
Do not prewrite implementation details to create artificial certainty.
Keep unresolved coupled correctness reasoning or cross-owner repair risk on impl_large; if the bundle cannot be independently falsified, keep it atomic rather than splitting it to force cheaper children.
Coarser impl_large units are not inherently wasteful.
Do not automatically trial impl_std on an unqualified task just to escalate it after failure.

Before PLAN review, every parent and every executable child records its own Implementer (`impl_std` or `impl_large`), rationale and existing task evidence: a concrete analogue or none; resolved/bounded/owner-unresolved ambiguity; actual producer→normalizer→store→projection→consumer semantic hops; local/shared async or transactional ownership; whether each invariant is independently falsifiable or needs a complete joint oracle; decisive/partial/missing oracle and its feasible checks; novel correctness reasoning and the consequence of a false clean.
Parent assignment does not fill a missing child assignment.
A two-line concurrency bug may be large; line count or a security label alone does not determine a tier.
Never split through an invariant bundle to force a cheaper role — [subsections.md](subsections.md) defines legitimate cost-motivated splits.

A fresh current plan uses only the two current tiers. Do not rewrite archived plans. The logical tier and its route are plan records; the TASK packet carries no routing metadata.

After a failure first distinguish model/semantic, plan/requirement, environment/tooling and evidence gaps.
Only genuine semantic under-routing supports upgrading unresolved work.
Record the evidence and adjust affected remaining assignments through a bounded plan delta; never reset accepted work or exhaust a manufactured model ladder.
Runtime/auth/MCP errors are not reasons to change model.
Missing external configuration blocks the planned route.

## Bounded exploration

Use the embedded profile's explorer route for one bounded owner/consumer/test map when cheaper than main reading directly.
Respect applicable CodeGraph exploration rules.
Return path/symbol/line, source head, claim→evidence, unknowns and a suggested next read directly in the final answer; usually at most eight source pointers, with an explicit truncation note when necessary.
The explorer writes no report file and never touches `.agent-work`.
No product decisions, plan rewriting, acceptance or nested subagents.

Requested and observed model/effort are separate facts recorded in the existing ledger fields; whether a wrong-route result may fill an intended slot is judged when the result returns ([reviewer-orchestration.md](reviewer-orchestration.md)), optional cost analysis may consume the same facts through [efficiency notes](efficiency-checkpoints.md), without an extra per-Section checkpoint.
No extra production experiments are authorized for measurement.

## Route substitution

The embedded profile fixes each route.
A user-specified route at call time overrides its row for that call: follow the user's request, record the requested and runtime-admitted values, and never relabel the substitution as the profile's default.
Independent coverage still shares blind spots: verify with concrete source-derived counterexamples rather than count agreement.
Do not split one invariant into artificial cheap tasks to route around the table.

## Escalation

There is no model-level advisor route.
For a genuinely unresolved cross-owner/state contract, repeated semantic failure after one evidence-producing correction, contradictory reviewer remedies, or a missing decisive oracle, escalate one bounded question to the external advisor ([advisor-escalation.md](advisor-escalation.md)) — the PLAN advisor at plan stage, the CODE advisor for a repair lineage.
An advisor analysis is not a third reviewer appended to every feature, and a solved spelling change or a CLI configuration error is never an escalation.

Each escalation needs a specific unresolved question, consequence, bounded evidence and exit criterion.
A budget trigger pauses and diagnoses; it never makes CLEAN optional.
Do not infer money or subscription quota from API list prices.
Compare physical calls, cache-aware usage, wall time and accepted outcomes only when the same task/head/harness/account evidence supports it; aliases do not prove an exact model release.
