/**
 * T4.2 RED tests for v0.4b long-tail multiplier integration per blueprint D9.
 *
 * Multiplier formula (D9):
 *   protection_multiplier = clamp(0.1, 1.0, isolation_distance / mean_isolation_distance)
 *
 * The multiplier is applied MULTIPLICATIVELY on top of T2.1's additive base
 * score. T2.1's selectVictims sorts ascending (lowest score = victim), so
 * isolated memories (high isolation_distance → multiplier ≈ 1.0 → score
 * unchanged) SURVIVE while clustered memories (low isolation_distance →
 * multiplier ≈ 0.1 → score reduced ≈ 10×) are penalized into the victim band.
 *
 * Plan T4.2 § Deep Dives line 712 reads "LOWER multiplier = STRONGER
 * protection (lower eviction-score = stays longer)" which assumes an
 * eviction-score convention (LOW = stays). T2.1 ships a value-score
 * convention (HIGH = stays). The FORMULA produces the correct long-tail
 * protection behavior in EITHER convention: clustered memories get
 * penalized into eviction; isolated memories survive. Plan-prose framing
 * inversion documented in commit body, mirroring T2.1's recency-formula
 * absorption pattern.
 *
 * Plan T4.2 § Files to edit declares
 * src/local/eviction/__tests__/multiplier-integration.test.ts (CONTRACT-tier).
 * Test #1 exercises real pgvector via PgNearestNeighborProvider → must be
 * INTEGRATION-tier. Placed at tests/integration/eviction/. Tests #2 and #3
 * use a stub NearestNeighborProvider and could live anywhere; co-located
 * here for cohesion. Documented in commit body.
 *
 * @see .claude/knowledge-base/plans/v0-4b-forgetting-pipeline-plan.md § T4.2 (D9)
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import pg from 'pg';

import { MAX_EMBEDDING_DIM } from '../../../src/core/constants.js';
import type { NearestNeighborProvider } from '../../../src/local/eviction/triadic-scoring-policy.js';
import { PgNearestNeighborProvider } from '../../../src/local/eviction/pg-nearest-neighbor-provider.js';
import { TriadicScoringPolicy } from '../../../src/local/eviction/triadic-scoring-policy.js';
import type { MemoryItem } from '../../../src/core/memory-item.js';

const PG_URI = process.env['THEOMEM_PG_URI'];

const NOW = new Date('2026-05-30T12:00:00Z');

function buildMemory(id: string, agentId: string, overrides: Partial<MemoryItem> = {}): MemoryItem {
  return {
    id,
    text: 'test fact',
    hash: `h-${id}`,
    scope: { kind: 'agent' as const, agentId },
    createdAt: new Date('2026-05-01T00:00:00Z'),
    updatedAt: new Date('2026-05-01T00:00:00Z'),
    metadata: {},
    tValid: new Date('2026-05-01T00:00:00Z'),
    tInvalid: null,
    llmImportanceScore: 0.5,
    lastAccessedAt: new Date(NOW.getTime() - 60_000),
    accessCount: 1,
    halfLifeSeconds: 30 * 86400,
    ...overrides,
  };
}

class SpyNeighborProvider implements NearestNeighborProvider {
  callCount = 0;
  callsById = new Map<string, number>();

  constructor(private readonly distances: ReadonlyMap<string, number>) {}

  async distance(memoryId: string, _agentId: string): Promise<number> {
    await Promise.resolve();
    this.callCount += 1;
    this.callsById.set(memoryId, (this.callsById.get(memoryId) ?? 0) + 1);
    return this.distances.get(memoryId) ?? 1;
  }
}

describe('T4.2 long-tail multiplier formula clamp + counting (D9; stub provider)', () => {
  test('multiplier clamped to [0.1, 1.0] for extreme isolation ratios', async () => {
    const agentId = 'test-multiplier-clamp';
    const distances = new Map<string, number>([
      ['mem-isolated', 1.0],
      ['mem-tightly-clustered', 0.001],
    ]);
    const spy = new SpyNeighborProvider(distances);
    const policy = new TriadicScoringPolicy(undefined, undefined, null, spy);

    const candidates = [
      buildMemory('mem-isolated', agentId),
      buildMemory('mem-tightly-clustered', agentId),
    ];
    const victims = await policy.selectVictims(candidates, 0.5, {
      meanIsolationDistance: 0,
      now: NOW,
    });

    // tightly-clustered (isolation = 0.001 vs mean = 0.5005) → ratio 0.002 → clamp 0.1
    // isolated (isolation = 1.0 vs mean = 0.5005) → ratio ≈ 2 → clamp 1.0
    // So tightly-clustered has score × 0.1 (penalized), isolated has score × 1.0.
    // Bottom 50% (1 of 2) by score = tightly-clustered.
    expect(victims).toEqual(['mem-tightly-clustered']);
  });

  test('mean_isolation_distance computed ONCE per selectVictims pass (N queries, not N²)', async () => {
    const agentId = 'test-mean-once';
    const distances = new Map<string, number>([
      ['mem-1', 0.5],
      ['mem-2', 0.4],
      ['mem-3', 0.6],
      ['mem-4', 0.3],
      ['mem-5', 0.7],
    ]);
    const spy = new SpyNeighborProvider(distances);
    const policy = new TriadicScoringPolicy(undefined, undefined, null, spy);

    const candidates = Array.from(distances.keys()).map((id) => buildMemory(id, agentId));
    await policy.selectVictims(candidates, 0.2, { meanIsolationDistance: 0, now: NOW });

    // Each candidate's distance is queried exactly once during the pass
    // (selectVictims pre-populates the cache; score() reads from the cache).
    expect(spy.callCount).toBe(candidates.length);
    for (const id of distances.keys()) {
      expect(spy.callsById.get(id)).toBe(1);
    }
  });
});

if (PG_URI === undefined || PG_URI === '') {
  describe.skip('T4.2 isolated-survives test (THEOMEM_PG_URI not set)', () => {
    test('placeholder', () => {
      // no-op
    });
  });
} else {
  describe('T4.2 isolated memory survives at tied base score (D9; real pgvector)', () => {
    let pool: pg.Pool;
    let policy: TriadicScoringPolicy;

    const TEST_AGENT_ID = 'goal-test-agent-v0-4b-t4-2';

    function makeEmbedding(oneHotIndex: number, value = 1): readonly number[] {
      const v = Array.from({ length: MAX_EMBEDDING_DIM }, () => 0);
      v[oneHotIndex] = value;
      return v;
    }

    async function seedMemoryWithEmbedding(
      embedding: readonly number[],
    ): Promise<string> {
      const result = await pool.query<{ id: string }>(
        `INSERT INTO memories (
            text, hash, embedding, payload, agent_id,
            llm_importance_score, half_life_seconds, last_accessed_at, access_count
         ) VALUES ($1, $2, $3::vector, $4, $5, $6, $7, $8, $9)
         RETURNING id`,
        [
          'tied seed',
          `h-t4-2-${Math.random().toString(36).slice(2)}`,
          `[${embedding.join(',')}]`,
          {},
          TEST_AGENT_ID,
          0.5,
          30 * 86400,
          new Date(NOW.getTime() - 60_000),
          1,
        ],
      );
      const id = result.rows[0]?.id;
      if (id === undefined) {
        throw new Error('Seed insert returned no row');
      }
      return id;
    }

    beforeAll(async () => {
      pool = new pg.Pool({ connectionString: PG_URI });
      const provider = new PgNearestNeighborProvider(pool);
      policy = new TriadicScoringPolicy(undefined, undefined, null, provider);
    });

    afterAll(async () => {
      await pool.end();
    });

    beforeEach(async () => {
      await pool.query(`DELETE FROM memories WHERE agent_id = $1`, [TEST_AGENT_ID]);
    });

    test('isolated memory survives when score tied with clustered sibling (D9)', async () => {
      // Seed: 1 isolated (orthogonal vector) + 1 clustered (close to siblings)
      //       + 4 sibling rows for the clustered memory.
      // Candidates = [isolated, clustered] (siblings NOT in candidates but
      // present in DB → they pull clustered's nearest-neighbor distance down).
      const isolatedId = await seedMemoryWithEmbedding(makeEmbedding(1000));
      const clusteredId = await seedMemoryWithEmbedding(makeEmbedding(0, 1.0));
      await seedMemoryWithEmbedding(makeEmbedding(0, 0.99));
      await seedMemoryWithEmbedding(makeEmbedding(0, 0.98));
      await seedMemoryWithEmbedding(makeEmbedding(0, 0.97));
      await seedMemoryWithEmbedding(makeEmbedding(0, 0.96));

      const candidates = [
        buildMemory(isolatedId, TEST_AGENT_ID),
        buildMemory(clusteredId, TEST_AGENT_ID),
      ];

      const victims = await policy.selectVictims(candidates, 0.5, {
        meanIsolationDistance: 0,
        now: NOW,
      });

      expect(victims).toContain(clusteredId);
      expect(victims).not.toContain(isolatedId);
    });
  });
}
