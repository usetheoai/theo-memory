/**
 * Runs statements against workspace-scoped tables from code that has no request scope.
 *
 * The admin API and credential resolution run on the RAW pool, before any
 * `withWorkspaceScope` exists — credential resolution is what discovers the
 * workspace in the first place. In production that pool is `themory_app`, which the
 * FORCE ROW LEVEL SECURITY policies on `workspaces` and `workspace_users` bind
 * like any other role: a row is visible or writable only when `app.workspace_id`
 * names its workspace. Without the setting an INSERT fails its WITH CHECK and a
 * SELECT returns nothing, silently (#227).
 *
 * This opens a transaction on one pinned connection and sets the context with
 * `set_config(..., true)` — TRANSACTION-local, so it cannot outlive the COMMIT or
 * ROLLBACK and leak into whatever borrows the connection next. The workspace must
 * already be server-authorized by the caller (taken from a verified key row, or an
 * explicit target a platform admin was allowed to name); this does not decide who
 * may reach which workspace, it only states which one the statements are for.
 */
import type { AuthPool, AuthPoolClient } from './api-key-verifier.js';

/** The statement surface handed to the callback — a pinned client in production. */
export interface WorkspaceQueryRunner {
  query<T>(sql: string, params: readonly unknown[]): Promise<{ rows: T[]; rowCount?: number | null }>;
}

/** The GUC the row-level policies read. Must match migration 0029. */
const WORKSPACE_SETTING = 'app.workspace_id';

export async function withWorkspaceContext<T>(
  pool: AuthPool,
  workspaceId: string,
  fn: (q: WorkspaceQueryRunner) => Promise<T>,
): Promise<T> {
  if (workspaceId.trim() === '') {
    // The empty context matches no row, so running with it would turn a wiring bug
    // into an empty result. Refuse and name the cause instead.
    throw new Error('withWorkspaceContext: workspaceId is empty; resolve the workspace before querying');
  }
  if (pool.connect === undefined) {
    // Only in-memory test stubs lack `connect`; `pg.Pool` always has it. A stub has
    // no row-level security to satisfy, so there is no context to set.
    return fn(pool);
  }
  const client: AuthPoolClient = await pool.connect();
  try {
    await client.query('BEGIN', []);
    await client.query(`SELECT set_config($1, $2, true)`, [WORKSPACE_SETTING, workspaceId]);
    const out = await fn(client);
    await client.query('COMMIT', []);
    return out;
  } catch (err) {
    try {
      await client.query('ROLLBACK', []);
    } catch {
      // The original error is the one worth reporting; a failed ROLLBACK on a
      // broken connection adds nothing, and the connection is released below.
    }
    throw err;
  } finally {
    client.release();
  }
}
