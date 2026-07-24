# Entity boost — precision@k (M15 / theo-memory#122)

Measured 2026-07-24 against real `ankane/pgvector:v0.5.1`, on the `develop` branch.

## Results

| Metric | Value |
|---|---|
| precision@1 — boost OFF | **0.64** |
| precision@1 — boost ON | **1.00** |
| delta | **+0.36** |
| `recall_set_churn` (post-threshold) | **0** |
| `boostedCandidateCount` | **9** of 25 topics |

Raw output: [`entity-boost-m15.json`](./entity-boost-m15.json).

## Reproduction

```bash
docker compose up -d pgvector                                   # port 5442 in this run
export THEOMEM_PG_URI="postgres://themem:themem@localhost:5442/themem"
npm run build
npx vitest run tests/integration/entity-boost/precision-benchmark.test.ts
```

Fully deterministic: fixed vectors, no LLM, no sampling, no clock. Re-running reproduces the
numbers exactly.

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
and therefore *shrinks* the measured delta, so **+0.36 is a lower bound**, not an inflated one.

**`boostedCandidateCount` is 9, not 25.** The boost changed the outcome for the 9 topics where
the relevant memory was not already ranked first by tie-break. For the other 16 it confirmed a
position that was already correct. The number exists so a dead boost cannot pass this
benchmark silently — which is precisely the defect (#122) this milestone closes, where the
component had been summed as a constant zero since v0.1.

**Memories written before M13 have no extracted entities** and therefore never receive a
boost. `themory reextract` is the remediation. This benchmark seeds its own graph and does not
measure that gap.

## Guard rails

Per `.claude/rules/public-copy.md` § 4, no comparative "faster than" or "better than" claim is
made anywhere in this document, and none may be derived from it: comparative claims require a
reproducible artifact plus independent third-party reproduction, and this benchmark has
neither. It is an internal before/after measurement of one feature.
