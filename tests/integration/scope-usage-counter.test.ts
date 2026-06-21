/**
 * Phase 2 (themory-scoped-forget-and-retrieval-counter) — the recall usage
 * counter: migration 0020 (T2.1), PgUsageCounterStore (T2.2), recall increment
 * (T2.3), metrics read (T2.4). Gated by THEOMEM_PG_URI; real ankane/pgvector.
 *
 * @see .claude/knowledge-base/plans/themory-scoped-forget-and-retrieval-counter-plan.md § Phase 2
 */
import { afterAll, beforeEach, describe, expect, test } from 'vitest';
import pg from 'pg';

import { runMigrations } from '@usetheo/memory';

const PG_URI = process.env['THEOMEM_PG_URI'];

if (PG_URI === undefined || PG_URI === '') {
  describe.skip('Phase 2 usage counter (THEOMEM_PG_URI not set)', () => {
    test('placeholder', () => undefined);
  });
} else {
  describe('T2.1 migration 0020_scope_usage_counters', () => {
    const pool = new pg.Pool({ connectionString: PG_URI, max: 4 });

    afterAll(async () => {
      await pool.end();
    });
    beforeEach(async () => {
      await runMigrations(pool);
    });

    test('creates the scope_usage_counters table', async () => {
      const { rows } = await pool.query<{ reg: string | null }>(
        `SELECT to_regclass('public.scope_usage_counters')::text AS reg`,
      );
      expect(rows[0]?.reg).toBe('scope_usage_counters');
    });

    test('creates the scope-tuple UNIQUE index (COALESCE arbiter for ON CONFLICT)', async () => {
      const { rows } = await pool.query<{ indexname: string }>(
        `SELECT indexname FROM pg_indexes
          WHERE tablename = 'scope_usage_counters' AND indexdef ILIKE '%UNIQUE%'`,
      );
      expect(rows.length).toBeGreaterThanOrEqual(1);
    });

    test('recall_count column defaults to 0', async () => {
      const { rows } = await pool.query<{ column_default: string | null }>(
        `SELECT column_default FROM information_schema.columns
          WHERE table_name = 'scope_usage_counters' AND column_name = 'recall_count'`,
      );
      expect(rows.length).toBe(1);
      expect(rows[0]?.column_default ?? '').toContain('0');
    });
  });
}
