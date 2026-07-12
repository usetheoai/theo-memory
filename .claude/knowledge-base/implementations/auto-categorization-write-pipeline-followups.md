# Followups — auto-categorization-write-pipeline

## F1 — pipeline.ts exceeds the 500-line budget (pre-existing debt) — RESOLVED 2026-07-12
`packages/core/src/domain/extraction/pipeline.ts` is 745 lines. It was **already 710
lines before this feature** (the 8-phase write pipeline); this change added ~35 lines and
already extracted a helper (`boundedAutoCategory`, SRP) per the plan's own DoD ("if
pipeline.ts grows past budget, extract a helper"). A full split of the pipeline into
per-phase modules is a separate refactor (touches the whole extraction path — out of
scope for this feature; would be scope-creep + risk). RESOLVED: behavior-preserving split into `pipeline-helpers.ts` (helpers + infer:false path + ExtractionDeps) — pipeline.ts now 438 lines, pipeline-helpers.ts 334; 1327 tests green, 0 regression.

## Known validation caveat (NOT a defect of this work)
`run_validation.py` `acceptance_criteria` flags `file_size_exceeded` on:
- `CHANGELOG.md` (752) — exempt by convention (`audit-trail-rotation.md § What NEVER rotates`: CHANGELOG kept indefinitely).
- `pipeline.ts` — RESOLVED (now 438 lines via the F1 split).
The NEW source files this feature added are all compliant: `taxonomy.ts` (45), `prompt.ts` (219),
`memory-event.ts` (192), `options.ts` (323).
