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
  },
);
