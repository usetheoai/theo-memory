# SEPA — Iteration 4 / T2.2 / pre-COMMIT / MODE=VERBOSE

## Findings (4 MAJOR + 2 MINOR + 2 INFO)

### MAJOR — 4 surfaced, all RESOLVED inline

- **F-T2.2-1 (Wiring (a) classification)** — FIXED: SEPA correctly identified that the wiring script's `verdict=PASS` was misleading. The 2 reported callers (self + JSDoc reference) are NOT real production callers; T6.1 evict() impl is the canonical first consumer. Reclassified `a=defer-foundation` matching T1.1/T2.1 precedent. Commit body documents the deferral chain (T1.1 → T2.1 → T2.2 → T6.1 consumer).
- **F-T2.2-2 (SRP smell — side-effecting `score()`)** — DOCUMENTED: D14 explicitly chose lazy-at-score backfill over eager-at-write. The side-effect IS the design. Added commit body paragraph naming the trade-off so post-merge reviewers don't re-flag it.
- **F-T2.2-3 (CREATE OR REPLACE TRIGGER PG 14+ canonical)** — FIXED: switched migration from `DROP IF EXISTS + CREATE` to `CREATE OR REPLACE TRIGGER` (atomic, no DROP-window for concurrent UPDATEs). Re-applied; 3/3 tests still GREEN.
- **F-T2.2-5 (Migration SQL header rationale comment)** — FIXED: added 5-line header citing T2.2 + EC-1 + plan path.

### MINOR — 1 FIXED, 1 ACCEPTED

- **F-T2.2-4 (xmin Number cast precision)** — FIXED: replaced `xmin::text → Number` with `ctid::text → string` comparison. ctid is the physical row pointer; UPDATE moves it under MVCC, so two equal ctids prove no UPDATE happened. More precise + no precision loss.

### INFO — clean

- **F-T2.2-6 (paper-name scan)** — zero hits across the 4 changed files.
- **F-T2.2-7 (integration test placement deviation)** — matches T1.1 barrel-path absorption pattern.
- **F-T2.2-8 (trigger MVCC concern)** — BEFORE UPDATE OF llm_importance_score modifies the in-flight tuple before MVCC commit; no race with concurrent reads. EC-1 invariant genuinely DB-layer-safe.

## DoD verification

- 3/3 RED → GREEN integration tests against real `ankane/pgvector:v0.5.1`
- 520/522 contract suite green (no regression — `halfLifePersister` defaults to null, T2.1 unit tests untouched)
- Typecheck clean, lint clean, boundary-check clean
- Migration applies via psql; trigger live in DB; verified via `information_schema.triggers` query

## Verdict

READY to ship with the 4 inline fixes applied. All SEPA-flagged blockers resolved.
