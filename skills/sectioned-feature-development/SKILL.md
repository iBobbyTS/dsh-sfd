---
name: sectioned-feature-development
description: "DSH dynamic Sectioned Feature Development with mutable graph, independent review evidence, guarded transitions and explicit user waivers."
---

# Sectioned Feature Development — dynamic runtime

Main decides *what to do and why*; the DSH plugin remembers *which required steps actually happened*. This is not a fixed-stage controller. When an SFD tool rejects a transition, resolve the missing evidence; do not bypass it by manually editing machine state.

## Start, progress, review

- `/sfd` resumes without recreating the flow. `sfd_start` handles prior workspace/branch-base choices; Main establishes the authorized non-main feature branch and writes `.agent-work/REQUIREMENTS.md` and `PLAN-FULL.md`.
- Main calls `sfd_flow_init` once with true Section IDs/dependencies, implementation profiles, and genuine Subsections. Later revisions use `sfd_flow_revise`; resume by `sfd_flow_status`. Never hand-edit `.agent-work/sfd-state.json`.
- Plan review A closes before independent Plan B; both precede implementation. Each declared Subsection gets an independently executed R01 scoped checkpoint before its dependent child. Parent reconciliation checks cross-child invariants and consumer behavior.
- Final Code A needs complete R01 and selected independent specialist coverage. Set risk lenses with `sfd_flow_revise(action="set_lenses",...)` when the actual diff requires them. Code B1 is an independent **blind complete review** only after A findings are resolved. B2 reconciles repairs/invalidated evidence on the same head; don't invent an extra reviewer call when no work remains.
- Dispatch `sfd_actor_start(taskId,assignment,lens?)`, collect via `sfd_actor_collect(actorId)` until terminal, read the original report, and use `sfd_review_admit` or `sfd_task_finish`. Actor spawn success, running status, unclosed report or model's bare CLEAN claim is insufficient evidence.
- To repair admitted material findings, dispatch `sfd_actor_start(taskId="S01:repair",assignment="...")`; it uses the Section implementer route and consumes one of five cumulative repair waves. Collect its real terminal result. Material finding closure requires a real independent `CLOSURE_VERIFY` result plus specific Main decision via `sfd_findings_close`. After code repairs, re-establish invalidated Code A/B evidence. `sfd_section_accept` checks A, B1/B2 (or user waiver), tests and feature path; `sfd_flow_complete` requires all Sections and no unresolved material findings.

## Dynamic work and authority

- Main may insert extra steps, Sections or Subsections at any time, without rebuilding completed unaffected work. Insert tasks ahead of their consumers to make their execution mandatory. Risk-based local investigation is always free.
- Only an explicit **user** instruction permits `waive_code_b` or `restore_code_b`. Pass `authorization:"user"` plus the authentic user reason. Program stores this as a recorded instruction, not an identity-proof; Main cannot invent consent. Waivers affect only Section B1/B2, never Plan A/B, Code A, required checkpoints or testing. Acceptance must say `ACCEPTED_WITH_WAIVER`, not CLEAN.
- Cancel active B actors, then collect terminal status before revising. Do not treat cancellation request as completion. No unverified concurrent writer/reviewer on the same mutable candidate. Missing ES runtime/profile blocks that specific dispatch; do not fake a fallback.
- The plugin cannot guard unrelated bash/MCP dispatch. Run SFD work through its named tools. Main owns implementation delegation, acceptance semantics, tests, commits and delivery; no automatic push.
- Advisor is external and human-mediated after a real trigger, not another reviewer. Use its existing [authority](references/advisor-escalation.md) when applicable.

Read only the currently triggered [Section planning](references/section-planning.md), [Subsections](references/subsections.md), [Reviewer orchestration](references/reviewer-orchestration.md), [Bounded review](references/bounded-review.md), [Integration/testing](references/integration-and-testing.md), or [planning router](references/planning/router.md) guide. Preserve original reports and meaningful scope guarantees, but avoid secondary state stores and routine cost diaries.