import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import { createLocalMemory, PgvectorStore, StubEmbedder, StubLLM } from '@usetheo/memory';

/**
 * T0.1 + EC-3: `consolidation_history.kept_memory_id` declares
 * `ON DELETE SET NULL` so GDPR `forget(memId, { hard: true })` (v0.4b
 * `T7.1`) physical DELETE of a memory referenced as the kept-row in an
 * audit entry does NOT cascade-destroy the audit row NOR violate the FK
 * constraint. `rejected_memory_ids` JSONB is value-stored (no FK) and
 * survives hard-delete by construction.
 *
 * RED: pre-migration the `consolidation_history` table does not exist; the
 * test FAILS at the seed-audit-row INSERT with `relation does not exist`.
 * GREEN: migration 0007 applied; the table exists with `ON DELETE SET NULL`
 * on the FK; the 4 assertions all hold.
 *
 */

const PG_URI = process.env['THEOMEM_PG_URI'] ?? '';

describe.skipIf(PG_URI === '')(
  'T0.1 / EC-3: consolidation_history.kept_memory_id ON DELETE SET NULL — GDPR forget hard survival',
  () => {
    let pool: pg.Pool;
    const TEST_USER = 't0-1-ec-3-user';

    async function resetTestRows(): Promise<void> {
      await pool.query(
        `DELETE FROM consolidation_history WHERE policy_name = $1`,
        ['ec-3-test'],
      );
      await pool.query(`DELETE FROM memories WHERE user_id = $1`, [TEST_USER]);
    }

    async function seedMemory(text: string): Promise<string> {
      const embedding = Array.from({ length: 1536 }, () => 0);
      embedding[0] = 1;
      const result = await pool.query<{ id: string }>(
        `INSERT INTO memories (
           text, hash, embedding, payload, user_id, last_accessed_at,
           access_count, llm_importance_score
         ) VALUES ($1, $2, $3::vector, $4, $5, NOW(), 0, 0.5)
         RETURNING id`,
        [
          text,
          `t0-1-ec-3-hash-${Date.now()}-${Math.random()}`,
          `[${embedding.join(',')}]`,
          { text, user_id: TEST_USER },
          TEST_USER,
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
      await resetTestRows();
      await pool.end();
    });

    beforeEach(async () => {
      await resetTestRows();
    });

    it('hard-delete of a memory referenced in consolidation_history.kept_memory_id survives the audit row (FK ON DELETE SET NULL)', async () => {
      // Given: a memory `a` that was the consolidation-keeper of a cluster with
      // a rejected sibling `b` whose id is recorded in the audit row's JSONB
      // array (value-stored, no FK).
      const memory = await createLocalMemory({
        vectorStore: new PgvectorStore(pool),
        embedder: new StubEmbedder(),
        llm: new StubLLM(),
      });
      const idA = await seedMemory('Paulo prefers oat milk in coffee');
      const idB = await seedMemory('Paulo likes milk in coffee');

      await pool.query(
        `INSERT INTO consolidation_history (
           kept_memory_id, rejected_memory_ids, reason, policy_name,
           original_episode_ids
         ) VALUES ($1, $2::jsonb, $3, $4, $5::jsonb)`,
        [
          idA,
          JSON.stringify([idB]),
          'kept "a" — more specific (oat milk)',
          'ec-3-test',
          JSON.stringify([idA, idB]),
        ],
      );

      // When: the consumer requests GDPR-style physical DELETE of memory `a`.
      await memory.forget(idA, { hard: true });

      // Then (a): no FK violation thrown; forget completes successfully.
      // (Reached this line — assertion holds.)

      // Then (b): the audit row STILL exists; kept_memory_id was nullified by
      // ON DELETE SET NULL (NOT cascaded out — audit trail is regulatory).
      const { rows: auditRows } = await pool.query<{
        kept_memory_id: string | null;
        rejected_memory_ids: string[];
        reason: string;
        policy_name: string;
      }>(
        `SELECT kept_memory_id, rejected_memory_ids, reason, policy_name
           FROM consolidation_history WHERE policy_name = $1`,
        ['ec-3-test'],
      );
      expect(auditRows).toHaveLength(1);
      expect(auditRows[0]?.kept_memory_id).toBeNull();

      // Then (c): the row and its `policy_name` stay as the record that a decision was made.
      // The free-text reason restates the erased memory, so a hard forget replaces it.
      expect(auditRows[0]?.reason).toBe('[erased]');
      expect(auditRows[0]?.policy_name).toBe('ec-3-test');

      // Then (d) [SEPA MAJOR add]: `rejected_memory_ids` JSONB unchanged —
      // value-stored array survives by construction (no FK to memories).
      expect(auditRows[0]?.rejected_memory_ids).toEqual([idB]);

      await memory.dispose();
    });
  },
);
