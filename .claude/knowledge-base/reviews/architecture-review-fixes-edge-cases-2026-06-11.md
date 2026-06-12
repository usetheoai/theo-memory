# Edge Case Review — architecture-review-fixes

Date: 2026-06-11
Tasks analyzed: 7 (T1.1, T1.2, T1.3, T1.4, T2.1, T3.1, T3.2)
Edge cases found: 7 (MUST FIX: 3, SHOULD TEST: 2, DOCUMENT: 2)

## MUST FIX

### EC-1: Relative import path MCP→agent-tools will break after tsc compilation
- **Affected task:** T2.1
- **Family:** Build / Integration
- **Scenario:** The plan proposes `packages/mcp/src/run-mcp-server.ts` importing via relative path `../../agent-tools/agent-tools-memory.js`. At source level this resolves. After `tsc` compilation, if MCP emits to `packages/mcp/dist/`, the relative path `../../agent-tools/` resolves to `packages/agent-tools/` (wrong) instead of `src/agent-tools/` (correct). Furthermore, `src/agent-tools/` is NOT a workspace package — it lives in the root `src/` directory. Cross-package relative imports in monorepos are fragile and depend on outDir configuration matching exactly.
- **Impact:** `pnpm build` succeeds but runtime `require()` / `import()` fails with `MODULE_NOT_FOUND` for the 5 shared files. The published `@usetheo/memory-mcp` package is broken.
- **Suggested fix:** Instead of relative paths, make MCP import the shared symbols via the existing `@usetheo/memory/agent-tools` subpath export. Add the 5 shared exports (`createAgentToolsMemory`, `classifyError`, `resolveScope`, `resolveOidcConfig`, `AgentToolsTypes`) to `src/agent-tools/index.ts` (already planned) AND verify `package.json#exports` maps `./agent-tools` to the compiled output. MCP then imports from `@usetheo/memory/agent-tools` — package resolution, not relative paths.

### EC-2: factory.ts will exceed 500 LoC budget (8 helpers + factory + config + error + constant)
- **Affected task:** T1.3
- **Family:** Boundary / Size
- **Scenario:** The plan moves `createLocalMemory` (~169 LoC) + `LocalMemoryConfig` interface + `EvictionNotSupported` class + `PROBE_TEXT` constant + 8 helper functions (`probeEmbedder` ~22 LoC, `validateEmbeddingDim` ~30 LoC, `isStubEmbedder` ~12 LoC, `emitStubEmbedderCacheWarning` ~12 LoC, `isRecallCacheStoreInstance` ~12 LoC, `resolveRecallCacheStore` ~58 LoC, `probeCacheTableDim` ~30 LoC, `resolveCacheTtl` ~30 LoC) to factory.ts. Adding imports + JSDoc, this totals ~500-550 LoC, right at or above the budget.
- **Impact:** Fails the plan's own acceptance criterion "factory.ts <= 500 LoC". Marginal violation, but the plan explicitly set this as a gate.
- **Suggested fix:** Extract cache-related helpers (`isRecallCacheStoreInstance`, `resolveRecallCacheStore`, `probeCacheTableDim`, `resolveCacheTtl`, `isStubEmbedder`, `emitStubEmbedderCacheWarning`) to the `cache-helpers.ts` file ALREADY listed in the Baseline Context table but NOT assigned to any task. factory.ts imports from cache-helpers.ts. This also matches the LCOM4 intent — cache helpers are a distinct concern from the factory assembly.

### EC-3: `applyDimChange` is called by `runMigrations` — extracting both to the same file is correct, but the plan must verify factory.ts does NOT also call it
- **Affected task:** T1.3, T1.4
- **Family:** State / Dependency
- **Scenario:** `runMigrations()` internally calls `applyDimChange()` (confirmed at lines 1506 and 1524 of index.ts). The plan correctly puts both in `migrations-runner.ts`. However, if `createLocalMemory()` in factory.ts also calls `applyDimChange()` or `runMigrations()` internally, a circular dependency is created: factory.ts → migrations-runner.ts → (possibly) factory.ts.
- **Impact:** TypeScript circular imports cause `undefined` at module evaluation time. Tests crash with cryptic errors.
- **Suggested fix:** Verify `createLocalMemory` (lines 1106-1273) does NOT call `applyDimChange` or `runMigrations` directly. Grep confirms it does not — but the implementer MUST validate this before extracting. Add a one-line note to T1.3 Tasks: "Step 0: Verify `createLocalMemory` body has zero references to `applyDimChange` or `runMigrations`."

## SHOULD TEST

### EC-4: Shared helpers called by BOTH LocalScopedMemory AND LocalMemory
- **Affected task:** T1.1, T1.2
- **Suggested test:** `test('local-memory.ts can import filtersFromScope from scoped-memory.ts without circular dep')` — import both modules and verify no module evaluation error. `filtersFromScope` is called by LocalMemory (lines 868, 880, 892 of index.ts for user/session/agent scope creation) and lives in scoped-memory.ts per the plan. The dependency direction (local-memory → scoped-memory) is correct (facade depends on delegate), but the implementer should confirm no reverse import exists.

### EC-5: SkillRepresentationStrategy removal — verify skill-barrel.test.ts tests other symbols too
- **Affected task:** T3.2
- **Suggested test:** Before deletion, read `skill-barrel.test.ts` to confirm it tests OTHER skill barrel exports besides `SkillRepresentationStrategy`. If the test file ONLY tests that one symbol, delete the whole file. If it tests multiple symbols, remove only the `SkillRepresentationStrategy` assertion line. The plan says "remover referencia" but does not specify whether the file should be deleted or edited — the implementer must check.

## DOCUMENT

### EC-6: `cache-helpers.ts` is listed in Baseline Context but NOT assigned to any task
- **Accepted risk:** The Baseline Context table lists `cache-helpers.ts (NEW)` as a file to be created. However, no Phase 1 task creates it. If EC-2 is absorbed (factory.ts too large), the cache-helpers extraction becomes a sub-task of T1.3. If factory.ts stays under 500 LoC without splitting cache helpers, the Baseline row should be removed to avoid confusion. Either way, the plan should be consistent between Baseline and Tasks.

### EC-7: MCP tests mock shared files — mock paths will need updating
- **Accepted risk:** `packages/mcp/src/run-mcp-server.test.ts` (458 LoC) may mock `./agent-tools-memory.js` or `./error-classifier.js` by local path. After T2.1, the mock paths must change to match the new import source. The plan's T2.1 TDD section says "teste existente run-mcp-server.test.ts deve continuar passando" which is correct, but the implementer must audit mock statements (vi.mock / jest.mock) in the test file and update them alongside the production imports.

## Summary

| Task | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------|----------|-------------|----------|
| T1.1 | 1 | 0 | 1 (EC-4) | 0 |
| T1.2 | 1 | 0 | 1 (EC-4) | 0 |
| T1.3 | 2 | 2 (EC-2, EC-3) | 0 | 1 (EC-6) |
| T1.4 | 1 | 1 (EC-3) | 0 | 0 |
| T2.1 | 2 | 1 (EC-1) | 0 | 1 (EC-7) |
| T3.1 | 0 | 0 | 0 | 0 |
| T3.2 | 1 | 0 | 1 (EC-5) | 0 |

**Verdict:** PLAN NEEDS ADJUSTMENT — 3 MUST FIX items require plan v1.1:
- EC-1: Change dedup strategy from relative paths to package subpath imports (affects D2 ADR rationale)
- EC-2: Add cache-helpers.ts extraction as sub-task of T1.3 or new task T1.5
- EC-3: Add pre-flight circular dep check to T1.3 step 0
