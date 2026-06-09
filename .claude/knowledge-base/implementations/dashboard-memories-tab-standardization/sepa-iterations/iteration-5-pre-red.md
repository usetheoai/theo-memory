# SEPA — Iteration 5 / Task T3.1 / Phase pre-RED (VERBOSE)

## Verdict: PROCEED TO RED after CRIT-1 + CRIT-2 fixes + MAJ-1/2/3 design locks

## CRITICAL — plan pseudo-code defects
- **CRIT-1** — `DeterministicStubEmbedder` has NO `{dim}` constructor arg; always returns MAX_EMBEDDING_DIM=1536. Live container is `vector(384)`. Fix: inline `Constant384Embedder` literal honoring `Embedder` DIP (10 LoC; analogous to `ConstantEmbedder` precedent at `v1-1-multi-peer-bitemporal.test.ts:33`).
- **CRIT-2** — `stubLLM([])` is NOT exported. Canonical is `new DeterministicStubLLM()` from `src/llms/stub.js`. The `[]` payload is irrelevant since `infer: false` bypasses LLM.

## MAJOR — design locks
- **MAJ-1** — In-process `app.fetch(new Request(...))` NOT real HTTP on port 8080 (mirrors `tests/integration/rest-api.test.ts` canonical; avoids port collision + spawn overhead).
- **MAJ-2** — PG_URI gate via `describe.skipIf` + `TRUNCATE memories, entities, history RESTART IDENTITY CASCADE` in `beforeEach` + `pool.end()` in `afterAll`. Use `Pool({connectionString, max: 4})`.
- **MAJ-3** — `ScopedMemory.remember()` returns `Promise<readonly MemoryItem[]>`, NOT `{items: []}`. Plan pseudo-code's `r1.items[0].id` is WRONG; correct: `r1[0]!.id`. With `infer: false`, exactly 1 row per call.

## MINOR
- MIN-1: JSON serialization of Date → ISO string; assert `.toBe('2026-01-02T20:00:00.000Z')` (string), NOT `.toBe(new Date(...))`.
- MIN-2: T2.1's `ORDER BY created_at DESC, id ASC` means newer row (2026-01-02) at index 0, older (2026-01-01) at index 1. Correct in plan.
- MIN-3: Use `Pool({ connectionString: PG_URI, max: 4 })`.
- MIN-4: 40-line docstring mirror of sibling sentinel.
- MIN-5: `runMigrations(pool)` may log "orphan-schema detected" warning under db:push — non-blocking.

## INFO
- Path C composition discipline VERIFIED: import set is clean of `@xenova/transformers`. `wireMemoryFromPool` not used.
- `tests/integration/server/` dir must be created; vitest.integration.config.ts glob picks it up.

## Honest TDD note for T3.1 (regression-sentinel pattern)
T3.1 is an END-TO-END integration validator that captures the contract delivered by T2.1+T2.2 (already shipped at `cf17aee` + `cea60b9`). The RED phase for the underlying bug was exercised at the UNIT level during T2.1 iter-2 (3 RED tests against PgvectorStore) and T2.2 iter-3 (5 RED tests against InMemoryVectorStore + getAll). T3.1's role is to LOCK the chain end-to-end; test will GREEN immediately when first run. Per Inquebrável Rule 3 honesty: this is documented in the test docstring + commit body (NOT a TDD-skip; the chain RED was just captured at units already).
