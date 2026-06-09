# SEPA — Iteration 2 / Task T2.1 / Phase pre-RED (VERBOSE)

## Verdict: ADVISORY-PASS-WITH-CAVEATS — proceed to RED after addressing action items

## Key findings

### F1 — EC-1 is DEFENSIVE-IN-DEPTH, not SDK-reachable
- `src/local/schema.ts:128` declares `created_at: timestamp(...).defaultNow().notNull()`. NULL is impossible via Drizzle path.
- Reachable via: manual psql INSERT bypassing DEFAULT + schema relaxation, OR pg_restore with constraint temporarily dropped.
- Honesty discipline: test docstring + production mapper comment MUST document this is forward-compat guard, not silent paranoia.

### F2 — EC-2 production SQL must emit literal `ORDER BY created_at DESC, id ASC`
- Current `list()` at `src/local/pgvector-store.ts:570-577` uses `ORDER BY created_at ASC`. T2.1 flips to DESC + id ASC tiebreak.

### F3 — DIP already has `createdAt?: Date` (T1.1 shipped at `a79a7bf`)
- T2.1 is implementation-side only; no new DIP method.

### F4 — Three edits needed in `pgvector-store.ts`:
1. `MemoriesRow` interface: add `readonly created_at?: Date | null`
2. `rowToResult`: null-safe assign `createdAt`
3. `list()` SQL: SELECT + ORDER BY DESC, id ASC

### F5/H1 — Test file location mismatch (CRITICAL action item)
- Plan says `src/local/__tests__/pgvector-store-list-temporal.test.ts` BUT real-PG-via-THEOMEM_PG_URI is the canonical INTEGRATION pattern (see `tests/integration/pgvector-store.test.ts`).
- Decision: USE `tests/integration/pgvector-store-list-temporal.test.ts` per option A. Plan's path was likely informal shorthand.

### H2 — Schema toggle bleeds state if parallel
- Test #2 `ALTER TABLE ... DROP NOT NULL` must `DELETE FROM memories WHERE created_at IS NULL` before SET NOT NULL restore. Tests must run serially OR with TRUNCATE between.

### M1/M2/M3 — Vector dimension 1536 (MAX), TRUNCATE between tests, `vectorLiteral` helper import.

### G2 — Scope discipline: 5 deferred sites in src/local/index.ts NOT TOUCHED
- Lines 475 (type), 643, 756, 807, 957 (synthetic `new Date()` stamps) remain — T2.1 changes DIP return value but consumers still synthesize. Tests MUST assert `VectorStoreResult.createdAt` directly, NOT `MemoryItem.createdAt` (which goes through synthesizer).

## Action items resolved by main session
1. ✅ Test location: `tests/integration/pgvector-store-list-temporal.test.ts` (option A).
2. ⏳ Verify schema.ts:128 status (next bash).
3. ⏳ Confirm THEOMEM_PG_URI + pgvector container running (next bash).
4. ✅ One file with 3 tests (plan T2.1 acceptance is unambiguous).

## Wiring triad pre-check for T2.1
- (a) Caller: 5 existing sites in src/local/index.ts call vectorStore.list() — PASSIVE pillar satisfaction (backward-compat additive).
- (b) Integration test: 3 RED tests against real PG.
- (c) Runtime metric: ADR D2 defers `getall_temporal_fallback{count}` to T2.2 consumer site. Commit body must document this defer.
