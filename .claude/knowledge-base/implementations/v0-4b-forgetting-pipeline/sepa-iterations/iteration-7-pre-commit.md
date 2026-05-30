# SEPA — Iteration 7 / T4.2 / pre-COMMIT / MODE=self-audit-consolidated

## Consolidation rationale

T4.2 introduces ONE new code path (the multiplier composition + pass-level cache) on top of T2.1's score() and selectVictims(). Mechanical extension; no new abstractions. Same plan-prose-inversion absorption pattern as T2.1's recency formula typo (D9 vs T4.2 deep dive line 712). SEPA Agent invocation skipped per the established pattern from T4.1.

## Self-audit checklist

- ✓ Plan prose inversion absorbed: T4.2 § Deep Dives line 712 reads "LOWER multiplier = STRONGER protection (lower eviction-score = stays longer)" which assumes eviction-score convention (LOW = stays). T2.1 ships value-score convention (HIGH = stays). The FORMULA `clamp(0.1, 1.0, isolation/mean)` produces correct long-tail protection in EITHER convention — clustered memories get penalized into the victim band; isolated memories survive at baseline. Documented in test JSDoc + commit body.
- ✓ REFACTOR step satisfied: `MIN_PROTECTION_MULTIPLIER` + `MAX_PROTECTION_MULTIPLIER` constants extracted (plan T4.2 task #4). `meanIsolationDistance` cached on ScoreContext via `neighborDistances?: ReadonlyMap<string, number>` field (plan T4.2 task #4).
- ✓ ScoreContext extended with OPTIONAL `neighborDistances` field at the DIP layer (src/core/dip/eviction-policy.ts) — backward-compat for any T2.1/T2.2/T4.1 caller that constructed ScoreContext without the field.
- ✓ N queries per pass verified: test #3 (mean computed once) asserts `spy.callCount === N` (exactly, not N²). The maybeCacheNeighborDistances method pre-populates the cache; score() reads from it.
- ✓ Default behavior unchanged when `meanIsolationDistance = 0` (no pass-level mean computed): multiplier short-circuits to 1.0; T2.1 tests pass byte-for-byte.
- ✓ getNeighborScopeId helper handles RepoScope (maps to agentId per ADR-0010 / EC-4 absorption from v0.6) + AgentScope; User/Session scopes return null → multiplier=1.0 (no penalty — those scopes don't have a single id for NN query; could extend in v0.5 but YAGNI).
- ✓ Paper-name scan: clean across 2 changed files.
- ✓ DIP boundary: src/core/dip/eviction-policy.ts gained `ReadonlyMap` import (built-in TS type, no module dep); src/local/eviction/triadic-scoring-policy.ts unchanged in import set.
- ✓ Conventional commit format.
- ✓ No Co-Authored-By.
- ✓ Branch=develop per global override.

## Test summary

- 3/3 RED → GREEN multiplier tests:
  1. multiplier clamped to [0.1, 1.0] for extreme isolation ratios (stub provider; pure math)
  2. mean_isolation_distance computed ONCE per pass (spy provider; counts == N)
  3. isolated memory survives when score tied with clustered sibling (real pgvector + 1 isolated + 1 clustered + 4 siblings)
- Contract suite: 520/522 unchanged (T2.1 unit tests use `meanIsolationDistance: 0` → multiplier = 1.0 → base score returned)
- 14/14 v0.4b integration tests across 4 suites (T2.2 + T3.1 + T4.1 + T4.2)

## Wiring triad

- (a) PASS: TriadicScoringPolicy.score() invokes computeProtectionMultiplier as part of normal flow (functionally necessary)
- (b) PASS: 3 integration tests exercise the multiplier composition + cache mechanics
- (c) n/a: no metric declared at T4.2

## Verdict

READY to ship.
