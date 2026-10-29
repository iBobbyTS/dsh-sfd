# Dynamic SFD execution contract

**Ownership:** PLAN-FULL and stage references define *what* must be achieved; Main selects *how*; the plugin validates actual tool-level transitions and retains one machine state. No global fixed phase sequencer.

## Graph and evidence

```text
plan:A → plan:B → (Subsection impl → scoped R01 checkpoint)* →
Section impl/reconciliation → Code A (selected lenses) → blind B1 →
same-head B2 reconciliation → Section accept → deliver
```

Dependencies prevent accidental skipping. Main can add Sections, Subsections, custom tasks and lenses during execution. Graph rebuilding preserves unchanged valid nodes and invalidates affected downstream nodes. A user-requested Code B waiver changes B1/B2 from required to `waived` and records the authorization and reason; it never fabricates CLEAN. Restore reopens affected acceptance.

Real review evidence comes only from `sfd_actor_start` → terminal `sfd_actor_collect` → an authored report → `sfd_review_admit`; actor success is **not** itself a CLEAN verdict. Plan and code candidates are content/version fingerprinted. Material findings need independent `CLOSURE_VERIFY` evidence. Code B1 does not inherit Code A findings; B2 is a Main same-candidate reconciliation, not a mandatory extra agent call.

## Implementation

- `lib/flow.js`: graph, dynamic revision, readiness, review and waiver semantics.
- `lib/actors.js`: public external-subagent CLI transport, candidate identity, terminal report collection.
- `lib/state.js`: persisted graph and serialized atomic state mutation.
- `lib/workflow-tools.js`: narrow model-facing APIs, no new runtime.
- `lib/tools.js` / `lib/cleanup.js`: existing `sfd_start` and branch/worktree decisions.
- `skills/sectioned-feature-development`: review semantics and user authority.

Programmatic guarantees cover plugin-owned actions, not out-of-band shell or other delegate tools. Waiver origin is prompt-governed rather than authenticated. Review quality remains Main/reviewer responsibility, and accepted predecessor Sections need integration revalidation when shared contracts are affected. Repair actors use the same ES lifecycle but do not add a fixed graph stage; the original Section lineage has five counted repair dispatches before an explicit Advisor/user decision. No automated retries or orphan reconciliation are claimed.