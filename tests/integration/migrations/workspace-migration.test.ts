/**
 * T0.2 — 0016 workspaces migration (non-destructive single->multi-tenant).
 *
 * Plan multi-tenant-workspace-isolation § T0.2 / ADR D5 + EC-1/3/6/7.
 * Runs against an isolated DB cloned from the migrated template (which now
 * includes 0016), asserting the post-migration schema state:
 *   - workspaces table exists with the seeded stable-id 'default' row (EC-6);
 *   - every directly-queried table carries workspace_id NOT NULL (D-LEAF/EC-1);
 *   - a row inserted WITHOUT workspace_id backfills to 'default' (EC-3 default);
 *   - theo_api_keys -> workspaces FK exists;
 *   - the (workspace_id, scope) indexes exist.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import pg from 'pg';

import { createIsolatedDb } from '../_helpers/isolated-db.js';

const PG_URI = process.env['THEOMEM_PG_URI'];

const DATA_TABLES = [
  'memories',
  'entities',
  'history',
  'consolidation_history',
  'reflection_counters',
  'recall_cache',
] as const;

if (PG_URI === undefined || PG_URI === '') {
  describe.skip('0016 workspaces migration (THEOMEM_PG_URI not set)', () => {
    test('placeholder', () => {
      // no-op
    });
  });
} else {
  describe('0016 workspaces migration — non-destructive workspace isolation schema', () => {
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

    test('workspaces table is seeded with the stable-id default workspace (EC-6)', async () => {
      const { rows } = await pool.query<{ id: string; name: string }>(
        `SELECT id, name FROM workspaces WHERE id = 'default'`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.id).toBe('default');
    });

    test('every directly-queried table carries workspace_id NOT NULL (D-LEAF / EC-1)', async () => {
      for (const table of DATA_TABLES) {
        const { rows } = await pool.query<{ is_nullable: string }>(
          `SELECT is_nullable FROM information_schema.columns
            WHERE table_name = $1 AND column_name = 'workspace_id'`,
          [table],
        );
        expect(rows, `${table}.workspace_id must exist`).toHaveLength(1);
        expect(rows[0]?.is_nullable, `${table}.workspace_id must be NOT NULL`).toBe('NO');
      }
    });

    test('a memories row inserted WITHOUT workspace_id backfills to default (EC-3 column default)', async () => {
      const insert = await pool.query<{ workspace_id: string }>(
        `INSERT INTO memories (text, hash, embedding, payload, user_id)
         VALUES ('legacy fact', 'h-ws-0016-legacy', $1::vector, '{}'::jsonb, 'alice')
         RETURNING workspace_id`,
        [`[${Array.from({ length: 1536 }, () => 0).join(',')}]`],
      );
      expect(insert.rows[0]?.workspace_id).toBe('default');
    });

    test('theo_api_keys carries a workspace_id FK to workspaces', async () => {
      const { rows } = await pool.query<{ constraint_name: string }>(
        `SELECT tc.constraint_name
           FROM information_schema.table_constraints tc
           JOIN information_schema.constraint_column_usage ccu
             ON tc.constraint_name = ccu.constraint_name
          WHERE tc.table_name = 'theo_api_keys'
            AND tc.constraint_type = 'FOREIGN KEY'
            AND ccu.table_name = 'workspaces'`,
      );
      expect(rows.length).toBeGreaterThanOrEqual(1);
    });

    test('the (workspace_id, scope) hot-path indexes exist', async () => {
      const { rows } = await pool.query<{ indexname: string }>(
        `SELECT indexname FROM pg_indexes
          WHERE tablename = 'memories' AND indexname LIKE 'memories_workspace_%'`,
      );
      expect(rows.length).toBeGreaterThanOrEqual(3);
    });
  });
}
