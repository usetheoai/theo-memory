# SEPA — Iteration 3 / Task T2.2 / Phase pre-RED (VERBOSE)

## Verdict: PROCEED TO RED after addressing 3 CRITICALs

## CRITICAL findings (MUST address before any RED test)
1. **EC-7 aggregation pattern** — plan pseudo-code shows per-row `emitEvent(..., { id: r.id })` INSIDE .map(). CORRECT: count fallback rows in one pass, emit ONCE after the map with `{ count: N }`. Mirrors `recall_threshold_filtered` discipline (no emit when count=0).
2. **MEMORY_EVENTS union extension FIRST** — add `'getall_temporal_fallback'` literal (16th) to `src/core/memory-event.ts` BEFORE writing tests to avoid TS narrow failure + `as any` cast.
3. **tValid honesty** — mirror createdAt (option (a)) so fallback doesn't double-synthesize. Document `updatedAt = tValid = createdAt` until ADR-0003 ADD-only contract changes.

## MAJOR findings
- StoredRow extension in `in-memory-store.ts:28-31` authorized per plan T2.2 file list.
- EC-6 same-millisecond determinism: SEPA recommends `.sort((a,b) => a.id.localeCompare(b.id))` in `list()` for id-order stability. Insertion-order (Map default) is fragile to future impl changes.
- ADR D5 hot zone: ONLY `src/local/index.ts:807-810` is in scope. Lines 643/756/957 + `scoped-skill-memory.ts:104` + `skills/payload.ts:78` MUST stay untouched.

## MINOR
- Test files: `src/local/__tests__/in-memory-store-temporal.test.ts` + `scoped-memory-getall-temporal.test.ts` (plan-declared paths).
- Tracer mock pattern: `startActiveSpan` with `vi.fn` capturing event names.
- vi.useFakeTimers — first repo adopter; beforeEach/afterEach guard required.

## RED test ordering
1. in-memory-store-temporal.test.ts: list returns createdAt per row
2. in-memory-store-temporal.test.ts: EC-6 same-ms determinism (frozen clock, sort-by-id)
3. scoped-memory-getall-temporal.test.ts: getAll uses store.createdAt (past Date)
4. scoped-memory-getall-temporal.test.ts: fallback event fires when undefined (1 row)
5. scoped-memory-getall-temporal.test.ts: EC-7 aggregation (100 rows → 1 event with count:100)

Tests #3 + #5 BLOCK on MEMORY_EVENTS literal landing first (in same RED commit or precursor).

## Wiring triad pre-check for T2.2
- (a) Pillar — getAll already called by REST handler at `src/server/handlers/scopes.ts:129`; passive PASS
- (b) Pillar — 5 unit tests against InMemoryVectorStore + mocked VectorStore boundary
- (c) Pillar — `getall_temporal_fallback` event becomes the observable signal; integration via vitest assertion on tracer mock

## Note (SEPA accuracy)
SEPA referenced "T2.3" but my plan has only T2.1 + T2.2 in Phase 2. SEPA mis-mapped — `PgvectorStore.list()` was already T2.1 (shipped at `cf17aee` iter 2). T2.2 is consumer-side only. Honest disclosure.
