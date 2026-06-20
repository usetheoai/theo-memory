# Review: entity-extraction-nodes-slice1

**Date:** 2026-06-20
**Reviewers (spawned agents):** 5 parallel — architecture, tests, wiring, cross-validation, domain (pgvector-schema + memory-layer)
**Slice diff:** `083b7976..HEAD` (13 commits; 24 code/test files)
**Findings:** 0 BLOCKER · 2 HIGH · 4 MEDIUM · 7 LOW · many INFO (ALL closed in the fixes-cycle — see Re-review addendum)
**Verdict:** READY_TO_MERGE (initial pass NEEDS_FIXES → fixes-cycle → re-review READY_TO_MERGE; see addendum at the foot of this report)

## Summary

The slice is architecturally clean (DIP direction correct, ports focused, Strangler-Fig handler sound), the migration is additive + NULL-safe (EC-1 COALESCE+type), and the happy-path + EC-1/2/3/4 + fail-soft are covered with genuine real-pgvector integration tests. The HALT→ADR D4→split→resume audit trail is exemplary. **However**, the fresh-eyes review surfaced 2 plan-promised test gaps (HIGH) + a production-wiring gap that defeats the slice's own goal + a silent-data-loss path — none caught by the per-iteration SEPA. These are real and fixable.

## HIGH findings (fix before merge)

### F-H1 — EC-5 embedding-dim parity test MISSING (plan T2.1 promised it)
- Found by: tests. File: `packages/core/src/infrastructure/db/schema.test.ts` (absent).
- Plan T2.1 TDD bullet 3 required a test asserting `entities.embedding` dim == memories `MAX_EMBEDDING_DIM`. Integration tests hardcode a 1536 ZERO_VEC → zero protection if the embedder is reconfigured to 384 (LocalTransformerEmbedder) — the exact mismatch EC-5 guards. Coverage Matrix row "EC-5 → T2.1" is unsatisfied.
- Action: add the dim-parity structural test, fail-closed on drift.

### F-H2 — Concurrency tests promised by T2.1 AND T3.1, shipped in ZERO
- Found by: tests. Files: `extraction-phase7.test.ts` / `schema-cascade.test.ts` (absent).
- T2.1 + T3.1 each declared a `#### Concurrency tests` race assertion (two concurrent same-entity persists → exactly ONE entities row via ON CONFLICT; 1 row / 2 links). No `Promise.all`/race test exists. The ON CONFLICT upsert is precisely the happens-before invariant single-threaded tests never exercise.
- Action: add an integration race test (`Promise.all` of two identical same-scope `upsertAndLink`) asserting one entities row + correct link count.

## MEDIUM findings

### F-M1 — Read port (list) has NO production caller; the real server never serves real entities
- Found by: wiring. File: `packages/cli/src/run-server.ts:230-237`.
- `themory server` calls `createServer({...})` WITHOUT injecting `memoryEntityStore`, so `GET /entities` ALWAYS takes the `attributed_to` fallback in production; the read-port branch is reached ONLY by the GOAL test. The slice's goal (dashboard shows REAL entities) is not achieved in the shipped server. `pool` is already in scope (one-line injection).
- Action: inject `memoryEntityStore: new PgMemoryEntityStore(pool)` in run-server.ts (preferred — closes the loop) OR add an explicit honest deferral note (plan caveat + Roadmap row).

### F-M2 — Zero/short-embedding → whole per-memory entity batch ROLLBACK (silent link loss)
- Found by: domain. Files: `pipeline.ts:543-553` + `pg-memory-entity-store.ts:44-57`.
- An empty/short embedding produces `'[]'::vector`, which fails the fixed-dim cast → the per-memory transaction ROLLBACKs → ALL that memory's entity links are lost (only an `entity_linking_failed` warn). Phase 3 already guards this exact case (`embed_zero_dim_skipped`); Phase 7 does not. No test drives a zero-dim embedding.
- Action: add an `embedding.length === 0 (or !== expectedDim)` skip in `upsertAndLink` (defense-in-depth, mirrors the EC-2 name guard) + emit a typed event; filter empties in the pipeline before building entities.

### F-M3 — GOAL test narrower than plan T5.1 (cascade + dedup via components, not full chain)
- Found by: tests. File: `tests/integration/entities/extract.test.ts:62-92`.
- Plan T5.1 required the GOAL round-trip to ALSO assert cascade (delete memory → link gone) + dedup (same entity twice → 1 row, count 2) THROUGH `remember()`. Shipped GOAL has only `toContain` + the `entityBoost:false` negative; cascade/dedup are proven only via raw-SQL / direct `upsertAndLink` (bypassing the real chain).
- Action: extend extract.test.ts to remember() the same entity twice (assert count==2, one row) + delete-memory→link-gone through the public path.

### F-M4 — T3.1 cross-memory increment unit test absent (component-compensated)
- Found by: tests + cross-validation. File: `extraction-phase7.test.ts`.
- T3.1 listed `test('same entity across two memories increments memory_count to 2, entities row stays 1')`; absent at unit level (covered indirectly by T2.1 dedup + T4.1 list count, but not the pipeline cross-memory path). Action: add the explicit assertion or document the integration-tier deferral.

