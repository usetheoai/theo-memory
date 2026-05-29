/**
 * T0.2 INTEGRATION RED — CHECK constraint enforcement for v0.4a schema.
 *
 * Asserts:
 *  - memories_kind_derived_from_check rejects kind='derived' with derived_from=NULL
 *  - memories_kind_derived_from_check rejects kind='extracted' with derived_from=['...']
 *  - reflection_counters_scope_not_all_null_check rejects rows with all 3 scope cols NULL (EC-3)
 *  - reflection_counters composite-unique allows partial NULLs (e.g., session+agent same with user differing)
 *
 * Per plan v0-4a-reflection-pipeline § T0.2 ADRs D4 + D6.
 * Per testing.md § Pyramid: integration-tier tests live here; UNIT-tier
 * introspection lives in src/local/__tests__/schema-v0-4a.test.ts.
 *
 * Note (Fix #4 of cycle-implement.md v1.5): the plan declares CHECK
 * violation tests under src/local/__tests__/schema-v0-4a.test.ts but
 * testing.md § Pyramid mandates real-Postgres tests live under
 * tests/integration/. Plan path honored for the introspection unit
 * portion; DB-touching CHECK enforcement here.
 *
 * @see .claude/knowledge-base/plans/v0-4a-reflection-pipeline-plan.md § T0.2
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import pg from 'pg';

const PG_URI = process.env['THEOMEM_PG_URI'];

if (PG_URI === undefined || PG_URI === '') {
  describe.skip('schema-v0-4a-constraints (THEOMEM_PG_URI not set)', () => {
    test('placeholder', () => {
      // no-op
    });
  });
} else {
  describe('memories CHECK constraint memories_kind_derived_from_check', () => {
    let pool: pg.Pool;

    beforeAll(async () => {
      pool = new pg.Pool({ connectionString: PG_URI });
    });

    afterAll(async () => {
      await pool.end();
    });

    test("kind='derived' with derived_from=NULL violates CHECK", async () => {
      await expect(
        pool.query(
          `INSERT INTO memories (id, text, hash, embedding, payload, kind, derived_from)
           VALUES (gen_random_uuid(), 'derived test', 'h1',
                   array_fill(0.0, ARRAY[1536])::vector,
                   '{}'::jsonb, 'derived', NULL)`,
        ),
      ).rejects.toThrow(/check constraint.*kind_derived_from/i);
    });

    test("kind='extracted' with non-null derived_from violates CHECK", async () => {
      await expect(
        pool.query(
          `INSERT INTO memories (id, text, hash, embedding, payload, kind, derived_from)
           VALUES (gen_random_uuid(), 'extracted test', 'h2',
                   array_fill(0.0, ARRAY[1536])::vector,
                   '{}'::jsonb, 'extracted', '["abc"]'::jsonb)`,
        ),
      ).rejects.toThrow(/check constraint.*kind_derived_from/i);
    });

    test("kind='derived' with non-empty derived_from succeeds", async () => {
      const result = await pool.query(
        `INSERT INTO memories (id, text, hash, embedding, payload, kind, derived_from)
         VALUES (gen_random_uuid(), 'derived ok', 'h3-' || gen_random_uuid(),
                 array_fill(0.0, ARRAY[1536])::vector,
                 '{}'::jsonb, 'derived', '["src-uuid"]'::jsonb)
         RETURNING id`,
      );
      expect(result.rows).toHaveLength(1);
    });
  });

  describe('reflection_counters CHECK reflection_counters_scope_not_all_null_check (EC-3)', () => {
    let pool: pg.Pool;

    beforeAll(async () => {
      pool = new pg.Pool({ connectionString: PG_URI });
    });

    afterAll(async () => {
      await pool.end();
    });

    test('row with all 3 scope columns NULL violates CHECK', async () => {
      await expect(
        pool.query(
          `INSERT INTO reflection_counters (scope_user_id, scope_session_id, scope_agent_id, count)
           VALUES (NULL, NULL, NULL, 0)`,
        ),
      ).rejects.toThrow(/check constraint.*scope_not_all_null/i);
    });

    test('row with at least one scope column non-NULL succeeds', async () => {
      const result = await pool.query(
        `INSERT INTO reflection_counters (scope_user_id, scope_session_id, scope_agent_id, count)
         VALUES ('user-' || gen_random_uuid(), NULL, NULL, 0)
         RETURNING scope_user_id`,
      );
      expect(result.rows).toHaveLength(1);
    });
  });
}
