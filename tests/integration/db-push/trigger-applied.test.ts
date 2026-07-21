import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import pg from 'pg';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';

/**
 * `psql` availability guard: this test drives `apply-trigger-migrations.mjs`, which
 * shells out to the `psql` client. CI runners have Postgres-as-a-service but NOT the
 * psql binary, and the runtime path there is `themory migrate` (not db:push). Skip
 * cleanly when psql is absent so the suite stays green; the trigger is independently
 * exercised by the migration integration tests.
 */
function psqlAvailable(): boolean {
  try {
    execFileSync('psql', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Asserts that `npm run db:push`'s trigger-apply step materializes the v0.4b
 * BEFORE-UPDATE-OF trigger on a fresh dev DB. Closes F-dom-db-2 CRITICAL.
 *
 * Test shape (option (c) per SEPA iter 3 pre-RED brief): rather than spawning
 * `npm run db:push` via execSync (brittle: couples to npm + dotenv + shell
 * env loading), we import the SAME helper the GREEN db:push script invokes
 * and exercise it directly against a throwaway DB. The behavior under test
 * is "after the helper runs, the trigger exists" — that is what F-dom-db-2
 * promises to consumers.
 *
 * Two invariants verified:
 *   (a) After one apply, the trigger `memories_reset_half_life_on_importance_update_trg`
 *       is registered against the `memories` table.
 *   (b) The helper is idempotent — running it a second time succeeds without
 *       error and the trigger is still registered (0004 uses
 *       `CREATE OR REPLACE FUNCTION/TRIGGER`).
 *
 */

const ROOT_PG_URI = process.env['THEOMEM_PG_URI'] ?? '';
const TRIGGER_NAME = 'memories_reset_half_life_on_importance_update_trg';
const TEST_DB = 'themem_db_push_trigger_test';

const helperPath = resolve(__dirname, '..', '..', '..', 'scripts', 'apply-trigger-migrations.mjs');
const helperUrl = pathToFileURL(helperPath).href;

interface TriggerHelper {
  applyTriggerMigrations(connectionString: string): Promise<{ appliedFiles: string[] }>;
}

describe.skipIf(ROOT_PG_URI === '' || !psqlAvailable())(
  'F-dom-db-2: db:push wraps trigger psql apply (T2.1)',
  () => {
    const adminUri = ROOT_PG_URI.replace(/\/[^/]*$/, '/postgres');
    const testUri = ROOT_PG_URI.replace(/\/[^/]*$/, `/${TEST_DB}`);
    let helper: TriggerHelper;

    /** Count the `memories` trigger rows on the test DB (extracted — used by 2 cases). */
    async function triggerRowCount(): Promise<number> {
      const pool = new pg.Pool({ connectionString: testUri });
      try {
        const { rows } = await pool.query<{ trigger_name: string }>(
          `SELECT trigger_name FROM information_schema.triggers
           WHERE event_object_table = 'memories' AND trigger_name = $1`,
          [TRIGGER_NAME],
        );
        return rows.length;
      } finally {
        await pool.end();
      }
    }

    beforeAll(async () => {
      const adminPool = new pg.Pool({ connectionString: adminUri });
      await adminPool.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
      await adminPool.query(`CREATE DATABASE ${TEST_DB}`);
      await adminPool.end();

      const testPool = new pg.Pool({ connectionString: testUri });
      await testPool.query('CREATE EXTENSION IF NOT EXISTS vector');
      // Apply column-bearing migrations via the journal-tracked runMigrations
      // path so the `memories` table exists for the trigger to attach to.
      const { runMigrations } = await import('@usetheo/memory');
      await runMigrations(testPool);
      await testPool.end();

      helper = (await import(helperUrl)) as TriggerHelper;
    }, 60_000);

    afterAll(async () => {
      const adminPool = new pg.Pool({ connectionString: adminUri });
      await adminPool.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
      await adminPool.end();
    });

    it('applies the trigger so a fresh dev DB has it registered after db:push', async () => {
      // Given: a fresh DB with column schema but no trigger
      await helper.applyTriggerMigrations(testUri);

      // Then: the trigger exists
      expect(await triggerRowCount()).toBe(1);
    });

    it('is idempotent — re-applying does not error and the trigger stays present', async () => {
      // When: the helper is invoked a second time (CREATE OR REPLACE semantics)
      await expect(helper.applyTriggerMigrations(testUri)).resolves.toBeDefined();

      // Then: the trigger is still registered exactly once
      expect(await triggerRowCount()).toBe(1);
    });

    it('reports which .sql files it applied so callers can verify coverage', async () => {
      // The helper return shape carries the list of trigger-bearing files
      // applied. v0.4b ships exactly one such file (0004); the contract is
      // "every .sql under src/local/migrations/ containing CREATE TRIGGER or
      // CREATE FUNCTION is included".
      const result = await helper.applyTriggerMigrations(testUri);
      expect(result.appliedFiles).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/0004_eviction_half_life_trigger\.sql$/),
        ]),
      );
    });
  },
);
