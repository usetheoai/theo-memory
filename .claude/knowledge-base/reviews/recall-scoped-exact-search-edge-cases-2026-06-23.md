# Edge Case Review — recall-scoped-exact-search (EG-6)

Date: 2026-06-23
Tasks analyzed: 2 (T1.1–T2.1)
Edge cases found: 4 (MUST FIX: 0, SHOULD TEST: 2 absorbed, DOCUMENT: 2)

## MUST FIX
(none)

## SHOULD TEST

### EC-1: planner picks a seq scan instead of the scope btree inside the CTE
- **Affected task:** T2.1 — Family: Resource
- **Resolution:** ABSORBED — T2.1 includes an EXPLAIN assertion that the scoped query uses an index/bitmap scan on the scope column (not a full seq scan).

### EC-2: empty scope (no rows) recall
- **Affected task:** T2.1 — Family: Boundary
- **Resolution:** ABSORBED — CTE yields 0 rows → outer returns []; T2.1 asserts empty-scope recall → [].

## DOCUMENT

### EC-3: very large single scope exact-sort cost
- **Accepted risk:** a huge single scope (100k+) exact-sorts; but such a dense scope does NOT starve under HNSW (it dominates the global nearest), so the perf trade-off only bites huge single scopes. Captured in Drawbacks (Medium); future size-threshold / pgvector 0.8.0 iterative-scan path documented.

### EC-4: param-index drift between CTE and outer query
- **Accepted risk:** the param order `[vector($1), ...temporal, ...filter, topK]` is preserved; the CTE references $2..$k (temporal+filter) and the outer references $1 (vector) + LIMIT. Single prepared statement, consistent indices. Covered by the SQL-shape unit test + the real-pgvector GOAL (a drift would error or mis-rank).

## Summary

| Task | Edges | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------|----------|-------------|----------|
| T1.1 | 1 | 0 | 0 | 1 (EC-4) |
| T2.1 | 3 | 0 | 2 (absorbed) | 1 (EC-3) |

**Verdict:** PLAN OK (2 SHOULD-TEST absorbed; 2 documented). deps-audit: no-op (no dependency change).
