# Implement Validation — distinct-entities-metric-fix (EG-3)

**Date:** 2026-06-23
**Plan:** `.claude/knowledge-base/plans/distinct-entities-metric-fix-plan.md` (v1.1, SHIPPABLE 90)
**Verdict:** PASS

## Gates

| Gate | Result |
|---|---|
| `npm run typecheck` (`tsc -p tsconfig.contract.json`) | PASS — 0 errors |
| `npm run lint` on changed files | PASS — 0 warnings (metrics.ts, app.ts, metrics-entities.test.ts) |
| Full api suite (`packages/api` vitest) | PASS — 221 passed (24 files; +4 EG-3 tests) |
| T1.1 `metrics-entities.test.ts` | PASS — 13/13 (wired count=3, consistency wired, EC-1 fallback parity, EC-2 workspace parity, + existing fallback assertions green) |
| T2.1 GOAL `tests/integration/distinct-entities-metric.test.ts` vs real `ankane/pgvector:v0.5.1` | PASS — 1/1 (`metrics.entity_count === entities.length >= 2`) |
| `/code-quality distinct-entities-metric-fix` | PASS (score_cap 100, 0 caps) |

## Tasks (TDD per task)

- **T1.1** `metricsHandler` gains `memoryEntityStore?` param; `entity_count = list().length` when wired, distinct-`attributedTo` fallback otherwise; metrics route threads the store. RED (3 failing pre-impl: wired-count, consistency, workspace-parity) → GREEN. EC-1 (fallback consistency) passed from the start because both handlers share the `attributedTo` fallback.
- **T2.1** GOAL: `metrics.entity_count == entities.length >= 2` over HTTP vs real pgvector (LLM-primary entities populate the graph; both endpoints read the SAME `PgMemoryEntityStore`). GREEN.

## Wiring triad

- **Caller:** `GET /v1/scopes/:type/:id/metrics` → `metricsHandler(c, memory, usageCounterStore, memoryEntityStore)` → `MemoryEntityStore.list()`. Exercised end-to-end by the GOAL via `app.fetch`.
- **Integration test:** `tests/integration/distinct-entities-metric.test.ts` (real pgvector; metrics ↔ entities equality).
- **Runtime observability:** the metric IS the observable (the dashboard Overview reads it); no new failure path (a `list()` rejection → app `onError` 500, same contract as the entities handler).

## Edge cases (from edge-case-plan, all absorbed)

- EC-1 fallback-path consistency (metrics == entities with no store) — test green.
- EC-2 workspace+scope param parity — test asserts `list()` called with `{ workspaceId, filters }` matching the entities handler.
- EC-3 (O(entities) `list().length` cost) + EC-4 (meaning differs by deployment) — DOCUMENT, accepted (ADR D2 / entities-handler precedent).

## Notes / honest disclosure (Inquebrável Rule 3)

- `packages/api` only; ZERO new dependency; no DIP widening (ADR-0008); no migration; no new public export (`createServer` `memoryEntityStore` option already existed).
- The metric MEANING changes (distinct attributed peers → distinct graph entities) on the wired path — this is the user-intended meaning; the gateway treats `entity_count` as an opaque integer (`client.go:117`), so no downstream break. Documented in ADR D2 + the handler JSDoc.
- No paper names in `src/**`.
- Pre-existing lint debt elsewhere (v0.18/v0.19 cycles) is NOT in this diff.
- Composes with EG-2 (v0.20.1): the entity graph is now noise-free, so the aligned `entity_count` counts clean entities.
