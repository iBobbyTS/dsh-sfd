# DSH dispatch profile

This host profile is distributed by the `@ibobbyts/dsh-sfd` plugin (not by the
skill installer). Every external row is a literal call through the
external-subagent MCP tools available in DSH (the host tool list may prefix
them, e.g. `mcp__external_subagent__external_subagent_spawn`; it is the same
tool). Named profiles live in the per-user external-subagent profiles
directory and are installed by the SFD skill installer (`scripts/install.py`).

| Logical role | Routing type | Subagent |
|---|---|---|
| code explore | main agent | CodeGraph + direct reads (no dedicated actor on this host) |
| impl_std | [@external-subagent](plugin://external-subagent@inline) | `external_subagent_spawn(profile="sfd-dsh-impl-std")` |
| impl_large | [@external-subagent](plugin://external-subagent@inline) | `external_subagent_spawn(profile="sfd-codex-impl-large")` |
| PLAN review A | [@external-subagent](plugin://external-subagent@inline) | `external_subagent_spawn(profile="sfd-zcode-plan-review")` |
| PLAN review B | [@external-subagent](plugin://external-subagent@inline) | `external_subagent_spawn(profile="sfd-codex-plan-review")` |
| code review A | [@external-subagent](plugin://external-subagent@inline) | `external_subagent_spawn(profile="sfd-zcode-code-review")` |
| code review B | [@external-subagent](plugin://external-subagent@inline) | `external_subagent_spawn(profile="sfd-codex-code-review")` |

A/B are fixed for both PLAN and CODE and keep the upstream independence
pattern: A rides the zcode runtime, B rides the codex (GPT-family) runtime —
two runtimes, two role-instruction lineages, no shared context.
`sfd-agy-impl-std` is a user-added impl_std alternate; use it only by explicit
user direction (a route substitution, recorded as one).

Each external row is a literal call: copy it verbatim, adding only
`repository` and `prompt` (and a task-bounded `write_manifest` where its route
carries one — none of the review routes does).
The named profile fixes that route's subagent, model, effort, permission mode
and the role's developer instructions; never send those fields alongside `profile`.
If `external-subagent profile list` lacks a named profile, the route is a
capability blocker: report it and run the skill installer, never
inline-substitute.
Reviewer jobs never request a nonempty write_manifest.
A prompt boundary or mode label is not sandbox enforcement; do not relabel
runtime failures as tier inadequacy.
On any spawn failure or plugin-contract doubt, re-read
[external-subagent.md](../external-subagent.md) and the installed
`$external-subagent` skill instead of improvising.
