/**
 * Phase 2 (themory-scoped-forget-and-retrieval-counter) — the recall usage
 * counter: migration 0020 (T2.1), PgUsageCounterStore (T2.2), recall increment
 * (T2.3), metrics read (T2.4). Gated by THEOMEM_PG_URI; real ankane/pgvector.
 *
 * @see .claude/knowledge-base/plans/themory-scoped-forget-and-retrieval-counter-plan.md § Phase 2
 */
import { afterAll, beforeEach, describe, expect, test } from 'vitest';
import pg from 'pg';

import { runMigrations, PgUsageCounterStore } from '@usetheo/memory';

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

  describe('T2.2 PgUsageCounterStore (atomic UPSERT, EC-3 byte-identical COALESCE)', () => {
    const pool = new pg.Pool({ connectionString: PG_URI, max: 16 });
    const store = new PgUsageCounterStore(pool);

    afterAll(async () => {
      await pool.end();
    });
    beforeEach(async () => {
      await runMigrations(pool);
      // Deterministic across re-runs — the table persists between runs.
      await pool.query('TRUNCATE scope_usage_counters');
    });

    test('increment creates the row then bumps it (read agrees)', async () => {
      // Given/When: three recalls in the same user scope
      await store.increment({ workspace_id: 'default', user_id: 'alice' });
      await store.increment({ workspace_id: 'default', user_id: 'alice' });
      await store.increment({ workspace_id: 'default', user_id: 'alice' });
      // Then: the counter reads exactly 3
      expect(await store.getRecallCount({ workspace_id: 'default', user_id: 'alice' })).toBe(3);
    });

    test('counts are scope-isolated across tier and id', async () => {
      // Given: one increment in user(alice)
      await store.increment({ workspace_id: 'default', user_id: 'alice' });
      // Then: a different user id and a different tier read 0
      expect(await store.getRecallCount({ workspace_id: 'default', user_id: 'bob' })).toBe(0);
      expect(await store.getRecallCount({ workspace_id: 'default', session_id: 'alice' })).toBe(0);
    });

    test('EC-3 increment and read agree when workspace is omitted (defaults to "default")', async () => {
      // Given/When: increment with NO workspace_id (TS normalizes to 'default')
      await store.increment({ user_id: 'carol' });
      // Then: a read with NO workspace_id hits the SAME row, not a split 0
      expect(await store.getRecallCount({ user_id: 'carol' })).toBe(1);
    });

    test('50 concurrent increments yield exactly 50 (no lost update)', async () => {
      // Given/When: 50 racing recalls in the same scope
      await Promise.all(
        Array.from({ length: 50 }, () =>
          store.increment({ workspace_id: 'default', user_id: 'dave' }),
        ),
      );
      // Then: the atomic ON CONFLICT DO UPDATE preserved every increment
      expect(await store.getRecallCount({ workspace_id: 'default', user_id: 'dave' })).toBe(50);
    });
  });
}
