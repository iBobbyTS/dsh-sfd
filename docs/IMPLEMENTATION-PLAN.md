# Native development workflow implementation plan

## Goal and scope

Implement the sectioned development method as a first-class DeepSeek Harness plugin. A durable Host controller owns the development Run; bounded native actors provide planning, implementation, independent review and semantic decisions. The original SFD repository is a frozen methodological reference, not a runtime dependency or another product to maintain.

Target SDK: DSH **0.2.1-rc.2**, source commit `687f282e8625c6b8d11ff58211a90524be2e4317`. Pin the public packages explicitly because their default npm tag may be older. The original MIT license and repository ownership remain intact.

## Architecture

- `src/core`: validated contracts, immutable Run aggregate, durable small-step controller, semantic admission rules and recovery.
- `src/workspace`: isolated Git workspaces, complete candidate trees, independent check execution, evidence and exact-candidate commits.
- `src/dsh`: one native storage domain, Host-owned anchor agents, caller-delivered native subagents, restricted role composition, commands/tools and Remote API.
- `src/roles`: versioned task packets and workflow knowledge owned by this plugin.
- `src/client`: a native DSH Development panel using the same Host service.

## Execution stages

1. **Contracts and distribution.** Establish typed ports, policy/schema versions, package exports and an installable profile bundle. Commit built artifacts so a direct GitHub installation does not depend on running arbitrary package build hooks.
2. **Durable vertical workflow.** Create and persist a Run, prepare an isolated workspace, plan, run independent serial PLAN A/B, implement one Section, freeze the candidate, execute required checks, collect independent Code A evidence, adjudicate, run complete blind Code B, reconcile and integrate.
3. **Repair and long work.** Schedule the Section DAG; preserve original requirement and repair lineage; support targeted closure, a new blind B after material repairs, composed Feature acceptance, explicit user decisions and bounded diagnosis. Infrastructure retries have a separate budget.
4. **Native execution and controls.** A real Host-owned idle anchor supplies runtime identity. Each actor uses an explicit preset, structured result schema and finite deadline. Pause/cancel/revise invalidate old authority and await activation teardown. Remote/client/tools operate the same state.
5. **Recovery and validation.** Persist operation intent before side effects. On restart, reconcile interrupted attempts and workspace facts; unknown writes require a decision and are not blindly replayed. Test pause races, stale inputs, same-candidate parallel reviews, dependency release, repair exhaustion, immutable evidence and package/API compatibility.
6. **Deliver.** Update documentation with supported behavior and limitations, run the full verification suite, inspect the packed plugin, commit and push to the authorized repository's `main` branch, then verify the remote commit.

## Required invariants

- A model ending a turn cannot mark a Run completed. Completion requires current-candidate evidence, accepted Sections and composed Feature acceptance.
- Aggregate revision, semantic input version and control epoch have distinct meanings. One parallel review result must not invalidate its siblings; pause/revise must invalidate old control authority.
- PLAN A and B are independent and serial. Code A always includes R01. B1 is complete and blind; reconciliation receives B1 plus admissible earlier evidence on the same candidate.
- Findings are adjudicated individually; a count of `clean` reports is not semantic acceptance. Missing coverage and inconclusive checks remain explicit.
- Material repair waves retain the original Section lineage and a maximum of five. Subsections do not reset budgets or create peer dependency identities.
- A Section releases successors after acceptance and integration. Feature acceptance checks composed journeys and shared obligations.
- Candidate trees include tracked, staged, unstaged and nonignored untracked files. Reviews use a frozen tree; checks use their own disposable copy. The user's source branch and index are preserved.
- One process owns a run workspace. Unknown recovery state blocks execution; neither timestamps nor an expired lease prove an old writer has stopped.
- Domain state is authoritative. The UI and exported reports are projections. Record writes are validated and state transitions remain within one Run aggregate.
- User scope and permissions cannot be expanded by an actor result. Commit is an explicit run policy; this plugin never automatically pushes user project branches.

## Verification strategy

Use the real published SDK for static/build and Host integration checks, deterministic actor doubles for reproducible business and crash/race scenarios, and real temporary Git repositories/processes for workspace/evidence tests. A live paid model end-to-end run is reported separately and is not implied by deterministic tests. Check generated output and the package manifest as an installable unit.

## Incremental parity work after the native baseline

The baseline implementation remains a durable DSH-native orchestration engine; it is not being replaced by conversational Skill dispatch. The first follow-up slice fixes Subsection effective-tier routing and Git-scoped candidate admission and adds `PLAN_HANDOFF`, including independent plan coverage without a writable session. The existing Adjudicator continues to make semantic review decisions; programmatic transitions still gate acceptance.

Outstanding migration scope: `REVIEW_ONLY` with explicit existing-code diff identity; approved isolated parent-Section parallelism; independent Feature-integration repair lineage; branch-base and mid-feature adoption; original human Advisor packaging/notification; bounded per-finding verification, native dynamic probes and a possible native provider adapter for external-subagent. These require separate design, tests and evidence; neither source parity docs nor fixture tests imply that they already work.

## Delivery checklist

- [x] Native controller and all bounded roles are implemented.
- [x] Native domain/agents/commands/Remote/client surfaces are connected.
- [x] Git snapshots, check execution and recovery are tested with real repositories.
- [x] Behavioral regression tests and typecheck/build pass.
- [x] Installation and operational documentation matches actual exported interfaces.

The final delivery step is a direct commit to `main`, followed by verification of the remote SHA and CI result. That evidence is reported with the delivered commit rather than predicted in its own contents. See [VALIDATION.md](VALIDATION.md) for the concrete verification performed before submission.
