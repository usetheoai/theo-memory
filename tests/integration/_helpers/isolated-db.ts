/**
 * Per-file isolated database — and the role each pool authenticates as.
 *
 * `createIsolatedDb()` clones the migrated template database (built once in
 * `global-setup.ts`) into a uniquely-named database via `CREATE DATABASE …
 * TEMPLATE`, a millisecond byte-clone. Each test file owns its database, which
 * is what removes the cross-file schema-state pollution that used to make
 * shared-DB tests fail in the full suite while passing in isolation.
 *
 * WHAT CHANGED, AND WHY IT MATTERS MORE THAN THE CLONING (#196).
 *
 * This helper used to return ONE pool, authenticated as the role in
 * `THEOMEM_PG_URI` — which in this repository's compose is a SUPERUSER. A
 * superuser ignores row level security completely: `FORCE ROW LEVEL SECURITY`
 * does not apply to it, `WITH CHECK` refuses nothing, and a cross-workspace
 * leak produces no error. Every isolation assertion made over that pool
 * measured a control that was switched off.
 *
 * That is not a hypothetical. It is the exact failure this line of work found
 * in the engine and then reproduced here: the protection was installed, the
 * suite was green, and both of those were compatible with the isolation not
 * existing.
 *
 * So the default is now the CONTAINED role, and a test that needs to cross
 * workspaces has to say so by name. Three pools, three different jobs:
 *
 *   `pool`                 `themory_app`     subject to the policies — THE DEFAULT
 *   `crossWorkspacePool()` `themory_worker`  crosses by NAMED policy, on request
 *   `setupPool`            THEOMEM_PG_URI    DDL, truncate, fixtures — bypasses RLS
 *
 * `setupPool` is honestly named: it is not "the owner", it is whatever role the
 * environment points at, and here that role is a superuser. Never assert
 * isolation over it — an assertion that passes there proves nothing.
 *
 * @see ../global-setup.ts — provisions the two roles before the template is migrated
 * @see ../../../packages/core/src/infrastructure/db/migrations/0032_app_role_grants.sql
 * @see ../../../packages/core/src/infrastructure/db/migrations/0030_worker_role_grants.sql
 */
import pg from 'pg';

import { runMigrations } from '@usetheo/memory';

import {
  APP_PASSWORD,
  APP_ROLE,
  TEMPLATE_DB,
  WORKER_PASSWORD,
  WORKER_ROLE,
  siblingUri,
} from '../global-setup.js';

export interface IsolatedDb {
  /**
   * The contained pool: authenticates as `themory_app`, `NOSUPERUSER
   * NOBYPASSRLS`. Reads and writes are governed by the policies, so a statement
   * with no `app.workspace_id` sees nothing and a write for another workspace
   * is refused. This is what a request path looks like in production, and it is
   * the pool an isolation assertion has to run over to mean anything.
   */
  readonly pool: pg.Pool;
  /**
   * The contained role, with `app.workspace_id` already pinned on every
   * connection — the shape a request path actually has, minus the plumbing.
   *
   * Most files predate workspaces entirely: they hand a bare pool to a store
   * and let the writes land in `default`. Pinning gives them the production
   * posture without rewriting each one to thread a scope, and the policy stays
   * live underneath — a row written to the wrong workspace is still refused.
   *
   * The context travels in the connection string (`options=-c app.workspace_id=…`),
   * not in a post-connect hook, so there is no window in which a connection is
   * handed out unscoped.
   */
  readonly poolPinnedTo: (workspaceId: string) => pg.Pool;
  /**
   * A pool that crosses every workspace, by the NAMED policy `*_worker_cross_workspace`
   * rather than by bypassing anything. Use it for a fixture that legitimately
   * seeds or inspects more than one workspace — and pass the reason, which is
   * there to make the crossing visible in review rather than incidental.
   *
   * Reaching for this because a test failed under `pool` is the thing to be
   * suspicious of: the failure may be the policy doing its job.
   */
  readonly crossWorkspacePool: (reason: string) => pg.Pool;
  /**
   * DDL, `TRUNCATE`, `runMigrations`, and the two tables the application role
   * deliberately has no grant on (`admin_config`). Authenticates as the role in
   * `THEOMEM_PG_URI`, which in this repo's compose is a SUPERUSER and therefore
   * bypasses RLS entirely.
   */
  readonly setupPool: pg.Pool;
  /**
   * Connection string for the CONTAINED role — what a spawned service should
   * receive as `THEOMEM_PG_URI`. The boot guard refuses a superuser, so handing
   * a CLI `setupUri` is a boot failure, not a shortcut.
   */
  readonly uri: string;
  /** Connection string for the setup role — migrations (`THEOMEM_MIGRATE_PG_URI`). */
  readonly setupUri: string;
  /** Close every pool and DROP the cloned database. Call in `afterAll`. */
  readonly dropDb: () => Promise<void>;
}

let counter = 0;

