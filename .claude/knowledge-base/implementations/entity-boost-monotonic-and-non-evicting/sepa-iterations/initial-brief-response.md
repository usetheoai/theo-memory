# SEPA Initial Brief — entity-boost-monotonic-and-non-evicting (M18)

Date: 2026-07-24 · consulted at Step 2.5 (pre-loop)

## Verdict: 2 CRITICAL findings — plan revised before the halt-loop starts

### CRITICAL 1 — semantic-saturated corpus makes the fix untestable (the headline)

The M15 benchmark corpus (`precision-benchmark.test.ts:51-54, 145-148`) pins every candidate's
semantic to EXACTLY 1.0 (distractors share the relevant's hot-dim vector → cosine=1.0). Under
numerator-only + clamp:
- unlinked distractor = `min(1.0/1.0, 1.0)` = 1.0
- linked relevant = `min((1.0+boost)/1.0, 1.0)` = 1.0
- **Both clamp to 1.0 → tie → discrimination lost.**

M15's discrimination in that corpus was *purchased by the very renormalization #127 removes*
(unlinked pushed to 0.667, linked riding to 1.0). Therefore `test_linked_candidate_still_ranks_above`
(T2.1) and `test_precision_not_regressed` (T3.1) CANNOT both pass on a semantic-saturated corpus.
Headroom form fails identically (base=1.0 → 0 headroom).

**Required correction (absorbed):** the T2.1 unit fixture AND the T3.1 corpus MUST give the linked
candidate semantic headroom below the 1.0 clamp (distractors ~0.85, relevant ~0.85 but linked).
Then numerator-only works: distractor 0.85, relevant `min(0.85+0.25, 1.0)` = 1.0 → discriminates,
and distractor unchanged with/without boost (churn=0). Without headroom T3.1 reports a VACUOUS green.
This subsumes EC-2.

### CRITICAL 2 — same root cause, framed at plan level

The plan treated the T3.1 corpus extension as additive; it is a PRECONDITION for the fix to be
testable at all. Flagged before T2.1 writes its fixture.

## Confirmed against real code

- **#125 curve:** current `W·1/(1+0.001·(n-1)²)` is strictly decreasing (n=1→0.500, n=10→0.4625).
  `scoring.test.ts:59-62` `"attenuates as numLinked grows"` encodes the bug → invert in T1.1.
- **Recommended curve:** `entityBoost(n) = W·n/(n+c)`, c a module const. n=0→0 (preserves exact zero),
  monotone for any c>0, saturates at W. n=1 = `W/(1+c)`: c=0.25→0.40, c=0.5→0.33, c=1→0.25. Benchmark
  sweeps c ∈ {0.25, 0.5, 1}; default toward small c (~0.25) to preserve the common n=1 magnitude.
- **#127 fix = `maxPossible` ONLY.** Delete the entity block (`scoring.ts:73-75`); `combineScores`
  already sums entityBoostScore into the numerator and clamps at 1.0 (`:99-100`) — no change.
  Update the `maxPossible` unit tests (`:74-80`) + JSDoc (`:62`) in T2.1 (do not leave dead).
- **Callers:** `maxPossible(` called exactly once (`pipeline.ts:501`); the single `maxScore` feeds
  BOTH filter passes (initial `:511`, adaptive-relax `:325`) consistently. `combineScores(` once
  (`:205`). Both barrel-exported (`domain/index.ts:547,549`), not consumed cross-repo. No separate
  denominator to fix.

## MINOR

- `ActiveSignals.entity` becomes unused by `maxPossible` — keep the field, ignore in body (KISS).
- `maxPossible` JSDoc set {0,1.0,1.5,2.0,2.5} becomes stale → update.
