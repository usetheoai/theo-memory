# Implement Validation — entity-extraction-noise-filter (EG-2)

**Date:** 2026-06-23
**Plan:** `.claude/knowledge-base/plans/entity-extraction-noise-filter-plan.md` (v1.1, SHIPPABLE_WITH_CAVEATS 84)
**Verdict:** PASS

## Gates

| Gate | Result |
|---|---|
| `npm run typecheck` (`tsc -p tsconfig.contract.json`) | PASS — 0 errors |
| `npm run lint` on changed files | PASS — 0 warnings on my 6 files (pre-existing lint debt in pipeline/factory/adaptive/graph files is NOT in this diff — disclosed) |
| Core extraction unit suite (`packages/core/src/{domain,infrastructure}/extraction`) | PASS — 94 passed |
| T1.1 `entity-noise-filter.test.ts` | PASS — 3/3 |
| T2.1 `entity-linking.test.ts` (NEW) | PASS — 3/3 (LLM-path + compromise-path noise dropped; multilingual preserved) |
| T2.2 `compromise-entity-extractor.test.ts` | PASS — 15/15 (14 pre-existing + 1 EG-2) |
| T3.1 GOAL `tests/integration/entity-noise-filter.test.ts` vs real `ankane/pgvector:v0.5.1` | PASS — 1/1 (Dune + Frank Herbert persisted; `I'm`/`m reading`/`love science`/`user` absent) |
| `/code-quality entity-extraction-noise-filter` | PASS (score_cap 100, 0 hard/soft caps) |

## Tasks (TDD per task)

- **T1.1** pure `isEntityNoise` predicate + unit tests (drop set / keep set incl. multilingual + verb-homograph compounds / totality). GREEN.
- **T2.1** `isEntityNoise` filter wired in `upsertNodes` (single chokepoint → both node sources) + first `entity-linking.test.ts`. RED→GREEN confirmed (2 failing before wire). GREEN.
- **T2.2** defense-in-depth in the compromise extractor's `pushUnique` + extractor test. GREEN (15/15).
- **T3.1** GOAL integration vs real pgvector (compromise-fallback path, non-vacuous per EC-4). GREEN.

## Edge cases (from edge-case-plan, all absorbed in v1.1)

- EC-1 capitalized-proper exception (`Love Island` kept) — covered by the keep-set + the `firstIsProper` guard.
- EC-2 narrowed `COMMON_BASE_VERB` to perception/desire verbs (`watch list`/`think tank`/`read me` kept) — covered.
- EC-3 possessive `user's` kept (KISS) — covered.
- EC-4 non-vacuous GOAL (noise provably reaches `upsertNodes` via the compromise fallback) — covered.
- EC-5 standalone `People` dropped / `People magazine` kept — documented + covered.

## Wiring triad

- **Caller:** write pipeline Phase 7 → `linkEntities` → `upsertNodes` → `isEntityNoise` filter → `MemoryEntityStore.upsertAndLink`. Exercised end-to-end by the GOAL via `memory.user('alice').remember(...)`.
- **Integration test:** `tests/integration/entity-noise-filter.test.ts` (real pgvector).
- **Runtime observability:** the existing `entity_linked` OTel event still fires after filtering (no new failure path; pure total function inside the fail-soft Phase-7 try/catch).

## Notes / honest disclosure (Inquebrável Rule 3)

- ZERO new dependency; no DIP widening (ADR-0008 method counts unchanged); no new public export (filter is package-internal); no migration.
- No paper names in `src/**`.
- Pre-existing lint debt in `pipeline.ts` / `factory.ts` / `heuristic-policy.ts` / `in-memory-graph-expansion-store.ts` / `scoped-memory-adaptive.test.ts` (from v0.18.0/v0.19.0 cycles) is NOT introduced by this diff and does not block this cycle.
- The GOAL uses a deterministic fact-only LLM to drive the compromise-fallback path because the observed noise originates in the compromise NER, not the LLM — a real LLM emits clean entities and would test the filter vacuously (EC-4). Consistent with the repo's integration-GOAL convention (queued LLMs).
