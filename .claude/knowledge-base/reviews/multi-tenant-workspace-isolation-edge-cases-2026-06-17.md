# Edge Case Review — multi-tenant-workspace-isolation

Date: 2026-06-17
Tasks analyzed: 7 (T0.1, T0.2, T1.1, T1.2, T2.1, T3.1, T4.1)
Edge cases found: 11 (MUST FIX: 5, SHOULD TEST: 4, DOCUMENT: 2)

Boundaries mapped: the security property lives at three boundaries — (a) the credential→Principal resolution (auth), (b) every store query (`WHERE workspace_id`), (c) the migration backfill. Edge cases cluster there; internal pure logic (scoring, embedding) is untouched and trusted.

## MUST FIX

### EC-1: A store path that joins to a leaf table (entities/recall_cache) without a denormalized workspace_id can leak across workspaces
- **Affected task:** T1.1 + T1.2
- **Family:** Permission
- **Scenario:** The blueprint says leaf rows "inherit via join". But `composeFilters` adds `workspace_id` to `memories` only. If any query reads `entities` or `recall_cache` by a key that is NOT itself workspace-filtered (e.g. a cache lookup by query-embedding cosine BEFORE joining to memories), a ws-B row can surface for a ws-A Principal.
- **Impact:** Silent cross-workspace data leak — the exact IDOR the plan exists to close.
- **Suggested fix:** D-LEAF decision: denormalize `workspace_id` on `entities` + `recall_cache` too (they ARE directly queried), not "inherit via join". Plan already lists both in the 6-table set — make the ADR explicit that NO table is join-inherited; every directly-queried table carries the column. (1 sentence in D5.)

### EC-2: `resolvePrincipal` returning a Principal for a revoked/expired key would open every workspace
- **Affected task:** T2.1
- **Family:** Permission
- **Scenario:** The lookup SQL must keep `revoked_at IS NULL AND (expires_at IS NULL OR expires_at > NOW())`. If the SELECT that now also fetches `workspace_id` drops one of those predicates during the rewrite, a revoked key resolves to a valid Principal.
- **Impact:** Revoked credential keeps full access — auth bypass.
- **Suggested fix:** The `principal-resolution.test.ts` RED test MUST include a revoked key AND an expired key → both resolve to `null` → 401. Keep the predicate verbatim from `api-key-verifier.ts:51-57`. (Already a DoD line; promote to an explicit RED assertion.)

### EC-3: Migration `SET NOT NULL` fails if ANY data table has rows the backfill UPDATE missed
- **Affected task:** T0.2
- **Family:** State
- **Scenario:** If the backfill `UPDATE ... SET workspace_id = default.id` is scoped (e.g. `WHERE workspace_id IS NULL`) but a concurrent insert lands a NULL between UPDATE and `SET NOT NULL`, or a table is forgotten, the ALTER throws and the whole migration rolls back — but on a partial-applied journal this bricks `runMigrations`.
- **Impact:** Migration failure on a real deployment with data; possible orphan-journal state (`architecture.md § 10.2`).
- **Suggested fix:** Run the entire `0016` inside ONE `BEGIN/COMMIT` (atomic); backfill is unconditional (`UPDATE <table> SET workspace_id = $default WHERE workspace_id IS NULL`) for ALL 6 tables + theo_api_keys in the same transaction, THEN all `SET NOT NULL`. (Add "single transaction" to D5.)

### EC-4: Body `workspaceId` silently ignored (not rejected) lets a confused client believe it scoped a tenant
- **Affected task:** T3.1
- **Family:** Input
- **Scenario:** D3 says "rejected/ignored". If `schemas.ts` uses `.strict()`, an unknown `workspaceId` field → 400 (good, explicit). If it uses `.passthrough()` or just doesn't list it, the field is silently dropped and the client thinks it targeted ws-X but hit its own default.
- **Impact:** Not a leak (Principal still wins), but a silent correctness trap → data written to the wrong-believed workspace.
- **Suggested fix:** Keep the existing `.strict()` on the body schemas so a `workspaceId` field → explicit 400 `unrecognized_keys`. Add a test asserting the 400. (1 line; `.strict()` is already present per `schemas.ts:63`.)

