/**
 * T5.1 RED integration tests for v0.4b `CapacityBasedTrigger`.
 *
 * Asserts the capacity-based eviction trigger fires on overflow per blueprint
 * D10, picks lowest-scored memories via TriadicScoringPolicy + soft-deletes
 * via `t_invalid = NOW()` per ADR D17. EC-2 absorption: concurrent fires on
 * the same scope are serialized by `pg_try_advisory_xact_lock(hashtext($1))`
 * preventing double-evict.
 *
 * Plan T5.1 § Files to edit declares
 * src/local/eviction/__tests__/capacity-trigger.test.ts (CONTRACT-tier).
 * Real-pgvector integration belongs at tests/integration/eviction/ per the
 * established T2.2/T3.1/T4.1/T4.2 pattern. Documented in commit body.
 *
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import pg from 'pg';

import { MAX_EMBEDDING_DIM } from '@usetheo/memory';
import {
  CapacityBasedTrigger,
  computeOverflowFraction,
} from '@usetheo/memory';
import { PgNearestNeighborProvider } from '@usetheo/memory';
import { TriadicScoringPolicy } from '@usetheo/memory';

const PG_URI = process.env['THEOMEM_PG_URI'];

describe('computeOverflowFraction helper (T5.1 REFACTOR step)', () => {
  test('returns 0 when current size <= cap', () => {
    expect(computeOverflowFraction(10, 50)).toBe(0);
    expect(computeOverflowFraction(50, 50)).toBe(0);
  });

  test('computes (current - cap) / current for moderate overflow', () => {
    // 60 over 50 → overflow = 10/60 ≈ 0.167
    expect(computeOverflowFraction(60, 50)).toBeCloseTo(10 / 60, 5);
  });

  test('caps eviction fraction at 0.5 (never evict more than half)', () => {
    // 200 over 50 → raw overflow = 150/200 = 0.75 → clamp to 0.5
    expect(computeOverflowFraction(200, 50)).toBe(0.5);
    // 1000 over 50 → raw overflow ≈ 0.95 → clamp to 0.5
    expect(computeOverflowFraction(1000, 50)).toBe(0.5);
  });
});

if (PG_URI === undefined || PG_URI === '') {
  describe.skip('T5.1 CapacityBasedTrigger (THEOMEM_PG_URI not set)', () => {
    test('placeholder', () => {
      // no-op
    });
  });
} else {
  describe('T5.1 CapacityBasedTrigger (D10 + EC-2; real pgvector)', () => {
    let pool: pg.Pool;
    let trigger: CapacityBasedTrigger;

    const TEST_AGENT_ID = 'goal-test-agent-v0-4b-t5-1';
    const CAP = 50;
    const TEST_EMBEDDING = Array.from({ length: MAX_EMBEDDING_DIM }, () => 0.1);

    async function seedMemories(count: number, agentId: string = TEST_AGENT_ID): Promise<readonly string[]> {
      const ids: string[] = [];
      for (let i = 0; i < count; i++) {
        const result = await pool.query<{ id: string }>(
          `INSERT INTO memories (
              text, hash, embedding, payload, agent_id,
              llm_importance_score, last_accessed_at, access_count
           ) VALUES ($1, $2, $3::vector, $4, $5, $6, $7, $8)
           RETURNING id`,
          [
            `seed ${i}`,
            `h-t5-1-${agentId}-${i}-${Math.random().toString(36).slice(2)}`,
            `[${TEST_EMBEDDING.join(',')}]`,
            {},
            agentId,
            // Spread importance so scoring picks the lowest-importance ones first.
            i / count,
            new Date(Date.now() - i * 1000),
            i,
          ],
        );
        const id = result.rows[0]?.id;
        if (id !== undefined) ids.push(id);
      }
      return ids;
    }

    async function countActive(agentId: string = TEST_AGENT_ID): Promise<number> {
      const result = await pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM memories WHERE agent_id = $1 AND t_invalid IS NULL`,
        [agentId],
      );
      return Number(result.rows[0]?.count ?? '0');
    }

    beforeAll(async () => {
      pool = new pg.Pool({ connectionString: PG_URI });
      const neighborProvider = new PgNearestNeighborProvider(pool);
      const policy = new TriadicScoringPolicy({ neighborProvider });
      trigger = new CapacityBasedTrigger(pool, policy, CAP);
    });

    afterAll(async () => {
      await pool.end();
    });

    beforeEach(async () => {
      await pool.query(`DELETE FROM memories WHERE agent_id LIKE $1`, [`${TEST_AGENT_ID}%`]);
    });

    test('fires on overflow and soft-deletes via t_invalid (D10 + D17)', async () => {
      await seedMemories(CAP + 1);
      const before = await countActive();
      expect(before).toBe(CAP + 1);

      const result = await trigger.fire({ kind: 'agent', agentId: TEST_AGENT_ID }, new Date());

      expect(result?.softDeleted.length ?? 0).toBeGreaterThanOrEqual(1);
      const after = await countActive();
      expect(after).toBeLessThanOrEqual(CAP);
    });

    test('evicts lowest-scored memories (lowest llm_importance_score first)', async () => {
      const ids = await seedMemories(CAP + 5);
      // The first 5 seeds have importance ∈ {0/55, 1/55, 2/55, 3/55, 4/55} — lowest.
      const expectedFirstEvicted = new Set(ids.slice(0, 5));

      const result = await trigger.fire({ kind: 'agent', agentId: TEST_AGENT_ID }, new Date());

      expect(result?.softDeleted.length).toBeGreaterThanOrEqual(1);
      // At least one of the lowest-importance ids should be in the evicted set.
      const evictedFromLowest = (result?.softDeleted ?? []).filter((id) =>
        expectedFirstEvicted.has(id),
      );
      expect(evictedFromLowest.length).toBeGreaterThan(0);
    });

    test('caps eviction fraction at half — never evicts more than 50% in one pass', async () => {
      await seedMemories(200);
      const before = await countActive();
      expect(before).toBe(200);

      const result = await trigger.fire({ kind: 'agent', agentId: TEST_AGENT_ID }, new Date());

      // Raw overflow = (200-50)/200 = 0.75 → clamp to 0.5 → evict 100 max.
      expect(result?.softDeleted.length ?? 0).toBeLessThanOrEqual(100);
      const after = await countActive();
      expect(after).toBeGreaterThanOrEqual(100);
    });

    test('no-op when below threshold', async () => {
      await seedMemories(10);
      const before = await countActive();
      expect(before).toBe(10);

      const result = await trigger.fire({ kind: 'agent', agentId: TEST_AGENT_ID }, new Date());

      expect(result).toBeNull();
      const after = await countActive();
      expect(after).toBe(10);
    });

    test('EC-2: concurrent fires do not double-evict (advisory lock serializes)', async () => {
      await seedMemories(CAP + 50);
      const before = await countActive();
      expect(before).toBe(CAP + 50);

      // Two concurrent fire() calls share the same scope. The advisory lock
      // ensures at most one runs the COUNT+evict path; the other sees the
      // lock taken and returns null.
      const [r1, r2] = await Promise.all([
        trigger.fire({ kind: 'agent', agentId: TEST_AGENT_ID }, new Date()),
        trigger.fire({ kind: 'agent', agentId: TEST_AGENT_ID }, new Date()),
      ]);
      const evictedTotal = (r1?.softDeleted.length ?? 0) + (r2?.softDeleted.length ?? 0);

      const after = await countActive();
      // Without the lock, both might evict; total evicted could exceed overflow.
      // With the lock, only one evicts. Either way: post-state >= CAP (never
      // below the cap from a single pass).
      expect(after).toBeGreaterThanOrEqual(CAP);
      expect(evictedTotal).toBeLessThanOrEqual(50);
      // At least one of the two should have returned null (lock contention).
      const nullCount = (r1 === null ? 1 : 0) + (r2 === null ? 1 : 0);
      expect(nullCount).toBeGreaterThanOrEqual(1);
    });
  });
}
