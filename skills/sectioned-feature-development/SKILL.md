---
name: sectioned-feature-development
description: "Plugin-driven Sectioned Feature Development for DSH: the /sfd command and sfd_* tools own scheduling, accounting, gates and dispatch; the main agent owns semantic judgment, finding admission and acceptance. Use for nontrivial implementation or repair with cross-owner, state or interface changes, unclear impact, or failed whole-change convergence. Not for an exact local fix solely because its file is risky."
---

# Sectioned Feature Development (plugin flow)

The DSH plugin `@ibobbyts/dsh-sfd` owns everything mechanical: state
(`sfd-state.json`, program-only), workspace cleanup, branch creation, actor
dispatch, wave counting, hard gates, reports to disk, commits via
dsh-git-commit, notifications. You — the main agent — own semantics only:
planning, finding admission, rework judgment, acceptance. Never reimplement
what a tool does; if a tool rejects a call, a gate is speaking.

## Starting and resuming

- `/sfd` (user) or a matching request (you may self-activate): the command
  detects state and injects either a **resume brief** or a **start handoff**.
  Both begin with reading this skill.
- New run: you must know the task first. If the session has no task context,
  ask the user what to build — never invent one. Then call `sfd_start` with a
  one-line `taskSummary` (and optional `slug`). The tool runs the cleanup
  decision table (cards), switches the workspace back to main when the user
  chose a main base, executes fast-forwards, and hands you the resolved
  intent plus any text the user typed into a card (`userNote`). **You** name
  and create the feature branch (handle duplicate names; ask the user when
  needed); if the user chose to stay on / branch from the current branch,
  honor that. Do not switch branches before `sfd_start` hands the base
  decision back to you.
- Resume: the brief states phase, open findings, budgets, pending decisions,
  and ES actor reconciliation. Reconcile listed actors (result/close), then
  continue from the stated phase. State drift (branch / HEAD mismatch, or the
  recorded plan file missing) blocks; offer the user options.
- No hash accounting anywhere: never record, recompute or check content
  hashes (sha256 etc.) of plans, advisor requests/results or any artifact.
  Identity is path + git state + the user's explicit disposition, never a
  digest.
- Only on **self-activation** must the first proportional plan be approved by
  the user card before plan review; explicit `/sfd` skips that pause.

## Phase model and your duties

| Phase | Program (plugin) does | You do |
|---|---|---|
| CLEANUP | decision-table cards, dirty-workspace commits (gitCommit), switch-to-main / fast-forward ops, intent + userNote handoff, state write | name and create the feature branch per the handed-back intent (handle duplicates, ask when needed); for a diverged branch merge and resolve conflicts, then `sfd_start` again; decide next steps from any `userNote` |
| PLAN | injects template + knowledge index for this phase | identify Features/Sections from the request; write REQUIREMENTS.md and PLAN-FULL.md (markdown, never big JSON); plan structure is validated programmatically before review |
| PLAN_REVIEW | serial A→B dispatch (ES zcode glm-5.3 max / ES codex), material-wave counting, ≥2 waves → hold + advisor; evidence bundles pre-assembled | admit/reject findings (each with evidence in the bundle); author bounded PLAN_DELTA repairs; both independent coverages must close before any implementer dispatch (hard gate) |
| IMPL | deterministic TASK extract, dispatch impl_std (ES zcode deepseek-flash) or impl_large (ES codex), inline prompts with file contents, failure protocol (queue-continue → 5 min → retry → Feishu + block) | the one decision point per section: completeness + review-panel routing (first by risk, then reuse); write supplementary content in your answer, program merges it into the task file; you never edit task files directly |
| COMMIT | gates (terminal result, HANDOFF required fields, declared checks, diff within scope), then `ctx.gitCommit.commit()` (retry 1×, fallback to you) | semantic rework judgment (rare): redispatch with fresh context |
| CODE_REVIEW | serial lens dispatch, wave budget 5/section, closure verify, B1 blind prompt construction, B2 same-candidate check | finding verification, clustering, admission, closure verdicts — using the pre-assembled evidence bundles |
| ACCEPT | final journey checks, archive on completion | prove each Feature journey; required failures block readiness |
| ADVISOR (any) | freeze, render diagnosis, advisor_pack, Feishu, **whole flow holds** | nothing until the user brings results back; then decide next step and resume |

## Hard rules

- Zero parallelism: every dispatch is serial, one actor at a time.
- Actor "running failure" = infrastructure (network/MCP). Agent loops are NOT
  failures — manage them with the observe tool; the panel shows facts.
- Reports land in `.agent-work/reviews|handoffs/` and are injected into your
  context; read them, don't re-read disk.
- Markdown for every human artifact; JSON only in `sfd-state.json`.
- Human may direct re-dispatch with route override parameters.
- The old manual flow is retired: never follow narratives from pre-plugin SFD
  documents if you encounter them.
- Cross-repo sections: a section contract may declare `- Repository:` (omitted
  = current repo). All state and artifacts stay in the primary repo's
  `.agent-work/`; an external repo never gets `.agent-work/`. The plugin does
  not manage git state there — you manage its branches and commits yourself
  (no extra user authorization needed), under the same naming rules.

## Knowledge base (read on demand, by stage)

Planning references live with this skill under `references/`:
[Section planning](references/section-planning.md),
[planning router](references/planning/router.md),
[reviewer orchestration](references/reviewer-orchestration.md),
[bounded review](references/bounded-review.md),
[integration and testing](references/integration-and-testing.md),
[artifact lifecycle](references/artifact-lifecycle.md),
[advisor escalation](references/advisor-escalation.md).
Read the named authority when a stage first applies; reuse text already in
context; reacquire after compaction or takeover.