### EC-5: `forget(id)` of a non-existent OR cross-workspace id must both be 404 — and must NOT soft-delete a same-id row in the caller's own workspace
- **Affected task:** T3.1
- **Family:** Permission
- **Scenario:** Current `forget` calls `memory.forget(memoryId)` with no workspace check (`handlers/forget.ts`). After the change it must existence-check WITHIN the Principal's workspace. UUIDs are globally unique so a cross-workspace id won't collide, but the handler must scope the DELETE/soft-delete by `workspace_id` so a ws-B id under a ws-A Principal is a no-op → 404, never touching ws-B's row.
- **Impact:** Cross-workspace delete (destructive IDOR) if the soft-delete UPDATE is not workspace-scoped.
- **Suggested fix:** The forget UPDATE/soft-delete carries `AND workspace_id = $principal`; 0 rows affected → 404. RED test: ws-B forget(ws-A id) returns 404 AND ws-A's row stays valid (`t_invalid IS NULL`). (Already in goal test; make the "ws-A row untouched" assertion explicit.)

## SHOULD TEST

### EC-6: `default` workspace id must be deterministic/stable across deployments
- **Affected task:** T0.2
- **Suggested test:** `test_default_workspace_has_stable_id` — assert the seeded `default` workspace uses a FIXED id (e.g. literal `'default'` or a fixed UUID), not `gen_random_uuid()`, so the env-key bridge (T2.1) and the no-credential collapse (T4.1) can resolve it without a lookup race, and re-running the migration is idempotent.

### EC-7: Two concurrent first-requests with no credential must not each try to create the default workspace
- **Affected task:** T0.2 + T4.1
- **Suggested test:** `test_default_workspace_seed_idempotent` — the `0016` INSERT uses `ON CONFLICT DO NOTHING` (or `WHERE NOT EXISTS`); the no-credential path READS the default workspace (seeded by migration), never creates it at request time. Assert a second migration run is a no-op.

### EC-8: recall-cache cross-workspace MISS must hold even when the two queries are byte-identical
- **Affected task:** T1.2
- **Suggested test:** `test_recall_cache_no_cross_workspace_hit` — ws-A and ws-B issue the IDENTICAL query string; assert ws-B gets a cache MISS (its own compute), proving `workspace_id` is part of the cache scope key, not just the query-embedding cosine.

### EC-9: in-memory store (unit/test path) must also honor workspace or the SDK-internal path diverges from pg
- **Affected task:** T1.1
- **Suggested test:** `test_in_memory_store_workspace_filter` — the `in-memory-store.ts` used by unit tests applies the same `workspace_id` filter, so contract tests don't pass while integration leaks (or vice-versa). If in-memory defaults every row to the `default` workspace, document that explicitly.

## DOCUMENT

### EC-10: MCP/CLI path resolves to the `default` workspace this slice (per-workspace MCP deferred)
- **Accepted risk:** Q2 already defers per-workspace MCP. The env→default bridge covers the single-tenant MCP/CLI use. Multi-workspace MCP (a key-per-workspace MCP transport) is a follow-up; documented so a reviewer doesn't read it as a gap.

### EC-11: RLS deferred — a raw `psql` connection bypasses app-level scoping
- **Accepted risk:** D8 already defers RLS. App-level scoping means anyone with direct DB credentials (ops) sees all workspaces. This is the documented trade (R2R/AnythingLLM do the same); RLS is the belt-and-suspenders follow-up. Acceptable because DB credentials are already a full-trust boundary.

## Summary

| Task | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------|----------|-------------|----------|
| T0.1 | 0 | 0 | 0 | 0 |
| T0.2 | 4 | 1 (EC-3) | 2 (EC-6, EC-7) | 0 |
| T1.1 | 2 | 1 (EC-1) | 1 (EC-9) | 0 |
| T1.2 | 2 | 0 | 1 (EC-8) | 0 (EC-1 shared) |
| T2.1 | 1 | 1 (EC-2) | 0 | 0 |
| T3.1 | 2 | 2 (EC-4, EC-5) | 0 | 0 |
| T4.1 | 1 | 0 | 0 | 1 (EC-11) |
| (MCP) | 1 | 0 | 0 | 1 (EC-10) |

**Verdict:** PLAN NEEDS ADJUSTMENT — 5 MUST FIX, all small (each a 1-sentence ADR clarification or an explicit RED assertion already implied). None requires new modules; all are `if`/predicate/transaction-boundary fixes that strengthen the security property the plan exists to deliver.
