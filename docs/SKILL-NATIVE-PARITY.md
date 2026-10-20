# SFD Skill → Native DSH workflow parity

## Source and constraint

Original normative source: `iBobbyTS/sectioned-feature-development` main at `1a50ec4541ca4bf8851041edfdc93710e9542bc5` (SFD v5.5.0).
This migration does **not** revise the original method; it moves enforcement and task ownership from conversational prose into DeepSeek Harness Host and native roles.

The repository ships 100 active Skill/reference/template Markdown files under `knowledge/`. These are **read-only methodological source material**, not another active dispatcher, state store, or runtime dependency on the old repository.
Host-specific Codex/ZCode/external-subagent routing references remain historical knowledge. The DSH Host's configured per-role model is authoritative; a frozen model-family rule now selects **GLM → external-subagent/zcode**, **GPT → external-subagent/codex**, **DeepSeek → native DSH subagent**. The original role model selection remains an explicit Host configuration choice, not an invented default. External daemon admission facts and DSH runtime observations remain distinct evidence.

## Ownership mapping

| Original SFD contract | Native owner / behavior |
| --- | --- |
| Main retains goal, requirement changes and decisions | Persisted `WorkflowController` Run; `inputContractVersion`, decision history and authoritative storage domain; goal revisions preserve unmodified accepted Sections until the new plan determines the invalidation cone |
| Feature / Section / Subsection and dependency sequencing | Validated Feature/Section DAG; serial declared Subsections each have scoped implementation and real R01 checkpoint; parent R01 reconciles checkpoint reports/checks and only parent acceptance unblocks external dependencies |
| Serial independent PLAN A/B | Agent-tool automatic activation stops after first PLAN for explicit owner approval; independent blind PLAN A/B, with a native semantic admission decision for material PLAN findings before any correction budget is consumed; subsequent PLAN_DELTA uses only the same slot's authored prior evidence and explicitly reasoned reuse; OWNER_DECISION blocks; PLAN_NIT never causes material churn; documented PLAN-only silent-A retirement after two qualifying rounds |
| Single authorized implementer per Section | Isolated Git worktree, assigned writeScope, Host's implementation stage |
| `impl_std` / `impl_large` dispatch | Logical tier remains as planned; selected DeepSeek model activates native implementer, GPT goes to external Codex, GLM to external ZCode. Large requires an explicit Host model/effort route |
| Frozen CODE A, R01 baseline, risk-qualified specialist selection | Immutable full Git candidate plus the exact parent Section start-tree → candidate delta, independent native reviewer-a activations, risk selector; `review/review-routing.md` is available on demand |
| Post-repair delta risk rerouting | `reroute` runs after Section repairs; child checkpoint repair also re-routes new/invalidated R01–R12 risks; add focused reviews for new risks rather than another full A/B pair, and carry applicable earlier evidence explicitly |
| One closure outcome per admitted repair finding | `closureFindingIds` + structured `closures`: verified-closed / still-open / regression / insufficient-evidence; Host enforces one supported closure per target; R02 SAFE_SIMPLIFICATION has separate SIMP IDs, batch-only-on-material-repair rules, and preservation-oracle closure |
| Blind independent full B1, then B2 reconciliation | Separate reviewer-b packet allowlist (no prior A/repair narrative), Host adjudicator reconciles evidence |
| Five admitted repair waves, no reset from replanning | Persistent original `lineageId` and legacy-named `materialRepairWaves` counter (every admitted source/test repair); one bounded nonstructural hard-cap recovery wave, or a diagnosed and explicitly traced structural replacement sharing original history and counters; second exhaustion enters ADV-01 external-human hold |
| Required Tier 1/2/3 checks and composed business paths | Native permission-scoped checks on isolated candidates, mandatory per-child required checks, parent joint checks and final Feature checks; only materially unproven composition boundaries trigger a bounded independent focused integration review |
| Only applicable current evidence can close a Feature | Host verifies evidence IDs are in accepted Section coverage/checks or passed checks for the final candidate |
| `PLAN_HANDOFF` with independent PLAN A/B, without product changes | Explicit native Run intent; same Planner/PLAN A/PLAN B admission and approval, then a plan-only completed state with no Git worktree preparation, product checks or delivery commit; surfaced through UI, `sfd_run` and `/sfd plan` |
| Delivery with commit on non-main feature branch | Default native `EXECUTE_WITH_COMMIT` and exact Git tree commit; no automatic push or merge |
| `REVIEW_ONLY` on existing changes | Current committed HEAD plus staged/unstaged/nonignored untracked files are frozen to a detached review snapshot; no product implementer, new branch or product commit. Original Section A/B plus Feature evidentiary gate apply; required repairs become owner decisions, not unauthorized writes |
| Markdown report and machine result | Role reports authored in Markdown with first-line JSON metadata under headings; separate final structured decision is admitted by Host, with one bounded format/reference correction rather than additional review or code repair |
| On-demand planning guides / risk knowledge | `sfd_knowledge` native read-only role tool; `planning/router.md`, `review/review-routing.md` and all bundled reference materials. Role prompt and Host, not the legacy Skill, own dispatch |
| Rare external human Advisor (ADV-01–06) | Native Host freezes active tasks, exports SHA-256-verified local secret-filtered ZIP with current source/Git/requirements/PLAN/reviews/repair history, records exclusions; one read-only role proposes the project/feature/reason notification fields; Host uses a signed Feishu bot, never auto-sends ZIP; failed delivery is visible and never bypasses the human hold; external response and separate human adoption are retained |

## Deliberate exclusions and remaining semantic judgment

- No new approval workflow, cost diary, telemetry subsystem or persistent-state performance redesign is introduced by this migration. Existing DSH user permissions and its native sandbox/tool boundary remain the execution authority.
- The Host checks mechanical facts (candidate identity, closure IDs, checks, boundaries and repair budgets), while the semantic correctness of findings, whether R02/R06 genuinely applies, and whether existing evidence remains applicable where source semantics changed require model judgment. A successful schema cannot prove these facts automatically.
- **Explicitly removed by user:** parallel parent-Section product writers and automatic import of legacy Markdown/old native Run state. Independent read-only A reviewers may still run concurrently. **Not yet equivalent:** non-main branch-base choice, live mid-feature adoption, full Feature-integration repair-lineage semantics, dynamic scoped reviewer probes, and real paid-model long-run benchmarking. Feishu is sent only as a minimal signed text notice; the user manually inspects/sends the ZIP. Secret filtering remains best effort and no real Feishu/live-model success is claimed.
- This mapping describes the migrated enforcement surfaces, not a guarantee that every edge case from the original prose has been demonstrated by live-model testing. Keep the original reference snapshot for parity comparisons without creating a second runtime state machine.

## Validation

The initial migration validated 80 deterministic tests without failures; parity convergence expanded this to 88 tests, including exact Section-boundary and native workflow regression cases. The branch GitHub Actions run validated these without failures, TypeScript checking, generated bundles and npm package verification on DSH 0.2.1-rc.2. Live paid-model long-horizon quality, external manual Advisor transport and migration of active 0.1.0 Runs have not been verified. Core/Policy/Role protocol versions were intentionally changed to reject unconverted old state.
