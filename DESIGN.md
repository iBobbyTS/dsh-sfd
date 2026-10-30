# Thin graph wrapper design

## Ownership

Main owns the plan, graph progress, semantic dispositions, model routes and acceptance. The plugin owns compilation, canonical review/acceptance structure, order validation, actual subagent transport and instructions. It does not parse reports, infer findings, choose models, invalidate evidence, or decide whether a review passed.

## Modules

- [Entry](index.js) registers the skill provider, non-mutating `/sfd` command, scoped host adapter and tools.
- [Compiler](lib/compiler.js) reads canonical Feature → Section → Subsection Markdown and produces deterministic graph nodes with located structural errors. A declared subsection always gets an implement node and a checkpoint review.
- [Graph store](lib/graph-store.js) owns `SFD-GRAPH.json`, `SFD-GRAPH.prev.json`, atomic writes, structural comparison, backup and validation. It never changes statuses.
- [Session store](lib/session-store.js) owns actual actor/round/group/page facts in `ACTORS.json`; it does not own progress.
- [Execution](lib/execution.js) owns spawn/wait/result/send/cancel/observe, partial-dispatch facts and graph prerequisite checks.
- [Guidance](lib/guidance.js) generates role-specific instructions, first-role authority and the next mandatory review.
- [ES transport](lib/es-cli.js) is the sole active process boundary. [Scoped host](lib/scoped-host.js) owns activation/hiding. [Skill provider](lib/skill-provider.js) serves exact canonical snapshots plus the separate adaptation.

## Graph and progress

One per-session editable graph is the progress authority. Nodes have stable IDs, canonical `needs` and `mandatory` flags. Main edits `status`, `evidence` and `note` directly. The compiler-generated topology is immutable except that Main may add custom nodes and extra prerequisites.

`status` values:

- `pending` / `failed`: not satisfied;
- `done`: satisfied; review/implementation requires real actor/round/report; Main node requires a reason;
- `skipped_by_user`: the only skip; requires user provenance and reason; satisfied for order but not CLEAN.

The graph validation rejects missing/mutated mandatory nodes, removed canonical prerequisites, cycles, unknown prerequisites, done nodes whose prerequisites are unsatisfied, and review evidence that is not a settled successful authored report.

## Compile and backup

Compilation is deterministic for the current plan and canonical structure. If the target already has the same plan digest and canonical topology, compile returns `already up to date, do not compile again` and does not write, reset status or back up. Progress and custom nodes survive.

If the plan/structure changed, the previous target is copied to `SFD-GRAPH.prev.json` (overwriting an earlier backup), a pending graph is written to `SFD-GRAPH.json`, `reconciled=false`, and the result instructs Main to compare previous graph, new graph and `PLAN-FULL.md`. Main copies only still-valid evidence, leaves affected work pending, sets `reconciled=true`, and continues. There is no automatic invalidation or evidence-cone calculation.

A plan edit without recompilation is detected by the graph plan digest; spawn/send reject stale execution.

## Dispatch and evidence

Spawn prevalidates every task before the first RPC: node exists, not done/skipped, every prerequisite done/skipped, no live actor on the node, valid route and assignment. It never changes status. Partial dispatch preserves actual created IDs and uncertain/unattempted failures without retry or automatic cancellation.

Wait expands all batch peers, applies only the requested rounds, and withholds result instructions until every target ends. Partial targets list remaining IDs; failures, pending input, cancellation and abnormal exits are not successful evidence. The graph remains untouched.

Send continues the same real session. It requires a pending node, satisfied prerequisites, settled actor group, verified session identity, matching kind/role and the owning implementation unit; base blind and first-pass Plan reviews require fresh spawns. It never changes graph status.

## Mandatory reviews and guidance

The graph carries Plan A/B, Section Code A/B, subsection checkpoints, parent reconciliation, Section/Feature acceptance and delivery. `section:accept` depends on the Section reconciliation and Code B chain; `S01.B:implement` depends on `S01.A:checkpoint`. No report keyword or terminal process status satisfies acceptance.

The first return for a role/layer supplies canonical handling text. Later returns are short state-specific instructions with actual actor/session IDs and graph successors. Wait and result explicitly name the next mandatory review, including blind Code B and subsection checkpoints, but never mark it done.

## Transport and host scope

Every batch item is validated before the first spawn. Known IDs and uncertain operations are kept. Wait polls outside the actor-state write queue; observe/cancel remain usable. UUID-bound send receipts, result pages and session identity prevent stale replies from fabricating new rounds.

Activation uses per-agent tool restrictions and a non-invocable ES skill shadow. Replayable membership restores effects; other sessions remain unchanged; unknown/same-layer restrictions fail honestly. Raw shell bypass, already-seen prompt content and residual MCP instructions are outside the hiding guarantee.

## Packaging and evidence

The package allowlist ships the nine active library modules and canonical skill snapshots. Historical source/tests remain in the repository but are not part of the active package or official test entry. Fake ES plus actual Cordis scope/registry integration verify the local contract; real installed DSH/ES behavior remains a separate end-to-end check.
