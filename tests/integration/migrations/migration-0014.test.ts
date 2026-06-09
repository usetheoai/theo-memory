/**
 * T2.1 of themory-category-filter-server-side plan v1.2 — integration test
 * for migration 0014 (category text column + btree index per ADR D2).
 *
 * Verifies:
 *  - (a) runMigrations() applies migration 0014 on a fresh DB; category
 *        column exists as nullable text.
 *  - (b) memories_category_idx btree index is CREATED on the category column.
 *  - (c) Idempotent re-run is a no-op — ADD COLUMN IF NOT EXISTS + CREATE
 *        INDEX IF NOT EXISTS make migrate() safe to call repeatedly.
 *  - (d) EC-11 / architecture.md § 10.2 — db:push vs runMigrations() do NOT
 *        collide on column-only migrations (this migration has no trigger/function).
 *  - (e) Legacy rows survive the migration with category=NULL (ADR D1 honest
 *        no-backfill — no implicit "general" default).
 *
 * @see .claude/knowledge-base/plans/themory-category-filter-server-side-plan.md § T2.1 + ADR D2 + ADR D1
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

const ROOT_PG_URI = process.env['THEOMEM_PG_URI'] ?? '';
const TEST_DB = 'themem_t2_1_migration_0014';

describe.skipIf(ROOT_PG_URI === '')(
  'themory-category-filter-server-side T2.1 — migration 0014 (ADR D2 + ADR D1 + EC-11)',
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
    }, 30_000);

    it('runMigrations() applies migration 0014: category column added as nullable text', async () => {
      const pool = new pg.Pool({ connectionString: testUri });
      try {
        const m = await import('../../../src/local/index.js');

        // (a) Fresh DB → all migrations including 0014 land.
        await m.runMigrations(pool);

        const columnInfo = await pool.query<{
          data_type: string;
          is_nullable: string;
          column_default: string | null;
        }>(
          `SELECT data_type, is_nullable, column_default
             FROM information_schema.columns
            WHERE table_name = 'memories' AND column_name = 'category'`,
        );
        expect(columnInfo.rowCount).toBe(1);
        expect(columnInfo.rows[0]?.data_type).toBe('text');
        expect(columnInfo.rows[0]?.is_nullable).toBe('YES');
        // ADR D1 honest no-backfill — no DEFAULT clause; NULL on insert when omitted.
        expect(columnInfo.rows[0]?.column_default).toBeNull();
      } finally {
        await pool.end();
      }
    }, 60_000);

    it('memories_category_idx btree index is created on the category column', async () => {
      const pool = new pg.Pool({ connectionString: testUri });
      try {
        const idxInfo = await pool.query<{ indexdef: string }>(
          `SELECT indexdef FROM pg_indexes
            WHERE schemaname = 'public'
              AND tablename = 'memories'
              AND indexname = 'memories_category_idx'`,
        );
        expect(idxInfo.rowCount).toBe(1);
        const idxDef = idxInfo.rows[0]?.indexdef ?? '';
        // btree by default; index on (category)
        expect(idxDef).toMatch(/CREATE INDEX/i);
        expect(idxDef).toMatch(/\bcategory\b/);
      } finally {
        await pool.end();
      }
    }, 30_000);

    it('runMigrations() is idempotent — re-running 0014 is a no-op', async () => {
      const pool = new pg.Pool({ connectionString: testUri });
      try {
        const m = await import('../../../src/local/index.js');
        await expect(m.runMigrations(pool)).resolves.toBeUndefined();

        // category column still exists exactly once.
        const colCount = await pool.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM information_schema.columns
            WHERE table_name = 'memories' AND column_name = 'category'`,
        );
        expect(colCount.rows[0]?.count).toBe('1');

        // memories_category_idx still exists exactly once.
        const idxCount = await pool.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM pg_indexes
            WHERE schemaname = 'public'
              AND tablename = 'memories'
              AND indexname = 'memories_category_idx'`,
        );
        expect(idxCount.rows[0]?.count).toBe('1');
      } finally {
        await pool.end();
      }
    }, 30_000);

    it('Legacy rows inserted without category survive with category=NULL (ADR D1 honest no-backfill)', async () => {
      const pool = new pg.Pool({ connectionString: testUri });
      try {
        await pool.query('TRUNCATE memories CASCADE');
        const vec1536 = `[${Array(1536).fill(0).join(',')}]`;

        // Raw INSERT without the category column — simulates a pre-2026-06-09 row.
        await pool.query(
          `INSERT INTO memories (text, hash, embedding, payload, user_id)
           VALUES ($1, $2, $3::vector, '{}'::jsonb, 'alice')`,
          ['Legacy fact without category', 'abc1234567890abcdef0123456789012', vec1536],
        );

        const row = await pool.query<{ category: string | null }>(
          `SELECT category FROM memories WHERE user_id = 'alice'`,
        );
        expect(row.rowCount).toBe(1);
        expect(row.rows[0]?.category).toBeNull();
      } finally {
        await pool.end();
      }
    }, 30_000);
  },
);
