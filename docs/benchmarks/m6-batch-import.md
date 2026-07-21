# Benchmark — M6 batch import vs per-fact (the rate-limit bottleneck)

**Date:** 2026-07-21 · **Target:** the deployed theo-memory REST at `<DEV_HOST>:8080` (real
`ankane/pgvector:v0.5.1` + real OpenAI embedder) · **Runs:** 3 each (mean ± stddev).
**Harness:** a client-side loop (`/tmp/.../m6-bench.mjs`) — batch of 30 facts in one
`POST /v1/remember/batch` vs 20 individual `POST /v1/remember`, unique texts per run.

## Results

| Path | Throughput | Notes |
|---|---|---|
| **Batch** (`POST /v1/remember/batch`, N=30/request) | **1.9 ± 0.1 facts/sec** | ~16 s for 30 facts — embedding-bound (each fact is one real OpenAI embedding call, `infer:false` so no LLM extraction). **One request = one write-limiter slot.** |
| **Per-fact** (`POST /v1/remember`, 20/run) | **1.1 ± 0.8 facts/sec** | run0: 20/20 ok · run1: **10/20** (10 rate-limited) · run2: **0/20** (all 20 `429`). The per-fact path is progressively throttled by the 30-writes/60s limiter. |

## Interpretation — the bottleneck is the rate limiter, not per-fact throughput (ADR-1)

- **Per-fact and batch have the SAME per-fact cost** (~1.7 facts/sec when unthrottled) because both are
  dominated by the server-side OpenAI embedding latency. Throughput-per-fact is NOT where the batch wins.
- **The real bottleneck is the write rate limiter (30 writes / 60 s, per bearer-token / per-IP).** The
  benchmark shows it biting live: successive per-fact runs went 20/20 → 10/20 → **0/20** as the sliding
  window filled. A migration of thousands of pre-written facts one-request-per-fact **caps at 30 facts/min
  (0.5 facts/sec sustained)** and then `429`s — hours-long or impossible.
- **The batch endpoint bypasses this by design:** N facts = **one** request = **one** write-slot. Within
  the same 30-requests/60s budget, a batch import moves up to `30 × MAX_BATCH_ITEMS (1000)` = **30 000
  facts/min** vs 30 facts/min per-fact — a **1000× ceiling increase** for the migration use case. This is
  the entire justification for `POST /v1/remember/batch` (blueprint ADR-3 / plan ADR-1), and it is why the
  migration tool imports in batches rather than looping `POST /v1/remember`.

## Honest caveats

- Absolute facts/sec is machine- + OpenAI-latency-relative; the SIGNAL is the rate-limit ceiling
  (30/min per-fact vs N-per-slot batch), which is deterministic, not the absolute embedding throughput.
- The batch's server-side embedding is currently sequential per item; a future optimization could
  `embedBatch` the array in one embedder call to cut the ~0.5 s/fact — out of M6 scope (the endpoint
  contract + the rate-limit bypass is what M6 needs).

## Reproduction

```bash
THEOMEM_MIGRATE_URL="http://<host>:8080" node m6-bench.mjs   # (harness inlined in the M6 implementation log)
# batch: N facts in 1 request; per-fact: M individual requests — observe the 429s fill in across runs.
```
