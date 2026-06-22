# Implementation Summary — first-class-episodes (M2 / gap G3)

**Date:** 2026-06-22 · **Branch:** develop · **Plan:** `.claude/knowledge-base/plans/first-class-episodes-plan.md` (v1.1, SHIPPABLE 96.8)

## What shipped

A first-class episodic / message-log READ surface over the EXISTING memory substrate — cursor-paginated, bi-temporal-aware temporal list of a scope's memories. No new storage engine, no new dependency, no new table.

### Phase 1 — domain (commit `feat(episodes): M2 Phase 1+2`)
- `packages/core/src/domain/episode.ts` (NEW): `EpisodeListOptions` (after/before/limit/order/asOf/queryText), `EpisodePage` ({items, nextCursor?, prevCursor?}), `EpisodeCursor`, `EPISODE_LIMIT_DEFAULT=50`/`MAX=200`, pure helpers `resolveEpisodeLimit` / `encodeEpisodeCursor` / `decodeEpisodeCursor` (throws `InvalidScope`) / `escapeLikePattern`. 9 unit tests (`episode.test.ts`).
- `ScopedMemory.episodes(opts?)` added to the interface (`memory-store.ts`) — additive; 4 existing verbs unchanged. test-d keyset updated.
- Barrel exports (`domain/index.ts`).

### Phase 2 — infrastructure (same commit)
- `VectorStore.listEpisodes(filters, opts)` added to the DIP (`dip/vector-store.ts`) — returns ≤ cap+1 over-fetched rows in active order.
- pgvector impl (`pgvector-store.ts`): raw SQL — `composeTemporalWhere(asOf)` (EC-1 if/else asOf vs `t_invalid IS NULL`), `composeFilters` scope isolation, row-value `(created_at, id)` cursor (EC-3), `text ILIKE $n ESCAPE '\'` with escaped pattern (EC-2), `ORDER BY created_at <order>, id <order>`, `LIMIT cap+1`.
- in-memory impl (`in-memory-store.ts`): mirrors ordering + cursor + literal-substring queryText; asOf is a no-op (hard-delete, no tombstones). 7 unit tests (`list-episodes.test.ts`).
- `LocalScopedMemory.episodes()` façade (`scoped-memory.ts`): asOf-NaN guard → `InvalidScope`; reuses `this.filters` (composeFilters parity with recall/forget); trims cap+1 → `nextCursor`; `getall_temporal_fallback` OTel event reuse.
- DIP widened 12→13 (test-d + 6 stubs updated).

### Phase 3 — REST (commit `feat(episodes): M2 Phase 3`)
- `packages/api/src/server/handlers/episodes.ts` (NEW): `GET /v1/scopes/:type/:id/episodes`; zod query (limit≤200, order enum, after/before, asOf, q) with `superRefine` rejecting after+before together (EC-4); asOf-NaN → 422; foreign/empty scope → 200 `{items:[]}` (no existence leak, ADR D6).
- Route wired in `app.ts`; OpenAPI path `scopeEpisodes` registered (`openapi-registration.ts`).
- 7 api tests (`__tests__/episodes.test.ts`).

### Phase 4 — GOAL (commit `test(episodes): M2 Phase 4`)
- `tests/integration/episodes.test.ts` (NEW): 7/7 vs real `ankane/pgvector:v0.5.1` — temporal order + asc=reverse(desc); cursor no-gap/no-overlap; scope isolation; EC-1 asOf replay (row soft-deleted after db-`now()` asOf still appears at asOf, excluded from default); soft-delete exclusion; EC-2 queryText literal; nextCursor round-trip.

## Edge cases absorbed
EC-1 (asOf vs soft-delete mutually exclusive), EC-2 (LIKE-escape), EC-3 (cursor precision + same-created_at), EC-4 (after+before 422), EC-5 (in-memory parity), EC-6 (cursor value-not-lookup, no error), EC-7 (prevCursor forward-only), EC-8 (tier generalization). EC-9 (skill-scope asOf) DEFERRED per ADR D5.

## Coverage Matrix: 13/13 (100%). Gates: typecheck 0, lint 0, contract 1079, api 212, integration 65 (GOAL 7), code-quality PASS 100.
