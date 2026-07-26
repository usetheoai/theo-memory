# TheMemory vs mem0 — full LongMemEval_oracle reproduction (PARTIAL — credit-blocked)

Goal of this run: the apples-to-dataset comparison the project never had — the **whole**
LongMemEval_oracle set (500 questions), same model, multiple runs, aggregated with variance.
The harness to do this now exists and is committed; the **execution is blocked on an external
limit** (OpenRouter credit exhausted mid-run), so this report is HONEST about being partial.

## What actually ran

| | value |
|---|---|
| Examples measured | **139 / 500** (run 1, stopped when the OpenRouter key hit `402 insufficient credits`) |
| Model | `openai/gpt-4o-mini` via OpenRouter (mem0's OSS default) |
| Embedder | `LocalTransformerEmbedder` (384-dim, keyless) |
| Judge | strict `#148` guard (an abstention on a non-abstention question = miss, before the LLM judge) |
| reflect | ON (`E2E_QA_REFLECT=1`, bounded consolidation) |
| Validity | **0 error rows, 0 recalled-empty rows** across the 139 — every measured example is a real measurement (the run stopped cleanly at the credit wall; it did not silently degrade). |

### Result (partial, 139 examples)

**Overall: 73/139 = 52.5%**

| question_type | correct/total | % |
|---|---|---|
| knowledge-update | 12/18 | 67% |
| temporal-reasoning | 36/60 | 60% |
| multi-session | 25/61 | 41% |

## vs mem0 (published)

| System | LongMemEval | Notes |
|---|---|---|
| **TheMemory** (this partial) | **52.5%** (139/500) | gpt-4o-mini · strict #148 judge · reflect ON · PARTIAL |
| mem0 (published, README) | 94.4 | their tuned pipeline/cloud stack; baseline they report beating = 67.8 |

## Honest reading (Rule 3 — do NOT over-claim)

- **This is NOT a finished benchmark.** 139/500 on a single incomplete run is a signal, not a
  verdict. No mean±std (only one partial run completed). Do not cite 52.5% as "TheMemory's
  LongMemEval score" — cite it as "a partial 139-question run".
- **NOT leaderboard-comparable to mem0's 94.4.** (a) mem0's headline almost certainly uses their
  tuned cloud stack, not gpt-4o-mini; (b) our judge is deliberately STRICTER (the #148 guard
  scores abstentions as misses — a lenient judge would score higher); (c) this is *TheMemory's*
  extraction/retrieval pipeline on the dataset, not mem0's. Same dataset ≠ same system.
- **The multi-session 41% is the honest weak spot** — these are cross-session "how many"/aggregation
  questions where the answer-LLM cannot count from recall. This matches the known agent-side
  aggregation gap (out of core scope, like G1/G4), not a memory-layer defect.

## Why it stopped + how to finish it

`remember` runs LLM extraction per turn; when the OpenRouter key ran out of credit (`total_credits
45 ≈ total_usage 45.19`), every subsequent `remember`/answer/judge call returned `402`. The harness's
per-example fail-safe converts a single failure to a scored miss, but a *wall* of 402s makes every
remaining example a zero-recall miss — which would be a **fabricated-low** number, so the run was
stopped and this report kept to the 139 valid pre-exhaustion examples.

**To complete the real 3-run full-500 comparison** (≈ $30-60 of gpt-4o-mini credit, ≈ 3×1.5h at
C=20, 0 throttle observed):

```bash
# .env.local at repo root with a funded OpenRouter key, then:
RUNS=3 CONC=20 bash packages/eval/scripts/run-longmemeval-full.sh
# → aggregates all 500×3 into this file with mean±std + per-type, via aggregate-longmemeval.py
```

The harness (full-set mode, bounded concurrency, per-example fail-safe, isolated DB per run,
multi-run driver + aggregator) is committed and unit-tested. The only missing input is a funded
API key — an owner action, not a code change.
