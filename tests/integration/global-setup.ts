/**
 * Global setup for integration tests.
 *
 * Builds a fully-migrated TEMPLATE database (`themem_template`) once before any
 * test file runs, so per-file isolated databases can be cloned from it in
 * milliseconds via `CREATE DATABASE … TEMPLATE` (see `_helpers/isolated-db.ts`).
 * Template-clone avoids re-running the 15 migrations once per file and removes
 * all cross-file schema-state pollution (integration-suite-stabilization T0.1).
 *
 * The shared database named in `THEOMEM_PG_URI` is ALSO migrated here, for
 * legacy test files that have not yet moved onto per-file isolation. New
 * DB-touching tests SHOULD use `createIsolatedDb()` instead of the shared DB.
 *
 * When `THEOMEM_PG_URI` is unset, setup is a no-op and tests skip via
 * `describe.skipIf`.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

const MIGRATIONS_DIR = join(
  import.meta.dirname ?? new URL('.', import.meta.url).pathname,
  '..', '..', 'packages', 'core', 'src', 'infrastructure', 'db', 'migrations',
);

/** Name of the migrated template database cloned by `createIsolatedDb()`. */
export const TEMPLATE_DB = 'themem_template';

/** Derive the admin (`/postgres`) URI from a database URI. */
function adminUriFrom(uri: string): string {
  return uri.replace(/\/[^/]*$/, '/postgres');
}

/** Derive a sibling-database URI (same host/creds, different db name). */
export function siblingUri(uri: string, dbName: string): string {
  return uri.replace(/\/[^/]*$/, `/${dbName}`);
}

/** Apply every migration SQL file (idempotently) to the database `pool` targets. */
async function applyMigrations(pool: pg.Pool): Promise<void> {
  await pool.query('CREATE EXTENSION IF NOT EXISTS vector');
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
    const statements = sql
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    for (const stmt of statements) {
      try {
        await pool.query(stmt);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (
          msg.includes('already exists') ||
          msg.includes('duplicate key') ||
          msg.includes('multiple primary keys')
        ) {
          continue;
        }
        throw err;
      }
    }
  }
}

/** DROP + CREATE a database via an admin connection to `/postgres`. */
async function recreateDatabase(adminUri: string, dbName: string): Promise<void> {
  const adminPool = new pg.Pool({ connectionString: adminUri, max: 1 });
  try {
    await adminPool.query(`DROP DATABASE IF EXISTS ${dbName}`);
    await adminPool.query(`CREATE DATABASE ${dbName}`);
  } finally {
    await adminPool.end();
  }
}

export async function setup(): Promise<void> {
  const uri = process.env['THEOMEM_PG_URI'];
  if (!uri) return; // Tests will skip via describe.skipIf

  const adminUri = adminUriFrom(uri);

  // 1. Build the migrated TEMPLATE database. Must have ZERO open connections
  //    when a test later clones it (CREATE DATABASE … TEMPLATE requirement),
  //    so the builder pool is closed before this function returns.
  await recreateDatabase(adminUri, TEMPLATE_DB);
  const templatePool = new pg.Pool({ connectionString: siblingUri(uri, TEMPLATE_DB), max: 2 });
  try {
    await applyMigrations(templatePool);
  } finally {
    await templatePool.end();
  }

  // 2. Legacy: migrate the shared DB named in THEOMEM_PG_URI for test files
  //    that have not yet moved onto per-file isolation.
  const sharedPool = new pg.Pool({ connectionString: uri, max: 2 });
  try {
    await applyMigrations(sharedPool);
  } finally {
    await sharedPool.end();
  }
}
