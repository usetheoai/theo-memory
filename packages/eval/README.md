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

- The **extraction** golden carries **negative cases** (noise-only text → zero
  entities, the #111 function-word case) and **ambiguous cases**, not just easy
  proper-noun hits. The negative-case contract is schema-enforced (a `negative`
  fixture declaring entities is rejected at load). This is what makes the
  extraction score non-vacuous — the numbers are mid-range (precision ≈ 0.64,
  recall ≈ 0.72, noise-rejection accuracy = 0.75), not a fabricated 1.0.
- The **consolidation** LLM-free score is `1.0` **by construction** — it measures
  HARNESS WIRING (synthetic perfect decisions), **not** LLM judgment quality.
  The real consolidation quality signal is the key-gated LLM-measured tier.
  Do not read the `1.0` as "consolidation is perfect".

If you add fixtures, add negative and ambiguous ones — a suite that only tests
the happy path is half a suite.
