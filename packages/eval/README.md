# @usetheo/memory-eval (private)

Per-stage quality eval for the LLM-touching stages of `@usetheo/memory`
(**extraction** + **consolidation** = reflect/distill/conflict). Scores each
stage against versioned golden fixtures, commits a baseline, and **fails a
regression gate** when a stage drops below `baseline − ε`.

> **Private — never published.** `"private": true` + a publish guard
> (`src/__tests__/publish-guard.test.ts`) fence it off from the four published
> packages. This is an **internal quality eval**, not a comparative benchmark
> (ADR-0020 / `public-copy.md § 4` untouched — no "faster-than" claim).

## Two tiers (ADR D4)

| Tier | Runs | What it proves |
|---|---|---|
| **LLM-free** (default) | always, keyless, deterministic | the deterministic extraction surface + the harness wiring; the regression gate |
| **LLM-measured** | only with an OpenRouter key | real LLM judgment quality; **SKIPs honestly without a key** |

## Reproduce

```bash
pnpm -w install

# LLM-free structural tier + regression gate (this is the CI gate):
pnpm --filter @usetheo/memory-eval test        # unit + framework + gate
pnpm --filter @usetheo/memory-eval eval        # prints the matrix, exits 1 on regression

# Inspect without gating / re-seed the baseline:
pnpm --filter @usetheo/memory-eval eval -- --predict-only
pnpm --filter @usetheo/memory-eval eval -- --update-baseline   # requires PR justification

# LLM-measured tier (real OpenRouter LLM — costs a few US cents):
OPENROUTER_KEY=sk-... pnpm --filter @usetheo/memory-eval test
```

The committed baseline is `src/baselines/llm-free.json`. Changing it requires a
PR justification (guards against baseline-as-theatre): the seeded-regression
test (`src/run.test.ts`, `src/regression.test.ts`) proves the gate actually
fires.

## Cost disclosure

- **LLM-free tier: $0.** No network, no LLM — pure deterministic computation.
- **LLM-measured tier: ~a few US cents/run** (≈9 `openai/gpt-4o-mini` chat calls
  for extraction; the consolidation LLM-measured signal lives in
  `tests/integration/distillation/the-goal-test-llm-measured.test.ts`, ~$0.01–0.10/run).

## Honesty caveat (F-M5 — REQUIRED READING)

**A green score over categorically-trivial fixtures proves nothing.** The eval
is only as honest as its golden set:

- The **extraction** deterministic score is made non-vacuous by its **hard**
  cases (real proper-noun ground truth, not input echo) and **negative cases**
  (noise-only text → zero entities, the #111 function-word case). The
  negative-case contract is schema-enforced (a `negative` fixture declaring
  entities is rejected at load). The numbers are mid-range (precision ≈ 0.64,
  recall ≈ 0.72, noise-rejection accuracy = 0.75), not a fabricated 1.0. The
  golden also carries **ambiguous** fixtures, but those are **not scored by any
  tier today** — they are documentation-only ground truth reserved for a future
  LLM-measured consumer, and contribute nothing to the current score.
- The **consolidation** LLM-free score is `1.0` **by construction** — it measures
  HARNESS WIRING (synthetic perfect decisions), **not** LLM judgment quality.
  The real consolidation quality signal is the key-gated LLM-measured tier.
  Do not read the `1.0` as "consolidation is perfect".

If you add fixtures, add negative and ambiguous ones — a suite that only tests
the happy path is half a suite.

## e2e-qa stage — LongMemEval counter-proof (key-gated)

`src/stages/e2e-qa/` faithfully replicates the published LongMemEval
end-to-end QA methodology (ingest → recall → generate → binary LLM-judge → accuracy),
wired to TheMemory. It is a **counter-proof**: an independent methodology that
cross-validates the per-stage extraction eval.

```bash
# .env.local: OPENAI_API_KEY=... + OPENAI_CHAT_MODEL=gpt-4o-mini-2024-07-18
export THEOMEM_PG_URI=postgresql://themem:themem@localhost:5442/themem
pnpm --filter @usetheo/memory-eval eval:e2e-qa   # SKIPs cleanly without a key or the dataset
```

Key-gated (no keyless CI run), heavy and LLM-bound, and NOT wired into the
automatic CI gate. Recorded result + honest disclosure: `docs/benchmarks/m21-e2e-qa-longmemeval.md`
(75% / 9-of-12 on gpt-4o-mini — NOT comparable to any published leaderboard figure).

### Dataset variants

The runner's default is `longmemeval_oracle.json`, whose histories contain only evidence sessions.
That is useful for diagnosis but is not comparable to standard LongMemEval-S results. For the
cleaned S benchmark, download the official `longmemeval_s_cleaned.json` to the gitignored
`benchmarks/data/` directory and set `E2E_QA_DATASET=benchmarks/data/longmemeval_s_cleaned.json`.
The full-run script records the variant and dataset SHA-256, and the aggregator labels Oracle, S,
and M separately.

The runner uses the authors' published CoT answer template and category-specific judge
templates, and routes every answer through the benchmark judge. The supplied context is still Theo's
retrieved memory records rather than verbatim source chats, so report the retrieval method and do
not claim an exact reproduction of the authors' end-to-end setup. For comparable reports, record
prompt mode, answer/judge model versions, provider, dataset variant/hash, retrieval configuration,
and raw per-question responses.

Ingestion defaults to `E2E_QA_INGEST_MODE=turn`. `E2E_QA_INGEST_MODE=session` extracts each
chronological source session in one call while preserving role labels and `source_date`; mixed-
speaker batches explicitly ask the extractor to retain each fact's author. Session mode is
experimental: local 12-example testing found regressions on multi-session retrieval and a large
increase in table memories, so use it only for controlled ablations. The runner records the mode,
and a capped run is marked invalid if it omits source turns.
