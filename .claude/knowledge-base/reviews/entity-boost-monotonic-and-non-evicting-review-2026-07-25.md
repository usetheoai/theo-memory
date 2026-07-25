# Review: entity-boost-monotonic-and-non-evicting (M18 — #125, #127)

**Date:** 2026-07-25
**Reviewers (spawned agents):** 6 — architecture, tests, wiring, cross-validation, domain-database, domain-testing
**Findings:** 13 total (BLOCKER: 0, HIGH: 0, MEDIUM: 3, LOW: 9, INFO: 1)
**Verdict:** READY_TO_MERGE — all 3 MEDIUM findings fixed; key LOWs addressed; core fix confirmed correct by every agent.

The 6 agents unanimously confirmed the core fix (`entityBoost` non-decreasing `W·n/(n+c)`; `maxPossible`
numerator-only) is architecturally sound, correctly wired, cross-validated against the plan, and correct
through the real pgvector pipeline. Every finding was a test/doc rigor gap, not a defect in the fix. All
were resolved in `5c484b6` (fixes) atop the 6 task commits.

## MEDIUM findings — all FIXED

### F-tests-1 — plan promised a c-sweep; impl hardcodes c=0.25
- Found by: tests, domain-database (F-dom-4 INFO echo)
- **Resolution:** reconciled the honesty gap (Rule 3). Precision is **c-invariant** on this corpus — any
  `c>0` gives a positive boost that promotes the relevant above the tied distractors, so precision is 1.0
  for every candidate `c` and a sweep cannot discriminate. `c=0.25` is chosen by the **n=1 magnitude**
  criterion (0.40, nearest the legacy 0.50). Plan ADR D1 + T3.1 + Drawbacks and `docs/benchmarks/entity-boost-m18.md`
  now state this; the benchmark *confirms non-regression*, it does not *elect* c by precision.

### F-dom-db-1 — benchmark cannot falsify the numerator-only domination risk
- Found by: domain-database
- **Resolution:** new `tests/integration/entity-boost/semantic-domination.test.ts` (2/2 vs real pgvector)
  proves the boost's influence is **bounded by W**: a linked candidate at semantic 0.6 leapfrogs an
  unlinked 0.9 (gap 0.3 < W — design intent), but a linked 0.3 does NOT leapfrog 0.9 (gap 0.6 > W — the
  boost caps at W and cannot resurrect an arbitrarily-less-relevant candidate). The domination is now
  bounded and tested, not assumed.

### F-dom-1 — monotonicViolations==0 is vacuous to a numLinked-collapse
- Found by: domain-testing
- **Resolution:** the benchmark now also asserts `boostByNumLinked[MONO_MAX-1] > boostByNumLinked[0]`, so a
  numLinked that silently collapsed to a constant (zero "decreasing" violations, but a dead varying-signal)
  can no longer pass green. Measured curve rises 0.40 → 0.48.

## LOW findings — addressed

- **F-dom-db-3** — monotonicity fixtures moved off `topicVector(0)` to a dedicated dim 200 (no topic-0 pool pollution).
- **F-tests-5 / EC-1** — added a negative case (`entityBoost(-1)/(-100) → 0`, per `testing.md § 4.1`) + a
  second saturation magnitude (n=100 and n=10000) with a finiteness guard.
- **F-tests-3** — renamed the stale `test_stage_returns_attenuated_boost_...` (the boost is no longer attenuated).
- **F-arch-3** — softened the `signals.entity` JSDoc: it is retained for interface stability (the pipeline
  still computes it), not for an unsubstantiated telemetry reader.
- **F-dom-2** — the benchmark doc now clarifies the "75 → 0" row pairs two corpora (M15 saturated vs M18
  headroom) and states the stronger, corpus-independent structural guarantee (denominator invariant → churn 0 on any corpus).
- **F-tests-2** (RED co-committed with fix, not separately auditable) and **F-tests-4** (M15/v0.1 headers):
  acknowledged process notes; the RED-bite was verified against `origin/main` by the tests agent, and the
  historical headers are non-blocking.
- **F-dom-db-2** (monotonicViolations measured at the stage, not the clamped pipeline): documented scope; the
  stage-level measurement is the correct isolation of the curve, and the pipeline-level rank behavior is
  covered by `ranking.test.ts` + `semantic-domination.test.ts`.

### Regression caught & fixed by the full-suite re-run
`production-path.test.ts` (the public-API boost-reaches-consumer test, not in the plan's file set) relied on
the pre-M18 saturated 1.0 corpus and broke under numerator-only (tie at the clamp). Fixed with the same
semantic-headroom (cosine 0.9, Gram-Schmidt from the query embedding) the other integration tests use. This is
exactly the class of latent dependency the full-suite review exists to surface.

## Cross-validation summary
- Plan tasks: 6 — Fully implemented: 6, Partially: 0, Missing: 0, Diverged: 0.
- Both ADRs (D1 curve, D2 numerator-only) implemented exactly. SEPA CRITICAL (semantic-headroom precondition)
  landed in the plan ~12 min before the first implement commit; implementation matches the revised plan.

## Quality gates summary
- Full contract suite: 1355 passed, 3 skipped, 0 failed; typecheck 0 errors.
- entity-boost integration (6 files, vs real ankane/pgvector:v0.5.1): 19 passed.
- Suspect recall-pipeline integration (reranker, entities, cache, bitemporal): 49 passed.
- `/code-quality`: PASS, cap 100, zero hard caps.
- Wiring triad: entityBoost + maxPossible pillar (a)+(b) PASS, (c) N/A (reuses M16 OTel events).
- Benchmark evidence (docs/benchmarks/entity-boost-m18.json): monotonic_violations 0, recall_set_churn_sensitive 0
  (75 in M15), precision@1 boost-ON 1.00 (delta +0.88), boostByNumLinked strictly rising, boostedCandidateCount 25.

## Spawned agents (audit trail)
- .claude/agents/review-entity-boost-monotonic-and-non-evicting-2026-07-25/{architecture,tests,wiring,cross-validation,domain-database,domain-testing}.md

## Handoff decision
READY_TO_MERGE → proceed to `/release`. No BLOCKER, no HIGH; all 3 MEDIUM findings fixed with tests that
bite; the core #125/#127 fix is confirmed correct by all six independent agents and proven by benchmark
against real pgvector.
