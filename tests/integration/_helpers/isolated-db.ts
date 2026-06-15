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
  /** Connection pool bound to the freshly-cloned, fully-migrated database. */
  readonly pool: pg.Pool;
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
 * Create an isolated database cloned from the migrated template and return a
 * pool bound to it plus a teardown closure.
 */
export async function createIsolatedDb(opts?: { embeddingDim?: number }): Promise<IsolatedDb> {
  const rootUri = process.env['THEOMEM_PG_URI'];
  if (rootUri === undefined || rootUri === '') {
    throw new Error('createIsolatedDb: THEOMEM_PG_URI is not set');
  }
  const adminUri = siblingUri(rootUri, 'postgres');
  const dbName = uniqueDbName();

  // Clone the migrated template (ms-level byte clone). The template MUST have
  // no open connections — global-setup closes its builder pool before tests run.
  const adminPool = new pg.Pool({ connectionString: adminUri, max: 1 });
  try {
    await adminPool.query(`CREATE DATABASE ${dbName} TEMPLATE ${TEMPLATE_DB}`);
  } finally {
    await adminPool.end();
  }

  const pool = new pg.Pool({ connectionString: siblingUri(rootUri, dbName) });

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

  return { pool, dropDb };
}
