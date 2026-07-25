# M21 — Per-stage LLM eval matrix (`@usetheo/memory-eval`)

Internal quality eval (NOT a comparative benchmark — ADR-0020 / `public-copy.md
§ 4` untouched, no "faster-than" claim). Reproduce:

```bash
pnpm --filter @usetheo/memory-eval eval           # gate + matrix
pnpm --filter @usetheo/memory-eval eval -- --predict-only   # matrix only
```

## LLM-free tier (deterministic, keyless) — committed baseline

Seeded from a real LLM-free run (`src/baselines/llm-free.json`). The gate fails
any stage that drops below `baseline − ε` (ε = 0.05/metric).

| Stage | Precision | Recall | Accuracy | n | Notes |
|---|---|---|---|---|---|
| extraction | 0.641 | 0.722 | 0.750 | 9 | precision/recall over 9 hard cases (CompromiseEntityExtractor vs ground truth, Jaccard@0.5); accuracy = noise-rejection over 4 negative cases (3/4 reject cleanly; `...yet...` leaks — an honest known miss) |
| consolidation | 1.000 | 1.000 | 1.000 | 50 | LWW harness over 50 hand-authored distillation fixtures — measures HARNESS WIRING, not LLM judgment (F-M5 caveat; real signal = LLM-measured tier) |

## Methodology

- **Extraction** — the deterministic entity-extraction surface run over
  `packages/eval/datasets/extraction/golden.json` (16 cases: 9 hard + 4 negative
  + 3 ambiguous). Ambiguous cases are excluded from the deterministic gate (the
  LLM-measured tier's job). Numbers are computed at run time, never hardcoded;
  two runs produce identical scores (deterministic).
- **Consolidation** — the reflect→distill→conflict path (one
  `ConflictResolutionPolicy`, ADR D5) scored via the LLM-free distillation
  harness over the 50 hand-authored fixtures (`source: 'hand'`).

## Regression gate — proven to fire

`src/run.test.ts` / `src/regression.test.ts` prove the gate:

- PASS against the committed baseline (`pnpm --filter @usetheo/memory-eval eval`
  exits 0).
- FAIL when a stage regresses below `baseline − ε` — e.g. raising the baseline
  extraction precision to 1.0 makes the gate throw `RegressionError` and the CLI
  exit 1:

  ```
  Gate: FAIL
  Eval regression detected:
    extraction.precision: 0.641 < baseline 1.000 − ε 0.050
    extraction.recall: 0.722 < baseline 1.000 − ε 0.050
  ```

## LLM-measured tier (key-gated)

`packages/eval/src/stages/extraction/llm-measured.test.ts` runs a real
`openai/gpt-4o-mini` (via OpenRouter) over the hard golden cases and asserts
precision ≥ 0.5, recall ≥ 0.5. It SKIPs honestly without an `OPENROUTER_KEY`
(never fabricates a passing score). Cost: a few US cents/run.
