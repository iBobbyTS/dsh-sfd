# Parallel execution (retired)

The plugin-era contract is **zero parallelism**: every dispatch is serial, one
actor at a time, no worktrees. This document exists only to redirect legacy
references. Anything below contradicts the plugin contract and is not followed.

Worktree infrastructure, overlap approvals and multi-branch integration from
the pre-plugin manual flow are retired. The plugin serializes all units and
owns branch state.
