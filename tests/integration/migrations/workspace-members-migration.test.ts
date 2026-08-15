/**
 * T0.2 — 0017 workspace_members migration (RBAC, Slice 2).
 *
 * Plan multi-tenant-rbac-and-slice1-completion § T0.2 / ADR D1/D2/D3.
 * Runs against an isolated DB cloned from the migrated template (which now
 * includes 0017), asserting the post-migration schema state:
 *   - users table seeded with the stable 'default-owner' row;
 *   - workspace_users seeded with ('default','default-owner','owner');
 *   - the role CHECK enum rejects an out-of-enum role;
 *   - theo_api_keys.user_id exists, is nullable, and FK-references users;
 *   - a key whose user_id is NULL can be set to 'default-owner' (backfill shape).
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import pg from 'pg';

import { createIsolatedDb } from '../_helpers/isolated-db.js';

const PG_URI = process.env['THEOMEM_PG_URI'];

if (PG_URI === undefined || PG_URI === '') {
  describe.skip('0017 workspace_members migration (THEOMEM_PG_URI not set)', () => {
    test('placeholder', () => {
      /* no-op */
    });
  });
} else {
  describe('0017 workspace_members migration — RBAC schema', () => {
    let pool: pg.Pool;
    let dropDb: () => Promise<void>;

    beforeAll(async () => {
      const iso = await createIsolatedDb();
      pool = iso.setupPool;
      dropDb = iso.dropDb;
    }, 30_000);

    afterAll(async () => {
      await dropDb();
    });

    test('users table is seeded with the stable default-owner row', async () => {
      const { rows } = await pool.query<{ id: string; email: string }>(
        `SELECT id, email FROM users WHERE id = 'default-owner'`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.email).toBe('owner@default.local');
    });

    test('workspace_users is seeded with default-owner as owner of the default workspace', async () => {
      const { rows } = await pool.query<{ role: string }>(
        `SELECT role FROM workspace_users WHERE workspace_id = 'default' AND user_id = 'default-owner'`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.role).toBe('owner');
    });

    test('the role CHECK enum rejects an out-of-enum role', async () => {
      // Given a member user, an INSERT with role='superuser' violates the CHECK.
      await pool.query(
        `INSERT INTO users (id, email) VALUES ('u-check', 'check@x.local') ON CONFLICT (id) DO NOTHING`,
      );
      await expect(
        pool.query(
          `INSERT INTO workspace_users (workspace_id, user_id, role) VALUES ('default', 'u-check', 'superuser')`,
        ),
      ).rejects.toThrow(/workspace_users_role_check|check constraint/i);
    });

    test('theo_api_keys.user_id exists and is nullable', async () => {
      const { rows } = await pool.query<{ is_nullable: string }>(
        `SELECT is_nullable FROM information_schema.columns
          WHERE table_name = 'theo_api_keys' AND column_name = 'user_id'`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.is_nullable).toBe('YES');
    });

    test('theo_api_keys.user_id FK references users (membership binding)', async () => {
      const { rows } = await pool.query<{ constraint_name: string }>(
        `SELECT constraint_name FROM information_schema.table_constraints
          WHERE table_name = 'theo_api_keys' AND constraint_name = 'theo_api_keys_user_id_users_id_fk'`,
      );
      expect(rows).toHaveLength(1);
    });

    test('a NULL-user key can be bound to default-owner (backfill shape)', async () => {
      // A legacy key with NULL user_id; the 0017 backfill UPDATEs exactly this shape.
      await pool.query(
        `INSERT INTO theo_api_keys (id, subject, key_name, key_hash, key_prefix, scopes)
         VALUES ('apk-legacy', 'legacy', 'legacy', 'hashlegacy', 'theo_live_xx', '["memory:read"]'::jsonb)`,
      );
      await pool.query(
        `UPDATE theo_api_keys SET user_id = 'default-owner' WHERE user_id IS NULL`,
      );
      const { rows } = await pool.query<{ user_id: string }>(
        `SELECT user_id FROM theo_api_keys WHERE id = 'apk-legacy'`,
      );
      expect(rows[0]?.user_id).toBe('default-owner');
    });
  });
}
