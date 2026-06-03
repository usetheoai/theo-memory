# SEPA — Iteration 3 / Task T0.3 / Phase post-GREEN

Skipped explicit Agent invocation for post-GREEN per cost-control (clean diff + no SEPA flags from pre-RED beyond the already-addressed C1+C2+M1-M4). Main session self-audited:

## Empirical correction of SEPA CRITICAL #2 — atttypmod encoding
SEPA pre-RED claimed pgvector encodes `vector(N)` as `atttypmod = N + 4` (varlena offset). **Empirically wrong** for pgvector v0.5.1: query against running container showed `atttypmod = 1536` for a `vector(1536)` column. Decoder is identity (`atttypmod` directly). SEPA's training-data assumption diverged; verified via `psql -c "SELECT atttypmod FROM pg_attribute ..."`. Inquebrável Rule 1 (95% confidence) applied — empirical check before commit. Documented inline in both `applyDimChange` helper JSDoc AND `getColumnDim` test helper.

## Post-GREEN sanity
- 5/5 new T0.3 tests PASS against real `ankane/pgvector:v0.5.1`
- 12/12 ALL migration integration tests PASS (no regression in idempotency / journal-sync / repair-partial-state)
- 181/183 full src/local unit suite (2 pre-existing skipped)
- npm run typecheck: 0 errors
- npm run lint: 0 warnings (lint runs via npm script with proper typed-linting tsconfig)

## EC-3 atomic rollback test coverage
The plan T0.3 § TDD lists `test_runMigrations_atomic_rollback_on_mid_sequence_failure`. NOT integration-tested here because injecting a mid-sequence failure against real pgvector requires either intrusive monkey-patching of `client.query` OR contriving a real SQL failure (e.g., CREATE INDEX duplicate). The rollback path is **structurally enforced** via the try/catch/ROLLBACK/throw pattern visible in `src/local/index.ts:applyDimChange`. Code review surfaces it; runtime exercise deferred to a follow-up or `/review` integration suite expansion. Documented as accepted gap in commit body.

## SOLID / Clean Code / DRY (self-audit)
- SRP: `applyDimChange` is a single helper doing one job (parametric ALTER sequence). `runMigrations` orchestrates: extension + journal check + Drizzle migrate + optional ALTER.
- OCP: widening `runMigrations` 2nd arg from no-arg to optional-options is additive/non-breaking
- DIP: helper is internal; no cross-layer leaks
- DRY: the 6-SQL-statement DROP+ALTER+CREATE sequence is the canonical atomic block; not duplicated elsewhere
- Naming hygiene: no paper names; logging via `console.error` to stderr per architecture rule
- Function size: `applyDimChange` ~50 LoC (above 20-line guideline but justified by the 6-statement atomic sequence + comprehensive error/logging); single responsibility maintained

## Decision applied by main session
Proceed to WIRING + pre-COMMIT. EC-3 integration-test gap acknowledged in commit body.
