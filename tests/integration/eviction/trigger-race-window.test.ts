import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';

/**
 * T9.2 — eventual-consistency invariant for the 0004 `BEFORE UPDATE OF
 * llm_importance_score` trigger (closes F-dom-pg-4 MAJOR per plan v1.3 +
 * EC-11 absorption).
 *
 * The trigger resets `half_life_seconds = NULL` whenever `llm_importance_score`
 * changes value. Under PostgreSQL READ COMMITTED isolation (the default), the
 * BEFORE-UPDATE-OF trigger fires within the UPDATE statement's snapshot —
 * concurrent writes on the same row serialize via row-level lock and the
 * trigger fires AGAIN on the second writer's NEW vs (now-updated) OLD
 * comparison.
 *
 * **EC-11 absorption (v1.1):** vitest lacks reliable worker_threads
 * orchestration for race-trigger reproduction; this test asserts EVENTUAL
 * CONSISTENCY (post-Promise.all-resolution state matches the BEFORE-UPDATE-OF
 * invariant), NOT a specific interleaving. The race window is BOUNDED by
 * tx-commit semantics; reliable race-trigger reproduction is deferred to
 * v0.4b.2 if needed.
 *
 * @see src/local/migrations/0004_eviction_half_life_trigger.sql (race-window
 *   discussion in the SQL comment block)
 * @see .claude/knowledge-base/plans/v0-4b-fixes-cycle-plan.md § T9.2
 */

const PG_URI = process.env['THEOMEM_PG_URI'] ?? '';
const TEST_AGENT_ID = 't9-2-race-window';

describe.skipIf(PG_URI === '')(
  'T9.2 — 0004 trigger race-window eventual consistency (F-dom-pg-4 + EC-11)',
  () => {
    let pool: pg.Pool;

    async function resetTestRows(): Promise<void> {
      await pool.query(`DELETE FROM memories WHERE agent_id = $1`, [TEST_AGENT_ID]);
    }

    async function seedRow(initialImportance: number, initialHalfLife: number | null): Promise<string> {
      const embedding = Array.from({ length: 1536 }, () => 0);
      embedding[0] = 1;
      const result = await pool.query<{ id: string }>(
        `INSERT INTO memories (
           text, hash, embedding, payload, agent_id, last_accessed_at,
           access_count, llm_importance_score, half_life_seconds
         ) VALUES ($1, $2, $3::vector, $4, $5, NOW(), 0, $6, $7)
         RETURNING id`,
        [
          't9.2 race-window seed',
          `t9-2-race-${Date.now()}-${Math.random()}`,
          `[${embedding.join(',')}]`,
          {},
          TEST_AGENT_ID,
          initialImportance,
          initialHalfLife,
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

    it('eventual consistency: UPDATE importance + concurrent SELECT half_life_seconds — final SELECT shows NULL', async () => {
      const id = await seedRow(0.5, 86_400);

      await Promise.all([
        pool.query(`UPDATE memories SET llm_importance_score = 0.9 WHERE id = $1`, [id]),
        pool.query(`SELECT half_life_seconds FROM memories WHERE id = $1`, [id]),
      ]);

      const { rows } = await pool.query<{ half_life_seconds: number | null }>(
        `SELECT half_life_seconds FROM memories WHERE id = $1`,
        [id],
      );
      expect(rows[0]?.half_life_seconds).toBeNull();
    });

    it('idempotent: second UPDATE with the SAME importance does NOT re-reset half_life', async () => {
      const id = await seedRow(0.5, 86_400);

      // First UPDATE changes value → trigger fires, half_life becomes NULL.
      await pool.query(`UPDATE memories SET llm_importance_score = 0.9 WHERE id = $1`, [id]);
      // Backfill half_life as if TriadicScoringPolicy.score() ran post-reset.
      await pool.query(`UPDATE memories SET half_life_seconds = 100 WHERE id = $1`, [id]);

      // Second UPDATE with SAME value → IS DISTINCT FROM returns false →
      // trigger no-ops → half_life STAYS at 100.
      await pool.query(`UPDATE memories SET llm_importance_score = 0.9 WHERE id = $1`, [id]);

      const { rows } = await pool.query<{ half_life_seconds: number | null }>(
        `SELECT half_life_seconds FROM memories WHERE id = $1`,
        [id],
      );
      expect(rows[0]?.half_life_seconds).toBe(100);
    });
  },
);
