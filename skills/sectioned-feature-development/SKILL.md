---
name: sectioned-feature-development
description: "Plugin-driven Sectioned Feature Development for DSH: the /sfd command and sfd_* tools own scheduling, accounting, gates and dispatch; the main agent owns semantic judgment, finding admission and acceptance, plus workspace preparation before start (dirty handling, branch-base decision, feature-branch creation per the mandatory decision table). Use for nontrivial implementation or repair with cross-owner, state or interface changes, unclear impact, or failed whole-change convergence. Not for an exact local fix solely because its file is risky."
---

# Sectioned Feature Development (plugin flow)

The DSH plugin `@ibobbyts/dsh-sfd` owns everything mechanical: state
(`sfd-state.json`, program-only), actor dispatch, wave counting, hard gates,
reports to disk, commits via dsh-git-commit, notifications. You — the main
agent — own semantics — planning, finding admission, rework judgment,
acceptance — **and workspace preparation before the run starts** (dirty
handling, branch-base decision, feature-branch creation). Never reimplement
what a tool does; if a tool rejects a call, a gate is speaking.

## Starting and resuming

- `/sfd` (user) or a matching request (you may self-activate): the command
  detects state and injects either a **resume brief** or a **start handoff**.
  Both begin with reading this skill.
- New run: you must know the task first. If the session has no task context,
  ask the user what to build — never invent one. Then perform workspace
  preparation (mandatory decision table below), create the feature branch,
  and call `sfd_start` with a one-line `taskSummary` (and optional `slug`,
  `branch`). The tool performs no git operations — it records the git facts
  it observes and persists the initial state.
- Resume: the brief states phase, open findings, budgets, pending decisions,
  and ES actor reconciliation. Reconcile listed actors (result/close), then
  continue from the stated phase. State drift (branch / HEAD mismatch, or the
  recorded plan file missing) blocks; offer the user options.
- No hash accounting anywhere: never record, recompute or check content
  hashes (sha256 etc.) of plans, advisor requests/results or any artifact.
  Identity is path + git state + the user's explicit disposition, never a
  digest.
- Only on **self-activation** must the user approve starting SFD before you
  begin — ask first, before any workspace preparation or `sfd_start` call.
  Explicit `/sfd` (or a user request naming SFD) already carries that approval.
  Once started, proceed to plan review without a user-approval pause.

## Workspace preparation (mandatory decision table)

Before calling `sfd_start`, bring the repository to a state where the run can
begin. This table is **mandatory, not advisory**: follow it case by case with
your own session tools, asking the user a plain question whenever a choice
below is theirs to make. Never lose the user's uncommitted work; record every
user choice in the conversation verbatim.

1. **Dirty workspace** → ask the user: [stop | auto commit (AI-generated
   message)]; the user may instead type free text (e.g. a note about their
   WIP) — honor it: leave the workspace as it is only when the user says so,
   otherwise resolve the dirt as the user directs before continuing.
2. **Clean + on main (or master)** → no question: name the feature branch
   yourself (from the task slug, e.g. `sfd/<slug>`) and create it from main.
3. **Clean + off main** — compute ahead/behind versus main, then offer the
   user exactly these option sets (always plus "stop"):
   - `0/0` → [stay on the current branch | new branch from the current branch]
   - `>0/0` → [stay | new from current | new from main (switch to main first)
     | fast-forward main to the current branch, then stay]
   - `0/>0` → [stay | new from current | new from main (switch to main first)
     | fast-forward the current branch to main, then branch from it]
   - `>0/>0` (diverged) → [stay | new from current | new from main (switch to
     main first) | you merge the current branch with main, resolve all
     conflicts, and continue from the result]
4. **Degenerate states** — no main-like reference, detached HEAD, or a merge
   in progress → ask the user how to proceed (offer reasonable options for
   the concrete situation, always including "stop"); do not guess a base.

Branch creation, duplicate-name handling (ask the user when needed), and any
merge you accepted above are always your own git operations. After
preparation, call `sfd_start` — the state records the branch it observes (or
the `branch` name you pass) as the run's starting point; planning follows.

## Phase model and your duties

| Phase | Program (plugin) does | You do |
|---|---|---|
| CLEANUP | `sfd_start` records git facts (branch, base, cleanliness) and writes state; no git operations | workspace preparation per the mandatory decision table above (dirty handling, base decision, merges); name and create the feature branch (handle duplicates, ask when needed); then call `sfd_start` |
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
  `.agent-work/`; SFD does not write into an external repo's `.agent-work/`
  (an existing one there is left untouched). The plugin does
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
