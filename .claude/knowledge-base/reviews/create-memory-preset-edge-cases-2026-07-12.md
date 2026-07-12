# Edge Case Review — create-memory-preset

Date: 2026-07-12
Tasks analyzed: 4 (T1.1, T1.2, T2.1, T2.2)
Cases found: 9 (EDGE: 3, NEGATIVE: 6 | MUST FIX: 3, SHOULD TEST: 3, DOCUMENT: 3)

All findings are grounded in the real code, not speculation:
- `DeterministicStubLLM.generateResponse({type:'json'})` returns **up to 3 extracted facts** for non-empty input (`packages/core/src/infrastructure/llms/stub.test.ts:76`) and `{ memory: [] }` only for empty content (`:100`) → the stub round-trip IS viable (no zero-facts problem).
- The existing canonical round-trip uses `recall('coffee', { topK: 3, threshold: 0 })` (`tests/integration/local-runtime.test.ts:99`) — cross-text cosine under a stub embedder is low, so `threshold: 0` is required.
- `OpenAIEmbedder` reads `process.env['OPENAI_API_KEY']` via a **module-global lazy singleton** `_openai` (`packages/core/src/infrastructure/embedders/openai.ts:44`).

## MUST FIX

### EC-1: Pool leak when migration/assembly fails
- **Affected task:** T1.2
- **Kind:** NEGATIVE (failure mid-operation)
- **Family:** Resource
- **Scenario:** `resolvePreset` does `pool = new pg.Pool(...)`, then `assemblePresetMemory` calls `runMigrations(pool, …)`. `pg.Pool` connects lazily, so a bad/unreachable `postgres` URI (or any migration error) throws INSIDE `runMigrations` — after the pool object exists but before the dispose-wrapped memory is returned. The pool is never `.end()`ed.
- **Impact:** Leaked pool / open sockets on every failed boot (Unbreakable Rule 8 resource discipline). The plan's Failure-scenarios row promises "no leaked open pool" but no task implements the cleanup.
- **Suggested fix:** In `assemblePresetMemory` (and/or `resolvePreset`), wrap the migrate+wire steps in `try { … } catch (e) { await pool.end(); throw e }` so a failed boot closes the pool it opened.

