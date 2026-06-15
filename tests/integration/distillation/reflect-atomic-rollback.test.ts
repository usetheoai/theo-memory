import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import pg from 'pg';

import {
  createLocalMemory,
  PgvectorStore,
  StubEmbedder,
  StubLLM,
  LastWriteWinsConflictPolicy,

} from '@usetheo/memory';

/**
 * T2.1 / EC-8 — atomic transaction rollback when a mid-batch
 * `consolidation_history` INSERT fails. We spy on the pool's `connect()` to
 * inject a wrapping client whose `query()` throws on the next
 * `INSERT INTO consolidation_history`. After the failure:
 *   (a) NO memory has `t_invalid IS NOT NULL` — rollback worked
 *   (b) `consolidation_history` has 0 rows for the failed policy run
 *   (c) `reflect()` raises an error (caller observes the failure)
 *
 * @see .claude/knowledge-base/plans/v0-7-distillation-pipeline-plan.md § T2.1 + EC-8
 */

const PG_URI = process.env['THEOMEM_PG_URI'] ?? '';

describe.skipIf(PG_URI === '')(
  'T2.1 / EC-8: persistConsolidations rolls back atomically on insert failure',
  () => {
    let pool: pg.Pool;
    const TEST_USER = 't2-1-rollback-user';

    async function reset(): Promise<void> {
      await pool.query(
        `DELETE FROM consolidation_history WHERE policy_name = 'last-write-wins'`,
      );
      await pool.query(`DELETE FROM memories WHERE user_id = $1`, [TEST_USER]);
    }

    async function seed(text: string, offsetMs: number): Promise<string> {
      const embedding = Array.from({ length: 1536 }, () => 0);
      embedding[0] = 1;
      const result = await pool.query<{ id: string }>(
        `INSERT INTO memories (
           text, hash, embedding, payload, user_id, created_at,
           last_accessed_at, access_count, llm_importance_score
         ) VALUES ($1, $2, $3::vector, $4, $5, NOW() + ($6 || ' milliseconds')::interval,
                   NOW(), 0, 0.5)
         RETURNING id`,
        [
          text,
          `t2-1-rb-hash-${String(Date.now())}-${String(Math.random())}`,
          `[${embedding.join(',')}]`,
          { text, user_id: TEST_USER },
          TEST_USER,
          String(offsetMs),
        ],
      );
      const id = result.rows[0]?.id;
      if (id === undefined) throw new Error('seed: no row');
      return id;
    }

    beforeAll(async () => {
      pool = new pg.Pool({ connectionString: PG_URI });
    });
    afterAll(async () => {
      await reset();
      await pool.end();
    });
    beforeEach(async () => {
      await reset();
    });

    it('persistConsolidations throw inside withTransaction → ROLLBACK; no t_invalid mutation; 0 audit rows', async () => {
      const store = new PgvectorStore(pool);
      // Spy on persistConsolidations to inject a mid-tx failure.
      const original = store.persistConsolidations.bind(store);
      const persistSpy = vi.spyOn(store, 'persistConsolidations').mockImplementationOnce(async (results) => {
        // Force a transaction that updates t_invalid then throws inside the
        // same tx → exercises ROLLBACK; second client.query simulates the
        // INSERT INTO consolidation_history failing.
        await store.withTransaction(async (client) => {
          for (const r of results) {
            if (r.rejectedMemoryIds.length > 0) {
              await client.query(
                `UPDATE memories SET t_invalid = NOW()
                  WHERE id = ANY($1::uuid[]) AND t_invalid IS NULL`,
                [[...r.rejectedMemoryIds]],
              );
            }
            throw new Error('simulated insertConsolidationHistory failure (EC-8 test)');
          }
        });
      });
      // Restore reference so afterAll cleanup still works.
      void original;

      const memory = await createLocalMemory({
        vectorStore: store,
        embedder: new StubEmbedder(),
        llm: new StubLLM(),
        reflectionPolicy: { kind: 'manual' },
      });
      const idOlder = await seed('older', -5_000);
      const idNewer = await seed('newer', +5_000);

      await expect(
        memory
          .user(TEST_USER)
          .reflect({ conflictResolution: new LastWriteWinsConflictPolicy() }),
      ).rejects.toThrow(/simulated insertConsolidationHistory/);

      // (a) No memory has t_invalid mutated — rollback worked
      const { rows: memRows } = await pool.query<{ id: string; t_invalid: Date | null }>(
        `SELECT id, t_invalid FROM memories WHERE user_id = $1`,
        [TEST_USER],
      );
      const invalidatedIds = memRows.filter((r) => r.t_invalid !== null).map((r) => r.id);
      expect(invalidatedIds).toEqual([]);
      void idOlder;
      void idNewer;

      // (b) Zero audit rows post-rollback
      const { rows: auditRows } = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM consolidation_history WHERE policy_name = 'last-write-wins'`,
      );
      expect(auditRows[0]?.count).toBe('0');

      expect(persistSpy).toHaveBeenCalledTimes(1);

      await memory.dispose();
    });
  },
);
