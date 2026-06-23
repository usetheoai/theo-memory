# Implement Validation — graph-aware-recall

**Date:** 2026-06-22
**Plan:** `.claude/knowledge-base/plans/graph-aware-recall-plan.md`
**Verdict:** PASS
**Commit:** `23d0715` feat(retrieval): graph-aware recall — entity-graph-augmented retrieval

## Gates

| Gate | Result |
|---|---|
| `tsc --noEmit -p tsconfig.contract.json` | PASS — 0 errors |
| `npm run build:core` (exactOptionalPropertyTypes) | PASS |
| Contract suite (`vitest.contract.config.ts`) | PASS — 1173 passed, 2 skipped (incl. DIP type test, 2 event-union, RecallOptions.graphExpand type, 6 pipeline Step 8.7, 4 in-memory traversal) |
| GOAL integration (`tests/integration/graph-aware-recall.test.ts`) vs real `ankane/pgvector:v0.5.1` (canonical integration config) | PASS — 2/2 (shared-entity below-threshold surfaces + default-unchanged + scope isolation), exercising the REAL entity-linking write path + the REAL PgGraphExpansionStore JOIN |
| `/code-quality graph-aware-recall` | PASS (0 hard/soft caps) |

## Tasks (TDD per task)

- **T1.1** `GraphExpansionStore` DIP (1 method, ADR-0008) + types + type-level test. GREEN (tsc).
- **T2.1** 2 `MEMORY_EVENTS` literals (32→34) + `RecallOptions.graphExpand` + tests. GREEN (18 event tests).
- **T3.1** pipeline Step 8.7 pool-expansion (banded score, EC-1 dedup, fail-soft, events) + scoped-memory thread + cache bypass. 6 pipeline tests GREEN.
- **T4.1** `PgGraphExpansionStore` (the JOIN, 1/2 hop, scope-confined). Integration-tested by the GOAL.
- **T4.2** `InMemoryGraphExpansionStore` test-double + 4 unit tests (shared-entity weight, EC-1 seed exclusion, EC-2 scope confine, limit). GREEN. Used as a real caller in the pipeline test.
- **T4.3** `LocalMemoryConfig.graphExpansionStore?` slot + factory auto-default (mirror `memoryGraphStore`) + DIP type export from `/contract` (core 55→56, both p0-audit snapshots reconciled). GREEN.
- **T5.1** GOAL integration (real pgvector) 2/2 + full gate. GREEN.

## Wiring triad

- **Caller:** `createLocalMemory({ graphExpansionStore })` (auto-defaulted `PgGraphExpansionStore` from the pool) → `scoped-memory` threads it into the pipeline deps → Step 8.7 calls `expandByEntities`. Exercised end-to-end by the GOAL.
- **Integration test:** `tests/integration/graph-aware-recall.test.ts` (real pgvector, real entity-link + JOIN).
- **Runtime observability:** 2 typed `MEMORY_EVENTS` literals via `emitEvent` (expanded/failed) + fail-soft never-crashes.

## Edge cases absorbed (edge-case-plan)

- EC-1 (dedup connected row already in pool) — pipeline test.
- EC-2 (candidate-side scope isolation; no cross-scope leak) — in-memory unit test + GOAL scope-isolation scenario (entities are scope-partitioned + explicit scope filter, defense-in-depth).
- EC-3 (graphExpand set but no store ⇒ no-op) — pipeline test.
- EC-4 (hub-entity fan-out) — documented; bounded by LIMIT + 1-hop default + index-backed JOIN.

## Plan refinements (honest disclosure, Inquebrável Rule 3)

- **DIP returns rows+weights in ONE query** (refines blueprint D1's "ids+weights then fetch"): `GraphExpansionRow = { result: VectorStoreResult; sharedEntities }` — strictly fewer round-trips, no new `VectorStore` method. Documented in plan ADR D1.
- **EC-2 at integration level:** a true cross-scope shared-entity-id leak is STRUCTURALLY impossible (entities are partitioned by `(scope, normalized_key)` UNIQUE — two scopes can never share an entity row id). The candidate-side scope filter is defense-in-depth. EC-2 is unit-tested at the traversal-logic level (InMemoryGraphExpansionStore, which CAN model a shared id across scopes) + asserted at the integration level (a different user's memory does not surface).
- `rowToResult` + `MemoriesRow` exported from `pgvector-store.ts` for DRY reuse by `PgGraphExpansionStore` (cross-module within `infrastructure/db/`, not a public-barrel export).

## Notes

- ZERO new dependency; NO new migration (the 3 tables + their indexes already exist).
- No paper names in `src/**` (GraphRAG cited in plan/blueprint only).
- Integration suite must run `--no-file-parallelism` (known dist-race flake). Pre-existing `pgvector-store.test.ts` dual-module-identity + mem0 reference-clone failures are NOT introduced by this cycle.
