# Entity boost — precision@k (M15 / theo-memory#122)

Measured 2026-07-24 against real `ankane/pgvector:v0.5.1`, on the `develop` branch.

## Results

Two runs, same corpus, same code:

| Metric | Run 1 | Run 2 |
|---|---|---|
| precision@1 — boost OFF | 0.64 | 0.68 |
| precision@1 — boost ON | **1.00** | **1.00** |
| delta | +0.36 | +0.32 |
| `recall_set_churn` at default threshold (0.1) | **0** | **0** |
| `recall_set_churn` at threshold 0.8 | not measured | **75** |
| `boostedCandidateCount` | 9 of 25 | 8 of 25 |
| latency per query — boost OFF | 40.70 ms | 27.66 ms |
| latency per query — boost ON | 46.91 ms | 52.50 ms |

Raw output of the latest run: [`entity-boost-m15.json`](./entity-boost-m15.json).

**The baseline is not stable across runs; the boosted side is.** With the boost off every
candidate in a topic ties exactly, so which one lands first is decided by Postgres' row order
— and that is not guaranteed stable between runs. With the boost on the tie is always broken
the same way, so precision@1 is 1.00 deterministically.

The honest reading is therefore a **range**, not a point: the baseline sits around 0.64–0.68
and the delta around +0.32 to +0.36. An earlier version of this document claimed the run
reproduces "the numbers exactly". That was wrong, and the second run is what disproved it.

## Reproduction

```bash
docker compose up -d pgvector                                   # port 5442 in this run
export THEOMEM_PG_URI="postgres://themem:themem@localhost:5442/themem"
npm run build
npx vitest run tests/integration/entity-boost/precision-benchmark.test.ts
```

Fixed vectors, no LLM, no sampling, no wall-clock in the scoring path. The **boosted** side
reproduces exactly. The **baseline** does not: it depends on how Postgres orders exactly-tied
rows, which varies between runs. Expect the baseline in the 0.64–0.68 band.

## Method

100 memories across 25 topics. Each topic has one **relevant** memory linked to that topic's
entity, plus three **distractors** carrying the byte-identical embedding and no entity link.
Each query targets one topic and mentions its entity by name.

The distractors share the relevant memory's embedding on purpose. Within a topic the semantic
signal therefore cannot discriminate at all — every candidate ties, and the only thing that
can break the tie is the entity link. That is what makes the measurement an isolation of the
boost's contribution, as plan ADR D2 requires.

`recall_set_churn` counts memories present in the post-threshold set with the boost off and
absent with it on. It is measured **before** the top-K truncation. Measuring after truncation
would count a successful promotion — the desired effect, since promoting one item necessarily
evicts the last-ranked one — as a regression, and the target of `0` would be unreachable by
construction.

## What these numbers mean, and what they do not

**They measure the boost's discriminating power when the semantic signal is ambiguous.** That
is the situation the feature exists for. They are **not** a general end-to-end
retrieval-quality claim, and they are **not** comparable to any other system's published
figures — this compares the system against itself, feature off versus on.

**The 0.64 baseline is not the random-tie floor.** With four tied candidates a uniformly random
tie-break would land near 0.25. The baseline is higher because ordering among equal scores is
not random: the relevant memory is inserted first in each topic, and that appears to bias the
tie-break in its favour. The effect is conservative for this report — it *raises* the baseline
and therefore *shrinks* the measured delta, so the reported band is a **lower bound**, not an
inflated one.

**`boostedCandidateCount` is 25 — one per topic.** The boost changed the outcome only for the topics
The earlier figure of 8–9 came from a broken instrument: it compared ranks between two runs, so
it only counted topics where the boost changed the winner, and it inherited the baseline's
instability — meaning a completely DEAD boost could have produced a non-zero count from
tie-break noise alone. It is now asked of the stage directly: how many candidates received a
non-zero boost. A dead boost returns an empty map, always. The number exists so the defect
(#122) this milestone closes — a component summed as a constant zero since v0.1 — cannot come
back unnoticed.

## The renormalization risk is real, and here is its size

Plan ADR D1 accepted, knowingly, that enabling the boost raises `maxPossible` and therefore
lowers the normalized score of every candidate WITHOUT an entity link. It accepted that on the
explicit condition that D2 would measure it.

The first version of this benchmark did not. It measured churn at the pipeline default
threshold (0.1), where an unlinked candidate lands at `1.0/1.5 = 0.667` — 6.7× above the gate.
Zero churn there was an arithmetic certainty, not an observation. The instrument reported
"no risk" because it was incapable of reporting anything else.

Measured properly, at threshold 0.8, the effect is **75 evictions across 25 topics**. The
arithmetic is exact and fully explains it: without the boost all four candidates in a topic
score 1.0; with it the linked one stays at `1.5/1.5 = 1.0` while the three unlinked fall to
`1.0/1.5 = 0.667`, below the gate. Three per topic, twenty-five topics.

**What this means for a consumer.** At the default threshold nothing changes — the drop does
not cross the gate. At a high threshold, turning the boost on can remove unlinked results that
a previous version returned. That is a behaviour change, not a bug: a candidate with no entity
link genuinely IS further from the achievable maximum once entity evidence is on the table.
But it is a change nobody would predict from the release notes alone, so it is stated here and
tracked separately for a decision on whether D1 should stand.

**Cost: +6.2 ms per query (40.70 → 46.91 ms), about 15%.** That is the price of one extra
indexed round-trip over the candidate set, measured on the same 25 queries. It is bounded by
construction: one query per recall regardless of candidate count, proven separately by
`linked-keys.test.ts` (20 candidates cost exactly 1 query) and `query-plan.test.ts` (index-served
at 50k rows). These are absolute numbers from one machine under load, so treat the ratio as the
signal, not the milliseconds.

**Memories written before M13 have no extracted entities** and therefore never receive a
boost. `themory reextract` is the remediation. This benchmark seeds its own graph and does not
measure that gap.

## Guard rails

Per the project's public-copy discipline, no comparative "faster than" or "better than" claim is
made anywhere in this document, and none may be derived from it: comparative claims require a
reproducible artifact plus independent third-party reproduction, and this benchmark has
neither. It is an internal before/after measurement of one feature.
