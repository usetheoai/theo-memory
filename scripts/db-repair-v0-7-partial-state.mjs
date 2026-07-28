#!/usr/bin/env node
/**
 * Repair script for partial state from v0.7 migration 0007 — mirrors v0.4b-fixes
 * `T11.1b` precedent. Forward-only migration cannot be rolled back by Drizzle
 * journal alone; this script lets ops recover from a crash mid-migration where
 * the `consolidation_history` table was partially created OR the Drizzle journal
 * `_journal.json` entry idx=7 is missing while the table exists in the database.
 *
 * Detection cases:
 *   A. Table exists in DB but journal lacks idx=7 → journal-only fix (rare; manual
 *      `_journal.json` edit OR re-run `drizzle-kit push` after restoring journal).
 *   B. Table missing AND journal has idx=7 → re-apply migration via psql.
 *   C. Table partially created (some indexes missing) → re-run migration file (it
 *      uses `IF NOT EXISTS` throughout — safe).
 *   D. All-or-nothing healthy → script reports OK; no action taken.
 *
 * Usage:
 *   THEOMEM_PG_URI=postgresql://... node scripts/db-repair-v0-7-partial-state.mjs
 *
 * Honors Inquebrável Rule 3 (extreme honesty): on detection, the script reports
 * what it found WITHOUT auto-applying destructive corrections. Operator decides.
 *
 * @see docs/RUNBOOK.md for the rollback procedure (DROP TABLE path).
 */
import { Pool } from 'pg';
import { readFileSync } from 'node:fs';

const PG_URI = process.env.THEOMEM_PG_URI;
if (!PG_URI) {
  console.error('ERROR: THEOMEM_PG_URI not set. Aborting.');
  process.exit(2);
}

const pool = new Pool({ connectionString: PG_URI });

try {
  const { rows: tableRows } = await pool.query(
    `SELECT to_regclass('public.consolidation_history') AS exists`,
  );
  const tableExists = tableRows[0]?.exists !== null;

  const { rows: indexRows } = await pool.query(
    `SELECT indexname FROM pg_indexes WHERE tablename = 'consolidation_history'`,
  );
  const indexNames = indexRows.map((r) => r.indexname);
  const expectedIndexes = [
    'consolidation_history_pkey',
    'idx_consolidation_history_kept',
    'idx_consolidation_history_created',
  ];
  const missingIndexes = expectedIndexes.filter((n) => !indexNames.includes(n));

  // EC-3 FK is the load-bearing GDPR contract — verify ON DELETE SET NULL
  // is actually live; T2.1 integration test caught a real defect where the
  // initial migration ran but the FK clause was silently dropped via
  // CREATE TABLE IF NOT EXISTS no-op semantics.
  const { rows: fkRows } = await pool.query(
    `SELECT delete_rule FROM information_schema.referential_constraints
      WHERE constraint_name = 'consolidation_history_kept_memory_id_fkey'`,
  );
  const fkRule = fkRows[0]?.delete_rule;
  const fkOk = fkRule === 'SET NULL';

  let journal;
  try {
    journal = JSON.parse(
      readFileSync('src/local/migrations/meta/_journal.json', 'utf8'),
    );
  } catch (err) {
    console.error('ERROR: cannot read _journal.json —', err.message);
    process.exit(2);
  }
  const journalHasV07 = journal.entries.some(
    (e) => e.tag === '0007_distillation_columns',
  );

  console.log('--- v0.7 partial-state check ---');
  console.log(`table consolidation_history exists: ${tableExists}`);
  console.log(`indexes present: ${indexNames.join(', ') || '(none)'}`);
  console.log(`indexes missing: ${missingIndexes.join(', ') || '(none)'}`);
  console.log(`FK kept_memory_id ON DELETE SET NULL live: ${fkOk} (delete_rule=${fkRule ?? 'absent'})`);
  console.log(`journal idx=7 (0007_distillation_columns) present: ${journalHasV07}`);

  if (tableExists && missingIndexes.length === 0 && fkOk && journalHasV07) {
    console.log('STATE: HEALTHY — no repair needed.');
    process.exit(0);
  }

  console.log('');
  console.log('STATE: PARTIAL — review and decide:');

  if (!tableExists && journalHasV07) {
    console.log(
      '  Case B: table missing, journal says applied. Re-apply migration:',
    );
    console.log(
      '    psql "$THEOMEM_PG_URI" -f src/local/migrations/0007_distillation_columns.sql',
    );
  }
  if (tableExists && missingIndexes.length > 0) {
    console.log('  Case C: table present, indexes missing. Re-run migration:');
    console.log(
      '    psql "$THEOMEM_PG_URI" -f src/local/migrations/0007_distillation_columns.sql',
    );
    console.log('  (IF NOT EXISTS guards make this safe.)');
  }
  if (tableExists && !journalHasV07) {
    console.log(
      '  Case A: table present, journal missing idx=7. Restore journal entry manually:',
    );
    console.log(
      '    See git: git log --all -- src/local/migrations/meta/_journal.json',
    );
  }
  if (tableExists && !fkOk) {
    console.log(
      '  Case E: table present but FK kept_memory_id ON DELETE SET NULL missing/wrong.',
    );
    console.log(
      '    Re-apply DO-block FK section (lines 13-26 of 0007 SQL) OR ALTER TABLE manually:',
    );
    console.log(
      `    psql "$THEOMEM_PG_URI" -f src/local/migrations/0007_distillation_columns.sql`,
    );
  }

  process.exit(1);
} finally {
  await pool.end();
}
