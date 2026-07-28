// @ts-check
/**
 * Detect + repair cross-version partial-state from a manual `psql -f` apply
 * of `0003_eviction_columns.sql` (or the trigger / index files) between
 * v0.4b shipping and v0.4b-fixes shipping (2026-05-31).
 *
 * Decision matrix:
 *   - Schema fresh + journal at idx≤2 → exit 0 (no repair needed; normal
 *     runMigrations() will apply forward).
 *   - Schema fully aligned with journal → exit 0 (idempotent no-op).
 *   - Schema has v0.4b artifacts BUT journal stops at idx=2 → INSERT missing
 *     journal rows so subsequent runMigrations() treats those migrations as
 *     already applied.
 *   - Schema state ambiguous (some v0.4b columns missing, or trigger present
 *     without all columns, etc.) → ABORT with a clear pointer at the
 *     runbook so the operator can drive the recovery manually.
 *
 * Read-only by default in mismatched-state detection; only writes when
 * --apply is passed AND the diagnosis is "partial-state recoverable".
 *
 * Invoke via:
 *   npm run db:repair-v0-4b-partial-state              (dry-run: report only)
 *   npm run db:repair-v0-4b-partial-state -- --apply   (perform the repair)
 *
 * @see docs/RUNBOOK.md § 4 (cross-version partial-state recovery)
 */

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(
  __dirname,
  '..',
  'packages',
  'core',
  'src',
  'infrastructure',
  'db',
  'migrations',
);

const RUNBOOK_REF = 'docs/RUNBOOK.md § 4';

const V04B_COLUMNS = ['last_accessed_at', 'access_count', 'half_life_seconds'];
const V04B_TRIGGER = 'memories_reset_half_life_on_importance_update_trg';

/**
 * @typedef {Object} RepairReport
 * @property {string} diagnosis
 * @property {string[]} actions
 * @property {boolean} requiresManualIntervention
 */

/**
 * @param {pg.Pool} pool
 * @returns {Promise<{ columnsPresent: string[]; triggerPresent: boolean; journalEntries: string[] }>}
 */
