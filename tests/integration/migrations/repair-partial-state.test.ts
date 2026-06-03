import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * T11.1b — `db:repair-v0-4b-partial-state` detects partial state (v0.4b
 * columns + trigger present BUT `drizzle.__drizzle_migrations` stops at
 * idx≤2) and inserts the missing journal rows so subsequent
 * `runMigrations()` is a no-op (EC-4 absorption).
 *
 * Test simulates the cross-version partial state that v0.4b consumers may
 * have via the `psql -f src/local/migrations/0003_eviction_columns.sql`
 * workaround applied between v0.4b shipping and v0.4b-fixes shipping.
 *
 * @see .claude/knowledge-base/plans/v0-4b-fixes-cycle-plan.md § T11.1b + EC-4 reversal
 * @see docs/runbook-v0-4b-rollback.md § 4
 */

const ROOT_PG_URI = process.env['THEOMEM_PG_URI'] ?? '';
const TEST_DB = 'themem_t11_1b_repair';

interface RepairModule {
  reportRepairState(pool: pg.Pool): Promise<{
    diagnosis: string;
    actions: string[];
    requiresManualIntervention: boolean;
  }>;
  applyRepair(pool: pg.Pool): Promise<{
    diagnosis: string;
    actions: string[];
    requiresManualIntervention: boolean;
    applied: boolean;
  }>;
}

const repairScriptUrl = pathToFileURL(
  resolve(__dirname, '..', '..', '..', 'scripts', 'db-repair-v0-4b-partial-state.mjs'),
).href;

describe.skipIf(ROOT_PG_URI === '')(
  'T11.1b — db:repair-v0-4b-partial-state (F-dom-db-3 + EC-4 absorption)',
  () => {
    const adminUri = ROOT_PG_URI.replace(/\/[^/]*$/, '/postgres');
    const testUri = ROOT_PG_URI.replace(/\/[^/]*$/, `/${TEST_DB}`);
    let repair: RepairModule;

    async function recreateTestDb(): Promise<void> {
      const adminPool = new pg.Pool({ connectionString: adminUri });
      await adminPool.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
      await adminPool.query(`CREATE DATABASE ${TEST_DB}`);
      await adminPool.end();
    }

    async function dropTestDb(): Promise<void> {
      const adminPool = new pg.Pool({ connectionString: adminUri });
      await adminPool.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
      await adminPool.end();
    }

    async function seedPartialState(): Promise<void> {
      const pool = new pg.Pool({ connectionString: testUri });
      await pool.query('CREATE EXTENSION IF NOT EXISTS vector');
      // Apply 0000 + 0001 + 0002 via runMigrations, then HAND-APPLY 0003 +
      // 0004 via psql-shape (simulates the workaround consumers may have
      // used). To keep the test self-contained, we manually create the
      // memories table + apply v0.4b SQL files directly.
      const m = await import('../../../src/local/index.js');
      await m.runMigrations(pool);
      // At this point all migrations applied + journal aligned. Simulate
      // the partial-state by REMOVING all post-0002 journal rows so the
      // schema is ahead of the journal. Use OFFSET 2 / created_at filter
      // so the simulation is robust to additional migrations shipped post-
      // v0.4b (v0.7 adds 0007; future cycles may add more — the v0.4b
      // partial-state is "journal stops at idx≤2" regardless of total
      // migration count).
      await pool.query(
        `DELETE FROM drizzle.__drizzle_migrations
          WHERE created_at > (
            SELECT created_at FROM drizzle.__drizzle_migrations
             ORDER BY created_at ASC LIMIT 1 OFFSET 2
          )`,
      );
      await pool.end();
    }

    beforeAll(async () => {
      await recreateTestDb();
      repair = (await import(repairScriptUrl)) as RepairModule;
    }, 60_000);

    afterAll(async () => {
      await dropTestDb();
    });

    beforeEach(async () => {
      await recreateTestDb();
    }, 30_000);

    it('detects partial state and restores journal entries via applyRepair', async () => {
      await seedPartialState();
      const pool = new pg.Pool({ connectionString: testUri });

      // Pre-repair: diagnosis mentions partial-state.
      const report = await repair.reportRepairState(pool);
      expect(report.diagnosis).toMatch(/partial-state/);
      expect(report.actions).toContain('insert-journal-rows-for-0003-through-0006');
      expect(report.requiresManualIntervention).toBe(false);

      const applied = await repair.applyRepair(pool);
      expect(applied.applied).toBe(true);

      // Post-repair: journal has one entry per SQL file on disk (currently
      // 8: 0000-0007 inclusive after v0.7 T0.1; the repair script reads
      // `loadOnDiskMigrations()` which picks up every `\d{4}_*.sql`).
      // Resilient assertion: count >= v0.4b minimum (7); accommodates future
      // migrations added by later cycles without re-editing the test.
      const journal = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM drizzle.__drizzle_migrations`,
      );
      const expectedMinimum = 7;
      const actualCount = Number(journal.rows[0]?.count ?? '0');
      expect(actualCount).toBeGreaterThanOrEqual(expectedMinimum);

      // Idempotent: re-running applyRepair after repair is a no-op.
      const second = await repair.applyRepair(pool);
      expect(second.diagnosis).toMatch(/aligned/);

      await pool.end();
    });

    it('reports fresh state when DB has no v0.4b artifacts', async () => {
      const pool = new pg.Pool({ connectionString: testUri });
      await pool.query('CREATE EXTENSION IF NOT EXISTS vector');
      const report = await repair.reportRepairState(pool);
      expect(report.diagnosis).toMatch(/fresh/);
      expect(report.actions).toEqual([]);
      expect(report.requiresManualIntervention).toBe(false);
      await pool.end();
    });

    it('reports aligned state when journal already matches schema', async () => {
      const pool = new pg.Pool({ connectionString: testUri });
      await pool.query('CREATE EXTENSION IF NOT EXISTS vector');
      const m = await import('../../../src/local/index.js');
      await m.runMigrations(pool);
      const report = await repair.reportRepairState(pool);
      expect(report.diagnosis).toMatch(/aligned/);
      expect(report.requiresManualIntervention).toBe(false);
      await pool.end();
    });
  },
);
