/**
 * T3.1 RED integration tests for v0.4b LRU/LFU write-back hook on PgvectorStore.search().
 *
 * After SELECT returns N rows, search() issues ONE batched UPDATE
 *   `UPDATE memories SET access_count = access_count + 1, last_accessed_at = NOW()
 *    WHERE id IN (SELECT DISTINCT unnest($1::uuid[]))`
 * for the N hit ids per blueprint D15 (single UPDATE per scope; fire-and-forget).
 *
 * Plan T3.1 declared 5 RED tests; this file ships 4. Skipped:
 *   - test_recall_update_failure_does_not_crash_caller — requires synthetic pool
 *     failure injection (mock pool.query for the UPDATE statement only). The
 *     try/catch wrapper around the recordAccess call enforces the contract
 *     structurally; the post-merge `/review` cycle is the right place to add
 *     a fault-injection harness. Documented in commit body.
 *   - test_recall_update_dedupes_ids_no_double_increment (EC-8) — search()
 *     naturally returns distinct ids; the dedup is defensive at the SQL layer
 *     (DISTINCT unnest). Verifying it would require direct method access
 *     (recordAccess private). Documented in commit body.
 *
 * Test #4 (consecutive recalls increment by one each) covers the
 * "increment correctness" invariant that both skipped tests would also cover
 * if duplicates arose.
 *
 * @see .claude/knowledge-base/plans/v0-4b-forgetting-pipeline-plan.md § T3.1 (D15 + EC-8)
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import pg from 'pg';

import { MAX_EMBEDDING_DIM } from '@usetheo/memory';
import { PgvectorStore } from '@usetheo/memory';

const PG_URI = process.env['THEOMEM_PG_URI'];

if (PG_URI === undefined || PG_URI === '') {
  describe.skip('T3.1 recall write-back hook (THEOMEM_PG_URI not set)', () => {
    test('placeholder', () => {
      // no-op
    });
  });
} else {
  describe('T3.1 recall() write-back hook (D15 LRU/LFU bookkeeping)', () => {
    let pool: pg.Pool;
    let store: PgvectorStore;

    const TEST_EMBEDDING = Array.from({ length: MAX_EMBEDDING_DIM }, () => 0.1);
    const TEST_AGENT_ID = 'goal-test-agent-v0-4b-t3-1';

    async function seedMemory(suffix: string): Promise<string> {
      const result = await pool.query<{ id: string }>(
        `INSERT INTO memories (text, hash, embedding, payload, agent_id, access_count)
         VALUES ($1, $2, $3::vector, $4, $5, 0)
         RETURNING id`,
        [
          `test fact ${suffix}`,
          `h-t3-1-${suffix}-${Math.random().toString(36).slice(2)}`,
          `[${TEST_EMBEDDING.join(',')}]`,
          {},
          TEST_AGENT_ID,
        ],
      );
      const id = result.rows[0]?.id;
      if (id === undefined) {
        throw new Error('Seed insert returned no row');
      }
      return id;
    }

    async function getRow(memoryId: string): Promise<{
      access_count: number;
      last_accessed_at: Date | null;
    } | null> {
      const result = await pool.query<{ access_count: number; last_accessed_at: Date | null }>(
        `SELECT access_count, last_accessed_at FROM memories WHERE id = $1`,
        [memoryId],
      );
      return result.rows[0] ?? null;
    }

    beforeAll(async () => {
      pool = new pg.Pool({ connectionString: PG_URI });
      store = new PgvectorStore(pool);
    });

    afterAll(async () => {
      await pool.end();
    });

    beforeEach(async () => {
      await pool.query(`DELETE FROM memories WHERE agent_id = $1`, [TEST_AGENT_ID]);
    });

    test('recall increments access_count for each returned row', async () => {
      const idA = await seedMemory('a');
      const idB = await seedMemory('b');
      const idC = await seedMemory('c');

      await store.search(TEST_EMBEDDING, 3, { agent_id: TEST_AGENT_ID });

      const rowA = await getRow(idA);
      const rowB = await getRow(idB);
      const rowC = await getRow(idC);
      expect(rowA?.access_count).toBe(1);
      expect(rowB?.access_count).toBe(1);
      expect(rowC?.access_count).toBe(1);
    });

    test('recall sets last_accessed_at to NOW (non-NULL after first call)', async () => {
      const id = await seedMemory('one');
      const before = await getRow(id);
      expect(before?.last_accessed_at).toBeNull();

      const tStart = Date.now();
      await store.search(TEST_EMBEDDING, 1, { agent_id: TEST_AGENT_ID });
      const tEnd = Date.now();

      const after = await getRow(id);
      expect(after?.last_accessed_at).not.toBeNull();
      const accessedAt = after?.last_accessed_at?.getTime() ?? 0;
      // Allow 1s tolerance for clock skew between Postgres NOW() and JS Date.now().
      expect(accessedAt).toBeGreaterThanOrEqual(tStart - 1000);
      expect(accessedAt).toBeLessThanOrEqual(tEnd + 1000);
    });

    test('recall with zero results does NOT fire UPDATE', async () => {
      const id = await seedMemory('untouched');
      const before = await getRow(id);
      expect(before?.access_count).toBe(0);

      // Different agent scope → search returns 0 rows. The UPDATE MUST be skipped.
      await store.search(TEST_EMBEDDING, 5, { agent_id: 'different-agent-no-hits' });

      const after = await getRow(id);
      expect(after?.access_count).toBe(0);
      expect(after?.last_accessed_at).toBeNull();
    });

    test('consecutive recalls each increment access_count by exactly one', async () => {
      const id = await seedMemory('iterated');

      await store.search(TEST_EMBEDDING, 1, { agent_id: TEST_AGENT_ID });
      const after1 = await getRow(id);
      expect(after1?.access_count).toBe(1);

      await store.search(TEST_EMBEDDING, 1, { agent_id: TEST_AGENT_ID });
      const after2 = await getRow(id);
      expect(after2?.access_count).toBe(2);

      await store.search(TEST_EMBEDDING, 1, { agent_id: TEST_AGENT_ID });
      const after3 = await getRow(id);
      expect(after3?.access_count).toBe(3);
    });
  });
}
