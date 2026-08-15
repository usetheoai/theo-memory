/**
 * Tenant isolation — proof that the database enforces it.
 *
 * WHY THIS FILE EXISTS SEPARATELY from the rest of the integration suite: every
 * other integration test connects as `postgres`, which is a SUPERUSER, and a
 * superuser bypasses Row Level Security unconditionally — even with FORCE ROW
 * LEVEL SECURITY set. Those tests therefore prove that migration 0029 did not
 * break anything; they cannot prove that it protects anything.
 *
 * That distinction is not academic. The engine audit of 2026-08-14 found a test
 * named `TestRLSTenantIsolation` that had been green for five months while
 * asserting isolation over a connection that structurally could not be isolated.
 * The suite reported a control as working over a property nobody had measured.
 *
 * So this file provisions a NON-SUPERUSER, NON-OWNER role and measures the real
 * posture through it. If the role can bypass RLS, the tests fail loudly rather
 * than passing vacuously.
 *
 * @see packages/core/src/infrastructure/db/migrations/0029_rls_fail_closed.sql
 * @see packages/core/src/infrastructure/db/tenant-scoped-pool.ts
 * @see packages/core/src/infrastructure/db/workspace-scope.ts
 */
import {
  tenantScopedPool,
  withWorkspaceScope,
  WorkspaceScopeError,
} from '@usetheo/memory';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createIsolatedDb, type IsolatedDb } from '../_helpers/isolated-db.js';

const WS_A = 'ws-isolation-a';
const WS_B = 'ws-isolation-b';

let db: IsolatedDb;
/** Raw pool on the restricted role — no workspace context is ever applied. */
let restrictedRaw: pg.Pool;
/** The same role, seen through the scoped wrapper the application uses. */
let scoped: pg.Pool;

beforeAll(async () => {
  db = await createIsolatedDb();

  // `db.pool` is already the role RLS can bind to — `themory_app`, NOSUPERUSER
  // NOBYPASSRLS, with the grants migration 0032 issues. The file used to mint
  // its own role for this; the harness now guarantees it for every file, which
  // is the whole point of #196.
  restrictedRaw = db.pool;
  scoped = tenantScopedPool(db.pool);

  // Seeding two workspaces IS a crossing, and it says so. Doing it over the
  // setup pool would work too — for the wrong reason, by ignoring the policies
  // rather than by holding a policy that permits it.
  const seed = db.crossWorkspacePool('seeds one row in each of two workspaces');
  for (const ws of [WS_A, WS_B]) {
    await seed.query(
      `INSERT INTO reflection_counters (workspace_id, scope_user_id, count)
       VALUES ($1, $2, 1)`,
      [ws, `user-of-${ws}`],
    );
  }
}, 120_000);

afterAll(async () => {
  await db.dropDb();
});

describe('tenant isolation is enforced by PostgreSQL, not by the query author', () => {
  it('the test role can actually be bound by RLS (guards against a vacuous suite)', async () => {
    const { rows } = await restrictedRaw.query<{
      role: string;
      bypass: boolean;
      superuser: boolean;
    }>(
      `SELECT current_user AS role, rolbypassrls AS bypass, rolsuper AS superuser
         FROM pg_roles WHERE rolname = current_user`,
    );
    expect(rows[0]?.bypass, 'the role must not hold BYPASSRLS').toBe(false);
    expect(rows[0]?.superuser, 'a superuser bypasses RLS unconditionally').toBe(false);

    const owner = await restrictedRaw.query<{ is_owner: boolean }>(
      `SELECT pg_get_userbyid(relowner) = current_user AS is_owner
         FROM pg_class WHERE relname = 'reflection_counters'`,
    );
    expect(owner.rows[0]?.is_owner, 'an owner is exempt from its own policies').toBe(false);
  });

  it('a request scoped to one workspace reads only that workspace', async () => {
    const seen = await withWorkspaceScope(WS_A, async () => {
      const { rows } = await scoped.query<{ workspace_id: string }>(
        `SELECT workspace_id FROM reflection_counters ORDER BY workspace_id`,
      );
      return rows.map((r) => r.workspace_id);
    });

    expect(seen).toEqual([WS_A]);
    expect(seen).not.toContain(WS_B);
  });

  it('each workspace sees its own row — isolation is symmetric, not one-directional', async () => {
    const fromB = await withWorkspaceScope(WS_B, async () => {
      const { rows } = await scoped.query<{ workspace_id: string }>(
        `SELECT workspace_id FROM reflection_counters`,
      );
      return rows.map((r) => r.workspace_id);
    });

    expect(fromB).toEqual([WS_B]);
  });

  it('a statement with no workspace context is refused before it reaches the database', async () => {
    // The scoped pool throws rather than running with an empty context. Under
    // fail-closed RLS an empty context matches nothing, and "zero rows" reads
    // exactly like "this workspace has no data" — a silent wrong answer. The
    // exception names the missing scope at the call site that caused it.
    await expect(
      scoped.query(`SELECT workspace_id FROM reflection_counters`),
    ).rejects.toBeInstanceOf(WorkspaceScopeError);
  });

  it('the database itself refuses an unscoped read, independently of the wrapper', async () => {
    // Defence in depth: even if a caller bypasses the scoped pool entirely and
    // uses a raw connection, the policy admits nothing without a context.
    const { rows } = await restrictedRaw.query(
      `SELECT workspace_id FROM reflection_counters`,
    );
    expect(rows).toHaveLength(0);
  });

  it('a request cannot write a row belonging to another workspace', async () => {
    await expect(
      withWorkspaceScope(WS_A, async () => {
        await scoped.query(
          `INSERT INTO reflection_counters (workspace_id, scope_user_id, count)
           VALUES ($1, 'forged', 1)`,
          [WS_B],
        );
      }),
    ).rejects.toThrow(/row-level security/i);
  });

  it('a request cannot update or delete another workspace rows', async () => {
    const { updated, deleted } = await withWorkspaceScope(WS_A, async () => {
      const u = await scoped.query(
        `UPDATE reflection_counters SET count = 999 WHERE workspace_id = $1`,
        [WS_B],
      );
      const d = await scoped.query(`DELETE FROM reflection_counters WHERE workspace_id = $1`, [
        WS_B,
      ]);
      return { updated: u.rowCount ?? 0, deleted: d.rowCount ?? 0 };
    });

    expect(updated, "workspace A must not update B's rows").toBe(0);
    expect(deleted, "workspace A must not delete B's rows").toBe(0);

    // Confirmed from outside the policy, so a filtered read cannot fake success:
    // the contained pool would see nothing here whether the row survived or was
    // deleted, and those are the two outcomes this test has to tell apart.
    const survivor = await db.setupPool.query<{ count: string }>(
      `SELECT count FROM reflection_counters WHERE workspace_id = $1`,
      [WS_B],
    );
    expect(survivor.rows[0]?.count).toBe('1');
  });

  it('releasing a connection clears the context so the next borrower inherits nothing', async () => {
    await withWorkspaceScope(WS_A, async () => {
      const c = await scoped.connect();
      c.release();
    });

    // A fresh raw connection from the same database must not observe A's context.
    const { rows } = await restrictedRaw.query<{ ws: string | null }>(
      `SELECT current_setting('app.workspace_id', true) AS ws`,
    );
    expect(rows[0]?.ws == null || rows[0]?.ws === '').toBe(true);
  });
});
