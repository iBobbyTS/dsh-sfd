# @ibobbyts/dsh-sfd

Dynamic Sectioned Feature Development for DeepSeek Harness. Main chooses scope, reviewers and execution strategy; the plugin preserves a **mutable task graph**, requires real review evidence before critical transitions, and records explicit user-authorized Code B waivers without restarting the run.

## Start

Use `/sfd` to start or resume. `sfd_start(taskSummary)` keeps the existing workspace/branch cleanup and human choice. Main writes `.agent-work/REQUIREMENTS.md` and `PLAN-FULL.md`, then initializes:

```text
sfd_flow_init(sections=[{
  id:"S01", profile:"impl_std", dependsOn:[],
  subsections:["A","B"], lenses:["R02"]
}])
```

The graph contains Plan A → Plan B, implementation and declared Subsection R01 checkpoints, Section Code A risk lenses → blind B1 → same-head B2 reconciliation → Section acceptance → final delivery.

## Tools

| Tool | Purpose |
|---|---|
| `sfd_flow_init` | Create graph once from real PLAN units |
| `sfd_flow_status` | Get ready/blocked nodes, actors, findings, waivers |
| `sfd_flow_revise` | Add a Section/Subsection/step, change Code A lenses, waive/restore B |
| `sfd_actor_start` / `sfd_actor_collect` | Dispatch, await, obtain actual ES terminal result and authored report |
| `sfd_actor_cancel` | Request cancellation; collect terminal status before reuse |
| `sfd_actor_start(taskId="S01:repair",...)` | Repair material findings on the Section's implementer route; at most five attempted waves |
| `sfd_review_admit` | Main admits clean/material review with real reviewer evidence |
| `sfd_findings_close` | Verify closure with separate terminal CLOSURE_VERIFY actor |
| `sfd_task_finish` | Main records implementation/reconciliation result |
| `sfd_section_accept` / `sfd_flow_complete` | Programmatically verify prerequisites and evidence |

Example: `sfd_flow_revise(action="add_task",id="windows",dependsOn=["plan:B"],before=["S01:impl"])` inserts a gate into an active workflow. An explicit user instruction may instead invoke `sfd_flow_revise(action="waive_code_b",authorization="user",reason="User requested no Code B")`. Waived review is **never** reported as CLEAN: Section acceptance becomes `ACCEPTED_WITH_WAIVER`. Active B reviewers must be cancelled and collected before waiving.

State and audit decisions stay in one `.agent-work/sfd-state.json`; plan, tests, HANDOFFs and reviewer reports remain Markdown. No Trailmap data duplicate, rigid global state-machine sequencer, parallel write scheduler, sidebar, or hidden retry loop.

## Limitations

Programmatic gates apply to SFD tool transitions, **not** arbitrary shell/MCP/subagent calls outside them. Main must use these tools to benefit from the guarantee. A real terminal reviewer report proves execution, not semantic correctness; Main remains responsible for scope, finding admission, tests and integration. ES review profiles must provide actual read-only isolation; the plugin checks candidate drift but cannot substitute for the runtime sandbox. Runtime failures remain visible and do not silently become approvals. User provenance for a waiver is recorded as a prompt-level contract, not cryptographically verified. No automatic push/merge.

Startup and flow revision work even when ES is temporarily unavailable. ES CLI must be installed for dispatch. Role profiles are configured in `lib/es.js`; missing profiles do not prevent unrelated startup, but block their actual dispatch.

## Test

```bash
npm test
```

See [DESIGN](DESIGN.md) and the bundled [SFD Skill](skills/sectioned-feature-development/SKILL.md).