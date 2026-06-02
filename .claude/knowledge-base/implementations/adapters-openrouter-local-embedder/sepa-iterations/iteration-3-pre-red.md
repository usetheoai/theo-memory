# SEPA — Iteration 3 / Task T0.3 / Phase pre-RED

## Findings (verbatim, abridged)

### CRITICAL
- **C1: Drizzle migrate() DOES use its own transaction internally.** Post-migration ALTER MUST acquire a SEPARATE `pool.connect()` client + run its own BEGIN/COMMIT/ROLLBACK. NEVER nest inside Drizzle's tx (would already be closed) and NEVER reuse `pool.query` directly (autocommits per statement, defeats EC-3 atomicity). Use `pool.connect()` + try/catch/finally + `client.release()`.
- **C2: pgvector TYPMOD encoding.** pgvector encodes `vector(N)` as `atttypmod = N + 4` (varlena length header offset). Idempotency probe MUST decode via `atttypmod - 4 === embeddingDim`, NOT direct comparison — direct comparison always misses the short-circuit forcing unnecessary DROP+ALTER+RECREATE on every call. RED test must spy `client.query` calls to verify NO ALTER emitted on 2nd same-dim call.

### MAJOR
- **M1:** HNSW index names verified correct at `src/local/migrations/0000_crazy_mimic.sql:44` (entities) + `:51` (memories). Use exact literals.
- **M2:** stderr via `console.error` (NOT `console.warn` — that signal class is taken by orphan-schema path). No emojis, no paper names.
- **M3:** Place `embeddingDim` ALTER block AFTER `migrate(db, ...)` returns, NOT before the journal check — otherwise ALTER runs on push-flow DB where user opted out of migrations.
- **M4:** Test dir `tests/integration/migrations/` exists (siblings: `idempotency.test.ts`, `journal-sync.test.ts`, `repair-partial-state.test.ts`). New test lands as `tests/integration/migrations/dim-change.test.ts`. Real pgvector via existing harness.

## Decision applied by main session
ALL ACCEPTED.
- Will use `pool.connect()` + try/catch/finally for the ALTER tx (C1)
- Will probe atttypmod via `atttypmod - 4` decode with citation to pgvector source semantics (C2)
- HNSW index names from the migration SQL literals (M1)
- `console.error` for warnings (M2)
- Place new branch AFTER `migrate(db, ...)` returns + AFTER existing orphan-schema short-circuit (M3)
- Test at `tests/integration/migrations/dim-change.test.ts` (M4)

agent_id: a9ae095846dc883c3
