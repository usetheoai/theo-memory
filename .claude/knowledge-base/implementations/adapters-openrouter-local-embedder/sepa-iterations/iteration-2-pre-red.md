# SEPA — Iteration 2 / Task T0.2 / Phase pre-RED

## Findings (verbatim from SEPA, abridged)

### CRITICAL (log + continue, NOT Stop Condition #4)
- **C1:** Plan T0.2 § Files to edit #3 (`createLocalMemory passes config.embeddingDim through to PgvectorStore constructor`) is **WRONG vs reality**. Empirical: `createLocalMemory(config)` receives `config.vectorStore` already-constructed by caller; NEVER does `new PgvectorStore(...)`. T0.2 scope reduces to (a) `src/local/pgvector-store.ts` constructor + guard, (b) NEW test file. The actual plumbing site (demo passes `{ embeddingDim: 384 }` when constructing PgvectorStore for local-openrouter backend) lives at T2.1, not here.

### MAJOR
- **M1:** Test file `src/local/__tests__/pgvector-store.test.ts` is NEW. Vitest contract include glob covers it. Mirror `pgvector-skill-store.test.ts` pattern (stubbed Pool, fail-fast tests).
- **M2:** Constructor's 2nd arg is currently `tracer?: Tracer`, NOT an options object. Plan ADR D2 collides with existing positional. Sweep confirmed ZERO positional-tracer callers across SDK + tests. **Recommend widening 2nd arg to `options?: { embeddingDim?: number; tracer?: Tracer }`.** Safe per empirical grep.
- **M3:** Test naming hygiene — already neutral. Preserve.

### INFO
- **I1:** EC-2 (schema-vs-constructor dim mismatch surfaces as clear error) is SHOULD TEST, not blocking T0.2 RED. Defer to T0.3 or follow-up.
- **I2:** `MAX_EMBEDDING_DIM` constant stays imported as fallback (`options?.embeddingDim ?? MAX_EMBEDDING_DIM`).

## Decision applied by main session
1. **C1 acknowledged** — T0.2 implementation will EXCLUDE the `src/local/index.ts` edit listed as Files to edit #3 in plan. The plumbing happens at T2.1 consumer code. Plan defect logged here for the /review architecture-reviewer agent + cross-validation agent to surface in the review report.
2. **M2 ACCEPTED** — constructor widens to `options?: { embeddingDim?: number; tracer?: Tracer }`. Existing `new PgvectorStore(pool)` and `new PgvectorStore(pool, tracer)` callers MUST continue to work. The widening is non-breaking for `new PgvectorStore(pool)` callers; for any hypothetical `new PgvectorStore(pool, tracer)` caller, the change is BREAKING (positional → options-object). Per sweep, no such caller exists — safe.
3. **M1 ACCEPTED** — new test file mirroring pgvector-skill-store.test.ts shape.

agent_id: a51c36faec6939bd1
