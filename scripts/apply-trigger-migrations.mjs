// @ts-check
/**
 * Apply trigger-bearing migrations via psql.
 *
 * Closes F-dom-db-2 CRITICAL: Drizzle ORM v0.45 does not model triggers in
 * `pgTable` declarations, so `drizzle-kit push` (which introspects schema.ts)
 * never emits the `BEFORE UPDATE OF` trigger that migration 0004 ships. This
 * helper bridges that gap by scanning `src/local/migrations/*.sql` for files
 * containing `CREATE TRIGGER` or `CREATE FUNCTION` and applying each via
 * `psql -v ON_ERROR_STOP=1 -f <file>` against the connection string supplied
 * by the caller (typically `$THEOMEM_PG_URI`).
 *
 * Wired into the `db:push` npm script so dev environments get the trigger
 * after `npm run db:push`. Production environments use `runMigrations()`,
 * which reads the journal directly and applies every .sql by tag — the
 * trigger landed there in T0.1.
 *
 * Idempotency: 0004 itself uses `CREATE OR REPLACE FUNCTION` and
 * `CREATE OR REPLACE TRIGGER` (PostgreSQL 14+ semantics), so re-applying is
 * a no-op at the SQL layer.
 *
 * EC-9 absorption: when `psql` is absent from PATH, the helper throws with
 * a message that anchors at `README.md § Quickstart › Prerequisites` so
 * consumers know exactly where to look.
 *
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, '..', 'packages', 'core', 'src', 'infrastructure', 'db', 'migrations');

const PREREQ_ANCHOR_MSG =
  'psql binary not found on PATH. The db:push script applies trigger-bearing migrations (e.g. 0004) via psql because Drizzle does not model triggers. Install PostgreSQL client tools (psql 14+) — see README § Quickstart › Prerequisites for instructions.';

/**
 * Detects whether the .sql file contains a trigger or function definition.
 * Regex-based detection is sufficient while migrations are hand-authored
 * (~5 files today). Revisit if migration count exceeds ~20 OR if hand-written
 * comments start carrying false-positive `CREATE TRIGGER` strings — at that
 * point pull in an SQL parser.
 *
 * @param {string} sql
 * @returns {boolean}
 */
function isTriggerBearing(sql) {
  return /\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:TRIGGER|FUNCTION)\b/i.test(sql);
}

/**
 * @returns {string[]} absolute paths to trigger-bearing .sql migrations.
 */
function findTriggerBearingMigrations() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => /^\d{4}_.*\.sql$/.test(name))
    .sort()
    .map((name) => resolve(MIGRATIONS_DIR, name))
    .filter((path) => isTriggerBearing(readFileSync(path, 'utf-8')));
}

/**
 * @returns {boolean} whether `psql` resolves on PATH.
 */
function psqlOnPath() {
  try {
    execFileSync('psql', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Apply every trigger-bearing migration via psql.
 *
 * @param {string} connectionString — Postgres URI (e.g. `process.env.THEOMEM_PG_URI`)
 * @returns {Promise<{ appliedFiles: string[] }>}
 */
export async function applyTriggerMigrations(connectionString) {
  if (typeof connectionString !== 'string' || connectionString.length === 0) {
    throw new Error(
      'apply-trigger-migrations: missing connection string (set THEOMEM_PG_URI).',
    );
  }
  if (!psqlOnPath()) {
    throw new Error(PREREQ_ANCHOR_MSG);
  }
  const files = findTriggerBearingMigrations();
  for (const filePath of files) {
    execFileSync(
      'psql',
      ['-v', 'ON_ERROR_STOP=1', '-f', filePath, connectionString],
      { stdio: 'inherit' },
    );
  }
  return { appliedFiles: files };
}

// CLI entrypoint when invoked via `node scripts/apply-trigger-migrations.mjs`
const isMainModule =
  import.meta.url === pathToFileUrlIfNode(process.argv[1] ?? '');
if (isMainModule) {
  const uri = process.env['THEOMEM_PG_URI'] ?? '';
  applyTriggerMigrations(uri)
    .then((result) => {
      const names = result.appliedFiles.map((p) => p.split('/').pop()).join(', ');
      process.stdout.write(
        names.length > 0
          ? `applied trigger-bearing migrations: ${names}\n`
          : 'no trigger-bearing migrations found\n',
      );
    })
    .catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`apply-trigger-migrations failed: ${msg}\n`);
      process.exit(1);
    });
}

/**
 * @param {string} p
 * @returns {string}
 */
function pathToFileUrlIfNode(p) {
  if (p.length === 0) return '';
  try {
    return new URL(`file://${resolve(p)}`).href;
  } catch {
    return '';
  }
}
