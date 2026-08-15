/**
 * Tests for the per-file isolated-database helper
 * (integration-suite-stabilization T0.1).
 *
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

/**
 * The contract of #196: what each pool can reach.
 *
 * These are the tests that keep the default honest. If `pool` ever goes back to
 * authenticating as a superuser, every isolation assertion in the suite silently
 * stops measuring anything — and only this file would notice.
 */
describe.skipIf(PG_URI === '')('createIsolatedDb — the role behind each pool (#196)', () => {
  it('the default pool is subject to the policies, and the setup pool is not', async () => {
    const db = await createIsolatedDb();
    try {
      const posture = async (p: pg.Pool) =>
        (
          await p.query<{ role: string; superuser: boolean; bypass: boolean }>(
            `SELECT current_user AS role,
                    COALESCE((SELECT rolsuper FROM pg_roles WHERE rolname = current_user), false) AS superuser,
                    COALESCE((SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user), false) AS bypass`,
          )
        ).rows[0];

      const app = await posture(db.pool);
      expect(app?.role).toBe('themory_app');
      expect(app?.superuser, 'a superuser default would make every isolation test vacuous').toBe(
        false,
      );
      expect(app?.bypass).toBe(false);

      // Not an aspiration about the environment — a statement of what the setup
      // pool IS, so nobody mistakes it for a place to assert isolation.
      const setup = await posture(db.setupPool);
      expect(setup?.superuser || setup?.bypass).toBe(true);
    } finally {
      await db.dropDb();
    }
  }, 30_000);

  it('the default pool reads only its own workspace; the crossing pool reads both', async () => {
    const db = await createIsolatedDb();
    try {
      const seed = db.crossWorkspacePool('seeds two workspaces to prove the default sees one');
      for (const ws of ['ws-iso-a', 'ws-iso-b']) {
        await seed.query(`INSERT INTO workspaces (id, name) VALUES ($1, $1)`, [ws]);
        await seed.query(
          `INSERT INTO routing_policies (workspace_id, user_id) VALUES ($1, 'u-iso')`,
          [ws],
        );
      }

      const scoped = await db.pool.connect();
      let seenScoped: string | undefined;
      let seenUnscoped: string | undefined;
      try {
        const bare = await scoped.query<{ c: string }>(
          `SELECT count(*)::text AS c FROM routing_policies`,
        );
        seenUnscoped = bare.rows[0]?.c;

        await scoped.query(`SELECT set_config('app.workspace_id', 'ws-iso-a', false)`);
        const withCtx = await scoped.query<{ c: string }>(
          `SELECT count(*)::text AS c FROM routing_policies`,
        );
        seenScoped = withCtx.rows[0]?.c;
      } finally {
        scoped.release();
      }

      const crossed = await seed.query<{ c: string }>(
        `SELECT count(*)::text AS c FROM routing_policies`,
      );

      expect(seenUnscoped, 'no context must match nothing, not everything').toBe('0');
      expect(seenScoped, 'with a context, exactly that workspace').toBe('1');
      expect(crossed.rows[0]?.c, 'the named crossing policy reaches both').toBe('2');
    } finally {
      await db.dropDb();
    }
  }, 30_000);

  it('the default pool cannot write into another workspace', async () => {
    const db = await createIsolatedDb();
    try {
      const seed = db.crossWorkspacePool('creates the two workspace rows the write targets');
      for (const ws of ['ws-w-a', 'ws-w-b']) {
        await seed.query(`INSERT INTO workspaces (id, name) VALUES ($1, $1)`, [ws]);
      }

      const c = await db.pool.connect();
      try {
        await c.query(`SELECT set_config('app.workspace_id', 'ws-w-a', false)`);
        await expect(
          c.query(`INSERT INTO routing_policies (workspace_id, user_id) VALUES ('ws-w-b', 'u')`),
        ).rejects.toThrow(/row-level security/i);
      } finally {
        c.release();
      }
    } finally {
      await db.dropDb();
    }
  }, 30_000);

  it('poolPinnedTo refuses a context the connection-option parser would mangle', async () => {
    const db = await createIsolatedDb();
    try {
      // Um espaço aqui produziria uma conexão fixada em OUTRA coisa, em silêncio.
      expect(() => db.poolPinnedTo('ws com espaço')).toThrow(/parser/i);
      expect(() => db.poolPinnedTo('')).toThrow(/empty context/i);
    } finally {
      await db.dropDb();
    }
  }, 30_000);

  it('crossWorkspacePool refuses an empty reason', async () => {
    const db = await createIsolatedDb();
    try {
      expect(() => db.crossWorkspacePool('   ')).toThrow(/reason/i);
    } finally {
      await db.dropDb();
    }
  }, 30_000);
});
