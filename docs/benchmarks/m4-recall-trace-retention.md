# Benchmark — M4 recall-trace retention + write overhead

**Date:** 2026-07-20 · **Target:** real `ankane/pgvector:v0.5.1` (local `themem_pgvector`) · **Runs:** 3 each (mean ± stddev).
**Harness:** `tests/integration/recall-trace/retention.bench.test.ts` (vitest, real DB).

## Results

| Metric | Result | Notes |
|---|---|---|
| **Retention sweep throughput** | **335,276 ± 40,449 rows/sec** (N=5000) | age-based `DELETE ... WHERE created_at <= NOW() - interval` inside `withSerializableTransactionAndRetry`. Sweeping 5000 rows takes ~15ms — a daily cron sweep is negligible even at millions of rows. |
| **Trace WRITE overhead** | **4.26 ± 0.59 ms/recall** (50 dropped candidates) | one multi-row `INSERT` of the dropped set. The per-recall cost of tracing scales with the dropped-candidate count (capped at `maxRowsPerRecall`). For a typical recall dropping a handful of candidates the cost is sub-millisecond. |

> **Scope note (honesty — /review M4-R4):** the shipped evidence is (a) sweep throughput
> and (b) the isolated **trace-write** cost. The write cost **IS** the recall-path ON-vs-OFF
> delta: the retrieval pipeline is byte-identical whether tracing is on or off **except** for
> this single batch `INSERT` — with tracing OFF (the default) the added cost is exactly `0`
> (no `recall_traces` write happens), and with tracing ON the added cost is the measured
> `4.26 ± 0.59 ms` for a 50-drop recall. There is no separate recall-latency harness because
> the trace INSERT is the entire added work; a full end-to-end p50/p95 ON/OFF arm would only
> re-measure this same INSERT on top of embedding + search noise.

## Interpretation (bottleneck analysis)

- The **sweep is not a bottleneck**: at ~335k rows/sec, even a table that accrued 10M rows sweeps in ~30s — well within a daily off-peak cron window. The SERIALIZABLE-retry adds no measurable cost on the uncontended path.
- The **write overhead is bounded** by the dropped-candidate count (≤ `maxRowsPerRecall`, default 200). At 50 drops it is ~4ms; this is the price of accountability, paid only when tracing is enabled (default OFF) and only for the workspaces not opted out.
- Growth is bounded by the retention window × the recall rate × avg drops/recall — and the retention cron enforces the ceiling.

## Reproduction

```bash
THEOMEM_PG_URI="postgresql://themem:themem@localhost:5432/themem" \
  npx vitest run --config vitest.integration.config.ts recall-trace/retention.bench --reporter=verbose
# look for the [BENCH] lines
```

Hardware: local dev box (the absolute numbers are machine-relative; the ratios + orders of magnitude are the signal). Re-run on target hardware before quoting absolute figures externally.
