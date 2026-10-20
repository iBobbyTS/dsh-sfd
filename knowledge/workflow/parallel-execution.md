# Parallel Section writers — retired policy

The DSH-native SFD workflow deliberately **does not** support concurrent product implementation by parent Sections, even if independent writes could technically be isolated.

- Every parent Section waits for the prior active writer to settle and for its own actual dependencies to be accepted/integrated.
- One Host-owned run workspace and one active product Implementer are the execution contract.
- Independent read-only Code A reviewer activations may run in bounded parallel on the same frozen candidate. This does **not** authorize parallel product writes or independent parent Section worktrees.
- No original upstream Skill text or old PLAN note can override this rule. Treat an upstream request to start concurrent parent writers as historical methodology, not active DSH workflow authority.
- Original Git worktree safety practices remain relevant for *serial* isolation, immutable candidate snapshots and human handoffs.

This explicit removal was requested by the user on 2026-10-20. The original parallel Section procedure remains in upstream Git history for provenance, but is not an executable native DSH capability.
