/**
 * T6.1 RED integration tests for v0.4b `evict()` orchestrator + EvictionResult contract.
 *
 * Asserts that `TriadicScoringPolicy.evict(ids)` (delegated to `PgEvictor`):
 *   - Soft-deletes rows via `UPDATE memories SET t_invalid = NOW()` per ADR D17
 *   - Distinguishes `softDeleted` (RETURNING set) from `alreadyInvalid` (input - RETURNING)
 *   - Never physical DELETE
 *   - `recall()` filters out soft-deleted rows post-eviction
 *   - Audit query `WHERE t_invalid IS NOT NULL` returns soft-deleted rows
 *   - Empty input array short-circuits (EC-10)
 *   - Emits OTel counter via the test-hook channel (EC-4)
 *
 * Plan path deviation: integration test at tests/integration/eviction/ per
 * established T2.2/T3.1/T4.x/T5.x pattern.
 *
 * @see .claude/knowledge-base/plans/v0-4b-forgetting-pipeline-plan.md § T6.1 (D17 + EC-4 + EC-10)
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import pg from 'pg';

import { MAX_EMBEDDING_DIM } from '../../../src/core/constants.js';
import { PgEvictor } from '../../../src/local/eviction/pg-evictor.js';
import { PgvectorStore } from '../../../src/local/pgvector-store.js';
import { TriadicScoringPolicy } from '../../../src/local/eviction/triadic-scoring-policy.js';

const PG_URI = process.env['THEOMEM_PG_URI'];

if (PG_URI === undefined || PG_URI === '') {
  describe.skip('T6.1 evict soft-delete (THEOMEM_PG_URI not set)', () => {
    test('placeholder', () => {
      // no-op
    });
  });
} else {
  describe('T6.1 evict() soft-delete + EvictionResult contract (D17 + EC-4 + EC-10)', () => {
    let pool: pg.Pool;
    let store: PgvectorStore;
    let policy: TriadicScoringPolicy;
    let evictor: PgEvictor;

    const TEST_AGENT_ID = 'goal-test-agent-v0-4b-t6-1';
    const TEST_EMBEDDING = Array.from({ length: MAX_EMBEDDING_DIM }, () => 0.1);

    async function seedMemory(suffix: string, tInvalid: Date | null = null): Promise<string> {
      const result = await pool.query<{ id: string }>(
        `INSERT INTO memories (text, hash, embedding, payload, agent_id, t_invalid)
         VALUES ($1, $2, $3::vector, $4, $5, $6)
         RETURNING id`,
        [
          `seed ${suffix}`,
          `h-t6-1-${suffix}-${Math.random().toString(36).slice(2)}`,
          `[${TEST_EMBEDDING.join(',')}]`,
          {},
          TEST_AGENT_ID,
          tInvalid,
        ],
      );
      const id = result.rows[0]?.id;
      if (id === undefined) throw new Error('Seed insert returned no row');
      return id;
    }

    beforeAll(async () => {
      pool = new pg.Pool({ connectionString: PG_URI });
      store = new PgvectorStore(pool);
      evictor = new PgEvictor(pool);
      policy = new TriadicScoringPolicy(undefined, undefined, null, null, evictor);
    });

    afterAll(async () => {
      await pool.end();
    });

    beforeEach(async () => {
      await pool.query(`DELETE FROM memories WHERE agent_id = $1`, [TEST_AGENT_ID]);
    });

    test('evict soft-deletes via t_invalid (D17)', async () => {
      const idA = await seedMemory('A');
      const idB = await seedMemory('B');

      const result = await policy.evict([idA, idB]);

      expect(result.softDeleted).toHaveLength(2);
      expect(new Set(result.softDeleted)).toEqual(new Set([idA, idB]));
      expect(result.errors).toEqual([]);

      // Verify t_invalid IS NOT NULL post-evict
      const rows = await pool.query<{ t_invalid: Date | null }>(
        `SELECT t_invalid FROM memories WHERE id = ANY($1::uuid[])`,
        [[idA, idB]],
      );
      expect(rows.rows.every((r) => r.t_invalid !== null)).toBe(true);
    });

    test('distinguishes already_invalid from soft_deleted via RETURNING', async () => {
      const idActive = await seedMemory('active');
      const idAlreadyInvalid = await seedMemory(
        'preinvalid',
        new Date('2026-01-01T00:00:00Z'),
      );

      const result = await policy.evict([idActive, idAlreadyInvalid]);

      expect(result.softDeleted).toEqual([idActive]);
      expect(result.alreadyInvalid).toEqual([idAlreadyInvalid]);
    });

    test('never physical-deletes (rows still exist post-evict)', async () => {
      const idA = await seedMemory('persist-check');

      await policy.evict([idA]);

      const countResult = await pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM memories WHERE id = $1`,
        [idA],
      );
      expect(Number(countResult.rows[0]?.count ?? '0')).toBe(1);
    });

    test('recall filters out soft-deleted rows', async () => {
      const idEvicted = await seedMemory('evicted');
      const idActive = await seedMemory('active');

      await policy.evict([idEvicted]);

      const results = await store.search(TEST_EMBEDDING, 10, { agent_id: TEST_AGENT_ID });
      const returnedIds = results.map((r) => r.id);
      expect(returnedIds).toContain(idActive);
      expect(returnedIds).not.toContain(idEvicted);
    });

    test('audit query WHERE t_invalid IS NOT NULL returns soft-deleted rows', async () => {
      const idEvicted = await seedMemory('audit-target');

      await policy.evict([idEvicted]);

      const audit = await pool.query<{ id: string }>(
        `SELECT id FROM memories WHERE agent_id = $1 AND t_invalid IS NOT NULL`,
        [TEST_AGENT_ID],
      );
      expect(audit.rows.map((r) => r.id)).toContain(idEvicted);
    });

    test('EC-10: evict with empty array is a no-op (no SQL roundtrip)', async () => {
      const result = await policy.evict([]);
      expect(result.softDeleted).toEqual([]);
      expect(result.alreadyInvalid).toEqual([]);
      expect(result.errors).toEqual([]);
    });

    test('EC-4: evict emits OTel counter via test hook', async () => {
      const idA = await seedMemory('counter-a');
      const idB = await seedMemory('counter-b');

      const counterEmissions: { count: number; attrs: Record<string, string> }[] = [];
      const observedEvictor = new PgEvictor(pool, {
        onSoftDelete: (count, attrs) => {
          counterEmissions.push({ count, attrs });
        },
      });
      const observedPolicy = new TriadicScoringPolicy(
        undefined,
        undefined,
        null,
        null,
        observedEvictor,
      );

      await observedPolicy.evict([idA, idB]);

      expect(counterEmissions).toHaveLength(1);
      expect(counterEmissions[0]?.count).toBe(2);
      expect(counterEmissions[0]?.attrs).toMatchObject({ policy: 'triadic_scoring' });
    });
  });
}
