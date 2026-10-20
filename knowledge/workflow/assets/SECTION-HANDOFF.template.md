# Handoff — <feature / parent / child>

- Actual writer ID and observed metadata or UNKNOWN:
- Feature / owning Section / child when applicable; TASK/PLAN references, repository/branch, base → candidate:
- Actual behavior and changed paths:
- Changed boundary, when applicable: actual redacted request/response fixture or exact source/test reference; encoding, subset/global, failure/late-result meaning; named consumers:
- Planned example changes and why; unobserved output explicitly marked, not claimed as captured evidence:
- Tests/checks you ran: command, relevant input/head/environment, exit status and key lines inline (long raw output is collected by main under `.agent-work/evidence/{feature}/`, never written by you):
- Remaining parent behavior, joint-oracle needs, no-future-scope statement:
- Affected named consumers (including other Features) and shared identity/state/security assumptions; evidence invalidated by the real edit:
- Risks/owner decisions/gaps:

The worker writes this file itself at the dispatched path; its final answer carries only the path, signal and one-line status. Main reads the file for admission and may append Git verification, never rewriting failed or unknown results into success.
