# Recovery and operational boundaries

## Ordinary controls

Pause invalidates dispatch authority before stopping active actors/checks. New writes are not scheduled while paused or pausing. Resume validates the actual workspace and outstanding side effects before issuing a new task contract. Cancel retains source, evidence and history; it does not erase the worktree.

If startup or cleanup does not cooperate within the control response budget, the control call returns a visible unresolved state. The controller retains the in-process activation/operation and physical workspace owner. It never releases a potential writer merely to make the UI look paused. Resolve the underlying native process and retry the control action; do not launch another writer into that workspace.

## After a Host restart

1. Open the Development panel and select the original owning Session. Its chat Agent does not need to remain live to observe or control an existing Run.
2. Inspect the Run's current goal, pending question, actual attempts, workspace and candidate evidence.
3. If an `owner.json` error is shown, identify the previous Host and all delegated processes. Confirm they have actually stopped. A dead parent PID or old timestamp alone does not prove external writers have ended.
4. Inspect the source worktree and its Git history. Only after that verification, remove the exact old owner file named in the error. Do not remove a different Run's file or delete the worktree.
5. If there is no pending question, use **Reconcile recovery** to request reconciliation. If a recovery decision is already pending, answer that specific decision and state what was checked; the reconcile button does not replace an answer. The controller captures actual source facts, retains unknown execution history and binds the explicit decision to those facts.

The default task directory is `<common-git-directory>/dsh-sfd/runs/<run-id>/`. A configured `stateRoot` adds a repository-identity directory before the Run id. `worktree/` contains development source; `candidates/` contains frozen review worktrees; `checks/` contains check logs; `actor-context/` contains large input evidence. `manifest.json`, `prepare-intent.json`, `commit-intent.json` and `commit.json` record physical preparation/delivery facts. The native `sfd_development` domain remains the authority for business progress.

## Specific interrupted operations

| Observed fact | Recovery behavior |
| --- | --- |
| Intent was never marked started | It can be superseded without claiming the actor ran |
| Reader failed or was interrupted | A bounded new attempt can run under the current contract; its old report is not silently admitted |
| Implementer failed/cancelled or its outcome is unknown | Inspect possible partial writes and explicitly acknowledge recovery before another writer |
| Preparation produced the complete recorded initial tree | Verify the manifest/intent and adopt the existing worktree; do not create another branch |
| Preparation left a partial tree | Restore or inspect against `prepare-intent.json`'s initial tree; no automatic replay of the source patch |
| Accepted tree already has a matching actual delivery commit | Adopt the verified receipt only if its original candidate, branch and Feature acceptance still match |
| Source differs from admitted candidate | Rebind actual source and invalidate affected acceptance/checks before continuing |
| Old result arrives after a control change | Preserve it as history; it cannot authorize a new phase |

Unknown execution is not reported as a successful or clean attempt. A recovery answer does not itself validate source behavior: when source changed, the appropriate checks and review obligations run again.

## Requirements and budgets

Use **Revise goal** or `/sfd revise` to supply the updated complete objective. New requirements are versioned. Removed Sections can be retired only as part of an explicit scope change; their original lineage and repair accounting remain in history and are restored if the same Section returns. Ordinary replan/retry cannot bypass an exhausted material repair budget.

For a semantic question, answer the actual question rather than using retry as approval. For budget exhaustion, narrow/revise the authorized plan or cancel. Infrastructure retries do not consume material repair waves and do not silently change the model.

## Environment constraints

- Use a Git repository with an initial commit. A source HEAD change between creation and preparation requires reviewing the new inputs.
- Submodule working changes require separate identities and are rejected by this version.
- Checkout filters that change the captured source are rejected rather than treated as the same candidate.
- Keep `stateRoot` and the relevant DSH storage backend stable during a Run. Copying only worktrees does not migrate the native domain or its owner.
- Retain completed work until it has been reviewed and incorporated. This version has no automatic garbage collector for retained snapshots or development branches.
- Model/preset protocol upgrades require compatible workflow handling. Unknown persisted policy/schema versions are not an invitation to discard state and restart as a new task.
