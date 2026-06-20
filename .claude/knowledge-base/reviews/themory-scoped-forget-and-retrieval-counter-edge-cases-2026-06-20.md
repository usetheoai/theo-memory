# Edge Case Review — themory-scoped-forget-and-retrieval-counter

Date: 2026-06-20
Plan analyzed: .claude/knowledge-base/plans/themory-scoped-forget-and-retrieval-counter-plan.md
Tasks analyzed: 6 (T1.1, T1.2, T2.1, T2.2, T2.3, T2.4)
Edge cases found: 6 (MUST FIX: 3, SHOULD TEST: 2, DOCUMENT: 1)

## MUST FIX

### EC-1: hard delete of a memory with entity links / FK rows
- **Affected task:** T1.1 (`deleteInScope` hard path)
- **Family:** Data integrity / FK cascade
- **Scenario:** A memory created post-slice1/2 has rows in `memory_entities` and may be a `source_memory_id` in `entity_edges`. A physical `DELETE FROM memories WHERE id=...` (the hard path) will FAIL if those child FKs are NOT `ON DELETE CASCADE`/`SET NULL`, OR will orphan rows if they are unconstrained.
- **Impact:** `forget(id,{hard:true})` throws (500) on any entity-linked memory → breaks GDPR hard-delete on exactly the rows the new graph feature creates.
- **Suggested fix:** T1.1 Deep Dives MUST verify the FK behavior of `memory_entities.memory_id` + `entity_edges.source_memory_id` against `memories.id`; if not already CASCADE/SET NULL, the hard path deletes child rows first (same tx) OR the migration adds the cascade. Add RED test `test_hard_forget_of_entity_linked_memory_succeeds()`. Resolves plan Unresolved Q2.

### EC-2: metrics handler has no path to the counter store
- **Affected task:** T2.4
- **Family:** Wiring / DIP
- **Scenario:** `metricsHandler(c, memory)` only receives `Memory` today; the `UsageCounterStore` is wired in the core factory, not exposed on `Memory`. T2.4 says "thread via app options" but the plan does not name the seam.
- **Impact:** Without an explicit seam, the handler cannot read `getRecallCount` → either fabricates 0 (defeats the feature) or reaches into internals.
- **Suggested fix:** Make the seam explicit: add `AppOptions.usageCounterStore?: UsageCounterStore` to `createServer` (MIRROR the existing `AppOptions.memoryEntityStore` at `app.ts:138`), inject it from `run-server.ts`, pass to `metricsHandler(c, memory, usageCounterStore?)`. Add `app.ts` (AppOptions) to T2.4 Files-to-edit + Baseline table. 0-fallback when option omitted (D4).

### EC-3: workspace-key normalization must be identical on write + read + UNIQUE
- **Affected task:** T2.2
- **Family:** Correctness / split-counter
- **Scenario:** `increment` (UPSERT), `getRecallCount` (SELECT), and the table UNIQUE all key on the scope tuple. If one uses `workspace_id` raw and another `COALESCE(workspace_id,'default')` (or `filters.workspace_id ?? 'default'` in TS vs SQL COALESCE), a recall could increment one row but the read SELECT a different row → metric reads 0 despite recalls.
- **Impact:** Silent under-count (metric stays 0) — the exact bug the feature fixes.
- **Suggested fix:** T2.2 Deep Dives MUST pin ONE normalization (recommend: TS normalizes `workspace_id ?? 'default'` + `user_id/session_id/agent_id ?? null`, SQL UNIQUE uses `COALESCE(col,'')` consistently for all four; increment + getRecallCount use the IDENTICAL COALESCE expression — copy the edge-store idiom `pg-memory-graph-store.ts:30-33`). Add RED `test_increment_and_read_agree_on_workspace_key()`.

## SHOULD TEST

### EC-4: double soft-forget idempotency
- **Affected task:** T1.1
- **Suggested checkpoint:** assert soft `deleteInScope` on an already-soft-deleted row returns `false` (→ 404). The soft WHERE includes `t_invalid IS NULL`, so the second call matches 0 rows. Test `test_double_soft_forget_returns_404()` to lock the idempotent-404 behavior (the gateway may retry).

### EC-5: counter under concurrent recall + a slow/locked row
- **Affected task:** T2.3 / T2.2
- **Suggested checkpoint:** the atomic-counter concurrency test already covers lost-update; ALSO assert that a recall whose counter UPSERT is delayed (e.g. lock contention simulated) still returns its results within the recall path (fail-soft does not block on counter latency — the increment is awaited but its FAILURE is swallowed; confirm a thrown/timeout counter does not surface). Covered by T2.3 throwing-stub test; note the latency dimension is acceptable (awaited, not fire-and-forget) per D3.

## DOCUMENT

### EC-6: skill-scope recalls are NOT counted
- **Accepted risk:** `retrieval_api_usage` counts `LocalScopedMemory.recall` (user/session/agent) only. `ScopedSkillMemory.recall` (`scoped-skill-memory.ts:159`) is a separate class + the metrics endpoint is user/session/agent-only — skill recalls are out of scope for this metric. Document in the metrics JSDoc + T2.3 (no skill-path increment). Consistent with the metrics endpoint's existing scope.

## Summary

| Task | Edges | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------|----------|-------------|----------|
| T1.1 | 2 | EC-1 | EC-4 | — |
| T2.2 | 2 | EC-3 | EC-5 | — |
| T2.3 | 1 | — | (EC-5) | EC-6 |
| T2.4 | 1 | EC-2 | — | — |

**Verdict:** PLAN NEEDS ADJUSTMENT — absorb EC-1, EC-2, EC-3 (MUST FIX) into v1.1 before /plan-confidence.