function uniqueDbName(): string {
  counter += 1;
  // Test-helper context (not a workflow script): Date.now is available and
  // combined with pid + a monotonic counter for collision-free names.
  return `themem_it_${String(process.pid)}_${String(Date.now())}_${String(counter)}`;
}

/** Swap the credentials of a connection string, keeping host/port/database. */
function uriAsRole(uri: string, role: string, password: string): string {
  const parsed = new URL(uri);
  parsed.username = role;
  parsed.password = password;
  return parsed.toString();
}

/**
 * Create an isolated database and return the pools plus a teardown closure. By
 * default the database is cloned from the migrated template (`themem_template`).
 * Pass `fresh: true` for an EMPTY database (cloned from `template0`) — useful
 * for tests that exercise `runMigrations`/`themory migrate` from a blank slate.
 *
 * On a `fresh` database the roles exist (they are cluster-wide) but hold no
 * grants until the migrations run, because 0030/0032 issue them. That is the
 * real production sequence, so it is the one the harness reproduces.
 */
export async function createIsolatedDb(opts?: {
  embeddingDim?: number;
  fresh?: boolean;
}): Promise<IsolatedDb> {
  const rootUri = process.env['THEOMEM_PG_URI'];
  if (rootUri === undefined || rootUri === '') {
    throw new Error('createIsolatedDb: THEOMEM_PG_URI is not set');
  }
  const adminUri = siblingUri(rootUri, 'postgres');
  const dbName = uniqueDbName();
  const sourceTemplate = opts?.fresh === true ? 'template0' : TEMPLATE_DB;

  // Clone the source template (ms-level byte clone). themem_template MUST have
  // no open connections — global-setup closes its builder pool before tests run.
  const adminPool = new pg.Pool({ connectionString: adminUri, max: 1 });
  try {
    await adminPool.query(`CREATE DATABASE ${dbName} TEMPLATE ${sourceTemplate}`);
  } finally {
    await adminPool.end();
  }

  const setupUri = siblingUri(rootUri, dbName);
  const uri = uriAsRole(setupUri, APP_ROLE, APP_PASSWORD);

  const setupPool = new pg.Pool({ connectionString: setupUri });

  if (opts?.embeddingDim !== undefined) {
    // Migrations are DDL and belong to the setup role — the application role
    // deliberately has none. Running them over `pool` fails with
    // `must be owner of index …`, which is the guard working, not a bug.
    await runMigrations(setupPool, { embeddingDim: opts.embeddingDim });
  }

  const pool = new pg.Pool({ connectionString: uri });

  // Both extra pools are built on demand and memoised: a file that never pins
  // and never crosses opens neither, which matters on a container that is also
  // running the rest of the suite.
  const pinned = new Map<string, pg.Pool>();
  const poolPinnedTo = (workspaceId: string): pg.Pool => {
    if (workspaceId.trim() === '') {
      throw new Error('poolPinnedTo(workspaceId): the empty context matches nothing by design');
    }
    // The context travels inside a `-c key=value` string, so a space or a quote
    // would be swallowed by the connection-option parser and the connection
    // would come up scoped to something OTHER than what was asked for — silently.
    if (!/^[A-Za-z0-9_.:-]+$/.test(workspaceId)) {
      throw new Error(
        `poolPinnedTo(${workspaceId}): only [A-Za-z0-9_.:-] survive the connection-option ` +
          'parser intact; a mangled context is worse than a refused one',
      );
    }
    let p = pinned.get(workspaceId);
    if (p === undefined) {
      const pinnedUri = new URL(uri);
      pinnedUri.searchParams.set('options', `-c app.workspace_id=${workspaceId}`);
      p = new pg.Pool({ connectionString: pinnedUri.toString() });
      pinned.set(workspaceId, p);
    }
    return p;
  };

  let crossPool: pg.Pool | undefined;
  const crossWorkspacePool = (reason: string): pg.Pool => {
    if (reason.trim() === '') {
      throw new Error(
        'crossWorkspacePool(reason): pass why this fixture legitimately spans workspaces — ' +
          'the reason is the point, it is what makes the crossing reviewable',
      );
    }
    crossPool ??= new pg.Pool({
      connectionString: uriAsRole(setupUri, WORKER_ROLE, WORKER_PASSWORD),
    });
    return crossPool;
  };

  const dropDb = async (): Promise<void> => {
    await Promise.all([
      pool.end().catch(() => undefined),
      setupPool.end().catch(() => undefined),
      crossPool?.end().catch(() => undefined) ?? Promise.resolve(),
      ...[...pinned.values()].map((p) => p.end().catch(() => undefined)),
    ]);
    const drop = new pg.Pool({ connectionString: adminUri, max: 1 });
    try {
      await drop.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    } finally {
      await drop.end();
    }
  };

  return { pool, poolPinnedTo, crossWorkspacePool, setupPool, uri, setupUri, dropDb };
}