async function inspectDb(pool) {
  const columns = await pool.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name='memories' AND column_name = ANY($1::text[])`,
    [V04B_COLUMNS],
  );
  const trigger = await pool.query(
    `SELECT trigger_name FROM information_schema.triggers
      WHERE event_object_table='memories' AND trigger_name=$1`,
    [V04B_TRIGGER],
  );
  let journalEntries = [];
  try {
    const entries = await pool.query(
      `SELECT hash FROM drizzle.__drizzle_migrations ORDER BY created_at ASC`,
    );
    journalEntries = entries.rows.map((r) => String(r.hash));
  } catch {
    // Schema is fresh — `drizzle.__drizzle_migrations` does not exist yet.
    journalEntries = [];
  }
  return {
    columnsPresent: columns.rows.map((r) => String(r.column_name)),
    triggerPresent: trigger.rows.length > 0,
    journalEntries,
  };
}

/**
 * @returns {Array<{ idx: number; tag: string; hash: string; sqlPath: string }>}
 */
function loadOnDiskMigrations() {
  const sqlFiles = readdirSync(MIGRATIONS_DIR)
    .filter((name) => /^\d{4}_.*\.sql$/.test(name))
    .sort();
  return sqlFiles.map((name) => {
    const idx = Number(name.substring(0, 4));
    const tag = name.replace(/\.sql$/, '');
    const sqlPath = resolve(MIGRATIONS_DIR, name);
    const sql = readFileSync(sqlPath, 'utf-8');
    const hash = createHash('sha256').update(sql).digest('hex');
    return { idx, tag, hash, sqlPath };
  });
}

/**
 * @param {pg.Pool} pool
 * @param {{ columnsPresent: string[]; triggerPresent: boolean; journalEntries: string[] }} state
 * @returns {RepairReport}
 */
function diagnose(state) {
  const allColumnsPresent = V04B_COLUMNS.every((c) => state.columnsPresent.includes(c));
  const someColumnsPresent = state.columnsPresent.length > 0;
  const journalHasV04bEntries = state.journalEntries.length > 3;

  if (!someColumnsPresent && !state.triggerPresent && !journalHasV04bEntries) {
    return {
      diagnosis: 'fresh: no v0.4b artifacts; normal runMigrations() will apply 0003-0006.',
      actions: [],
      requiresManualIntervention: false,
    };
  }
  if (allColumnsPresent && state.triggerPresent && journalHasV04bEntries) {
    return {
      diagnosis: 'aligned: schema + journal fully synced. No repair needed.',
      actions: [],
      requiresManualIntervention: false,
    };
  }
  if (allColumnsPresent && state.triggerPresent && !journalHasV04bEntries) {
    return {
      diagnosis:
        'partial-state: v0.4b columns + trigger present but journal stops at 0002. Manual psql apply between v0.4b shipping and v0.4b-fixes detected; repair = INSERT missing journal rows so subsequent runMigrations() is a no-op.',
      actions: ['insert-journal-rows-for-0003-through-0006'],
      requiresManualIntervention: false,
    };
  }
  return {
    diagnosis:
      `ambiguous: partial v0.4b artifacts on disk — columns present: ${JSON.stringify(state.columnsPresent)}, trigger present: ${String(state.triggerPresent)}, journal entries: ${String(state.journalEntries.length)}. Manual intervention required.`,
    actions: [],
    requiresManualIntervention: true,
  };
}

/**
 * @param {pg.Pool} pool
 * @returns {Promise<RepairReport>}
 */
export async function reportRepairState(pool) {
  const state = await inspectDb(pool);
  return diagnose(state);
}

/**
 * @param {pg.Pool} pool
 * @returns {Promise<RepairReport & { applied: boolean }>}
 */
export async function applyRepair(pool) {
  const report = await reportRepairState(pool);
  if (report.requiresManualIntervention) {
    return { ...report, applied: false };
  }
  if (report.actions.length === 0) {
    return { ...report, applied: false };
  }
  if (report.actions.includes('insert-journal-rows-for-0003-through-0006')) {
    const migrations = loadOnDiskMigrations();
    const toInsert = migrations.filter((m) => m.idx >= 3);
    await pool.query(`CREATE SCHEMA IF NOT EXISTS drizzle`);
    await pool.query(
      `CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
         id serial PRIMARY KEY,
         hash text NOT NULL,
         created_at bigint
       )`,
    );
    const now = Date.now();
    for (const m of toInsert) {
      await pool.query(
        `INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
         SELECT $1, $2 WHERE NOT EXISTS (
           SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = $1
         )`,
        [m.hash, now + m.idx],
      );
    }
  }
  return { ...report, applied: true };
}

function isMainModule(argv1) {
  if (argv1 === undefined || argv1.length === 0) return false;
  try {
    return import.meta.url === new URL(`file://${resolve(argv1)}`).href;
  } catch {
    return false;
  }
}

if (isMainModule(process.argv[1])) {
  const uri = process.env['THEOMEM_PG_URI'] ?? '';
  if (uri === '') {
    process.stderr.write('THEOMEM_PG_URI is unset.\n');
    process.exit(2);
  }
  const apply = process.argv.includes('--apply');
  const pool = new pg.Pool({ connectionString: uri });
  try {
    const result = apply ? await applyRepair(pool) : await reportRepairState(pool);
    process.stdout.write(`[db:repair-v0-4b-partial-state]\n`);
    process.stdout.write(`Diagnosis: ${result.diagnosis}\n`);
    if (result.actions.length > 0) {
      process.stdout.write(`Actions: ${result.actions.join(', ')}\n`);
    }
    if (result.requiresManualIntervention) {
      process.stderr.write(
        `MANUAL INTERVENTION REQUIRED — see ${RUNBOOK_REF}\n`,
      );
      process.exit(1);
    }
    if (apply && 'applied' in result) {
      process.stdout.write(`Applied: ${String(result.applied)}\n`);
    } else if (!apply) {
      process.stdout.write(`Dry-run — re-invoke with --apply to perform repair.\n`);
    }
  } finally {
    await pool.end();
  }
}
