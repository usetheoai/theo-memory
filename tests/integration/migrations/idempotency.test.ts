import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

/**
 * T11.1b — `runMigrations(pool)` is idempotent across multiple calls
 * (closes F-dom-db-3 MAJOR per plan v1.3).
 *
 * Per Drizzle's journal-driven design, applying a second `runMigrations()`
 * against a DB already aligned with the journal is a no-op at the SQL layer:
 * each migration entry's hash is compared against the journal; matching
 * hashes are skipped.
 *
 */

const ROOT_PG_URI = process.env['THEOMEM_PG_URI'] ?? '';
const TEST_DB = 'themem_t11_1b_idempotency';

describe.skipIf(ROOT_PG_URI === '')(
  'T11.1b — runMigrations() idempotency (F-dom-db-3)',
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

    it('runMigrations() called twice in succession is a no-op on the second call', async () => {
      const pool = new pg.Pool({ connectionString: testUri });
      const m = await import('@usetheo/memory');

      // First call: fresh DB → applies migrations 0000-0006.
      await m.runMigrations(pool);

      const firstCount = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM drizzle.__drizzle_migrations`,
      );
      const firstColumnCount = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM information_schema.columns
          WHERE table_name='memories'
            AND column_name IN ('last_accessed_at','access_count','half_life_seconds')`,
      );

      // Second call: journal-aligned → no migrate() rerun + no schema mutation.
      await expect(m.runMigrations(pool)).resolves.toBeUndefined();

      const secondCount = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM drizzle.__drizzle_migrations`,
      );
      const secondColumnCount = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM information_schema.columns
          WHERE table_name='memories'
            AND column_name IN ('last_accessed_at','access_count','half_life_seconds')`,
      );

      expect(secondCount.rows[0]?.count).toBe(firstCount.rows[0]?.count);
      expect(secondColumnCount.rows[0]?.count).toBe(firstColumnCount.rows[0]?.count);
      expect(secondColumnCount.rows[0]?.count).toBe('3');

      await pool.end();
    });
  },
);
