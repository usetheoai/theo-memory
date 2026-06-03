/**
 * `themory migrate` composition root — applies pending Drizzle migrations
 * against `THEOMEM_PG_URI`. Thin wrapper around `runMigrations(pool)` for
 * operator ergonomics; the underlying drizzle journal already provides:
 *  - **EC-35**: each migration runs inside its own SQL transaction (Drizzle
 *    default); a partially-applied migration is rolled back atomically.
 *  - **EC-36**: idempotent on re-run. Subsequent invocations against an
 *    already-migrated DB are SQL-level no-ops (Drizzle journal-lock skips
 *    entries whose hash is already recorded in `__drizzle_migrations`).
 *
 * EC-7 reuse: identical `THEOMEM_PG_URI` hard-fail discipline as runMcpServer
 * and runServer — exit 2 + stderr example URI when env var missing.
 *
 * DIP discipline: src/agent-tools/run-migrate.ts IS the composition root for
 * this subcommand (architecture.md § 3) — it directly imports `pg` + the
 * src/local/ migration runner.
 *
 * @see Plan theo-memory-standalone-p0 § T2.4 + EC-35 + EC-36
 */
import { Pool } from 'pg';

import { runMigrations } from '../local/index.js';

export async function runMigrate(): Promise<void> {
  const pgUri = process.env['THEOMEM_PG_URI'];
  if (pgUri === undefined || pgUri.length === 0) {
    process.stderr.write(
      'Error: THEOMEM_PG_URI required. Set it to a postgres connection string (e.g., postgres://user:pass@host:5432/dbname).\n',
    );
    process.exit(2);
    return;
  }

  const pool = new Pool({ connectionString: pgUri });
  try {
    await runMigrations(pool);
    process.stdout.write('themory migrate: migrations applied successfully.\n');
  } catch (err) {
    process.stderr.write(
      `themory migrate: migrations failed (${err instanceof Error ? err.message : String(err)})\n`,
    );
    await pool.end().catch(() => undefined);
    process.exit(1);
    return;
  }
  await pool.end();
}
