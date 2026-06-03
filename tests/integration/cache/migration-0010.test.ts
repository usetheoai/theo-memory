import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

/**
 * T0.2 — Migration 0010 (recall_cache table) integration test against real
 * `ankane/pgvector:v0.5.1` per `semantic-recall-cache-v1-5-plan.md § T0.2`.
 *
 * Asserts:
 *   - T0.2-RED-1: migration applies to a fresh container; recall_cache exists and is empty
 *   - T0.2-RED-2: re-running runMigrations() is a no-op (idempotency — v1.1 EC-6 pattern)
 *   - T0.2-RED-3: HNSW + B-tree indexes are present post-migration
 *   - T0.2-RED-4: schema.ts recallCache declaration matches migration SQL (parity sentinel — v1.1 T0.1 precedent)
 *
 * Pattern mirrors `tests/integration/migrations/idempotency.test.ts` (T11.1b precedent).
 */

const ROOT_PG_URI = process.env['THEOMEM_PG_URI'] ?? '';
const TEST_DB = 'themem_t0_2_recall_cache_migration';

describe.skipIf(ROOT_PG_URI === '')(
  'T0.2 — migration 0010 recall_cache (v1.5)',
  () => {
    const adminUri = ROOT_PG_URI.replace(/\/[^/]*$/, '/postgres');
    const testUri = ROOT_PG_URI.replace(/\/[^/]*$/, `/${TEST_DB}`);

    beforeAll(async () => {
      const adminPool = new pg.Pool({ connectionString: adminUri });
      await adminPool.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
      await adminPool.query(`CREATE DATABASE ${TEST_DB}`);
      await adminPool.end();
    }, 60_000);

    afterAll(async () => {
      const adminPool = new pg.Pool({ connectionString: adminUri });
      await adminPool.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
      await adminPool.end();
    });

    it('T0.2-RED-1 — migration applies; recall_cache exists and is empty', async () => {
      const pool = new pg.Pool({ connectionString: testUri });
      const m = await import('../../../src/local/index.js');

      await m.runMigrations(pool);

      // Table presence
      const tableProbe = await pool.query<{ exists: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM information_schema.tables
           WHERE table_schema = 'public' AND table_name = 'recall_cache'
         ) AS exists`,
      );
      expect(tableProbe.rows[0]?.exists).toBe(true);

      // Empty post-migration
      const rows = await pool.query('SELECT * FROM recall_cache');
      expect(rows.rows).toEqual([]);

      await pool.end();
    });

    it('T0.2-RED-2 — runMigrations() called twice is idempotent (v1.1 EC-6 pattern)', async () => {
      const pool = new pg.Pool({ connectionString: testUri });
      const m = await import('../../../src/local/index.js');

      const firstCount = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM drizzle.__drizzle_migrations`,
      );

      await expect(m.runMigrations(pool)).resolves.toBeUndefined();

      const secondCount = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM drizzle.__drizzle_migrations`,
      );

      expect(secondCount.rows[0]?.count).toBe(firstCount.rows[0]?.count);

      // recall_cache still present + still empty
      const rows = await pool.query('SELECT * FROM recall_cache');
      expect(rows.rows).toEqual([]);

      await pool.end();
    });

    it('T0.2-RED-3 — HNSW + B-tree indexes present post-migration', async () => {
      const pool = new pg.Pool({ connectionString: testUri });

      const indexes = await pool.query<{ indexname: string; indexdef: string }>(
        `SELECT indexname, indexdef
           FROM pg_indexes
          WHERE schemaname = 'public' AND tablename = 'recall_cache'
          ORDER BY indexname`,
      );

      const byName = new Map(indexes.rows.map((r) => [r.indexname, r.indexdef]));

      expect(byName.has('recall_cache_scope_hnsw_idx')).toBe(true);
      expect(byName.get('recall_cache_scope_hnsw_idx')).toMatch(/hnsw/);
      expect(byName.get('recall_cache_scope_hnsw_idx')).toMatch(/vector_cosine_ops/);

      expect(byName.has('recall_cache_scope_key_idx')).toBe(true);
      expect(byName.get('recall_cache_scope_key_idx')).toMatch(/btree/);

      expect(byName.has('recall_cache_expires_at_idx')).toBe(true);
      // Partial index: WHERE expires_at IS NOT NULL
      expect(byName.get('recall_cache_expires_at_idx')).toMatch(/expires_at.*IS NOT NULL/i);

      await pool.end();
    });

    it('T0.2-RED-4 — schema.ts/SQL parity sentinel: column types match Drizzle declaration', async () => {
      // Mirror v1.1 T0.1 parity precedent: assert SQL column types match what
      // schema.ts declares. Catches accidental drift between schema declaration
      // and migration SQL — exactly the F-dom-dbmig-1 class of bug.
      const pool = new pg.Pool({ connectionString: testUri });

      const columns = await pool.query<{ column_name: string; data_type: string; is_nullable: string }>(
        `SELECT column_name, data_type, is_nullable
           FROM information_schema.columns
          WHERE table_name = 'recall_cache'
          ORDER BY ordinal_position`,
      );

      const byName = new Map(columns.rows.map((r) => [r.column_name, r]));

      // id serial PRIMARY KEY → underlying integer NOT NULL
      expect(byName.get('id')?.data_type).toBe('integer');
      expect(byName.get('id')?.is_nullable).toBe('NO');

      // scope_key text NOT NULL
      expect(byName.get('scope_key')?.data_type).toBe('text');
      expect(byName.get('scope_key')?.is_nullable).toBe('NO');

      // query_embedding vector(1536) NOT NULL — information_schema reports
      // pgvector custom type as 'USER-DEFINED'.
      expect(byName.get('query_embedding')?.data_type).toBe('USER-DEFINED');
      expect(byName.get('query_embedding')?.is_nullable).toBe('NO');

      // result_set jsonb NOT NULL
      expect(byName.get('result_set')?.data_type).toBe('jsonb');
      expect(byName.get('result_set')?.is_nullable).toBe('NO');

      // hit_count integer NOT NULL DEFAULT 0
      expect(byName.get('hit_count')?.data_type).toBe('integer');
      expect(byName.get('hit_count')?.is_nullable).toBe('NO');

      // created_at timestamptz NOT NULL DEFAULT now()
      expect(byName.get('created_at')?.data_type).toBe('timestamp with time zone');
      expect(byName.get('created_at')?.is_nullable).toBe('NO');

      // expires_at timestamptz NULLABLE
      expect(byName.get('expires_at')?.data_type).toBe('timestamp with time zone');
      expect(byName.get('expires_at')?.is_nullable).toBe('YES');

      // threshold_used real NOT NULL DEFAULT 0.8
      expect(byName.get('threshold_used')?.data_type).toBe('real');
      expect(byName.get('threshold_used')?.is_nullable).toBe('NO');

      // Probe atttypmod to confirm dim is 1536 (matches MAX_EMBEDDING_DIM in schema.ts)
      const dimProbe = await pool.query<{ atttypmod: number }>(
        `SELECT a.atttypmod
           FROM pg_attribute a
           JOIN pg_class c ON c.oid = a.attrelid
          WHERE c.relname = 'recall_cache'
            AND a.attname = 'query_embedding'
            AND a.attisdropped = false`,
      );
      expect(dimProbe.rows[0]?.atttypmod).toBe(1536);

      await pool.end();
    });
  },
);
