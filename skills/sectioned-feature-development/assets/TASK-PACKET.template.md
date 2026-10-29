# TASK — <unit / bounded repair>

- Business Feature ID / owning Section / child (if declared):
- Repository / workspace / exact candidate base:
- Bounded implementation or admitted repair finding IDs (only when absent from the extracted contract):
- Dispatched report path and template: {SECTION-HANDOFF.template.md}.

<!-- Coordinator note (do not ship): prepend these missing runtime facts to
     the section_plan.py extract --output view. Authority, approved outcome,
     owned/inspect-only/excluded paths, global and parent invariants, boundary
     examples, consumer dispositions, checks and known gaps come from the
     extracted PLAN contract below; never repeat them in this header or
     hand-maintain another section body. MAIN-ONLY blocks in PLAN exclude
     scheduling metadata, never business constraints or validation oracles.
     Include repair facts only for an admitted repair and child/parallel facts
     only when that execution path applies; do not add no-event fields. Reuse
     canonical pointers instead of copying evidence. Preserve the required
     candidate, authority, checks and coverage facts; mark required missing
     facts UNKNOWN or as explicit gaps, never inapplicable.
     Role law and report conventions are bound by developer instructions. -->

The extracted contract, not this header, supplies the current Feature's complete business path, shared producer constraints and Section acceptance criteria. A consumer in a different Feature receives the actual accepted producer handoff, not unrelated full Feature plans. Name repository artifacts by feature or behavior, never by a section ID.
