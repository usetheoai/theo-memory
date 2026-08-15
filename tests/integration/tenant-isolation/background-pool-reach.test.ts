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
 *   themory_app, no context     -> 0 rows  (fail-closed)
 *   themory_app, one context    -> 1 row   (its own workspace)
 *   themory_worker              -> 2 rows  (via a NAMED policy)
 *
 * The setup connection is refused for a third reason, asserted below: it is the
 * role in THEOMEM_PG_URI, a superuser here, and the guard refuses reach that
 * comes from ignoring the policies rather than from being granted them.
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

const WS_A = 'ws-reach-a';
const WS_B = 'ws-reach-b';
const TABLE = 'recall_traces';

let db: IsolatedDb;
let workerPool: pg.Pool;
let appPool: pg.Pool;

/** Inserts one trace row under an explicit workspace context. */
async function seedTrace(workspaceId: string): Promise<void> {
  const client = await appPool.connect();
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
  // A FRESH database: 0029 only creates the worker policies, and 0030/0032 only
  // issue their grants, when the roles already exist. They do — global-setup
  // provisions them cluster-wide before the template is built — so running the
  // migrations here against an empty database reproduces the real sequence.
  // (The file must NOT create or drop the roles itself: they are shared with
  // every other file in the suite, and a stray DROP would cut their connections.)
  db = await createIsolatedDb({ fresh: true });

  await runMigrations(db.setupPool);

  appPool = db.pool;
  workerPool = db.crossWorkspacePool('this file exists to measure the crossing itself');

  await seedTrace(WS_A);
  await seedTrace(WS_B);
}, 60_000);

afterAll(async () => {
  await db?.dropDb();
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
    const reach = await measureBackgroundReach(db.setupPool, TABLE);

    // The setup connection is the role in THEOMEM_PG_URI, which in this repo's
    // compose is a superuser; the assertion holds in both shapes, for two
    // different reasons, so it does not encode the local environment.
    await expect(assertBackgroundPoolCrossWorkspace(db.setupPool, TABLE)).rejects.toThrow(
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
