# SFD Skill → Native DSH workflow parity

## Source and constraint

Original normative source: `iBobbyTS/sectioned-feature-development` main at `1a50ec4541ca4bf8851041edfdc93710e9542bc5` (SFD v5.5.0).
This migration does **not** revise the original method; it moves enforcement and task ownership from conversational prose into DeepSeek Harness Host and native roles.

The repository ships 100 active Skill/reference/template Markdown files under `knowledge/`. These are **read-only methodological source material**, not another active dispatcher, state store, or runtime dependency on the old repository.
Host-specific Codex/ZCode/external-subagent routing references remain historical knowledge and do not configure DSH actors. DSH role presets and Host route policy remain authoritative.

## Ownership mapping

| Original SFD contract | Native owner / behavior |
| --- | --- |
| Main retains goal, requirement changes and decisions | Persisted `WorkflowController` Run; `inputContractVersion`, decision history and authoritative storage domain |
| Feature / Section / Subsection and dependency sequencing | Validated Feature/Section DAG; Subsections kept internal, one original Section repair lineage |
| Serial independent PLAN A/B | Native plan-review-a and plan-review-b with phase/candidate fences |
| Single authorized implementer per Section | Isolated Git worktree, assigned writeScope, Host's implementation stage |
| `impl_std` / `impl_large` dispatch | Same native implementer preset; optional distinct Host-configured large model/effort route |
| Frozen CODE A, R01 baseline, risk-qualified specialist selection | Immutable Git candidate, independent native reviewer-a activations, risk selector; `review/review-routing.md` is available on demand |
| Post-repair delta risk rerouting | `reroute` phase runs fresh selector; adds only new/invalidated A lenses; existing valid A evidence may be reused explicitly |
| One closure outcome per admitted repair finding | `closureFindingIds` + structured `closures`: verified-closed / still-open / regression / insufficient-evidence; Host enforces one supported closure per target |
| Blind independent full B1, then B2 reconciliation | Separate reviewer-b packet allowlist (no prior A/repair narrative), Host adjudicator reconciles evidence |
| Five material repair waves, no reset from replanning | Persistent `lineageId` and materialRepairWaves, bounded diagnosis and explicit owner decision |
| Required Tier 1/2/3 checks and composed business paths | Native permission-scoped checks executed on isolated exact candidates; final Feature acceptance on a composed candidate |
| Only applicable current evidence can close a Feature | Host verifies evidence IDs are in accepted Section coverage/checks or passed checks for the final candidate |
| Delivery with commit on non-main feature branch | Default native `EXECUTE_WITH_COMMIT` and exact Git tree commit; no automatic push or merge |
| On-demand planning guides / risk knowledge | `sfd_knowledge` native read-only role tool; `planning/router.md`, `review/review-routing.md` and related references |

## Deliberate exclusions and remaining semantic judgment

- No new approval workflow, cost diary, telemetry subsystem or persistent-state performance redesign is introduced by this migration. Existing DSH user permissions and its native sandbox/tool boundary remain the execution authority.
- The Host checks mechanical facts (candidate identity, closure IDs, checks, boundaries and repair budgets), while the semantic correctness of findings, whether R02/R06 genuinely applies, and whether existing evidence remains applicable where source semantics changed require model judgment. A successful schema cannot prove these facts automatically.
- Legacy Markdown state import, original Codex/ZCode/external-subagent dispatch profiles, cross-Host takeover, and real paid-model outcome benchmarking remain outside the native port.
- This mapping describes the migrated enforcement surfaces, not a guarantee that every edge case from the original prose has been demonstrated by live-model testing. Keep the original reference snapshot for parity comparisons without creating a second runtime state machine.

## Validation

The GitHub Actions migration branch validated the updated controller, knowledge tool, routes, evidence admission and physical Git isolation with 69 deterministic tests, typecheck, build and npm pack. Real model long-horizon validation is still a separate acceptance obligation.
