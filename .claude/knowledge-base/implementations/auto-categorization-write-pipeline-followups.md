# Followups — auto-categorization-write-pipeline

## F1 — pipeline.ts exceeds the 500-line budget (pre-existing debt) — RESOLVED 2026-07-12
`packages/core/src/domain/extraction/pipeline.ts` is 745 lines. It was **already 710
lines before this feature** (the 8-phase write pipeline); this change added ~35 lines and
already extracted a helper (`boundedAutoCategory`, SRP) per the plan's own DoD ("if
pipeline.ts grows past budget, extract a helper"). A full split of the pipeline into
per-phase modules is a separate refactor (touches the whole extraction path — out of
scope for this feature; would be scope-creep + risk). RESOLVED: behavior-preserving split into `pipeline-helpers.ts` (helpers + infer:false path + ExtractionDeps) — pipeline.ts now 438 lines, pipeline-helpers.ts 334; 1327 tests green, 0 regression.

## Known validation caveat (NOT a defect of this work) — CHANGELOG-only after F1

After the F1 pipeline.ts split, the ONLY remaining `run_validation.py` blocking finding is:
- `acceptance_criteria` HIGH `file_size_exceeded` on `CHANGELOG.md` (~753 lines).

CHANGELOG.md is **exempt by explicit project convention** (`audit-trail-rotation.md § What NEVER
rotates`: "CHANGELOG.md — kept indefinitely (it's the public contract)") AND Unbreakable Rule 6
**requires** updating it. Truncating it would violate both rules. The acceptance-criteria gate
applies the 500-line SOURCE budget to CHANGELOG.md and has no doc-exemption — a check limitation,
not an implementation defect. **Every source file this feature touched is compliant**: pipeline.ts
(438), pipeline-helpers.ts (334), taxonomy.ts (45), prompt.ts (219), memory-event.ts (192),
options.ts (323). All 7 functional gates PASS (npm test 1327, typecheck, lint, code_quality PASS,
wiring, checkpoint consistency). The 17 `criterion_requires_human_evidence` are LOW (surfaced for
human review, non-blocking).

### Optional follow-up (check hardening, not this feature)
`check_acceptance_criteria.py` could exempt `CHANGELOG.md` / `*.md` docs from the source LoC budget
(they are exempt per `audit-trail-rotation.md`). Tracked as a tooling improvement.
