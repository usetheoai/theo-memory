# SEPA — Iteration 12 / T7.2 / pre-COMMIT / MODE=self-audit-consolidated

## Guardrail test — CLAUDE.md Item 6 acceptance second half

**Result: 1/1 PASS in 1.84s.**

Plan T7.2 acceptance verbatim:
> "Guardrail unit test: a rare-but-isolated memory survives ≥ 5 consecutive LRU eviction passes against frequent siblings."

## Plan deviation absorbed (D18 / EC-3 fallback)

Plan T7.2 § Deep Dives prescribes UNIT tier with `InMemoryVectorStore` (no Docker, < 500ms). ADR D18 (plan v1.1 EC-3 absorption) provides an explicit fallback: "InMemoryVectorStore MUST support cosine-distance nearest-neighbor (linear-scan); else T7.2 promoted to integration tier."

`InMemoryVectorStore` does NOT carry a cosine-NN method matching `PgNearestNeighborProvider`. Adding one would either (a) duplicate the SQL `<=>` semantics in JS for a test-only purpose (scope creep + drift risk), or (b) skip multiplier protection (defeats the test's intent). Honest path = integration promotion. Runtime: 1.84s (vs the 500ms unit-tier ideal). Trade-off: 1.3s extra latency for correctness + zero new InMemoryVectorStore surface area.

Placed at `tests/integration/forgetting/guardrail-long-tail.test.ts` per the established T2.2/T3.1/T4.x/T5.x/T6.1/T7.1 pattern.

## Topology

- 1 rare-isolated memory: one-hot vector at index 500 (orthogonal to frequent cluster)
- 100 frequent siblings: one-hot at index 0 + small perturbations at nearby dims → tight intra-cluster cosine distance ≈ 0.005
- Same triadic base score across all 101 (importance=0.5, access_count=0, lastAccessedAt=NULL)
- Trigger: `CapacityBasedTrigger({ maxMemoriesPerScope: 70 })`

## 5-pass wave protocol

Each pass cycle:
1. Trigger fire → evicts ~31 (raw overflow 30.7% → cap 0.5 → exact 30%)
2. Assert rare NOT in `softDeleted`
3. Assert rare's `t_invalid IS NULL` in DB
4. Refill: insert 31 fresh frequent rows to push count back above cap

After all 5 passes: final assertion that rare's `t_invalid IS NULL` regardless of how many frequent waves washed through.

## Self-audit

- ✓ Plan deviation documented (D18 fallback → integration tier)
- ✓ Paper-name scan clean
- ✓ Test runtime 1.84s (vs plan's 500ms unit-tier ideal; well under the 60s integration-tier vitest timeout I configured)
- ✓ Long-tail multiplier validated at the 5-pass stress depth — rare's high isolation_distance (1.0 to all 100 frequent siblings) keeps its multiplier at the clamp ceiling (1.0); frequent siblings always get multiplier ≈ 0.1 → become victims every pass
- ✓ Wiring: a/b/c all PASS (T7.1 satisfied a/b/c for the whole chain; T7.2 is an additional integration test reinforcing the wiring)

## Verdict

READY to ship. Together with T7.1, this commit closes CLAUDE.md § Macro roadmap Item 6 acceptance VERBATIM in full (both the `recall@10 ≥ 0.70` constraint AND the `survives ≥ 5 consecutive LRU passes` guardrail).
