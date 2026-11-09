/**
 * Access bookkeeping (v0.4b LRU/LFU signal) on PgvectorStore.
 *
 * An access is a memory the caller received from recall(). The store exposes
 * recordAccess(ids); search() itself no longer counts, because every internal
 * search (the recall over-fetch, the write path's dedup lookup) would otherwise
 * mark rows as used that nobody saw. recordAccess locks rows in id order, so
 * concurrent recalls over overlapping rows cannot deadlock and lose increments.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import pg from 'pg';

import { createLocalMemory, MAX_EMBEDDING_DIM, PgvectorStore } from '@usetheo/memory';

const PG_URI = process.env['THEOMEM_PG_URI'];

if (PG_URI === undefined || PG_URI === '') {
  describe.skip('T3.1 recall write-back hook (THEOMEM_PG_URI not set)', () => {
    test('placeholder', () => {
      // no-op
    });
  });
} else {
  describe('access bookkeeping (LRU/LFU signal)', () => {
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

      await store.recordAccess((await store.search(TEST_EMBEDDING, 3, { agent_id: TEST_AGENT_ID })).map((r) => r.id));

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
      await store.recordAccess((await store.search(TEST_EMBEDDING, 1, { agent_id: TEST_AGENT_ID })).map((r) => r.id));
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
      await store.recordAccess((await store.search(TEST_EMBEDDING, 5, { agent_id: 'different-agent-no-hits' })).map((r) => r.id));

      const after = await getRow(id);
      expect(after?.access_count).toBe(0);
      expect(after?.last_accessed_at).toBeNull();
    });

    test('a search on its own does not count as an access', async () => {
      const id = await seedMemory('searched-only');
      await store.search(TEST_EMBEDDING, 5, { agent_id: TEST_AGENT_ID });
      expect((await getRow(id))?.access_count).toBe(0);
    });

    test('recall counts only the memories it returns, not the candidates it over-fetched', async () => {
      const ids = await Promise.all(['r1', 'r2', 'r3', 'r4'].map((s) => seedMemory(s)));
      const memory = await createLocalMemory({
        vectorStore: store,
        embedder: { embed: async () => TEST_EMBEDDING, embedBatch: async (t) => t.map(() => TEST_EMBEDDING) },
        embeddingDim: MAX_EMBEDDING_DIM,
      });
      const returned = await memory.agent(TEST_AGENT_ID).recall('test fact', { topK: 1, threshold: 0 });
      expect(returned).toHaveLength(1);
      const counts = await Promise.all(ids.map(async (id) => (await getRow(id))?.access_count));
      expect(counts.filter((c) => c === 1)).toHaveLength(1);
      expect(counts.filter((c) => c === 0)).toHaveLength(3);
      expect((await getRow(returned[0]!.id))?.access_count).toBe(1);
    });

    test('concurrent access records over overlapping rows neither deadlock nor lose increments', async () => {
      // 120 rows per call: the recall over-fetch size at topK 30, where the deadlock was observed.
      const ids = await Promise.all(Array.from({ length: 120 }, (_, i) => seedMemory(`c${String(i)}`)));
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const rounds = 32;
      // Each call names the same rows in a different order, the shape that deadlocked.
      await Promise.all(Array.from({ length: rounds }, (_, i) => {
        const order = [...ids];
        for (let k = order.length - 1; k > 0; k -= 1) {
          const j = (i * 7 + k * 3) % (k + 1);
          [order[k], order[j]] = [order[j]!, order[k]!];
        }
        return store.recordAccess(order);
      }));
      expect(warn).not.toHaveBeenCalled();
      warn.mockRestore();
      for (const id of ids) expect((await getRow(id))?.access_count).toBe(rounds);
    });

    test('consecutive recalls each increment access_count by exactly one', async () => {
      const id = await seedMemory('iterated');

      await store.recordAccess((await store.search(TEST_EMBEDDING, 1, { agent_id: TEST_AGENT_ID })).map((r) => r.id));
      const after1 = await getRow(id);
      expect(after1?.access_count).toBe(1);

      await store.recordAccess((await store.search(TEST_EMBEDDING, 1, { agent_id: TEST_AGENT_ID })).map((r) => r.id));
      const after2 = await getRow(id);
      expect(after2?.access_count).toBe(2);

      await store.recordAccess((await store.search(TEST_EMBEDDING, 1, { agent_id: TEST_AGENT_ID })).map((r) => r.id));
      const after3 = await getRow(id);
      expect(after3?.access_count).toBe(3);
    });
  });
}
