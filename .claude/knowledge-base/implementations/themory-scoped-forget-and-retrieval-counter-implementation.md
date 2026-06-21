# Implementation summary — themory-scoped-forget-and-retrieval-counter

**Plan:** `.claude/knowledge-base/plans/themory-scoped-forget-and-retrieval-counter-plan.md` (v1.1)
**Branch:** `develop`
**Completed:** 2026-06-21
**Integration DB:** real `ankane/pgvector:v0.5.1` (`THEOMEM_PG_URI`)

## Goal (met)

> Enable the theo-cloud gateway to delete a memory by id without an O(scope) ownership pre-check AND read a real recall-usage number — measured by (a) `DELETE /v1/scopes/user/alice/memories/{id}` → 204 owned / 404 cross-scope, and (b) `retrieval_api_usage` > 0 after one `recall()` against real pgvector.

Both proven: T1.2 integration (204/404/422 + cross-subject victim intact) and T2.4 GOAL e2e (2 recalls through the server → `retrieval_api_usage == 2`).

## Tasks (6/6 committed)

| Task | Commit | Wiring (a/b/c) | What |
|---|---|---|---|
| T1.1 | `1068f77` | pass/pass/n-a | `VectorStore.deleteInScope(id, filters, hard)` (pgvector + in-memory) + `ScopedMemory.forget(id, {hard?})` (scope+workspace checked; MemoryNotFound on miss) |
| T1.2 | `89b59e2` | pass/pass/n-a | `DELETE /v1/scopes/:type/:id/memories/:memId` (+`?hard`); 204/404/422; rate-limited; OpenAPI |
| T2.1 | `e5bb07d` | n-a | `scope_usage_counters` table (migration 0020) + UNIQUE COALESCE arbiter |
| T2.2 | `6a2c335` | pass/pass/n-a | `UsageCounterStore` DIP + `PgUsageCounterStore` (atomic ON CONFLICT +1; EC-3 byte-identical COALESCE); gated factory wiring + barrels |
| T2.3 | `d19117c` | pass/pass/pass | fail-soft recall counter increment (3 paths, once/recall; `retrieval_counted_failed` 24th event; EC-6 skill not counted) + fixed pre-existing p0-audit export baselines |
| T2.4 | `e601115` (+ `34f4d19` mock) | pass/pass/pass | `metrics.ts` reads real `retrieval_api_usage` via `AppOptions.usageCounterStore` seam; run-server injects `PgUsageCounterStore` (same pool); 4-field shape unchanged; CHANGELOG |

## Edge cases absorbed

- **EC-1** (T1.1) hard delete cascades via entity-link FKs (ON DELETE CASCADE in 0018/0019 — no children-first logic).
- **EC-2** (T2.4) metrics→counter seam via `AppOptions.usageCounterStore` (mirrors `memoryEntityStore`).
- **EC-3** (T2.2/T2.4) identical `COALESCE(col,'')` across the UNIQUE index + increment ON CONFLICT arbiter + getRecallCount WHERE; `workspace_id ?? 'default'` on both write + read → no split counter.
- **EC-6** (T2.3) skill scope served by `LocalScopedSkillMemory` (not wired) → not counted (test-proven).

## Validation

- Contract (`npm test`): PASS (1031 tests).
- Full integration vs real pgvector: 594 passed | 61 skipped | **0 failed** (107 files).
- `npm run typecheck`: PASS. `npm run lint`: PASS. Wiring triad: PASS. Coverage: SKIP (no `test:coverage` script).
- Phase 1 + Phase 2 boundary mini-reviews: PHASE_REVIEW_PASS.
- SEPA consulted 3×/iteration (pre-RED / post-GREEN / pre-COMMIT) — zero unresolved CRITICAL/MAJOR.

## Honest disclosures (Inquebrável Rule 3)

- T2.3 also fixed the p0-audit public-surface sentinels (exports-root/exports-contract/full-public-surface) that were **already RED on develop** before this plan — the entity-extraction slices (`a80a4e6`/`dbbf564`, 2026-06-20) grew both barrels without updating count baselines or per-export JSDoc. Updated baselines (13/47) + backfilled per-export JSDoc+@see for the export block touched. Pure docs/test-baseline; no behavior change to those slices.
- Backward-compatible: `POST /v1/forget` unchanged; `usageCounterStore` optional (0-fallback). Gateway cutover to the DELETE endpoint + counter is a sequenced follow-up, not in this plan.

## Follow-ups (deferred)

- F1: extract `_scope-params.ts` (DRY `filtersFor` + `pathParamsToScoped` across metrics/entities/graph/scoped-forget handlers).