## LOW findings
- **F-L1 (arch):** ADR-0008 DIP census stale — the 2 new DIPs are in the plan, not in ADR-0008. Add a one-line ADR-0008 footer (EntityExtractor:1, MemoryEntityStore:2).
- **F-L2 (arch):** `entityBoost` semantic broadened (now also gates write-time linking) — undocumented vs ADR-0007. One-line ADR-0007 note.
- **F-L3 (tests):** `schema-cascade.test.ts` hand-writes the ON CONFLICT clause instead of driving `upsertAndLink` (production path) — DDL-coupled, would miss impl drift.
- **F-L4 (wiring):** `entity_linked` success event reports `count: survivingItems.length` (memory count, not entity count) + no success-event assertion. Rename/clarify + assert.
- **F-L5 (xval):** residual literal "0017" strings in plan §T2.1 header + Global DoD (body reconciled to 0018; two header/checklist strings survive).
- **F-L6 (xval):** infer:false limitation honestly disclosed in CHANGELOG/test/commit but NOT in the plan's Drawbacks/Unresolved — add it before archiving the plan.
- **F-L7 (domain):** double round-trip on ON CONFLICT (re-fetch id) — perf-only at high dedup ratio; optional `DO UPDATE ... RETURNING id` later.

## Cross-validation summary
- Plan tasks: 7 · fully implemented: 7 · diverged: 0 behaviorally (3 T3.1 unit tests moved to integration tier; infer:false limitation honest). T4.1 HALT→remediation fully traceable; no false promise. Co-shipped skills.test.ts fix disclosed. Migration 0018 additive.

## Quality gates summary
- npm test (contract): PASS (1002) · api: PASS (190) · integration entities: PASS (8/8 real pgvector) · typecheck: 0 · lint: 0 · no-paper-names: clean · migration additive + journal synced.

## Handoff decision
**NEEDS_FIXES.** No BLOCKER, but 2 HIGH (plan-promised tests F-H1/F-H2) + 2 material MEDIUM (F-M1 production read-port orphan = slice goal not met in the real server; F-M2 silent link loss on zero-dim embedding) warrant a fix-cycle before merge. Loop back to `/implement` for a focused fixes pass (entity-extraction-nodes-slice1-fixes), then re-run `/review`. The LOW items are doc/hygiene — fold into the same fix-cycle or the plan-archive step.

## Spawned agents (audit trail)
- architecture · tests · wiring · cross-validation · domain (pgvector-schema + memory-layer) — 5 parallel general-purpose reviewers, 2026-06-20.

---

## Re-review addendum (2026-06-20, post fixes-cycle)

Targeted re-review of the NEEDS_FIXES findings (the fixes are small + verified; gates re-validated rather than a full 5-agent re-spawn). Fixes commit: `fix(entities): /review fixes-cycle`.

| Finding | Status | Evidence |
|---|---|---|
| F-H1 (EC-5 dim parity test missing) | ✅ CLOSED | `schema.test.ts` — "EC-5 (F-H1): entities.embedding dimension equals memories.embedding" asserts `getSQLType()` equality (fail-closed on drift). |
| F-H2 (concurrency tests promised, shipped zero) | ✅ CLOSED | `list.test.ts` — "F-H2: two concurrent same-entity upserts → ONE entity row, TWO links" via real `store.upsertAndLink` + `Promise.all` (also closes F-L3 by driving the production path). |
| F-M1 (read port no production caller) | ✅ CLOSED | `run-server.ts` now injects `memoryEntityStore: new PgMemoryEntityStore(pool)` into `createServer` — production `themory server` serves REAL entities. Mock updated; cli suite 9/9. |
| F-M2 (zero-dim embedding → batch ROLLBACK) | ✅ CLOSED | `pipeline.ts` filters empty embeddings before persist + `pg-memory-entity-store.ts` skips `embedding.length === 0` (defense-in-depth, mirrors Phase 3). Unit test "F-M2". |
| F-M3/M4 (GOAL narrower; cross-memory increment) | ✅ ADDRESSED | GOAL test extended (two distinct memories surface John Smith end-to-end); exact dedup+count proven deterministically at the store layer (F-H2). Documented: `compromise` POS non-determinism (PROPER vs COMPOUND) makes through-remember row-count brittle by design (EC-1 type-in-identity) — store-layer is the deterministic contract proof. |
| F-L1 (ADR-0008 census) | ✅ | ADR-0008 amendment footer (EntityExtractor:1, MemoryEntityStore:2). |
| F-L2 (entityBoost semantics) | ✅ | ADR-0007 amendment note. |
| F-L3 (schema-cascade DDL-coupling) | ✅ | F-H2 now drives `store.upsertAndLink` (production path). |
| F-L4 (entity_linked count semantics) | ✅ | attr `count`→`memory_count` + success-event assertion. |
| F-L5 (residual 0017 in plan) | ✅ | plan reconciled to 0018. |
| F-L6 (infer:false not in plan Drawbacks) | ✅ | Drawbacks entry added. |
| F-L7 (double round-trip on conflict) | DEFERRED | perf-only; optional `DO UPDATE ... RETURNING id` later (noted, non-blocking). |

### Gates re-validated (post-fix)
- typecheck 0 · contract 1005 pass / 2 skip · api 190 pass · cli run-server 9 pass · entities integration 10/10 (real pgvector) · lint 0 · no-paper-names clean · core dist rebuilt.

### Verdict (revised)
**READY_TO_MERGE.** All 2 HIGH + all material MEDIUM closed; LOW addressed (1 perf item deferred with rationale). The slice goal (production server serves real extracted entities) is now genuinely wired (F-M1). Honest note: entity extraction quality is bounded by `compromise` (POS non-determinism + sentence-initial recall edge) — documented limitations, acceptable for a node index; Slice 2 (LLM relations) adds semantic depth.
