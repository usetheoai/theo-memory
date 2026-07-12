# SEPA — Initial Brief / create-memory-preset

> Generated 2026-07-12. NOTE: the per-plan SEPA agent (`implement-create-memory-preset-sepa`) is not hot-loadable in this session (agent registry snapshotted at session start). This brief was produced by a `general-purpose` READ-ONLY surrogate executing the same SEPA role contract (`agents/implement-create-memory-preset-2026-07-12/sepa.md`).

## Plan recap
4 tasks add a non-breaking preset overload to `createMemory({ postgres, openai })` wiring `OpenAIEmbedder`+`OpenAILLM`+`PgvectorStore`+`pg.Pool`, auto-migrating (opt-out), owning the pool lifecycle, returning a `DisposableMemory`. Phase 1 (T1.1 type+`isPresetConfig`, T1.2 `assemblePresetMemory`+`resolvePreset` in new `preset.ts`); Phase 2 (T2.1 dispatcher replacing the alias, T2.2 integration GOAL TEST + CHANGELOG).

## Findings (verified against real code)

- **INFO — D1 discriminator SAFE.** `LocalMemoryConfig` (`config.ts:33`) + `MemoryConfig` (`memory-store.ts:224`) have NO `postgres` field. `typeof input.postgres === 'string'` is sound. Keep the `index.test-d.ts` disjointness guard.
- **INFO — D2 env-set NECESSARY.** `OpenAIEmbedder` (`embedders/openai.ts:42-47`) + `OpenAILLM` (`llms/openai.ts:53-58`) build a module-global lazy singleton `_openai = new OpenAI({ apiKey: process.env['OPENAI_API_KEY'] })`, no constructor apiKey. Binding is at FIRST API call (EC-9 JSDoc `openai.ts:21`), so EC-7 one-key-per-process is real. EC-5 truthy guard mandatory.
- **INFO — T2.1 non-breaking invariant REAL.** `factory.ts:287` = `export { createLocalMemory as createMemory };`. `matrix.test.ts:106` asserts name presence; `index.test-d.ts:100` types the full-config path. A single union signature satisfies both.
- **MAJOR — EC-2 justification imprecise but assertion CORRECT.** For `DeterministicStubLLM` (`llms/stub.ts:76`), a single-sentence input's extracted fact text EQUALS the raw text (`local-runtime.test.ts:101` even asserts `.toBe('Paulo likes coffee')`). So "stored item is not the raw text" is imprecise. BUT the load-bearing constraint is `threshold: 0` (`DeterministicStubEmbedder` `embedders/stub.ts:107` → different vectors for different text → low cosine). Keep `results.length > 0` + `threshold: 0`; do NOT weaken to a bare default-threshold assertion.
- **MAJOR — `assemblePresetMemory` seam export UNRESOLVED in plan.** T2.2 imports it as the CI-runnable seam, but T2.1 only barrel-exports `CreateMemoryPresetConfig` + `InvalidPresetConfig`. DECISION (absorbed): keep `assemblePresetMemory` `@internal` in `preset.ts`; the integration test deep-imports it (mirroring `resolveChatModel` `@internal` at `llms/openai.ts:76`). Do NOT add it to the `index.ts` barrel (would widen public surface + re-trip surface-enumeration tests).
- **MINOR — stale `embeddingDim?` in Objective prose (plan §"preset shape" / Objective).** v1.0 echo; the type + `assemblePresetMemory` params correctly omit it (D4/EC-3). Doc drift, fixed.
- **MINOR — surface tests.** After T2.1, confirm `matrix.test.ts` + `full-public-surface.test.ts` tolerate the new exports (they assert presence, not exact count).
- **INFO — `runMigrations(pool, { embeddingDim? })` (`migrations-runner.ts:34`) matches the D3/D4 call.**

## Recommended action
- Proceed — implementable; load-bearing invariants verified.
- T2.2: assert exactly `recall(q, { topK: 3, threshold: 0 })` then `expect(results.length).toBeGreaterThan(0)`.
- Seam: `assemblePresetMemory` `@internal`, deep-imported by the test; state the decision in the T2.1/T2.2 commit body.
- EC-1: land `test_assemble_ends_pool_on_migration_failure` + `test_assemble_dispose_ends_pool_once` FIRST; `try/catch pool.end()` + once-guarded dispose.
