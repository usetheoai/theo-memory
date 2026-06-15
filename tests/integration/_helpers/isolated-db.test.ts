/**
 * Tests for the per-file isolated-database helper
 * (integration-suite-stabilization T0.1).
 *
 * @see .claude/knowledge-base/plans/integration-suite-stabilization-plan.md § T0.1
 */
import { afterAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import { createIsolatedDb } from './isolated-db.js';
import { siblingUri } from '../global-setup.js';

const PG_URI = process.env['THEOMEM_PG_URI'] ?? '';

describe.skipIf(PG_URI === '')('createIsolatedDb (T0.1)', () => {
  const pools: pg.Pool[] = [];

  afterAll(async () => {
    await Promise.all(pools.map((p) => p.end().catch(() => undefined)));
  });

  it('clones a fully-migrated database with the late tables present', async () => {
    const { pool, dropDb } = await createIsolatedDb();
    try {
      const { rows } = await pool.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables
          WHERE table_schema = 'public'
            AND table_name IN ('memories','entities','consolidation_history','reflection_counters')
          ORDER BY table_name`,
      );
      const names = rows.map((r) => r.table_name);
      expect(names).toContain('memories');
      expect(names).toContain('entities');
      expect(names).toContain('consolidation_history');
      expect(names).toContain('reflection_counters');
    } finally {
      await dropDb();
    }
  });

  it('honors embeddingDim: the cloned DB is re-migrated to vector(384)', async () => {
    const { pool, dropDb } = await createIsolatedDb({ embeddingDim: 384 });
    try {
      const { rows } = await pool.query<{ atttypmod: number }>(
        `SELECT a.atttypmod FROM pg_attribute a
           JOIN pg_class c ON c.oid = a.attrelid
          WHERE c.relname = 'memories' AND a.attname = 'embedding'
            AND a.attisdropped = false`,
      );
      expect(rows[0]?.atttypmod).toBe(384);
    } finally {
      await dropDb();
    }
  });

  it('dropDb() removes the specific cloned database', async () => {
    const { uri, dropDb } = await createIsolatedDb();
    const dbName = (uri.split('/').pop() ?? '').split('?')[0] ?? '';
    expect(dbName).toMatch(/^themem_it_/);
    await dropDb();

    const admin = new pg.Pool({ connectionString: siblingUri(PG_URI, 'postgres'), max: 1 });
    pools.push(admin);
    const { rows } = await admin.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM pg_database WHERE datname = $1`,
      [dbName],
    );
    // Assert THIS test's specific DB is gone (not a global themem_it_* count,
    // which would be polluted by other files' in-flight isolated DBs).
    expect(Number(rows[0]?.count ?? '0')).toBe(0);
  });
});
