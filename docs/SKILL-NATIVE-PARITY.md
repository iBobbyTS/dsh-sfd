# SFD Skill → Native DSH workflow parity

## Source and constraint

Original normative source: `iBobbyTS/sectioned-feature-development` main at `1a50ec4541ca4bf8851041edfdc93710e9542bc5` (SFD v5.5.0).
This migration does **not** revise the original method; it moves enforcement and task ownership from conversational prose into DeepSeek Harness Host and native roles.

The repository ships 100 active Skill/reference/template Markdown files under `knowledge/`. These are **read-only methodological source material**, not another active dispatcher, state store, or runtime dependency on the old repository.
Host-specific Codex/ZCode/external-subagent routing references remain historical knowledge and do not configure DSH actors. DSH role presets and Host route policy remain authoritative.

## Ownership mapping

| Original SFD contract | Native owner / behavior |
| --- | --- |
| Main retains goal, requirement changes and decisions | Persisted `WorkflowController` Run; `inputContractVersion`, decision history and authoritative storage domain; goal revisions preserve unmodified accepted Sections until the new plan determines the invalidation cone |
| Feature / Section / Subsection and dependency sequencing | Validated Feature/Section DAG; serial declared Subsections each have scoped implementation and real R01 checkpoint; parent R01 reconciles checkpoint reports/checks and only parent acceptance unblocks external dependencies |
| Serial independent PLAN A/B | Agent-tool automatic activation stops after first PLAN for explicit owner approval; independent blind PLAN A/B, with a native semantic admission decision for material PLAN findings before any correction budget is consumed; subsequent PLAN_DELTA uses only the same slot's authored prior evidence and explicitly reasoned reuse; OWNER_DECISION blocks; PLAN_NIT never causes material churn; documented PLAN-only silent-A retirement after two qualifying rounds |
| Single authorized implementer per Section | Isolated Git worktree, assigned writeScope, Host's implementation stage |
| `impl_std` / `impl_large` dispatch | Same native implementer preset; optional distinct Host-configured large model/effort route |
| Frozen CODE A, R01 baseline, risk-qualified specialist selection | Immutable full Git candidate plus the exact parent Section start-tree → candidate delta, independent native reviewer-a activations, risk selector; `review/review-routing.md` is available on demand |
| Post-repair delta risk rerouting | `reroute` runs after Section repairs; child checkpoint repair also re-routes new/invalidated R01–R12 risks; add focused reviews for new risks rather than another full A/B pair, and carry applicable earlier evidence explicitly |
| One closure outcome per admitted repair finding | `closureFindingIds` + structured `closures`: verified-closed / still-open / regression / insufficient-evidence; Host enforces one supported closure per target; R02 SAFE_SIMPLIFICATION has separate SIMP IDs, batch-only-on-material-repair rules, and preservation-oracle closure |
| Blind independent full B1, then B2 reconciliation | Separate reviewer-b packet allowlist (no prior A/repair narrative), Host adjudicator reconciles evidence |
| Five admitted repair waves, no reset from replanning | Persistent original `lineageId` and legacy-named `materialRepairWaves` counter (every admitted source/test repair); one bounded nonstructural hard-cap recovery wave, or a diagnosed and explicitly traced structural replacement sharing original history and counters; second exhaustion enters ADV-01 external-human hold |
| Required Tier 1/2/3 checks and composed business paths | Native permission-scoped checks on isolated candidates, mandatory per-child required checks, parent joint checks and final Feature checks; only materially unproven composition boundaries trigger a bounded independent focused integration review |
| Only applicable current evidence can close a Feature | Host verifies evidence IDs are in accepted Section coverage/checks or passed checks for the final candidate |
| Delivery with commit on non-main feature branch | Default native `EXECUTE_WITH_COMMIT` and exact Git tree commit; no automatic push or merge |
| On-demand planning guides / risk knowledge | `sfd_knowledge` native read-only role tool; `planning/router.md`, `review/review-routing.md` and all bundled reference materials. Role prompt and Host, not the legacy Skill, own dispatch |
| Rare external human Advisor (ADV-01–06) | Persisted candidate/source/finding/check context, explicit blocking native UI/command, verbatim external result and independently recorded human adoption; no model-as-advisor route, no automatic third-party contact |

## Deliberate exclusions and remaining semantic judgment

- No new approval workflow, cost diary, telemetry subsystem or persistent-state performance redesign is introduced by this migration. Existing DSH user permissions and its native sandbox/tool boundary remain the execution authority.
- The Host checks mechanical facts (candidate identity, closure IDs, checks, boundaries and repair budgets), while the semantic correctness of findings, whether R02/R06 genuinely applies, and whether existing evidence remains applicable where source semantics changed require model judgment. A successful schema cannot prove these facts automatically.
- Automatic concurrent parent-Section writers, legacy Markdown state import, original Codex/ZCode/external-subagent dispatch profiles, cross-Host takeover, and real paid-model outcome benchmarking remain outside the native port. The old Skill's sanitized Advisor ZIP generator and Feishu notification are not reproduced: the Host exposes a local evidence index for deliberate human handoff, not third-party transport or an assurance that it contains no secrets.
- This mapping describes the migrated enforcement surfaces, not a guarantee that every edge case from the original prose has been demonstrated by live-model testing. Keep the original reference snapshot for parity comparisons without creating a second runtime state machine.

## Validation

The initial migration validated 80 deterministic tests without failures; parity convergence expanded this to 88 tests, including exact Section-boundary and native workflow regression cases. The branch GitHub Actions run validated these without failures, TypeScript checking, generated bundles and npm package verification on DSH 0.2.1-rc.2. Live paid-model long-horizon quality, external manual Advisor transport and migration of active 0.1.0 Runs have not been verified. Core/Policy/Role protocol versions were intentionally changed to reject unconverted old state.
