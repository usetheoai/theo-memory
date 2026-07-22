# M10 — Scope-aware recall@k benchmark

Reproducible measurement that the opt-in scope-aware reweight (`RecallOptions.scopes`)
**improves recall@k of the scope-preferred set and does not regress** (ROADMAP M10 risk #2),
plus the **projection cost** of the two hot-path columns T1.1 added (`created_at`,
`confirmation_count`).

## Method

- **Fixture** (one `(workspace, user, session)`): 6 relevant rows = 3 recent SESSION facts (age 0–2d)
  ∪ 3 durable GLOBAL facts (`confirmation_count` 15–25); 40 noise = 20 stale-session (age 40–90d)
  ∪ 20 one-off-global (`confirmation_count` 1). **All rows share one embedding**, so cosine is
  UNIFORM — semantic cannot distinguish and the **scope-aware reweight is the sole ranking signal**.
- **recall@k** (k = 6, = relevant-set size): fraction of the top-k that is relevant, for
  baseline (no reweight, tie-broken by id) vs scope-aware (bounded reweight `score*(1+w*signal)`).
- **projection cost**: the search `SELECT ... ORDER BY embedding <=> $1 LIMIT 20` timed WITH vs
  WITHOUT the two scalar columns, mean ± stddev over 5 queries per arm.
- The reweight formula in the bench **mirrors** `packages/core/src/domain/retrieval/scope-reweight.ts`;
  the **real pipeline wiring** is proven separately in
  `tests/integration/recall/scope-aware-ranking.test.ts` (real pgvector).

## Results (mean over 3 runs, `ankane/pgvector:v0.5.1`, local)

| Metric | Baseline | Scope-aware | Delta |
|---|---|---|---|
| recall@6 (scope-preferred set) | 0.056 (0, 0, 0.167) | **1.000** (1, 1, 1) | **+0.94** |

| Projection arm | mean_ms (3-run mean) |
|---|---|
| WITH `created_at` + `confirmation_count` | 1.16 |
| WITHOUT the two columns | 0.85 |
| **delta** | **≈ 0.31 ms** |

**Verdict:** `PASS` — scope-aware recall@6 = **1.000** vs baseline **0.056** (never regresses; the
recent-session + durable-global rows are surfaced into the top-k that a uniform-cosine baseline
scatters). The two projected columns add **≈ 0.31 ms** to a ~1 ms query — a real but sub-millisecond
cost on the hot path, accepted per blueprint ADR D3 (a second timestamp query would be an N+1 on the
hot path — strictly worse).

## Reproduce

```bash
THEOMEM_PG_URI=postgres://<user>:<pass>@localhost:5432/<db> \
  node benchmarks/m10-scope-aware-recall.bench.mjs
# BENCH_RUNS=5 by default; the DB must be migrated (the memories table exists).
```

The script `TRUNCATE`s + reseeds `memories` in a throwaway workspace (`tn-bench-m10`); run it
against a scratch DB, never a dev/prod store.
