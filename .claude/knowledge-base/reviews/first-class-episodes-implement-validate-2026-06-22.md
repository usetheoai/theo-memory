# Implement Validation — first-class-episodes (M2)

**Date:** 2026-06-22
**Branch:** develop
**Verdict:** PASS

Post-implementation validation gate (cycle-implement § post-halt-loop). All gates run against the real toolchain + real `ankane/pgvector:v0.5.1`.

## Gates

| Gate | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` (`tsc -p tsconfig.contract.json`) | PASS — 0 errors |
| Lint | `npm run lint` (eslint core+api+cli+agent-core) | PASS — 0 errors, 0 warnings |
| Contract suite (core+mcp) | `npm test` | PASS — 1079 passed, 2 skipped |
| API suite | `packages/api` vitest | PASS — 212 passed |
| Integration (regression + GOAL) | `vitest --config vitest.integration.config.ts` (subset: episodes + pgvector-store + list-temporal + local-runtime + scoped-forget + scope-usage-counter) | PASS — 65 passed (incl. GOAL 7/7) |
| Code quality | `/code-quality first-class-episodes` | PASS 100 (0 dead code, 0 fabricated symbols, 0 orphan exports) |

## Wiring triad (per task)

| Task | Caller (pillar a) | Integration test (pillar b) | Runtime metric (pillar c) |
|---|---|---|---|
| T1.1 EpisodeListOptions/EpisodePage + cursor helpers | consumed by listEpisodes (T2.1) + façade (T2.2) + REST (T3.1) | `episode.test.ts` (9) + exercised by GOAL | n/a (pure types/helpers) |
| T1.2 ScopedMemory.episodes() iface | implemented by LocalScopedMemory (T2.2) | test-d keyset + GOAL | n/a (contract) |
| T2.1 VectorStore.listEpisodes (pgvector + in-memory) | called by LocalScopedMemory.episodes | `list-episodes.test.ts` (7, in-memory) + GOAL `episodes.test.ts` (7, pgvector) | `getall_temporal_fallback` OTel event (reused, emitted on stale-impl createdAt fallback) |
| T2.2 LocalScopedMemory.episodes() façade | called by episodesHandler (REST) | `episodes.test.ts` api (7) + GOAL | `getall_temporal_fallback` event |
| T3.1 REST GET .../episodes | wired in `app.ts`; OpenAPI registered | `packages/api .../episodes.test.ts` (7) | Hono per-handler span (existing middleware) |
| T4.1 GOAL | `tests/integration/episodes.test.ts` | 7/7 vs real pgvector | — |

## Commits (this slice, on develop)

- `feat(episodes): M2 Phase 1+2 — episode types + listEpisodes DIP + episodes() facade`
- `feat(episodes): M2 Phase 3 — REST GET /v1/scopes/:type/:id/episodes`
- `test(episodes): M2 Phase 4 — GOAL integration vs real ankane/pgvector:v0.5.1`
- `audit(episodes): /code-quality PASS 100`

## Notes / honest caveats

- DIP `VectorStore` widened 12→13 methods (additive read-only `listEpisodes`); ADR-0008 method-count test updated; 6 test stubs + test-d updated.
- In-memory adapter hard-deletes (no `t_invalid`), so `asOf` bi-temporal replay is a no-op there; the GOAL asOf assertion runs on the real pgvector runtime (documented in `list-episodes.test.ts`).
- `EpisodePage.prevCursor` is reserved/forward-only in v1 (EC-7); only `nextCursor` is computed.
- `EpisodeListOptions` placed in `domain/episode.ts` (cohesive) rather than `options.ts` as the plan's Files-to-edit listed — re-exported via the domain barrel; no functional difference.
