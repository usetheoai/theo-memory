/**
 * T4.1 RED integration tests for v0.4b nearest-neighbor cosine-distance lookup.
 *
 * Asserts `TriadicScoringPolicy.nearestNeighborDistance(memoryId, agentId)`
 * (delegated to `PgNearestNeighborProvider`) returns the cosine-distance to
 * the closest non-self non-invalidated memory in the same scope, using the
 * pgvector `<=>` operator per blueprint D16 + plan T4.1.
 *
 * Plan T4.1 § Files to edit declares the test at
 * src/local/eviction/__tests__/nearest-neighbor.test.ts (CONTRACT-tier per
 * vitest.contract.config.ts include glob). Real-pgvector integration belongs
 * at tests/integration/** per the established pattern (T2.2 + T3.1). Placed
 * here; documented in commit body.
 *
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import pg from 'pg';

import { MAX_EMBEDDING_DIM } from '@usetheo/memory';
import { PgNearestNeighborProvider } from '@usetheo/memory';
import { TriadicScoringPolicy } from '@usetheo/memory';

const PG_URI = process.env['THEOMEM_PG_URI'];

if (PG_URI === undefined || PG_URI === '') {
  describe.skip('T4.1 nearest-neighbor cosine-distance (THEOMEM_PG_URI not set)', () => {
    test('placeholder', () => {
      // no-op
    });
  });
} else {
  describe('T4.1 nearest-neighbor distance via pgvector <=> (D16)', () => {
    let pool: pg.Pool;
    let policy: TriadicScoringPolicy;

    const TEST_AGENT_ID = 'goal-test-agent-v0-4b-t4-1';

    function makeEmbedding(oneHotIndex: number, value = 1): readonly number[] {
      const v = Array.from({ length: MAX_EMBEDDING_DIM }, () => 0);
      v[oneHotIndex] = value;
      return v;
    }

    async function seedMemory(
      embedding: readonly number[],
      tInvalid: Date | null = null,
    ): Promise<string> {
      const result = await pool.query<{ id: string }>(
        `INSERT INTO memories (text, hash, embedding, payload, agent_id, t_invalid)
         VALUES ($1, $2, $3::vector, $4, $5, $6)
         RETURNING id`,
        [
          'nn seed',
          `h-t4-1-${Math.random().toString(36).slice(2)}`,
          `[${embedding.join(',')}]`,
          {},
          TEST_AGENT_ID,
          tInvalid,
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
      policy = new TriadicScoringPolicy({ neighborProvider: provider });
    });

    afterAll(async () => {
      await pool.end();
    });

    beforeEach(async () => {
      await pool.query(`DELETE FROM memories WHERE agent_id = $1`, [TEST_AGENT_ID]);
    });

    test('returns geometrically-closest neighbor distance', async () => {
      // mem A at one-hot index 0; mem B close to A (one-hot at 0 too, very similar);
      // mem C orthogonal to A (one-hot at distant index).
      const idA = await seedMemory(makeEmbedding(0, 1.0));
      await seedMemory(makeEmbedding(0, 0.95));
      await seedMemory(makeEmbedding(1000, 1.0));

      const distance = await policy.nearestNeighborDistance(idA, { kind: 'agent', agentId: TEST_AGENT_ID });
      // A's nearest is the second one (cosine similarity 1.0 → cosine distance 0)
      expect(distance).toBeLessThan(0.01);
    });

    test('returns 1.0 for singleton scope (no other memories)', async () => {
      const id = await seedMemory(makeEmbedding(0));
      const distance = await policy.nearestNeighborDistance(id, { kind: 'agent', agentId: TEST_AGENT_ID });
      expect(distance).toBe(1);
    });

    test('excludes self from neighbor search', async () => {
      // Only one memory — if self were included, the "nearest neighbor" would be
      // self with distance 0. Verify it returns the singleton fallback (1.0).
      const id = await seedMemory(makeEmbedding(42));
      const distance = await policy.nearestNeighborDistance(id, { kind: 'agent', agentId: TEST_AGENT_ID });
      expect(distance).toBe(1);
    });

    test('excludes invalidated rows from neighbor search', async () => {
      const idA = await seedMemory(makeEmbedding(0, 1.0));
      // Soft-deleted row very close to A — MUST be excluded from NN.
      await seedMemory(makeEmbedding(0, 0.95), new Date('2026-01-01T00:00:00Z'));
      // Active row far from A.
      await seedMemory(makeEmbedding(1000, 1.0));

      const distance = await policy.nearestNeighborDistance(idA, { kind: 'agent', agentId: TEST_AGENT_ID });
      // Only the orthogonal active row counts → distance ≈ 1.0
      expect(distance).toBeGreaterThan(0.5);
    });

    test('nearest names the closest live neighbour and its distance', async () => {
      const idA = await seedMemory(makeEmbedding(0, 1.0));
      const idB = await seedMemory(makeEmbedding(0, 0.95));
      await seedMemory(makeEmbedding(1000, 1.0));
      const provider = new PgNearestNeighborProvider(pool);
      const neighbour = await provider.nearest(idA, { kind: 'agent', agentId: TEST_AGENT_ID });
      expect(neighbour?.id).toBe(idB);
      expect(neighbour?.distance).toBeLessThan(0.01);
    });

    test('nearest returns null when the scope holds no other live memory', async () => {
      const id = await seedMemory(makeEmbedding(7));
      await seedMemory(makeEmbedding(7, 0.9), new Date('2026-01-01T00:00:00Z'));
      const provider = new PgNearestNeighborProvider(pool);
      expect(await provider.nearest(id, { kind: 'agent', agentId: TEST_AGENT_ID })).toBeNull();
    });

    test('a pass never evicts every copy of a repeated fact (#240)', async () => {
      // Three copies of one fact and three unrelated memories; half of the scope goes.
      const copies = [
        await seedMemory(makeEmbedding(0, 1.0)),
        await seedMemory(makeEmbedding(0, 0.9)),
        await seedMemory(makeEmbedding(0, 0.8)),
      ];
      for (const index of [300, 600, 900]) await seedMemory(makeEmbedding(index, 1.0));
      const rows = await pool.query<{ id: string }>('SELECT id FROM memories WHERE agent_id = $1', [TEST_AGENT_ID]);
      const at = new Date('2026-01-01T00:00:00Z');
      const scope = { kind: 'agent' as const, agentId: TEST_AGENT_ID };
      const candidates = rows.rows.map((r) => ({
        id: r.id, text: 'nn seed', hash: r.id, scope, createdAt: at, updatedAt: at, metadata: {}, tValid: at, tInvalid: null,
      }));
      const victims = await policy.selectVictims(candidates, 0.5, { meanIsolationDistance: 0, now: at });
      expect(victims).toHaveLength(3);
      expect(copies.filter((id) => !victims.includes(id)).length).toBeGreaterThanOrEqual(1);
    });
  });
}
