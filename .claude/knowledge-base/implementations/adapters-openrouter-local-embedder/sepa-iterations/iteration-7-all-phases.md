# SEPA — Iteration 7 / Task T2.1 / Combined log

## SEPA pre-RED (abridged)
7 findings adopted: EC-13 path verified (`tests/unit/**/*.test.ts` glob match), EC-11 loud-fail pre-precedence validation structure, RED test naming for 3 unknown-value cases + error message lists 3 valid values, MemorySingleton widening (adapterSource union + new embedderDim field), adapter wiring (LocalTransformerEmbedder + OpenAILLM with ZERO code change for OPENAI_BASE_URL routing per ADR D5), LJM guard naturally widens correctly (adapterSource === 'stub' check passes local-openrouter through), console.log line for embedderDim.

## Implementation
- `examples/chat-with-memory/lib/memory.ts`:
  - Imported `LocalTransformerEmbedder` from `@usetheo/memory/embedders/local`
  - Widened `MemorySingleton.adapterSource` union to `'stub' | 'openai' | 'local-openrouter'`
  - Added `MemorySingleton.embedderDim: number` field
  - Added exported `BackendMode` type + `resolveBackendMode()` helper with EC-11 loud-fail validation
  - Refactored `resolveAdapters(mode)` to 3-way switch returning `embedderDim` for each branch
  - Widened `buildStore(embeddingDim)` to propagate dim to `runMigrations({ embeddingDim })` (T0.3 atomic ALTER) + `PgvectorStore(pool, { embeddingDim })` (T0.2 constructor option)
  - Wired `embedderDim` into `getSingleton` factory + `LocalMemoryConfig.embeddingDim` + console.log + returned singleton
- `tests/unit/examples/chat-with-memory-memory.test.ts` (NEW, EC-13 absorption): 12 RED tests covering:
  - Precedence ladder (7 tests): default openai, 3 valid values, legacy stub flag, 2 precedence-wins cases
  - EC-11 loud-fail (5 tests): underscore typo, uppercase variant, generic typo, error message lists 3 valid values, empty-string treated as unset
- `vitest.contract.config.ts`: added `resolve.alias` for `server-only` → existing shim (same pattern v0-7 cycle uses for integration tests; contract tests now also need it since EC-13 lands a unit test that imports examples/chat-with-memory/lib/memory.ts)

## Post-GREEN sanity
- 12/12 new T2.1 unit tests PASS
- 658/660 full contract suite PASS (2 skipped env-conditional pre-existing)
- npm run typecheck: 0 errors
- npm run lint: 0 warnings

## Wiring triad
- (a) static caller: PASS — resolveBackendMode + resolveAdapters called from getSingleton in same file; getSingleton called from getMemory + getBackend + getConflictResolutionPolicy + chat-with-memory route handlers
- (b) integration test: defer to T4.1 (demo HTTP surface against running dev server with /api/info shape verification)
- (c) runtime metric: n/a

## SOLID / Clean Code / DRY
- SRP: resolveBackendMode (env precedence) vs resolveAdapters (adapter wiring) split correctly
- OCP: new mode added via switch case (mode union widening is the OPEN point); legacy stub flag preserved via precedence ladder
- DIP: no cross-layer leakage; embedders imported via subpaths
- Naming: no paper names; "local-openrouter" is a deployment-mode coordinate
- No console.log in production paths beyond the existing demo boot-time signal (eslint-disable already present)

## Decision applied by main session
APPROVE COMMIT. T2.1 wires Phase 0 SDK + Phase 1 LocalTransformerEmbedder into the demo singleton. T2.2 (next iteration) extends /api/info route to surface `adapterSource` + `embedderDim` per Goal metric.
