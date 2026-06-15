/**
 * Per-file isolated-database helper (integration-suite-stabilization T0.1 / ADR D1).
 *
 * `createIsolatedDb()` clones the migrated template database (built once in
 * `global-setup.ts`) into a uniquely-named database via `CREATE DATABASE …
 * TEMPLATE`, which is a millisecond byte-clone — no migration replay. Each test
 * file owns its database, eliminating the cross-file schema-state pollution that
 * made shared-DB tests fail in the full suite while passing in isolation.
 *
 * When `embeddingDim` is supplied, the freshly-cloned database is re-migrated to
 * that dimension via the public `runMigrations(pool, { embeddingDim })` path
 * (e.g. 384 for the local transformer embedder).
 *
 * @see .claude/knowledge-base/plans/integration-suite-stabilization-plan.md § T0.1
 */
import pg from 'pg';

import { runMigrations } from '@usetheo/memory';

import { TEMPLATE_DB, siblingUri } from '../global-setup.js';

export interface IsolatedDb {
  /** Connection pool bound to the isolated database. */
  readonly pool: pg.Pool;
  /** Connection string of the isolated database (e.g. to pass to a spawned CLI via `THEOMEM_PG_URI`). */
  readonly uri: string;
  /** Close the pool and DROP the cloned database. Call in `afterAll`. */
  readonly dropDb: () => Promise<void>;
}

let counter = 0;

function uniqueDbName(): string {
  counter += 1;
  // Test-helper context (not a workflow script): Date.now is available and
  // combined with pid + a monotonic counter for collision-free names.
  return `themem_it_${String(process.pid)}_${String(Date.now())}_${String(counter)}`;
}

/**
 * Create an isolated database and return a pool bound to it plus a teardown
 * closure. By default the database is cloned from the migrated template
 * (`themem_template`). Pass `fresh: true` for an EMPTY database (cloned from
 * `template0`) — useful for tests that exercise `runMigrations`/`themory migrate`
 * from a blank slate.
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

  const uri = siblingUri(rootUri, dbName);
  const pool = new pg.Pool({ connectionString: uri });

  if (opts?.embeddingDim !== undefined) {
    await runMigrations(pool, { embeddingDim: opts.embeddingDim });
  }

  const dropDb = async (): Promise<void> => {
    await pool.end();
    const drop = new pg.Pool({ connectionString: adminUri, max: 1 });
    try {
      await drop.query(`DROP DATABASE IF EXISTS ${dbName}`);
    } finally {
      await drop.end();
    }
  };

  return { pool, uri, dropDb };
}
