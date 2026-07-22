# M10 — Scope-aware recall ranking benchmark

Reproducible measurement of the opt-in scope-aware reweight (`RecallOptions.scopes`): (1) how well the
weights **surface the scope-preferred set into top-k** without regressing vs base order, and (2) the
**projection cost** of the single hot-path column M10 added (`created_at`).

## Honest scope of this benchmark (read first)

- The "relevant@k" set here **IS** the scope-preferred set (recent-session ∪ durable-global) that the
  reweight is built to boost. So this measures **whether the weights surface the intended rows into
  top-k** — it is NOT a general recall@k win against an independent, scope-blind ground truth (that
  would need human-judged relevance). A non-zero weight will always lift the preferred rows, so the
  "no regression" verdict is expected by construction.
- The load-bearing **safety** property — a large base-score gap is NOT inverted, so durable facts are
  never buried under session noise (Risk #1) — is proven in the unit suite
  (`scope-reweight.test.ts::test_bounded_does_not_invert_a_large_base_score_gap`), not here.
- The **real pipeline wiring + isolation** is proven in
  `tests/integration/recall/scope-aware-ranking.test.ts` on real pgvector. This bench replicates the
  bounded formula (`MIRRORS scope-reweight.ts — keep in sync`) over a raw-SQL pool, so it gauges the
  **ranking**, not the wiring.
- **Recency signal = `created_at` only** for M10 (not `last_accessed_at`). `created_at` is a valid v1
  session-recency signal and is the single column added to the hot-path projection; `last_accessed_at`
  (access-bumped recency) is a deliberate deferral (KISS/YAGNI) — a future refinement, not a v1 gap.

## Method

- **Fixture** (one `(workspace, user, session)`): 6 scope-preferred rows = 3 recent SESSION facts
  (age 0–2d) ∪ 3 durable GLOBAL facts (`confirmation_count` 15–25); 40 noise = 20 stale-session
  (40–90d) ∪ 20 one-off-global (`confirmation_count` 1). **All rows share one embedding** → cosine is
  UNIFORM, so the scope-aware reweight is the **sole** ranking signal.
- **recall@k** (k = 6 = preferred-set size): fraction of top-k that is scope-preferred, for baseline
  (no reweight, tie-broken by id) vs scope-aware.
- **projection cost**: the search `SELECT ... ORDER BY embedding <=> $1 LIMIT 20` timed WITH vs WITHOUT
  the `created_at` column — `confirmation_count` stays in BOTH arms (it was projected pre-M10), so the
  delta is the marginal cost of M10's single added column. Mean over 5 queries per arm.

## Results (mean over 3 runs, `ankane/pgvector:v0.5.1`, local)

| Metric | Baseline | Scope-aware | Delta |
|---|---|---|---|
| top-6 that is scope-preferred | 0.111 (0.167, 0, 0.167) | **1.000** (1, 1, 1) | **+0.89** |

| Projection arm (marginal cost of `created_at`) | mean_ms (3-run mean) |
|---|---|
| WITH `created_at` (+ `confirmation_count`) | 1.12 |
| WITHOUT `created_at` (still `confirmation_count`) | 0.85 |
| **delta** | **≈ 0.27 ms** |

**Verdict:** `PASS` — the reweight surfaces the full scope-preferred set into the top-6 that a
uniform-cosine base order scatters (1.000 vs 0.111), with no regression. The single added column costs
**≈ 0.27 ms** on a ~1 ms query — a real but sub-millisecond hot-path cost, accepted per blueprint ADR D3
(a second timestamp query would be an N+1, strictly worse).

## Reproduce

```bash
THEOMEM_PG_URI=postgres://<user>:<pass>@localhost:5432/<db> \
  node benchmarks/m10-scope-aware-recall.bench.mjs
# BENCH_RUNS=5 by default; the DB must be migrated (the memories table exists).
```

The script `TRUNCATE`s + reseeds `memories` in a throwaway workspace (`tn-bench-m10`); run it against a
scratch DB, never a dev/prod store.
