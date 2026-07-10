# Implementation Summary — graph-aware-recall-temporal-correctness (M0)

**Promise:** IMPLEMENTATION_COMPLETE · **Plan:** knowledge-base/plans/graph-aware-recall-temporal-correctness-plan.md · milestone_id: M0

## Tasks (all RED→GREEN, wiring triad complete)

| Task | What | Evidence |
|---|---|---|
| T1.1 | Extract `composeTemporalWhere` to shared `temporal-where.ts` (+ `columnPrefix` for JOIN alias) | unit 3/3; commit a4cd944 |
| T1.2 | PG store final SELECT reuses the predicate during the JOIN (the bug fix) | integration RED (without fix: "expected [alpha doc, beta doc] to not include beta doc") → GREEN; commit a739fb5 |
| T1.3 | `asOf` honored through expansion (via existing `filters.asOf`; DIP unchanged) | integration asOf=midpoint resurfaces; a739fb5 |
| T1.4 | In-memory store mirrors temporal semantics (LSP) | unit RED→GREEN 3/3 + 4/4 regression; a739fb5 |
| T2.1 | REST `POST /v1/recall` parity | NEW integration test `tests/integration/rest-graph-aware-recall-temporal.test.ts` (forget B → graphExpand excludes; asOf=mid resurfaces) 1/1 over HTTP vs real pgvector |
| T2.2 | MCP `recall` exposes `graphExpand`+`asOf` (was silently dropped) | RED→GREEN passthrough 2/2 + 35 MCP regression; commit e3c80b0 |
| T3.1 | CHANGELOG + full suite green + exactOptional typecheck fix | 1271 passed, 0 errors; commit 1733ef5 |

## Wiring triad
- **Caller:** `PgGraphExpansionStore.expandByEntities` (recall pipeline) + MCP recall handler + REST recall handler.
- **Integration test:** `tests/integration/graph-aware-recall-temporal.test.ts` vs real pgvector.
- **Runtime metric:** reuses the existing `recall_graph_expanded` OTel span (unchanged); fail-soft `graph-aware-recall` event preserved.

## Verdicts
- plan-confidence: SHIPPABLE (100)
- code-quality: PASS (100, --no-network; tsc authoritative)
- Full contract suite: 1271 passed / 0 errors; integration 10/10.

## Review findings (5 agents) — all closed

- Architecture / Domain-SQL / Public-API: READY_TO_MERGE clean (SQL injection-safe, param-index correct both branches, bi-temporal ADR-0011 faithful, no-paper-names 0 hits, MCP↔REST schema parity exact).
- Tests+Wiring + Cross-validation flagged 2 MEDIUM → closed:
  1. **T2.1 REST temporal integration test** — ADDED (`rest-graph-aware-recall-temporal.test.ts`, 1/1 vs real pgvector).
  2. **Fail-soft + NaN-asOf negative cases** — already covered pre-M0 (fail-soft: `packages/core/src/domain/retrieval-pipeline.test.ts:519` "graph store throws → normal results, recall_graph_failed"; NaN-asOf: `packages/core/src/infrastructure/db/factory.test.ts:118` "recall with invalid Date throws InvalidScope"). The M0 predicate does not alter the fail-soft try/catch nor the boundary NaN guard — cited, not duplicated (DRY).
- LOW/INFO (OpenMemory search no graphExpand parity — by design per Item 26; readability nit on the MCP spread) — accepted, no change.

**Post-fix verdict: READY_TO_MERGE.**
