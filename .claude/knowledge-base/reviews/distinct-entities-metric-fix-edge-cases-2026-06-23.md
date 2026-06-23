# Edge Case Review — distinct-entities-metric-fix (EG-3)

Date: 2026-06-23
Tasks analyzed: 2 (T1.1, T2.1)
Edge cases found: 4 (MUST FIX: 0, SHOULD TEST: 2, DOCUMENT: 2)

The plan mirrors a shipped precedent (`entitiesHandler` ADR-D4, `f108c99`) and is low-risk (read-only metric, one extra `list()` call, no DIP/migration/export change). No MUST FIX. Two SHOULD TEST strengthen the single-source-of-truth claim; two DOCUMENT accept conscious trade-offs.

## SHOULD TEST

### EC-1: consistency must hold on the FALLBACK path too (not only the wired path)
- **Affected task:** T1.1
- **Scenario:** when NO `memoryEntityStore` is wired, `metricsHandler` counts distinct `attributedTo` peers AND `entitiesHandler` ALSO derives from `attributedTo` (same fallback). So the single-source-of-truth (metrics == entities) actually holds on BOTH paths — this is a strength worth pinning so a future change to one fallback but not the other re-introduces the bug silently.
- **Suggested test:** `it("metrics entity_count equals entities length on the no-store fallback path too")` — with NO store, seed items with 2 distinct `attributedTo` peers → assert `metrics.entity_count === entities.length === 2`.

### EC-2: scope/workspace params MUST be byte-identical between the two handlers
- **Affected task:** T1.1
- **Scenario:** the equality only holds if `metricsHandler` calls `list({ workspaceId, filters })` with the EXACT same `workspaceId` resolution (`principal?.workspaceId ?? DEFAULT_WORKSPACE_ID`) and `filtersFor(type, id)` that `entitiesHandler` uses. A drift (e.g. metrics forgetting the principal workspace) would make them diverge again under multi-tenant.
- **Suggested test:** `it("metrics uses the same workspace+scope as entities")` — set a principal with a non-default `workspaceId`; assert the fake store's `list` is called with that workspaceId + the correct single-tier filter (spy on the params), matching the entities handler's call.

## DOCUMENT

### EC-3: `entity_count = list().length` materializes all rows (O(entities) per /metrics call)
- **Accepted risk:** `list()` returns full `EntityNodeSummary[]`; counting via `.length` materializes every entity row for the scope. This mirrors what `entitiesHandler` already does on every Entities-tab load — NO new DOS surface, same exposure as the shipped endpoint. A dedicated `count()` would require widening the `MemoryEntityStore` DIP (ADR-0008 — forbidden by this plan's scope). Accepted per KISS; dashboard scope sizes make this immaterial. If a scope ever holds pathologically many entities, that is a separate capacity concern shared with the entities endpoint, not introduced here.

### EC-4: `entity_count` meaning differs by deployment (store-wired vs absent)
- **Accepted risk:** already ADR D2. Store-wired (production/pgvector) = distinct graph entities; store-absent (in-memory/tests) = distinct attributed peers. Production always wires the store, so the user-visible dashboard is always graph entities. Documented in the handler JSDoc + ADR D2. Gateway treats `entity_count` as an opaque integer (`client.go:117`).

## Summary

| Task | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------|----------|-------------|----------|
| T1.1 | 4 | 0 | 2 | 2 |
| T2.1 | 0 | 0 | 0 | 0 |

**Verdict:** PLAN OK (no MUST FIX). Absorb the 2 SHOULD TEST into T1.1's TDD (fallback-consistency + workspace-param parity) to harden the single-source-of-truth guarantee; the 2 DOCUMENT items are already covered by ADR D2 / the entities-handler precedent.
