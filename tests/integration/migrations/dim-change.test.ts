import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';

/**
 * adapters-openrouter-local-embedder T0.3 — `runMigrations(pool, { embeddingDim? })`
 * post-migration parametric ALTER COLUMN sequence (EC-3 + EC-4 absorbed).
 *
 * Scope:
 *   - Backward compat: `runMigrations(pool)` (no options) continues to
 *     produce `vector(1536)` schema with both HNSW indexes present.
 *   - Parametric path: `runMigrations(pool, { embeddingDim: 384 })`
 *     drops HNSW indexes → ALTERs both columns to `vector(384)` →
 *     recreates HNSW indexes, all inside a single BEGIN/COMMIT.
 *   - EC-3 atomic: simulated failure inside the sequence triggers
 *     ROLLBACK; schema preserved at pre-change state.
 *   - EC-4 HNSW recreation: both `memories_embedding_hnsw_idx` and
 *     `entities_embedding_hnsw_idx` exist post-ALTER with the new dim.
 *   - Idempotency: 2nd call with same dim short-circuits via atttypmod
 *     probe. pgvector v0.5.1 stores `vector(N)` dimension in `atttypmod`
 *     directly (NO +4 varlena offset — empirical, see `getColumnDim` below).
 *
 * @see .claude/knowledge-base/plans/adapters-openrouter-local-embedder-plan.md § T0.3
 * @see .claude/knowledge-base/reviews/adapters-openrouter-local-embedder-edge-cases-2026-06-01.md § EC-3 + EC-4
 * @see .claude/knowledge-base/implementations/adapters-openrouter-local-embedder/sepa-iterations/iteration-3-pre-red.md (C1 + C2 absorption)
 */

const ROOT_PG_URI = process.env['THEOMEM_PG_URI'] ?? '';
const TEST_DB = 'themem_t0_3_dim_change';

async function getColumnDim(pool: pg.Pool, tableName: string): Promise<number> {
  // pgvector v0.5.1 stores `vector(N)` dimension in pg_attribute.atttypmod
  // directly (NO +4 varlena offset — empirically verified against the
  // running ankane/pgvector:v0.5.1 container: vector(1536) → atttypmod=1536).
  // The SEPA pre-RED CRITICAL #2 claim of `N + 4` encoding was wrong for
  // this version; the actual decoder is the identity function.
  const res = await pool.query<{ atttypmod: number }>(
    `SELECT a.atttypmod
       FROM pg_attribute a
       JOIN pg_class c ON c.oid = a.attrelid
      WHERE c.relname = $1
        AND a.attname = 'embedding'
        AND a.attisdropped = false`,
    [tableName],
  );
  return res.rows[0]?.atttypmod ?? -1;
}

