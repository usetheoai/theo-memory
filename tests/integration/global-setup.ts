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

/**
 * The three roles the suite runs as, and the whole point of provisioning them
 * HERE rather than per test file.
 *
 * Migrations 0029/0030/0032 are conditional: they create the cross-workspace
 * policies and issue the grants ONLY if the role already exists. So the roles
 * have to exist BEFORE the template is migrated — then every `CREATE DATABASE …
 * TEMPLATE` clone inherits the grants for free, and no test file pays for them.
 *
 * They are also cluster-wide, which is why a test file must NOT create or drop
 * them: files run in parallel, and one file's `DROP ROLE` would pull the floor
 * out from under another's connection.
 */
export const APP_ROLE = 'themory_app';
export const WORKER_ROLE = 'themory_worker';
/**
 * As MESMAS senhas do `dev/roles.sql`, de propósito.
 *
 * O provisionamento abaixo faz `ALTER ROLE … PASSWORD` quando o papel já existe,
 * porque a suíte precisa conseguir logar mesmo num cluster onde alguém criou o
 * papel antes. Se a senha da suíte divergisse da do compose, rodar os testes
 * trocaria a senha por baixo do `THEOMEM_PG_URI` do desenvolvedor e o próximo
 * `themory server` falharia na autenticação — um efeito colateral que ninguém
 * associaria a ter rodado a suíte.
 */
export const APP_PASSWORD = 'themory_app';
export const WORKER_PASSWORD = 'themory_worker';

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

/**
 * Create (or re-password) the two non-superuser roles, idempotently.
 *
 * `NOSUPERUSER NOBYPASSRLS` is not decoration — it is the entire property under
 * test. A role with either attribute ignores row level security completely, and
 * a suite that measures isolation over such a role measures nothing.
 */
async function provisionRoles(adminUri: string): Promise<void> {
  const admin = new pg.Pool({ connectionString: adminUri, max: 1 });
  try {
    for (const [role, password] of [
      [APP_ROLE, APP_PASSWORD],
      [WORKER_ROLE, WORKER_PASSWORD],
    ] as const) {
      // ALTER on the existing branch so the suite can log in even when the role
      // was created elsewhere (an older `dev/roles.sql`, a hand-made role). The
      // password it sets is the compose one, so the ALTER is a no-op in the
      // normal case and never breaks a developer's connection string.
      await admin.query(`
        DO $$ BEGIN
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN
            ALTER ROLE ${role} LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS;
          ELSE
            CREATE ROLE ${role} LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS;
          END IF;
        END $$;
      `);
    }
  } finally {
    await admin.end();
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

  // 0. The roles FIRST: 0029/0030/0032 only wire a role that already exists,
  //    and the template built below is what every isolated database is cloned
  //    from. Roles after migrations would produce clones with no grants.
  await provisionRoles(adminUri);

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

  // The shared DB named in THEOMEM_PG_URI is NOT migrated here. It is reset to
  // a clean clone of the template BEFORE EACH test file by the per-file setup
  // (`_helpers/reset-shared-db.ts`, wired via vitest `setupFiles`). That makes
  // every file start from an identical 1536-dim + full-schema shared DB,
  // immune to a prior file having mutated it (e.g. a CLI boot that migrates the
  // dim to 384, or a destructive test that drops tables).
}

/** Extract the database name (last path segment, sans query string) from a URI. */
export function sharedDbName(uri: string): string {
  const last = uri.split('/').pop() ?? 'themem';
  return last.split('?')[0] ?? 'themem';
}
