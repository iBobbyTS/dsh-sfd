# Thin graph wrapper design

## Ownership

Main owns plan/scope, graph progress, report meaning, review spawn/send decisions and review targets. The plugin owns compilation, current-graph prerequisite/consistency checks, actual subagent transport and next-step instructions. Its only program-selected assignment is implementation repair routing within the current per-unit implementation cycle.

## Active modules

- [Entry](index.js) registers the skill provider, `/sfd`, scoped host adapter and tools.
- [Compiler](lib/compiler.js) reads canonical Feature → Section → Subsection Markdown and builds complete default obligations.
- [Graph store](lib/graph-store.js) owns graph identity, backup, atomic writes, topology/status validation and true report references; it never changes progress automatically.
- [Session store](lib/session-store.js) owns actual actors/rounds/groups/pages and the current implementation-cycle index in ACTORS.json. This is dispatch lineage, not a second acceptance state.
- [Execution](lib/execution.js) prevalidates and dispatches batches, selects impl repair actors, records real transport facts, waits/reads/continues/responds/cancels/observes and never infers review outcomes.
- [Guidance](lib/guidance.js) explains current report handling, effective successors and concrete ready Main-stage duties. Summaries name actions without repeating their duties; first-role authority adds applicable references, not another root skill copy. Reviewer candidates are suggestions, never dispatch restrictions.
- [ES transport](lib/es-cli.js) is the sole process boundary; [scoped host](lib/scoped-host.js) manages current-session activation; [skill provider](lib/skill-provider.js) serves canonical bytes plus the separate DSH addendum.

## Plan versus process changes

PLAN-FULL owns functional scope, Feature/Section/child membership, implementation tiers and declared dependencies. Remove/change functionality there, compile again and reconcile evidence/waivers against the old graph. Canonical graph ownership/dependencies continue matching that current plan.

The graph owns execution progress and added workflow obligations. Main can skip **any** process node with `skipped_by_user` plus user source/reason, add custom review/repair nodes and edit their extra prerequisites. A skipped task does not implicitly skip its unfinished ancestors and is never CLEAN. Reopen guidance lists completed descendants and preserved skips; Main decides which evidence applies and edits progress.

Unchanged compile validates and returns navigation without writing. Changed compile backs up the old graph and writes a pending graph with reconciled=false. Main restores only still-valid evidence/waivers and explicitly reconciles; no automatic invalidation/retention engine is introduced.

## Review dispatch

Main selects fresh spawn or a known review actor to send. There is no reviewer continuity rejection, replacement declaration, first-pass-name prohibition or role/Section-based send-target enforcement. The canonical skill explains why independence/continuity may matter, but Main decides the current assignment. A task still needs pending/failed status, satisfied graph prerequisites, a real known actor/session for send and no live overlapping work. Review contexts remain distinct from implementation task kind.

Actor current scope follows a selected send; each real round keeps its actual node/role. Old rounds and reports remain available. A newer reviewer does not make an older known actor unselectable.

## Implementation cycles

Implementation dispatch declares purpose=implementation or repair. Spawn defaults to implementation; send defaults to repair, with an explicit custom node purpose used when present. New implementation requires its planned tier and begins a new cycle for that owning unit. Repair never rewrites the plan tier.

ACTORS.json stores `implementationCycles[unit] = {original, repair, repairRoute}`. For original large, repair=original. For original std, repair starts empty; first repair spawns one large actor using an explicitly supplied large route and saves it. Later repairs always continue that actual actor, even if Main calls spawn or names the original std actor in send. The next explicit new implementation resets the index; old actors remain history. Children have independent unit cycles.

A caller may save repair_route on new implementation or supply route/repair_route at the first std repair. The program fixes the logical repair tier and session but does not invent concrete models or inspect external preset contents. Missing routes give actionable instructions. Known unknown spawn outcomes prevent duplicate implementation dispatch until actual task facts are reconciled. Unsupported repair continuation reports a capability gap without silently replacing its session; a definitively rejected new-implementation send does not end the existing cycle.

## Reports and instructions

A node marked done references real actor/round/report evidence; a Main node supplies reason. Reports must be complete and successful with a settled batch. Cross-node report sharing also records `evidence.conclusion`, explicitly accounting for that additional obligation. This permits one final child checkpoint report to satisfy parent reconciliation without a redundant physical call; report text is never parsed for automatic approval.

Wait/result first instruct Main to inspect and record returned reports, not to redispatch nodes whose progress is still pending. Successor actions carry concrete stage instructions, including risk selection/specialists, same-head repair reconciliation, Section finding/check/integration closure, residual Feature composition checks and final delivery/actor cleanup. User-waived steps stay waived; no step-specific skip API is introduced.

## Runtime and packaging boundaries

Batches validate before dispatch and checkpoint IDs, cycle selection and message UUIDs before the next irreversible call. Continuations verify the same actual session and reject stale receipt/result reuse. Wait runs outside the state-write queue so observe/cancel remain usable. Pending responses preserve actual effective policy outcomes and require fresh wait.

Per-agent activation/hiding uses replayable host membership; peers remain unaffected. The package allowlist ships only the nine active modules and canonical snapshots. Fake ES and real Cordis registry/scope tests establish the local contract; real installed DSH/ES activation/resume/CLI behavior remains a separate end-to-end check.
