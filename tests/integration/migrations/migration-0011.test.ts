/**
 * T0.1 of principles-alignment-hardening plan v1.1 — integration test for
 * migration 0011 (confirmation_count column + composite UNIQUE per ADR D5).
 *
 * Verifies:
 *  - (a) runMigrations() applies migration 0011 on a fresh DB.
 *  - (b) confirmation_count column exists with DEFAULT 1 (EC-4 honest floor).
 *  - (c) v0.1 global UNIQUE memories_hash_unique_idx is DROPPED.
 *  - (d) composite UNIQUE memories_hash_scope_unique_idx is CREATED with the
 *        4-key shape (hash, COALESCE(user_id,''), COALESCE(session_id,''),
 *        COALESCE(agent_id,'')) per ADR D5.
 *  - (e) idempotent re-run is a no-op.
 *  - (f) EC-1 absorption — cross-scope same-hash writes succeed: alice and bob
 *        each get an independent row when they assert the same fact text.
 *  - (g) EC-4 absorption — backfill rows have confirmation_count = 1 (honest
 *        floor, not fabricated history).
 *
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

const ROOT_PG_URI = process.env['THEOMEM_PG_URI'] ?? '';
const TEST_DB = 'themem_t0_1_migration_0011';

describe.skipIf(ROOT_PG_URI === '')(
  'principles-alignment-hardening T0.1 — migration 0011 (ADR D5 + EC-1 + EC-4)',
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

    it('runMigrations() applies migration 0011: confirmation_count + composite UNIQUE', async () => {
      const pool = new pg.Pool({ connectionString: testUri });
      try {
        const m = await import('@usetheo/memory');

        // (a) Fresh DB → all migrations including 0011 land.
        await m.runMigrations(pool);

        // (b) confirmation_count column exists with INTEGER + NOT NULL + DEFAULT 1.
        const columnInfo = await pool.query<{
          data_type: string;
          is_nullable: string;
          column_default: string | null;
        }>(
          `SELECT data_type, is_nullable, column_default
             FROM information_schema.columns
            WHERE table_name = 'memories' AND column_name = 'confirmation_count'`,
        );
        expect(columnInfo.rows[0]?.data_type).toBe('integer');
        expect(columnInfo.rows[0]?.is_nullable).toBe('NO');
        expect(columnInfo.rows[0]?.column_default).toContain('1');

        // (c) v0.1 global UNIQUE is GONE.
        const oldIdx = await pool.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM pg_indexes
            WHERE schemaname = 'public'
              AND tablename = 'memories'
              AND indexname = 'memories_hash_unique_idx'`,
        );
        expect(oldIdx.rows[0]?.count).toBe('0');

        // (d) Composite UNIQUE memories_hash_scope_unique_idx is CREATED.
        const newIdx = await pool.query<{ indexdef: string }>(
          `SELECT indexdef FROM pg_indexes
            WHERE schemaname = 'public'
              AND tablename = 'memories'
              AND indexname = 'memories_hash_scope_unique_idx'`,
        );
        expect(newIdx.rows[0]?.indexdef).toBeDefined();
        const idxDef = newIdx.rows[0]?.indexdef ?? '';
        expect(idxDef).toContain('UNIQUE');
        expect(idxDef).toContain('hash');
        expect(idxDef).toContain('user_id');
        expect(idxDef).toContain('session_id');
        expect(idxDef).toContain('agent_id');
      } finally {
        await pool.end();
      }
    }, 60_000);

    it('runMigrations() is idempotent — re-running 0011 is a no-op', async () => {
      const pool = new pg.Pool({ connectionString: testUri });
      try {
        const m = await import('@usetheo/memory');
        await expect(m.runMigrations(pool)).resolves.toBeUndefined();

        // confirmation_count still exists; composite UNIQUE still present.
        const result = await pool.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM information_schema.columns
            WHERE table_name = 'memories' AND column_name = 'confirmation_count'`,
        );
        expect(result.rows[0]?.count).toBe('1');
      } finally {
        await pool.end();
      }
    }, 30_000);

    it('EC-1 absorption — cross-scope same-hash writes succeed independently', async () => {
      const pool = new pg.Pool({ connectionString: testUri });
      try {
        // Reset the table to start clean for the scope-isolation assertion.
        await pool.query('TRUNCATE memories CASCADE');

        const sharedHash = 'd41d8cd98f00b204e9800998ecf8427e'; // arbitrary 32-char hex
        const vec1536 = `[${Array(1536).fill(0).join(',')}]`;

        // Raw INSERT bypassing the pipeline — exercises the constraint directly.
        await pool.query(
          `INSERT INTO memories (text, hash, embedding, payload, user_id)
           VALUES ($1, $2, $3::vector, '{}'::jsonb, 'alice')`,
          ['I like coffee', sharedHash, vec1536],
        );

        await pool.query(
          `INSERT INTO memories (text, hash, embedding, payload, user_id)
           VALUES ($1, $2, $3::vector, '{}'::jsonb, 'bob')`,
          ['I like coffee', sharedHash, vec1536],
        );

        // Both rows persisted independently.
        const rows = await pool.query<{
          user_id: string;
          confirmation_count: number;
        }>(`SELECT user_id, confirmation_count FROM memories ORDER BY user_id`);
        expect(rows.rowCount).toBe(2);
        expect(rows.rows[0]?.user_id).toBe('alice');
        expect(rows.rows[1]?.user_id).toBe('bob');

        // (g) EC-4 absorption — both rows carry the DEFAULT 1 (honest floor).
        expect(rows.rows[0]?.confirmation_count).toBe(1);
        expect(rows.rows[1]?.confirmation_count).toBe(1);
      } finally {
        await pool.end();
      }
    }, 30_000);

    it('Composite UNIQUE rejects same-scope same-hash duplicate INSERT (cross-check)', async () => {
      const pool = new pg.Pool({ connectionString: testUri });
      try {
        await pool.query('TRUNCATE memories CASCADE');

        const sharedHash = '5d41402abc4b2a76b9719d911017c592'; // arbitrary 32-char hex
        const vec1536 = `[${Array(1536).fill(0).join(',')}]`;

        await pool.query(
          `INSERT INTO memories (text, hash, embedding, payload, user_id)
           VALUES ($1, $2, $3::vector, '{}'::jsonb, 'alice')`,
          ['Same fact', sharedHash, vec1536],
        );

        // Second INSERT with identical (hash, user_id, NULL, NULL) MUST fail
        // unless we use ON CONFLICT — confirms the composite constraint catches
        // same-scope duplicates (T1.1 will rewrite this path to use UPSERT).
        await expect(
          pool.query(
            `INSERT INTO memories (text, hash, embedding, payload, user_id)
             VALUES ($1, $2, $3::vector, '{}'::jsonb, 'alice')`,
            ['Same fact', sharedHash, vec1536],
          ),
        ).rejects.toThrow(/memories_hash_scope_unique_idx|duplicate key/);
      } finally {
        await pool.end();
      }
    }, 30_000);
  },
);
