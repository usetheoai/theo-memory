# Entity boost — monotonic + non-evicting (M18 / theo-memory#125, #127)

Measured 2026-07-25 against real `ankane/pgvector:v0.5.1`, on the `develop` branch.

M18 fixes two defects the M15 `/review` surfaced in the entity boost, and proves each with a
number:

- **#125** — the boost curve was DECREASING in `numLinked`: a memory matching more query
  entities got *less* boost. Replaced `W/(1+0.001·(n-1)²)` with `W·n/(n+c)` (c=0.25) — monotone
  non-decreasing, saturating at `W`.
- **#127** — the boost sat in the normalization DENOMINATOR (`maxPossible`), so activating the
  entity signal inflated the denominator for *every* candidate and evicted unlinked candidates
  that had already passed the semantic gate. Made numerator-only.

## Results

Against the M15 baseline (same feature, the defects present):

| Metric | M15 (before) | M18 (after) |
|---|---|---|
| precision@1 — boost OFF | 0.64–0.68 | 0.08 |
| precision@1 — boost ON | **1.00** | **1.00** |
| delta | +0.32 … +0.36 | **+0.92** |
| `recall_set_churn` at default threshold (0.1) | 0 | **0** |
| `recall_set_churn` at threshold 0.8 | **75** | **0** |
| `monotonic_violations` across numLinked 1..6 | not measured | **0** |
| boost by numLinked 1..6 | n/a (always 1) | 0.40, 0.44, 0.46, 0.47, 0.48, 0.48 |
| `boostedCandidateCount` | 8–9 of 25 | 25 of 25 |

Raw output: [`entity-boost-m18.json`](./entity-boost-m18.json).

**The headline is the `recall_set_churn` at threshold 0.8: 75 → 0.** In the M15 corpus, turning
the boost on evicted 75 unlinked candidates from the post-threshold set at the sensitive band,
purely because *other* candidates were entity-linked and inflated the shared denominator.
Numerator-only makes an unlinked candidate's score identical with and without the entity signal,
so it can never be evicted — the 0 is now a structural guarantee, asserted as `toBe(0)`, not the
`>= 0` the M15 instrument had to use.

**The lower boost-OFF baseline (0.08 vs 0.64) is the corpus, not a regression.** M18 gives the
query semantic HEADROOM (cosine 0.85 to the candidates) instead of the saturated 1.0 the M15
benchmark used. Under numerator-only, a saturated 1.0 corpus ties the linked relevant and its
unlinked distractors at the clamp — precision would be a coin-flip and the number vacuous (the
SEPA precondition). With 0.85 headroom the boost promotes the linked relevant to
`min(0.85 + 0.40, 1.0) = 1.0` above the distractors at 0.85: a real, deterministic separation.
The boost-ON precision stays 1.00; the boost-OFF baseline is lower because tied 0.85 candidates
rarely put the relevant first by row-order luck. The delta +0.92 is the boost's measured worth.

**Monotonicity (#125):** the boost the stage assigns rises with `numLinked` —
0.40, 0.44, 0.46, 0.47, 0.48, 0.48 for n = 1..6 — strictly non-decreasing, saturating toward
`W = 0.5`. The M15 corpus linked every relevant to exactly one entity, so the decreasing curve
was invisible; the M18 fixtures link 1..6 query-matched entities to expose it.

### Why c = 0.25

`entityBoost(n) = W·n/(n+c)` gives `n=1 → W/(1+c)`. Smaller `c` keeps the common single-match
case nearer the legacy peak of 0.50: c=0.25 → 0.40, c=0.5 → 0.33, c=1 → 0.25. c=0.25 was chosen
to preserve the n=1 magnitude while staying monotone; the benchmark confirms it does not regress
precision (boost-ON stays 1.00).

## Reproduction

```bash
docker compose up -d pgvector                                   # port 5442 in this run
export THEOMEM_PG_URI="postgres://themem:themem@localhost:5442/themem"
npm run build
npx vitest run --config vitest.integration.config.ts tests/integration/entity-boost/precision-benchmark.test.ts
```

Fixed vectors, no LLM, no sampling. The boosted side and every M18 gate number
(`recall_set_churn` = 0, `monotonic_violations` = 0) reproduce exactly. The boost-OFF baseline
depends on how Postgres orders tied rows and varies run to run — read it as a band, not a point.

## Method

100 topic memories across 25 topics (one relevant linked to the topic's entity + three unlinked
distractors sharing its embedding) measure precision and churn; the query embeds at cosine 0.85
to the candidates (semantic headroom below the clamp). Six monotonicity fixtures each link
`n = 1..6` distinct entities that their query mentions, read straight through `computeEntityBoost`
to measure the curve end-to-end through the pipeline stage.

`recall_set_churn` counts memories present in the post-threshold set with the boost off and absent
with it on, measured **before** top-K truncation (measuring after would count a successful
promotion as a regression). At threshold 0.8 — the sensitive band where the old renormalization
could cross the gate — the churn is 0.
