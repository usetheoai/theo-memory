# M8 — isolation-filter benchmark (T4.3)

The `(workspace_id, user_id, session_id)` isolation filter (the WHERE clause every
scoped recall/list issues) WITH vs WITHOUT the composite index
`memories_ws_user_session_idx` (migration 0024). Real `ankane/pgvector:v0.5.1`,
20 000 rows across 200 users in one workspace, 5 runs/arm, warm cache.

Reproduce: `THEOMEM_PG_URI=postgres://… BENCH_ROWS=20000 BENCH_RUNS=5 node benchmarks/m8-isolation-filter.bench.mjs`

| Arm | mean ms | stddev ms | EXPLAIN plan node |
|---|---|---|---|
| **WITH** `memories_ws_user_session_idx` | **0.582** | 0.078 | `Index Scan using memories_ws_user_session_idx` |
| WITHOUT (single-column indexes only) | 0.685 | 0.097 | `Bitmap Heap Scan on memories` |

**Speedup: 1.18×** (verdict PASS — the composite index is faster).

**Honest reading:** at 20 000 rows the absolute win is small (both sub-millisecond),
because the single-column indexes still produce a bitmap that filters quickly. The
load-bearing difference is the **plan shape**: the composite index yields a direct
`Index Scan` (no heap recheck), whereas without it Postgres falls back to a
`Bitmap Heap Scan` that re-checks `user_id`/`session_id`/`t_invalid` on the heap. That
recheck cost grows with row count and with lower selectivity, so the composite index
is the correct at-scale choice (the partition-key-in-every-index discipline,
blueprint Q2) even though the 20k-row delta is modest.
