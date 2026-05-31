import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import { createLocalMemory, PgvectorStore, StubEmbedder, StubLLM } from '../../../src/local/index.js';
import { MemoryNotFound } from '../../../src/core/errors.js';

/**
 * T7.1: `Memory.forget(id)` soft-deletes via t_invalid through the PgEvictor
 * path (PUBLIC API BREAKING change per ADR D7 + EC-3 absorption). Closes
 * F-dom-3 + F-wire-1 MAJOR from /review v0-4b-forgetting-pipeline-2026-05-30.
 *
 * Contract comparison:
 *   - v0.1 (shipped): `vectorStore.delete()` hard delete; raw SELECT post-
 *     forget returns 0 rows. This violated the documented
 *     `ForgetOptions.hard?: false` default at src/core/options.ts:55-62.
 *   - v0.4b-fixes T7.1 (this): soft-delete via t_invalid=NOW() via PgEvictor;
 *     raw SELECT post-forget returns 1 row with t_invalid IS NOT NULL.
 *     `forget(id, { hard: true })` preserves the v0.1 physical-delete path
 *     for GDPR-style erasure.
 *
 * The cascade impact: v0.6 `ScopedSkillMemory.forget()` routes through this
 * same path via `LocalScopedSkillMemory.forgetDelegate` (line 564); skill
 * consumers also see the BREAKING change.
 *
 * @see .claude/knowledge-base/plans/v0-4b-fixes-cycle-plan.md § T7.1 + ADR D7
 * @see .claude/knowledge-base/reviews/v0-4b-fixes-cycle-edge-cases-2026-05-30.md § EC-3
 */

const PG_URI = process.env['THEOMEM_PG_URI'] ?? '';

describe.skipIf(PG_URI === '')(
  'T7.1: Memory.forget() soft-delete via PgEvictor (F-dom-3 + ADR D7 BREAKING)',
  () => {
    let pool: pg.Pool;
    const TEST_USER = 't7-1-forget-user';

    async function resetTestRows(): Promise<void> {
      await pool.query(`DELETE FROM memories WHERE user_id = $1`, [TEST_USER]);
    }

    async function seedRow(): Promise<string> {
      const embedding = Array.from({ length: 1536 }, () => 0);
      embedding[0] = 1;
      const result = await pool.query<{ id: string }>(
        `INSERT INTO memories (
           text, hash, embedding, payload, user_id, last_accessed_at,
           access_count, llm_importance_score
         ) VALUES ($1, $2, $3::vector, $4, $5, NOW(), 0, 0.5)
         RETURNING id`,
        [
          't7.1 sample fact',
          `t7-1-hash-${Date.now()}-${Math.random()}`,
          `[${embedding.join(',')}]`,
          { text: 't7.1 sample fact', user_id: TEST_USER },
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

    it('soft-deletes via t_invalid (raw SELECT returns the row with t_invalid IS NOT NULL)', async () => {
      const memory = await createLocalMemory({
        vectorStore: new PgvectorStore(pool),
        embedder: new StubEmbedder(),
        llm: new StubLLM(),
      });
      const id = await seedRow();
      await memory.forget(id);
      const { rows } = await pool.query<{ t_invalid: Date | null }>(
        `SELECT t_invalid FROM memories WHERE id = $1`,
        [id],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.t_invalid).not.toBeNull();
      await memory.dispose();
    });

    it('is idempotent for already-evicted row (second forget() does not throw)', async () => {
      const memory = await createLocalMemory({
        vectorStore: new PgvectorStore(pool),
        embedder: new StubEmbedder(),
        llm: new StubLLM(),
      });
      const id = await seedRow();
      await memory.forget(id);
      await expect(memory.forget(id)).resolves.toBeUndefined();
      const { rows } = await pool.query<{ t_invalid: Date | null }>(
        `SELECT t_invalid FROM memories WHERE id = $1`,
        [id],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.t_invalid).not.toBeNull();
      await memory.dispose();
    });

    it('EC-3 PUBLIC API BREAKING: raw SELECT post-forget returns 1 row with t_invalid set (NOT 0 rows as v0.1)', async () => {
      const memory = await createLocalMemory({
        vectorStore: new PgvectorStore(pool),
        embedder: new StubEmbedder(),
        llm: new StubLLM(),
      });
      const id = await seedRow();
      await memory.forget(id);
      const { rows } = await pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM memories WHERE id = $1`,
        [id],
      );
      // v0.1 contract: COUNT(*) == 0 after forget (hard delete).
      // v0.4b contract: COUNT(*) == 1 after forget (soft delete via t_invalid).
      expect(Number(rows[0]?.count ?? '0')).toBe(1);
      await memory.dispose();
    });

    it('forget(id, { hard: true }) physically deletes the row (GDPR contract preserved)', async () => {
      const memory = await createLocalMemory({
        vectorStore: new PgvectorStore(pool),
        embedder: new StubEmbedder(),
        llm: new StubLLM(),
      });
      const id = await seedRow();
      await memory.forget(id, { hard: true });
      const { rows } = await pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM memories WHERE id = $1`,
        [id],
      );
      expect(Number(rows[0]?.count ?? '0')).toBe(0);
      await memory.dispose();
    });

    it('EC-12 preserved: forget(unknownId) throws MemoryNotFound', async () => {
      const memory = await createLocalMemory({
        vectorStore: new PgvectorStore(pool),
        embedder: new StubEmbedder(),
        llm: new StubLLM(),
      });
      await expect(
        memory.forget('00000000-0000-0000-0000-000000000000'),
      ).rejects.toBeInstanceOf(MemoryNotFound);
      await memory.dispose();
    });
  },
);
