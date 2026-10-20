# Validation record — 0.2.0

## Environment and scope

Verified with Node **24.19.0**, npm **11.9.0**, Git **2.51.1**, and the published DSH **0.2.1-rc.2** SDK. The DSH source reference used for interface inspection is commit `687f282e8625c6b8d11ff58211a90524be2e4317`.

The tests use real DSH runtime components and real temporary Git repositories. Model responses are deterministic fixtures; this is not a live paid-model end-to-end run or a benchmark of planning, code review, or long-task quality.

## Reproducible checks

```bash
npm ci --ignore-scripts
npm run check
npm pack --ignore-scripts
node scripts/verify-package.mjs
```

The previous parity convergence verified **88 named tests**. The new model-family routing branch adds **9 deterministic cases (97 total)** covering GLM/GPT/DeepSeek family routing, exact external route admission, JSON completion and partial-result rejection, cancellation/close, role-specific knowledge, large-prompt JSON stdin, real Host dispatch and same-workspace external serialization, and preservation of large task contracts inline within the external prompt budget. The model responses remain fixtures; no live Codex/ZCode model task was run. The eight added cases cover first-plan approval, material PLAN finding rejection, forward-progress continuation, no-progress diagnosis, repair-wave counting, incomplete PLAN_DELTA source exclusion, exact Section delta, and one-Feature Section ownership. The package verifier checks required files, every declared export, compiled Host/role/core/client imports, and the absence of installation-time build hooks. The current PR CI also verified the committed compiled distribution matches a fresh build, and the packed plugin contains the declared outputs. GitHub CI repeats these checks on Node 24 and checks that committed `lib/` matches a fresh build.

## What the tests establish

| Area | Evidence exercised |
| --- | --- |
| Workflow and admission | Independent PLAN A/B and PLAN_DELTA, PLAN-only silent retirement, actual serial Subsection R01, logical Code A/B, itemized closure and SIMP preservation, residual integration review, composed Feature acceptance and truthful commit delivery |
| Goal continuity | Explicit user decisions enter the relevant task; retired requirements and structural child replacements preserve original lineage/budgets; dependency release requires accepted/integrated parent Sections |
| Long execution | Parallel report admission, control-epoch fences, late startup/results, bounded noncooperative teardown, retained unknown-writer ownership, and separate infrastructure retry budgets |
| Recovery | Prepared worktree and completed commit gaps reconciled from real Git/filesystem evidence; bounded one-time hard-cap recovery, descendant ownership and original-wave inheritance, mandatory ADV-01 after second convergence failure |
| Evidence | Complete tracked/staged/unstaged/untracked trees, independent frozen review/check worktrees, tamper detection, self-modifying-check rejection, and unchanged source checkout/index |
| Native DSH | Actual Cordis Host, storage domain, Session ownership, native subagent spawn, role tools, structured output, observed model route, deadline/cleanup, Remote API and command registrations |
| External model-family routing | Deterministic CLI stdin tests and fake-daemon spawn/wait/result/cancel/close: model/effort/permission admission matching, strict JSON result, same-workspace scheduling, cancellation, and truthful admission-versus-observed provenance |
| Native checks | Real pre-tool denial stops shell dispatch; a successful fixed command returns through the actual BashSandbox/subprocess/tools result schema |
| User interface | Owner selection and stale-response fences, duplicate action suppression, truthful requested/observed route display, actual delivery rendering, and observer closure without Run cancellation |
| Large context | Bounded prompt plus exact immutable artifacts, blind-review filtering before artifact persistence, and explicit rejection of an oversized original goal |

## Native check execution boundary

The successful native check test explicitly uses an owner with `danger-full-access`, runs a fixed `printf` with a two-second timeout through the real DSH BashSandbox and subprocess implementations, verifies exact output and exit status, and confirms no model request or leftover Agent. Its test sandbox provider refuses every confinement request; no OS confinement is simulated or claimed.

The current verification host has neither a usable Bubblewrap nor a usable Landlock runner. A real SandboxLocal capability probe returned `SANDBOX_UNAVAILABLE` without executing the command. OS-confined successful execution therefore remains an environment-dependent integration check. The production adapter requires an actual native execution result with a sandbox mode and preserves the owner's DSH permissions; a plain local-shell fallback cannot turn an unavailable check into a pass.

## Installation smoke test

Installed the published DSH CLI `0.2.1-rc.2` in a separate temporary directory and used a separate `DSH_HOME` and profile. The following operations succeeded:

```bash
dsh --version
dsh plugin --profile sfd-verify add /absolute/path/to/dsh-sfd --ignore-scripts
dsh --profile sfd-verify --dump-config
```

The resolved configuration contains the Host contribution and all eleven explicit role presets. This validates the bundle's installation and profile composition without changing an existing user profile. It does not claim that a real paid model was configured or that a browser interaction was exercised.

## Release boundaries

The package targets the pinned DSH SDK. `standard` and `large` implementation contracts use the same native writer preset, with a separately configurable Host-owned large model route. The large route must be configured explicitly; it cannot silently inherit a standard route. Transport selection is pinned on Run creation. GLM routes target external-subagent/ZCode and GPT routes external-subagent/Codex; DeepSeek uses native DSH spawn. Submodules, source-changing checkout filters, automatic takeover from another Host, automatic import of historical SFD Markdown state, and independent role/permission-definition migrations are outside this release's supported scope. The README and recovery guide describe operational behavior and explicit intervention points.

No successful live paid-model end-to-end long-run benchmark, sanitized external Advisor ZIP generator, native third-party notification or old-Run migration is claimed by these deterministic tests. The exact build and test count on the final main commit should be checked in its own CI run.

## External-runtime verification limit

The GitHub runner has neither the user's enabled external-subagent daemon nor live authenticated ZCode/Codex model sessions. It tests the published CLI projection contract through an executable stdin fixture, and the SFD external actor state machine through deterministic task fixtures. Successful live GLM→ZCode and GPT→Codex execution, enabled daemon status, explicit ZCode model selection on the installed version, and persistence/recovery under real external process failure remain **NOT_RUN** and must not be inferred from CI success. An unavailable or mismatched route is a blocker, not authorization to run the task natively.
