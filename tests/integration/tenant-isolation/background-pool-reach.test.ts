/**
 * Cross-workspace reach — proof that the retention sweep can still sweep, and
 * that the guard refuses the connection where it could not.
 *
 * The sibling file (`rls-enforcement.test.ts`) proves the request path is
 * confined to one workspace. This one proves the other half, which is where the
 * failure is silent: migration 0029 is fail-closed, so a sweep over a connection
 * with no cross-workspace policy does not error. It deletes zero rows, commits,
 * and the cron logs a successful run while the table grows forever.
 *
 * Measured here against a real database, with three connections over the same
 * two workspaces' rows:
 *
 *   themory (owner, FORCE RLS, no context) -> 0 rows
 *   the application role, one context      -> 1 row   (its own workspace)
 *   themory_worker                         -> 2 rows  (via a NAMED policy)
 *
 * @see packages/core/src/infrastructure/db/background-pool-reach.ts
 * @see packages/core/src/infrastructure/db/migrations/0029_rls_fail_closed.sql
 * @see packages/core/src/infrastructure/db/migrations/0030_worker_role_grants.sql
 */
import {
  assertBackgroundPoolCrossWorkspace,
  measureBackgroundReach,
  runMigrations,
} from '@usetheo/memory';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createIsolatedDb, type IsolatedDb } from '../_helpers/isolated-db.js';

/** The name is not a choice: migration 0029 looks for exactly this role. */
const WORKER_ROLE = 'themory_worker';
const WORKER_PASSWORD = 'worker-reach-test';
const APP_ROLE = 'themory_app_reach_test';
const APP_PASSWORD = 'app-reach-test';

const WS_A = 'ws-reach-a';
const WS_B = 'ws-reach-b';
const TABLE = 'recall_traces';

let db: IsolatedDb;
let workerPool: pg.Pool;
let appPool: pg.Pool;

function uriForRole(uri: string, role: string, password: string): string {
  const parsed = new URL(uri);
  parsed.username = role;
  parsed.password = password;
  return parsed.toString();
}

/** Inserts one trace row under an explicit workspace context (FORCE RLS applies to the owner too). */
async function seedTrace(workspaceId: string): Promise<void> {
  const client = await db.pool.connect();
  try {
    await client.query(`SELECT set_config('app.workspace_id', $1, false)`, [workspaceId]);
    await client.query(
      `INSERT INTO recall_traces
         (recall_id, workspace_id, scope_key, memory_id, semantic, bm25, threshold, drop_reason)
       VALUES ($1, $2, 'user:reach', 'mem-reach', 0.5, 0.5, 0.7, 'below_threshold')`,
      [`recall-${workspaceId}`, workspaceId],
    );
  } finally {
    await client.query(`SELECT set_config('app.workspace_id', '', false)`);
    client.release();
  }
}

beforeAll(async () => {
  // A FRESH database: migration 0029 only creates the worker policies when the
  // role already exists, so the role has to be there before migrations run.
  // Cloning the pre-migrated template would silently skip them.
  db = await createIsolatedDb({ fresh: true });

  for (const [role, password] of [
    [WORKER_ROLE, WORKER_PASSWORD],
    [APP_ROLE, APP_PASSWORD],
  ] as const) {
    await db.pool.query(`DROP ROLE IF EXISTS ${role}`);
    await db.pool.query(
      `CREATE ROLE ${role} LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS`,
    );
  }

  await runMigrations(db.pool);

  // The application role gets ordinary table access and NO worker policy — the
  // shape a normal deployment has.
  await db.pool.query(`GRANT USAGE ON SCHEMA public TO ${APP_ROLE}`);
  await db.pool.query(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${APP_ROLE}`,
  );

  await seedTrace(WS_A);
  await seedTrace(WS_B);

  workerPool = new pg.Pool({
    connectionString: uriForRole(db.uri, WORKER_ROLE, WORKER_PASSWORD),
    max: 2,
  });
  appPool = new pg.Pool({
    connectionString: uriForRole(db.uri, APP_ROLE, APP_PASSWORD),
    max: 2,
  });
}, 60_000);

afterAll(async () => {
  await workerPool?.end();
  await appPool?.end();
  await db?.dropDb();
  // Roles are cluster-wide, so they outlive the dropped database.
  const admin = new pg.Pool({ connectionString: process.env['THEOMEM_PG_URI'], max: 1 });
  try {
    await admin.query(`DROP ROLE IF EXISTS ${WORKER_ROLE}`);
    await admin.query(`DROP ROLE IF EXISTS ${APP_ROLE}`);
  } finally {
    await admin.end();
  }
});

describe('background pool reach', () => {
  it('the_worker_role_is_accepted_and_reaches_every_workspace', async () => {
    const reach = await assertBackgroundPoolCrossWorkspace(workerPool, TABLE);

    expect(reach.role).toBe(WORKER_ROLE);
    expect(reach.policy).toBe(`${TABLE}_worker_cross_workspace`);
    expect(reach.bypassRls).toBe(false);

    // The guard's premise, measured rather than assumed.
    const { rows } = await workerPool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM recall_traces`,
    );
    expect(rows[0]?.count).toBe('2');
  });

  it('the_application_role_is_refused_because_its_sweep_would_touch_nothing', async () => {
    // This is the case that used to pass silently: no error, no rows.
    const client = await appPool.connect();
    let scoped: string | undefined;
    let scopeless: string | undefined;
    try {
      const empty = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM recall_traces`,
      );
      scopeless = empty.rows[0]?.count;

      await client.query(`SELECT set_config('app.workspace_id', $1, false)`, [WS_A]);
      const one = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM recall_traces`,
      );
      scoped = one.rows[0]?.count;
    } finally {
      client.release();
    }

    expect(scopeless).toBe('0'); // fail-closed: no context matches nothing
    expect(scoped).toBe('1'); // and with a context, only its own workspace

    await expect(assertBackgroundPoolCrossWorkspace(appPool, TABLE)).rejects.toThrow(
      /ZERO rows/,
    );
  });

  it('the_owner_is_refused_too_because_FORCE_leaves_it_with_no_reach', async () => {
    // Unlike the engine, this package puts FORCE ROW LEVEL SECURITY on every
    // scoped table and grants the owner no maintenance policy — so the owner is
    // not a special case here, it simply has no reach either.
    const reach = await measureBackgroundReach(db.pool, TABLE);

    // The template's owner connection may be a superuser in some setups; the
    // assertion below holds in both shapes, for two different reasons.
    await expect(assertBackgroundPoolCrossWorkspace(db.pool, TABLE)).rejects.toThrow(
      reach.bypassRls ? /BYPASSRLS/ : /ZERO rows/,
    );
  });

  it('the_worker_can_actually_delete_across_workspaces', async () => {
    // Reach without privilege is a boot that passes and a first tick that
    // fails with `permission denied` — migration 0030 is what closes that gap.
    const deleted = await workerPool.query(
      `DELETE FROM recall_traces WHERE created_at <= NOW() + interval '1 second'`,
    );

    expect(deleted.rowCount).toBe(2);
  });
});
