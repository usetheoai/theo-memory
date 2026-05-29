/**
 * T0.2 INTEGRATION RED — EC-10 absorption: migration ordering test.
 *
 * Verifies that applying 0001_reflection_columns.sql AFTER seeding 100 v0.1
 * memories correctly backfills kind='extracted' DEFAULT for all rows WITHOUT
 * triggering the CHECK constraint violation during ALTER TABLE.
 *
 * Sequence (mandatory per plan EC-10):
 *   1. Spin pgvector container (uses THEOMEM_PG_URI)
 *   2. Apply ONLY 0000_crazy_mimic.sql (v0.1 schema)
 *   3. INSERT 100 rows with v0.1 columns (no kind/derived_from/llm_importance_score)
 *   4. Apply 0001_reflection_columns.sql
 *   5. Assert all 100 rows have kind='extracted' AND no CHECK violation
 *
 * Per plan v0-4a-reflection-pipeline § T0.2 + EC-10.
 * Env-gated skip pattern matches tests/integration/pgvector-store.test.ts.
 *
 * @see .claude/knowledge-base/plans/v0-4a-reflection-pipeline-plan.md § T0.2
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';

const PG_URI = process.env['THEOMEM_PG_URI'];

if (PG_URI === undefined || PG_URI === '') {
  describe.skip('0001 migration ordering (THEOMEM_PG_URI not set)', () => {
    test('placeholder', () => {
      // no-op
    });
  });
} else {
  describe('0001_reflection_columns.sql ordering against v0.1-seeded DB (EC-10)', () => {
    let pool: pg.Pool;

    beforeAll(async () => {
      pool = new pg.Pool({ connectionString: PG_URI });
    });

    afterAll(async () => {
      await pool.end();
    });

    test('backfills kind=extracted for v0.1 rows without CHECK violation', async () => {
      // Step 1: drop all tables (simulate fresh container)
      await pool.query(`
        DROP TABLE IF EXISTS history CASCADE;
        DROP TABLE IF EXISTS reflection_counters CASCADE;
        DROP TABLE IF EXISTS memories CASCADE;
        DROP TABLE IF EXISTS entities CASCADE;
        DROP TABLE IF EXISTS drizzle.__drizzle_migrations CASCADE;
      `);

      // Step 2: apply 0000 only
      const v01Sql = readFileSync(
        resolve(process.cwd(), 'src/local/migrations/0000_crazy_mimic.sql'),
        'utf8',
      );
      // Split on Drizzle's statement-breakpoint comment; apply each statement.
      const statements = v01Sql.split('--> statement-breakpoint').map((s) => s.trim()).filter(Boolean);
      for (const stmt of statements) {
        await pool.query(stmt);
      }

      // Step 3: seed 100 v0.1 memories (no kind/derived_from/llm_importance_score)
      for (let i = 0; i < 100; i++) {
        await pool.query(
          `INSERT INTO memories (id, text, hash, embedding, payload)
           VALUES (gen_random_uuid(), $1, $2, array_fill(0.0, ARRAY[1536])::vector, '{}'::jsonb)`,
          [`v0.1 row ${i}`, `hash-${i}-${Math.random()}`],
        );
      }

      // Step 4: apply 0001_reflection_columns.sql
      const v04aSql = readFileSync(
        resolve(process.cwd(), 'src/local/migrations/0001_reflection_columns.sql'),
        'utf8',
      );
      const v04aStatements = v04aSql.split('--> statement-breakpoint').map((s) => s.trim()).filter(Boolean);
      for (const stmt of v04aStatements) {
        await pool.query(stmt);
      }

      // Step 5: assert all 100 rows have kind='extracted'
      const countResult = await pool.query(
        `SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE kind = 'extracted') AS extracted
         FROM memories`,
      );
      expect(countResult.rows[0].total).toBe('100');
      expect(countResult.rows[0].extracted).toBe('100');
    });
  });
}
