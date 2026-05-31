/**
 * T7.1 — THE GOAL TEST for v0.4b triadic-scored forgetting with long-tail
 * preservation. CLAUDE.md § Macro roadmap Item 6 acceptance verbatim:
 *
 *   "Curated test set: 1000 memories with 50 rare-query targets seeded. After
 *    forget() cycle removing 30% by triadic score: recall@10 on rare-query
 *    set ≥ TBD. Guardrail unit test: a rare-but-isolated memory survives ≥ 5
 *    consecutive LRU eviction passes against frequent siblings."
 *
 * Locked threshold (plan T7.1 § Deep Dives line 898): `recall@10 ≥ 0.70`.
 * Random eviction baseline: ≈ 0.40 (with 30% removal × top-10 retrieval
 * probability). Triadic + long-tail multiplier MUST beat 0.70 by design.
 *
 * Topology: 950 cluster members across 5 dense clusters + 50 rare-isolated
 * targets (see fixtures/rare-target-seed.ts for the deterministic generator).
 * All seeds share identical triadic BASE score → the long-tail multiplier
 * is the sole discriminator during selectVictims:
 *   - Cluster member multiplier ≈ 0.1 (clamp floor; tight sibling NN)
 *   - Rare target multiplier ≈ 1.0 (max isolation; no near neighbors)
 *
 * @see .claude/knowledge-base/plans/v0-4b-forgetting-pipeline-plan.md § T7.1
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import pg from 'pg';

import { CapacityBasedTrigger } from '../../../src/local/eviction/capacity-based-trigger.js';
import { PgEvictor } from '../../../src/local/eviction/pg-evictor.js';
import { PgNearestNeighborProvider } from '../../../src/local/eviction/pg-nearest-neighbor-provider.js';
import { PgvectorStore } from '../../../src/local/pgvector-store.js';
import { TriadicScoringPolicy } from '../../../src/local/eviction/triadic-scoring-policy.js';

import {
  CLUSTER_COUNT,
  MEMBERS_PER_CLUSTER,
  RARE_TARGET_COUNT,
  TOTAL_SEED_COUNT,
  seedRareTargetTopology,
} from './fixtures/rare-target-seed.js';

const PG_URI = process.env['THEOMEM_PG_URI'];

const RECALL_AT_10_THRESHOLD = 0.7;
const TARGET_CAP = 700;
const TEST_AGENT_ID = 'goal-test-agent-v0-4b-t7-1';

if (PG_URI === undefined || PG_URI === '') {
  describe.skip('THE GOAL TEST T7.1 — triadic eviction (THEOMEM_PG_URI not set)', () => {
    test('placeholder', () => {
      // no-op
    });
  });
} else {
  describe('THE GOAL TEST T7.1 — 1000 memories, 30% triadic eviction, recall@10 ≥ 0.70', () => {
    let pool: pg.Pool;
    let store: PgvectorStore;
    let policy: TriadicScoringPolicy;
    let trigger: CapacityBasedTrigger;

    beforeAll(async () => {
      pool = new pg.Pool({ connectionString: PG_URI });
      store = new PgvectorStore(pool);
      const neighborProvider = new PgNearestNeighborProvider(pool);
      const evictor = new PgEvictor(pool);
      policy = new TriadicScoringPolicy({ neighborProvider, evictor });
      trigger = new CapacityBasedTrigger(pool, policy, TARGET_CAP);
    }, 30_000);

    afterAll(async () => {
      await pool.end();
    });

    beforeEach(async () => {
      await pool.query(`DELETE FROM memories WHERE agent_id = $1`, [TEST_AGENT_ID]);
    }, 60_000);

    test(
      'seeds 1000 memories, evicts 30% via CapacityBasedTrigger, recall@10 on rare queries ≥ 0.70',
      async () => {
        const seed = await seedRareTargetTopology(pool, TEST_AGENT_ID);
        expect(seed.clusterMemberIds.length).toBe(CLUSTER_COUNT * MEMBERS_PER_CLUSTER);
        expect(seed.rareTargetIds.length).toBe(RARE_TARGET_COUNT);

        const result = await trigger.fire({ kind: 'agent', agentId: TEST_AGENT_ID }, new Date());
        expect(result).not.toBeNull();
        // (1000 - 700) / 1000 = 0.30 raw overflow → cap 0.5 → expect 300 evicted.
        expect(result?.softDeleted.length ?? 0).toBe(
          Math.floor(TOTAL_SEED_COUNT * 0.3),
        );

        let totalHits = 0;
        for (let r = 0; r < RARE_TARGET_COUNT; r++) {
          const query = seed.rareQueries[r];
          if (query === undefined) {
            throw new Error(`Rare query ${r} undefined`);
          }
          const results = await store.search(query, 10, { agent_id: TEST_AGENT_ID });
          const expectedId = seed.rareTargetIds[r];
          if (expectedId === undefined) {
            throw new Error(`Rare target id ${r} undefined`);
          }
          if (results.some((row) => row.id === expectedId)) {
            totalHits += 1;
          }
        }

        const recallAt10 = totalHits / RARE_TARGET_COUNT;
        expect(recallAt10).toBeGreaterThanOrEqual(RECALL_AT_10_THRESHOLD);
      },
      120_000,
    );

    test(
      'rare-isolated targets survive disproportionately (≥ 90% of rare survive vs 70% of cluster expected)',
      async () => {
        const seed = await seedRareTargetTopology(pool, TEST_AGENT_ID);

        const result = await trigger.fire({ kind: 'agent', agentId: TEST_AGENT_ID }, new Date());
        expect(result).not.toBeNull();

        const evictedSet = new Set(result?.softDeleted ?? []);
        const rareEvicted = seed.rareTargetIds.filter((id) => evictedSet.has(id)).length;
        const clusterEvicted = seed.clusterMemberIds.filter((id) => evictedSet.has(id)).length;
        const rareSurvivalRate = 1 - rareEvicted / RARE_TARGET_COUNT;
        const clusterSurvivalRate = 1 - clusterEvicted / seed.clusterMemberIds.length;

        // Disproportionate protection: rare survival rate must exceed cluster
        // survival rate by a clear margin. Under random eviction both would be
        // ≈ 0.70; the long-tail multiplier should push rare to ≥ 0.90.
        expect(rareSurvivalRate).toBeGreaterThanOrEqual(0.9);
        expect(rareSurvivalRate).toBeGreaterThan(clusterSurvivalRate);
      },
      120_000,
    );
  });
}