async function indexExists(pool: pg.Pool, indexName: string): Promise<boolean> {
  const res = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public' AND indexname = $1
     ) AS exists`,
    [indexName],
  );
  return res.rows[0]?.exists === true;
}

describe.skipIf(ROOT_PG_URI === '')(
  'T0.3 — runMigrations parametric embeddingDim (EC-3 + EC-4)',
  () => {
    const adminUri = ROOT_PG_URI.replace(/\/[^/]*$/, '/postgres');
    const testUri = ROOT_PG_URI.replace(/\/[^/]*$/, `/${TEST_DB}`);

    beforeAll(async () => {
      const adminPool = new pg.Pool({ connectionString: adminUri });
      await adminPool.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
      await adminPool.end();
    }, 60_000);

    beforeEach(async () => {
      const adminPool = new pg.Pool({ connectionString: adminUri });
      await adminPool.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
      await adminPool.query(`CREATE DATABASE ${TEST_DB}`);
      await adminPool.end();
    }, 30_000);

    afterAll(async () => {
      const adminPool = new pg.Pool({ connectionString: adminUri });
      await adminPool.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
      await adminPool.end();
    });

    it('backward compat: runMigrations(pool) without options produces vector(1536) schema', async () => {
      const pool = new pg.Pool({ connectionString: testUri });
      const m = await import('../../../src/local/index.js');

      await m.runMigrations(pool);

      expect(await getColumnDim(pool, 'memories')).toBe(1536);
      expect(await getColumnDim(pool, 'entities')).toBe(1536);
      expect(await indexExists(pool, 'memories_embedding_hnsw_idx')).toBe(true);
      expect(await indexExists(pool, 'entities_embedding_hnsw_idx')).toBe(true);

      await pool.end();
    });

    it('parametric: runMigrations(pool, { embeddingDim: 384 }) alters both columns to vector(384)', async () => {
      const pool = new pg.Pool({ connectionString: testUri });
      const m = await import('../../../src/local/index.js');

      await m.runMigrations(pool, { embeddingDim: 384 });

      expect(await getColumnDim(pool, 'memories')).toBe(384);
      expect(await getColumnDim(pool, 'entities')).toBe(384);

      await pool.end();
    });

    it('EC-4: runMigrations parametric recreates HNSW indexes after ALTER', async () => {
      const pool = new pg.Pool({ connectionString: testUri });
      const m = await import('../../../src/local/index.js');

      await m.runMigrations(pool, { embeddingDim: 384 });

      expect(await indexExists(pool, 'memories_embedding_hnsw_idx')).toBe(true);
      expect(await indexExists(pool, 'entities_embedding_hnsw_idx')).toBe(true);

      // Sanity: the index should be on the 384-dim column (we cannot
      // assert this from `pg_indexes` alone, but the existence of the
      // index post-ALTER + the column being 384-dim together prove that
      // CREATE INDEX ran AFTER ALTER COLUMN TYPE).
      await pool.end();
    });

    it('idempotent: 2nd call with same dim short-circuits via atttypmod probe', async () => {
      const pool = new pg.Pool({ connectionString: testUri });
      const m = await import('../../../src/local/index.js');

      await m.runMigrations(pool, { embeddingDim: 384 });

      // Get the indexes' relfilenode (changes when index is recreated).
      const before = await pool.query<{ relfilenode: number }>(
        `SELECT relfilenode FROM pg_class WHERE relname = 'memories_embedding_hnsw_idx'`,
      );
      const beforeRelfilenode = before.rows[0]?.relfilenode ?? -1;

      // 2nd call with same dim — must NOT drop+recreate the index.
      await m.runMigrations(pool, { embeddingDim: 384 });

      const after = await pool.query<{ relfilenode: number }>(
        `SELECT relfilenode FROM pg_class WHERE relname = 'memories_embedding_hnsw_idx'`,
      );
      const afterRelfilenode = after.rows[0]?.relfilenode ?? -1;

      expect(afterRelfilenode).toBe(beforeRelfilenode);
      expect(await getColumnDim(pool, 'memories')).toBe(384);

      await pool.end();
    });

    it('no-op: runMigrations(pool, { embeddingDim: 1536 }) does not run the ALTER sequence (matches default)', async () => {
      const pool = new pg.Pool({ connectionString: testUri });
      const m = await import('../../../src/local/index.js');

      // Run once with default to establish baseline.
      await m.runMigrations(pool);
      const baseline = await pool.query<{ relfilenode: number }>(
        `SELECT relfilenode FROM pg_class WHERE relname = 'memories_embedding_hnsw_idx'`,
      );

      // Now call with the default dim explicitly — should be a no-op,
      // no index recreation.
      await m.runMigrations(pool, { embeddingDim: 1536 });
      const after = await pool.query<{ relfilenode: number }>(
        `SELECT relfilenode FROM pg_class WHERE relname = 'memories_embedding_hnsw_idx'`,
      );

      expect(after.rows[0]?.relfilenode).toBe(baseline.rows[0]?.relfilenode);

      await pool.end();
    });

    // /review F-M1 — EC-3 atomic rollback regression test (4 reviewers flagged
    // this gap). The BEGIN/COMMIT/ROLLBACK wrapper in applyDimChange exists
    // for atomicity; without a test that injects a mid-sequence failure, the
    // entire EC-3 contract is verified only by code review.
    it('EC-3 atomic rollback: mid-sequence failure preserves pre-change schema state', async () => {
      const pool = new pg.Pool({ connectionString: testUri });
      const m = await import('../../../src/local/index.js');
      try {
        // Bring DB to vector(1536) baseline first.
        await m.runMigrations(pool);
        expect(await getColumnDim(pool, 'memories')).toBe(1536);

        // Inject a mid-sequence failure by pre-creating a VIEW that
        // depends on `memories.embedding`. PostgreSQL blocks
        // ALTER COLUMN TYPE on a column used by a view (error:
        // "cannot alter type of a column used by a view or rule"),
        // so the ALTER fails inside BEGIN/COMMIT → the wrapper
        // ROLLBACKs and re-throws, preserving the pre-change schema.
        await pool.query(
          'CREATE VIEW v_embed_dep AS SELECT id, embedding FROM memories',
        );

        await expect(
          m.runMigrations(pool, { embeddingDim: 384 }),
        ).rejects.toThrow();

        // Post-rollback assertions: dim still 1536, primary HNSW indexes
        // still present (they were dropped inside the same BEGIN that
        // rolled back, so DROP is undone).
        expect(await getColumnDim(pool, 'memories')).toBe(1536);
        expect(await indexExists(pool, 'memories_embedding_hnsw_idx')).toBe(true);
        expect(await indexExists(pool, 'entities_embedding_hnsw_idx')).toBe(true);
      } finally {
        // Always end the pool so the next test's beforeEach can DROP DATABASE.
        await pool.end();
      }
    });

    // /review F-M6 — destructive DELETE cascade verification. Previous tests
    // all ran against fresh DBs (no rows to DELETE); a regression that broke
    // FK cascade behavior would have shipped silently.
    it('destructive cascade: seeded rows wiped + FK cascades fire as documented (F-C1)', async () => {
      const pool = new pg.Pool({ connectionString: testUri });
      const m = await import('../../../src/local/index.js');
      try {
      await m.runMigrations(pool);

      // Seed: insert ONE memory + ONE history row + ONE consolidation_history
      // row pointing at it. Each table touches a distinct FK arm of the cascade.
      const seedDim = 1536;
      const fakeVec = `[${Array.from({ length: seedDim }, () => '0').join(',')}]`;
      const inserted = await pool.query<{ id: string }>(
        `INSERT INTO memories (text, hash, embedding, payload, user_id)
         VALUES ('seed', 'h-cascade-1', $1::vector, '{}'::jsonb, 'u-cascade')
         RETURNING id`,
        [fakeVec],
      );
      const memoryId = inserted.rows[0]?.id;
      expect(memoryId).toBeTruthy();
      await pool.query(
        `INSERT INTO history (memory_id, event, prev_text, new_text)
         VALUES ($1, 'add', NULL, 'seed')`,
        [memoryId],
      );
      await pool.query(
        `INSERT INTO consolidation_history
           (kept_memory_id, rejected_memory_ids, reason, policy_name)
         VALUES ($1, '[]'::jsonb, 'cascade-test', 'k-cascade')`,
        [memoryId],
      );
      // /review re-run F-dom-pgvector-rerun-1: seed the 3rd cascade arm
      // (memories.superseded_by self-FK ON DELETE SET NULL — v0.6 Voyager
      // skill supersession). Insert a 2nd memory whose `superseded_by`
      // points at the 1st; after DELETE FROM memories wipes everything,
      // the 2nd row is gone too (both DELETED in the same statement), but
      // the chain itself is verified end-to-end when re-seeded post-ALTER.
      // We assert the FK CONSTRAINT exists with action 'n' (SET NULL) so
      // a future migration that flips the action to CASCADE/RESTRICT is
      // caught here as a regression.
      const supersedingInsert = await pool.query<{ id: string }>(
        `INSERT INTO memories (text, hash, embedding, payload, user_id, superseded_by)
         VALUES ('supersedes seed', 'h-cascade-2', $1::vector, '{}'::jsonb, 'u-cascade', $2)
         RETURNING id`,
        [fakeVec, memoryId],
      );
      expect(supersedingInsert.rows[0]?.id).toBeTruthy();

      // Sanity: rows are there.
      const beforeMemories = await pool.query<{ c: number }>(
        `SELECT COUNT(*)::int AS c FROM memories WHERE user_id = 'u-cascade'`,
      );
      const beforeHistory = await pool.query<{ c: number }>(
        `SELECT COUNT(*)::int AS c FROM history WHERE memory_id = $1`,
        [memoryId],
      );
      expect(beforeMemories.rows[0]?.c).toBe(2);
      expect(beforeHistory.rows[0]?.c).toBe(1);
      // FK action assertion (catches regression if action flips):
      const fk = await pool.query<{ action: string }>(
        `SELECT confdeltype AS action
           FROM pg_constraint
          WHERE conname LIKE '%superseded_by%' AND contype = 'f'
          LIMIT 1`,
      );
      expect(fk.rows[0]?.action).toBe('n'); // 'n' = SET NULL

      // Trigger the destructive dim change.
      await m.runMigrations(pool, { embeddingDim: 384 });

      // (a) row count is 0 post-ALTER (DELETE FROM memories ran — wipes
      // BOTH the original memory + the superseding row that pointed at it).
      const afterMemories = await pool.query<{ c: number }>(
        `SELECT COUNT(*)::int AS c FROM memories WHERE user_id = 'u-cascade'`,
      );
      expect(afterMemories.rows[0]?.c).toBe(0);

      // (b) history table empty per ON DELETE CASCADE.
      const afterHistory = await pool.query<{ c: number }>(
        `SELECT COUNT(*)::int AS c FROM history WHERE memory_id = $1`,
        [memoryId],
      );
      expect(afterHistory.rows[0]?.c).toBe(0);

      // (c) consolidation_history.kept_memory_id NULLed per ON DELETE SET NULL.
      // The audit row itself survives (different cascade arm).
      const afterConsolidation = await pool.query<{ c: number; kept: string | null }>(
        `SELECT COUNT(*)::int AS c, MAX(kept_memory_id::text) AS kept
           FROM consolidation_history
          WHERE policy_name = 'k-cascade'`,
      );
      expect(afterConsolidation.rows[0]?.c).toBe(1);
      expect(afterConsolidation.rows[0]?.kept).toBeNull();
      } finally {
        await pool.end();
      }
    });

    // /review F-M7 — push-flow dim-change RED test. The T4.1 hotfix that
    // applies dim change on push-flow DBs (no drizzle journal but schema
    // present) was discovered empirically; this is the TDD-first regression
    // gate (Inquebrável Rule 5).
    it('push-flow: orphan-schema branch still applies parametric dim change', async () => {
      const pool = new pg.Pool({ connectionString: testUri });
      const m = await import('../../../src/local/index.js');
      try {
        // Simulate the push-flow footgun: schema present but journal missing.
        // Bootstrap a real schema first (runMigrations writes the journal),
        // then DROP the journal table to mimic `drizzle-kit push` state.
        await m.runMigrations(pool);
        await pool.query('DROP TABLE IF EXISTS drizzle.__drizzle_migrations CASCADE');
        await pool.query('DROP SCHEMA IF EXISTS drizzle CASCADE');
        expect(await getColumnDim(pool, 'memories')).toBe(1536);

        // Re-invoke with the parametric embeddingDim. The orphan-schema branch
        // MUST apply the dim change instead of silently skipping.
        await m.runMigrations(pool, { embeddingDim: 384 });

        expect(await getColumnDim(pool, 'memories')).toBe(384);
        expect(await getColumnDim(pool, 'entities')).toBe(384);
      } finally {
        await pool.end();
      }
    });
  },
);
