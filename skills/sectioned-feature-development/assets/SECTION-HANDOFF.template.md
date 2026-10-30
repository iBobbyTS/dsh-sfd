# Handoff — <feature / parent / child>

- Actual writer ID and observed metadata or UNKNOWN:
- Feature / owning Section / child when applicable; TASK/PLAN references, repository/branch, base → candidate:
- Actual behavior and changed paths:
- Changed boundary, when applicable: actual redacted request/response fixture or exact source/test reference; encoding, subset/global, failure/late-result meaning; named consumers:
- Planned example changes and why; unobserved output explicitly marked, not claimed as captured evidence:
- Local diagnostic probes (if any): command, relevant input/head/environment, exit and key lines; avoid broad acceptance suites or claiming gate success. Main runs required tests and saves full logs under `.agent-work/evidence/{feature}/`:
- Remaining parent behavior, joint-oracle needs, no-future-scope statement:
- Affected named consumers (including other Features) and shared identity/state/security assumptions; evidence invalidated by the real edit:
- Risks/owner decisions/gaps:

The worker writes this file itself at the dispatched path; its final answer carries only the path, signal and one-line status. Main reads the file for admission and may append Git verification, never rewriting failed or unknown results into success.
