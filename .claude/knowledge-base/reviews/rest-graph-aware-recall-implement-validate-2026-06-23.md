# Implement Validation — rest-graph-aware-recall

**Date:** 2026-06-23
**Plan:** `.claude/knowledge-base/plans/rest-graph-aware-recall-plan.md`
**Verdict:** PASS
**Commit:** `9eb4e0c` feat(server): expose graphExpand on POST /v1/recall

## Gates

| Gate | Result |
|---|---|
| `tsc --noEmit -p tsconfig.contract.json` | PASS — 0 errors |
| `npm run build:core` + `pnpm -C packages/api build` | PASS |
| Contract suite (`vitest.contract.config.ts`) | PASS — no failures, 0 type errors |
| API package tests (`packages/api` vitest) | PASS — 216 passed (incl. 4 new graphExpand handler tests) |
| GOAL integration (`tests/integration/rest-graph-aware-recall.test.ts`) vs real `ankane/pgvector:v0.5.1` over HTTP | PASS — 3/3 (graphExpand surfaces shared-entity below-threshold memory; default byte-unchanged; invalid hops → 422) |
| `/code-quality rest-graph-aware-recall` | PASS (0 hard/soft caps) |

## Tasks (TDD per task)

- **T1.1** `graphExpand` bounded zod field on the strict `RecallBody` (`hops` literal 1|2, `limit` ≤ 100, `.strict()` inner, optional). Validation tests (422 on hops:3 + unknown inner key). GREEN.
- **T1.2** `recallHandler` destructures + passes `graphExpand` into `scoped.recall` (one key, mirroring topK/threshold). Handler tests: mapping pass-through + default-undefined. OpenAPI auto-derives (recall request uses `RecallBody`). GREEN.
- **T2.1** GOAL integration over HTTP (real pgvector) 3/3 + full gate. GREEN.

## Wiring triad

- **Caller:** `POST /v1/recall` → `recallHandler` → `scoped.recall({ ..., graphExpand })` → (core) Step 8.7 → `PgGraphExpansionStore` JOIN. Exercised end-to-end by the GOAL over `app.fetch`.
- **Integration test:** `tests/integration/rest-graph-aware-recall.test.ts` (real pgvector via the HTTP server).
- **Runtime observability:** inherited — the core emits `recall_graph_expanded`/`recall_graph_failed` (v0.19.0); the REST layer adds no new failure path (invalid input → 422 via zod).

## Edge cases (edge-case-plan)

- EC-1 (invalid graphExpand → 422 not 500) — handler test + GOAL.
- EC-2 (empty `graphExpand: {}` activates expansion with defaults) — GOAL main scenario.
- EC-3 (REST recall scope isolation inherited — `workspaceBoundMemory` + core candidate-side scope filter) — documented; no new surface.
- EC-4 (rerank/adaptive REST exposure deferred) — ADR D3, documented followup.

## Notes

- ZERO new dependency; NO core change (graph internals shipped v0.19.0); NO migration; NO new public export (p0-audit export counts unchanged — `graphExpand` is a request-body field, not an exported symbol).
- No paper names in `src/**`.
- Additive + non-breaking: an optional field on the strict `RecallBody` only WIDENS acceptance (a `graphExpand` body previously 422'd is now honored); omitting it is byte-identical.
- Integration suite must run `--no-file-parallelism` (known dist-race flake). Pre-existing `pgvector-store.test.ts` dual-module-identity + mem0 reference-clone failures are NOT introduced by this cycle.
