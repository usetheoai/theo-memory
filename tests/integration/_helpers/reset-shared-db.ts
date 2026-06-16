/**
 * Per-file shared-DB reset (integration-suite-stabilization).
 *
 * Wired via vitest `setupFiles`. This runs at the setup file's TOP LEVEL, which
 * vitest awaits BEFORE the test file's module body evaluates — so it executes
 * before the test file opens any module-level pool to the shared database. That
 * ordering is load-bearing: a `beforeAll` hook here would run AFTER the test
 * module created its pool, and the `pg_terminate_backend` below would then kill
 * the file's own live connection (observed: auth tests failing with
 * "terminating connection due to administrator command"). At top level the only
 * connections to the shared DB are leaks from a PRIOR file (already finished),
 * which are safe to terminate.
 *
 * It resets the shared database named in `THEOMEM_PG_URI` to a clean clone of
 * the migrated template (`themem_template`, built once by `global-setup.ts`).
 * `CREATE DATABASE … TEMPLATE` is a millisecond byte-clone.
 *
 * Why per file: many integration files share the single `themem` database and
 * some mutate it irreversibly within their own run — e.g. a `themory server`/
 * `mcp`/verb boot calls `runMigrations({ embeddingDim: 384 })` and ALTERs the
 * dimension to 384, or a destructive test drops late tables. Without a reset,
 * the next file inherits the mutated state and fails non-deterministically.
 *
 * Files that already use a per-file isolated database (`createIsolatedDb`) are
 * unaffected — the shared-DB reset is simply a no-op for them.
 */
import pg from 'pg';

import { TEMPLATE_DB, sharedDbName, siblingUri } from '../global-setup.js';

const uri = process.env['THEOMEM_PG_URI'];
if (uri !== undefined && uri !== '') {
  const dbName = sharedDbName(uri);
  const adminUri = siblingUri(uri, 'postgres');
  const admin = new pg.Pool({ connectionString: adminUri, max: 1 });
  try {
    // Terminate stray connections from a PRIOR file (its afterAll may have
    // missed a pool, or a local dev server is connected) so DROP DATABASE does
    // not block. Safe at top level: the current test file has not yet imported,
    // so none of ITS connections exist.
    await admin.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
         WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [dbName],
    );
    // DROP ... WITH (FORCE) (PG 13+) atomically disconnects any session that
    // raced in between the terminate above and the drop, then drops. Without
    // FORCE, a slow-closing prior-file pool could reconnect in that window and
    // block the DROP, leaving the shared DB in the prior file's (possibly
    // dim-polluted) state — observed as an intermittent recall@10 collapse in
    // the heavy forgetting/eviction GOAL tests.
    await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${dbName} TEMPLATE ${TEMPLATE_DB}`);
  } finally {
    await admin.end();
  }
}
