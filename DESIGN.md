# Thin wrapper design

## Canonical owners

- [Entry](index.js) registers the skill provider, non-mutating `/sfd` command, scoped host adapter and wrapper tools. It does not register cleanup/Git controllers or native-child orchestration.
- [Compiler](lib/compiler.js) reads the canonical Markdown grammar and produces located Feature/Section/Subsection dependencies and review/acceptance nodes. Structural validity is not semantic approval. A separate evidence digest ignores only trailing blank lines; substantive source changes still advance the plan-source revision.
- [Obligation declarations](lib/obligations.js) compose Main-authored runtime obligations into that graph. This is a graph overlay, not a finding database or repair scheduler. It validates owners, dependencies, cycles and real source/continuation identities. Main selects the actual route, admits findings and decides which obligations exist.
- [Execution](lib/execution.js) owns order checks, actual actors/rounds, dispatch groups, evidence receipts and explicit Main dispositions. [Guidance](lib/guidance.js) generates role/hierarchy/session/successor instructions from those same records and the canonical authority; it does not maintain a second workflow state.
- [Run store](lib/run-store.js) serializes one schema-3 session/repository record. [ES transport](lib/es-cli.js) is the sole active process boundary. [Scoped host](lib/scoped-host.js) owns activation and raw-tool hiding. [Skill provider](lib/skill-provider.js) serves exact canonical snapshots plus the separate adaptation.

## Source and graph updates

The plan is reread on execution entry and after order failure. Invalid compilation leaves the last valid graph and records staleness, but cannot authorize stale dispatch. Source changes invalidate affected unit/shared-contract/dependency cones. Plan evidence is handled separately: provisionally reopened Plan A/B can be restored only by real original-session rechecks or Main's explicit `retain` of previously accepted unaffected actor/round evidence. Retention never changes the original report revision or invents an invocation.

Completed nodes removed from the current plan keep historical dispositions. They do not become unaccepted ghost Sections. Unmet removed nodes remain retired obligations requiring explicit user-authorized disposition. Live actors remain actual recorded work, never silently cancelled or erased. Open-Section safety continues to derive from actors and acceptance rather than a sticky ownership controller.

Dynamic obligations are reconstructed on source recompilation and reapplied after specialist selection. Main can revise their dependencies atomically, with real prior evidence invalidated where necessary. Retired mandatory delivery gates survive this reconstruction. Runtime graph edits do not masquerade as new plan-source revisions or blanket-invalidate unaffected code.

## Roles and session relationships

Main-authored purposes distinguish integration, focused discovery, skeptical finding verification, owner repair, finding-author closure, child repair delta, plan delta and same-head repair reconciliation. Session checks are mechanical consequences of those declarations, not report interpretation:

- Original impl_large repair returns to its actual owning implementer. Original impl_std repair uses one fresh logical impl_large session and then reuses it; selection uses the recorded original role, not a later edited plan tier. Predeclared repairs resolve that real target again at dispatch time.
- Closure/delta/reconciliation uses the declared discovering session. Plan A/B first-pass contexts are independent; affected plan rechecks use their original sessions. One parent R01 session continues across children and parent reconciliation.
- Code blind first-pass discovery always spawns a fresh session. A continuation cannot be relabelled as a new blind review. Same-head reconciliation requires the current Main-confirmed B1 report, not an old candidate's reviewer. Main updates its source after a fresh B1 restart.
- The final child checkpoint can explicitly cover parent reconciliation in one physical call. The report carries both declared obligations, and Main separately confirms both conclusions in graph order. Arbitrary report sharing is rejected.

A required session that cannot continue can be replaced only through Main's explicit recorded-gap spawn: the old actor must be terminal, the route must match its recorded route, the frozen-evidence pointer and real old/new IDs remain distinct, and the same lineage gets only one replacement. Future continuations resolve that recorded actual target. Historical report origins survive later failed rounds without turning those failures into successful evidence.

The wrapper has no model-routing table, repair-wave counter, report verdict parser, automated repair dispatch or parallel finding/closure ledger. Main still declares all genuinely required closure/risk/check obligations, applies the skill's budgets and judges exact coverage and semantic acceptance.

## Transport and concurrency

Every batch item is validated before the first spawn. Only actual created IDs are recorded. Pending non-idempotent mutations and known IDs are checkpointed before another mutation. Partial dispatch is reconciled explicitly by Main, without automatic retry, cancellation or rollback.

Wait has prepare/poll/apply phases: remote polling runs outside the write queue; apply validates the exact actor round and never rolls terminal state back to running or accepts an older continuation result. Message UUIDs, original session identity, complete contiguous result pages and delivered receipts prevent stale results or a lost-send reply from fabricating completion. Unsupported continuations remain explicit gaps.

Wait expands requested IDs to their batch peers. All must terminate without unresolved input/transport state before group result handling. Remaining IDs and raw failures remain visible. No report counts as accepted without Main's explicit disposition; failed/cancelled/partial/empty reports cannot be used as successful evidence.

Sections are serial. Writers never overlap incompatible actors; concurrent reviewers require Main-declared enforced immutable source with isolated reports/test effects. Yolo is not filesystem isolation. Observe and explicit cancellation use read-only ledger snapshots and forward to ES without a competing cancellation state or a long-held run lock. `sfd_cancel` only cancels its explicit list; it never expands into automatic peer cancellation or graph edits.

## Instruction delivery and host scope

Guidance names actual actor/session IDs, owning unit/Section/Feature, proper original or escalated repair sessions, discovery/continuation rules and direct graph successors. Applicable canonical handling text is sent on first role/layer delivery; later rounds receive concise state-specific hints. Main-only next-stage instructions are available before the ready gate is confirmed. Suspected loops, no progress and abnormal exits retain a diagnostic branch during partial waits.

Activation uses supported per-agent tool restrictions and a non-invocable runtime ES skill shadow. Effects restore through replayable membership events and dispose with the agent/plugin. Other sessions remain untouched. Same-scope/unknown registrations fail honestly; residual MCP prompt instructions, already-seen content and raw shell bypass are documented limits, not reasons to rewrite host prompts.

## Distribution and evidence boundaries

Canonical skill resources are unchanged snapshots; their manifest verifies exact bytes independently of the adaptation. The explicit package allowlist ships only the nine currently reachable library modules, not historical cleanup/state/flow helpers. Historical source/tests are preserved in the repository rather than deleted or silently promoted back into runtime support.

Verification uses fake ES, actual Cordis registry/scope integration, negative evidence tests, syntax/import checks, canonical snapshot comparison and package inspection. Real installed DSH/ES activation/resume/CLI behavior still requires a separately observed end-to-end run; no installation, restart or GUI replacement is part of repository verification.
