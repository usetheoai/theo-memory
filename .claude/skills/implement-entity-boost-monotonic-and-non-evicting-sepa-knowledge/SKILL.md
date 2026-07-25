---
name: implement-entity-boost-monotonic-and-non-evicting-sepa-knowledge
description: Paired knowledge base for the M18 SEPA (entity-boost monotonic + non-evicting, #125/#127). Distilled plan context so the SEPA agent grounds its second opinions without re-reading every artifact each turn.
---

# SEPA knowledge — M18 entity-boost monotonic + non-evicting

Companion to the SEPA agent `implement-entity-boost-monotonic-and-non-evicting-sepa`.

## What M18 fixes (both surfaced by the M15 /review)

- **#125** — `entityBoost(numLinked)` (`packages/core/src/domain/scoring.ts:45`) is DECREASING in `numLinked`; must become non-decreasing + saturating at `ENTITY_BOOST_WEIGHT=0.5`. Semantics: `numLinked` = query↔memory matched-entity count → more is better.
- **#127** — the shared denominator `maxPossible` inflates to 2.5 when the entity signal is active, evicting UNLINKED candidates at `pipeline.ts` `filterAtThreshold` line ~209 (`combined < threshold`). Fix: unlinked-candidate score identical with/without entity active for others (ADR D2, numerator-only preferred).

## Non-negotiable invariants

`entityBoost(0)===0` exact · monotonic non-decreasing · saturates ≤ W · combineScores clamps at 1.0 · M15 gain preserved (linked > unlinked) · `scoring.ts` stays pure `Math`-only.

## The bug-encoding test

`scoring.test.ts` `"attenuates as numLinked grows"` asserts `entityBoost(10) < entityBoost(2) < entityBoost(1)` — this ENCODES #125 and MUST be inverted/removed in T1.1.

## Benchmark evidence (T3.1)

`monotonic_violations=0` · `recall_set_churn_sensitive=0` at threshold 0.8 (was 75) · `precision@k` new ≥ old, with a corpus containing the `numLinked=1` common case (EC-2).