### EC-2: GOAL TEST assertion is invalid for the stub round-trip
- **Affected task:** T2.2
- **Kind:** EDGE (boundary of the valid recall path)
- **Family:** State / Format
- **Scenario:** The plan's pseudo-code remembers `'needle in a haystack'` and asserts `results.some(r => r.text.includes('needle'))` with the default recall threshold. But (a) the STORED item is the **LLM-extracted fact** (deterministic stub output), not the raw input text, so a substring match on `'needle'` is not guaranteed; and (b) under `DeterministicStubEmbedder`, the query vector for the recall string differs from the stored-fact vector → cosine is low and the default threshold filters it out (this is exactly why `local-runtime.test.ts:99` passes `threshold: 0`).
- **Impact:** The load-bearing GOAL TEST (the plan's single metric) would fail or be flaky, invalidating the plan's proof.
- **Suggested fix:** Mirror the canonical test — `recall(query, { topK: 3, threshold: 0 })` and assert `results.length > 0` (the extracted fact is recalled + migrations fired), not a substring of the raw input.

### EC-3: `embeddingDim` override on the preset cannot be honored
- **Affected task:** T1.1, T1.2 (ADR D4)
- **Kind:** NEGATIVE (invalid-but-accepted config)
- **Family:** Input / Format
- **Scenario:** The preset always constructs `OpenAIEmbedder` (fixed `text-embedding-3-small`, 1536-dim output). If a consumer passes `createMemory({ postgres, openai, embeddingDim: 768 })`, the preset threads 768 into the store + migrations, but `probeEmbedder` (inside `createLocalMemory`, `factory.ts`) gets a 1536-length vector and throws `EmbeddingMismatch`. The override is a footgun that can only ever fail — the preset cannot swap the embedder to match a custom dim.
- **Impact:** A public config field that is guaranteed to break the boot; contradicts "zero-config" and P0 "all public APIs correct".
- **Suggested fix:** Drop `embeddingDim` from `CreateMemoryPresetConfig` (YAGNI — parsimony rung 1). The preset is always 1536; a consumer needing a different dim uses the full-config path. Update ADR D4 accordingly.

## SHOULD TEST

### EC-4: Empty / whitespace `postgres` string
- **Affected task:** T1.2
- **Kind:** NEGATIVE
- **Suggested test:** `test_resolvePreset_rejects_empty_postgres_with_typed_error` — call the preset with `{ postgres: '' }` and assert it rejects with a specific typed error + clear message BEFORE opening a pool (not a deferred opaque pg error). `isPresetConfig` returns `true` for `{postgres:''}` (`typeof '' === 'string'`), so the fail-fast must live in `resolvePreset`.

### EC-5: `openai: ''` must not clobber the ambient key
- **Affected task:** T1.2
- **Kind:** NEGATIVE
- **Suggested test:** `test_resolvePreset_empty_openai_does_not_overwrite_ambient_key` — set `process.env.OPENAI_API_KEY = 'ambient'`, call preset with `{ postgres, openai: '' }`, assert `process.env.OPENAI_API_KEY === 'ambient'` (guard must be truthy `if (config.openai)`, NOT `!== undefined`). Prevents a misconfigured empty env-read from silently wiping a valid ambient key.

### EC-6: `migrate: false` against an un-migrated DB
- **Affected task:** T2.2
- **Kind:** NEGATIVE
- **Suggested test:** `test_preset_migrate_false_on_empty_db_surfaces_clear_error` — assemble with `migrate: false` against a fresh schema, then `recall`, and assert the error is a clear missing-relation error (not a silent empty result). Confirms the opt-out is the consumer's explicit, observable choice (Failure-scenarios row 2).

## DOCUMENT

### EC-7: Single OpenAI key per process (module-global singleton)
- **Kind:** NEGATIVE
- **Accepted risk:** `OpenAIEmbedder`/`OpenAILLM` use a module-global lazy singleton `_openai` (`openai.ts:44`) built on first API call. If OpenAI was already used before the preset, OR the preset is called twice with different `openai` keys, the FIRST key wins and later keys are silently ignored. Accepted for v1 — this is the D2 env-set tradeoff; the deferred constructor-threading alternative (D2 rejected-alt) is the clean fix if multi-key-per-process is ever needed. Document in the preset JSDoc + CHANGELOG: "one OpenAI key per process; for multiple keys use the full-config path with distinct embedder/llm instances."

### EC-8: Concurrent preset boots race migrations on a fresh DB
- **Kind:** EDGE (two simultaneous valid boots)
- **Accepted risk:** Two `createMemory({postgres})` calls on the same fresh DB concurrently both invoke `runMigrations`. Drizzle migration concurrency is a pre-existing concern (`tests/integration/migration-no-concurrently.test.ts`) and out of this plan's scope. Document: boot the preset once per process (singleton), matching `examples/chat-with-memory/lib/memory.ts` (`getSingleton`).

### EC-9: `process.env.OPENAI_API_KEY` set globally, not restored
- **Kind:** EDGE
- **Accepted risk:** Per ADR D2 the preset mutates process-global env when `openai` is provided and does not restore it. Already listed in the plan's Drawbacks table; keep as a documented, opt-out-able (omit `openai`) side-effect.

## Summary

| Task | EDGE | NEGATIVE | MUST FIX | SHOULD TEST | DOCUMENT |
|------|------|----------|----------|-------------|----------|
| T1.1 | 0 | 1 | 1 (EC-3) | 0 | 0 |
| T1.2 | 0 | 4 | 1 (EC-1) | 2 (EC-4, EC-5) | 1 (EC-7) |
| T2.1 | 0 | 0 | 0 | 0 | 0 |
| T2.2 | 2 | 1 | 1 (EC-2) | 1 (EC-6) | 1 (EC-8) |
| (cross) | 1 | 0 | 0 | 0 | 1 (EC-9) |

**Coverage check:** every task touching an input boundary (T1.2 preset input, T2.2 round-trip I/O) has both an EDGE and a NEGATIVE case considered. T2.1 is a pure type-level dispatcher (no runtime input boundary) — no runtime edge case applies; its safety is proven by the `index.test-d.ts` disjointness type test already in the plan.

**Verdict:** PLAN NEEDS ADJUSTMENT — 3 MUST FIX (EC-1 pool leak, EC-2 invalid GOAL-TEST assertion, EC-3 unhonorable `embeddingDim` override). All fixes are small (a try/catch, a corrected assertion, dropping one field). Absorb into plan v1.1, then re-run `/plan-confidence`.
