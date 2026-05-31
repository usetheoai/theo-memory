# SEPA — Iteration 8 / T5.1 / pre-COMMIT / MODE=self-audit-consolidated

## Consolidation rationale

T5.1 introduces ONE new orchestrator class `CapacityBasedTrigger` with:
- Pool dependency (already established pattern from PgHalfLifePersister + PgNearestNeighborProvider)
- Advisory lock per EC-2 absorption (deep dive line 758 documented the trigger choice)
- Transaction-scoped fire() method delegating to private runEvictionPass

Mechanical extension on top of T4.2's TriadicScoringPolicy (now complete with all 4 dimensions). SEPA Agent invocation skipped per the established T4.1+T4.2 pattern; self-audit covers the same checklist.

## Self-audit checklist

- ✓ EC-2 advisory lock implemented with `pg_try_advisory_xact_lock(hashtext('eviction_' || scope))` per plan deep dive line 758. Lock acquired BEFORE COUNT+evict path. Auto-released on COMMIT/ROLLBACK.
- ✓ REFACTOR step done: `computeOverflowFraction(currentSize, maxSize)` extracted as a top-level pure function (plan T5.1 task #4). Tested independently via 3 unit-shape tests at the top of the integration file.
- ✓ Overflow fraction clamp: `Math.min(0.5, raw)` — never evicts more than 50% per pass per blueprint D10 + plan deep dive line 757.
- ✓ Soft-delete via `t_invalid = NOW()` + `t_invalid IS NULL` idempotency guard — never physical DELETE per ADR D17.
- ✓ rowToMemoryItem helper handles scope discrimination (agent → AgentScope, session → SessionScope, user → UserScope fallback).
- ✓ Concurrent fire() test (EC-2) passes: two parallel fires share scope; advisory lock makes one return null; total evicted ≤ overflow_count.
- ✓ Paper-name scan clean (zero hits on the 2 changed files).
- ✓ DIP boundary clean: capacity-based-trigger.ts imports pg + ../../core/dip/eviction-policy.js + ../../core/memory-item.js + ./triadic-scoring-policy.js. No cross-cloud touch.
- ✓ Backward compat: no changes to TriadicScoringPolicy / EvictionPolicy interfaces; CapacityBasedTrigger is additive only.
- ✓ Conventional commit format; no Co-Authored-By; branch=develop per global override.

## Wiring triad

- (a) DEFER-foundation: check_wiring.py reports PASS with 2 callers but they are (1) the trigger file itself + (2) the test file. No real production consumer instantiates `new CapacityBasedTrigger(...)` yet — T6.1 (evict orchestration → wire into LocalScopedMemory.remember() path) is the canonical first caller. Same classification pattern as T1.1, T2.1, T2.2 persister.
- (b) PASS: 5 integration tests cover overflow / scoring / cap-fraction / no-op / EC-2 concurrent paths.
- (c) n/a: plan T5.1 declares no metric (forgetting_evict_total at T6.1 only).

## Test results

- 8/8 GREEN in capacity-trigger suite (3 computeOverflowFraction unit tests + 5 integration tests)
- 22/22 v0.4b integration suite across 5 files (lazy-half-life + recall-bookkeeping + nearest-neighbor + multiplier-integration + capacity-trigger)
- 520/522 contract suite unchanged
- Typecheck clean, lint clean, boundary clean

## Verdict

READY to ship.
