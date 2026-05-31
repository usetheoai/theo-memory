# SEPA — Iteration 2 / Task T1.1 / Phase Pre-RED / Mode TIGHT

Date: 2026-05-31
Agent ID: ab0727c9d07080a35

## Plan recap
- T1.1 ships TriadicScoringPolicyOptions interface + overloaded constructor closing F-arch-1 CRITICAL; preserves 5-positional signature as `@deprecated` per ADR D5; EC-2 absorbs the `'weights' in undefined` TypeError trap.

## Findings

- **[MAJOR]** EC-2 disambiguation has a `null`-first-arg gap. `typeof null === 'object'`. Plan branch line 280 reads `if (arg === undefined || isWeightsLike(arg))` — does NOT include `arg === null`. The 9 positional-undefined call sites pass `undefined`, so they're safe — but `docs/forgetting-evaluation/run.ts` + future callers may pass `null`. Recommend explicit `arg === null` branch OR `isWeightsLike` guards null. Add 6th RED test.
- **[MAJOR]** Plan TDD declares 5 RED tests; Acceptance line 308 says "3 RED tests GREEN". TDD block is authoritative — implement all 5 (3 happy + 2 EC-2) + 1 null guard = 6 total.
- **[MINOR]** Test path `src/local/eviction/__tests__/triadic-scoring-options.test.ts` covered by `vitest.contract.config.ts` glob ✓.
- **[INFO]** CHANGELOG `[Unreleased]` § Deprecated entry per Acceptance line 311 — flag if missing at pre-COMMIT.
- **[INFO]** Call-site migration straightforward; no F-wire-4 evictor=null trap (existing `evict()` returns empty result when evictor=null, file:238-240).

## Recommended action

RED phase: add 5 plan-declared tests + 6th null-first-arg guard test. GREEN: ensure branch handles `undefined`, `null`, and `TriadicWeights` shape before falling through to options-object.
