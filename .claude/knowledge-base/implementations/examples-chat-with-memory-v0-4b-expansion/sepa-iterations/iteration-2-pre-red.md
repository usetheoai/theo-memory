# SEPA — Iteration 2 / Task T1.1 / Phase PRE-RED

**MODE:** VERBOSE

## Plan recap
- T1.1 wires `lib/memory.ts` to opt-in v0.4b capacity-trigger eviction when `THEOMEM_EVICTION_DEMO=1` AND backend=`pgvector`, default unchanged.

## Findings
- [INFO] — `createMemory` is byte-identical re-export of `createLocalMemory` (src/local/index.ts:701).
- [MAJOR] — Single `createLocalMemory(config)` call site; conditionally add `eviction` field; do NOT branch with two factory calls.
- [MAJOR] — `DisposableMemory` is `Memory + dispose()`. Keep `MemorySingleton.memory: Memory` (no widen); demo never disposes per ADR D5.
- [MINOR] — Use `as const` on `trigger: 'capacity'` if TypeScript widens to `string`.
- [INFO] — `MemorySingleton.eviction` shape locked per plan §216.
- [INFO] — Console log strings locked: `eviction=enabled (capacity, max=10)` / `eviction=disabled (reason: env|backend)`.
- [INFO] — File budget: 102 → ~115 LoC; under 200 LoC AC.
- [INFO] — Vocabulary/paper-name clean.
- [INFO] — ADR D5 sanctions `RED: n/a`. Acceptance at T4.1 E2E.
- [INFO] — `.env.example` exists; UPDATE not CREATE.

## Recommended action
1. Switch import to `createLocalMemory` + `LocalEvictionConfig`.
2. Build `LocalMemoryConfig` once; conditionally add `eviction` field.
3. Compute `evictionEnabled` + `evictionReason` together.
4. Keep `memory: Memory` typing unchanged.
5. Lock `eviction` field shape exactly per plan.
6. GREEN verification:
   - `npm run build` clean
   - Boot env=1 + pgvector → `eviction=enabled (capacity, max=10)`
   - Boot no env → `eviction=disabled (reason: env)`
   - Boot env=1 but no PG_URI → `eviction=disabled (reason: backend)`
