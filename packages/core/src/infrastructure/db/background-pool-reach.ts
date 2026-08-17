/**
 * Background pool reach — the counterpart of `tenantScopedPool`.
 *
 * `tenantScopedPool` guarantees a request touches ONE workspace. This file
 * guarantees the opposite property for the small amount of work that must touch
 * them ALL: the retention sweep, and anything else that exists to look at every
 * workspace's rows.
 *
 * The two are not symmetric in how they fail. A request that loses its scope
 * throws — `requireScopeValue` refuses, loudly, before a statement runs. A
 * SWEEP that loses its reach does not throw: migration 0029 is fail-closed, so
 * `DELETE FROM recall_traces WHERE created_at <= ...` over a connection with no
 * cross-workspace policy deletes zero rows and returns success. The job still
 * "runs", the log line still says it swept, and the table grows forever.
 *
 * So the reach is asserted at boot rather than discovered in an incident. Two
 * things are refused, for opposite reasons:
 *
 *   - NO reach (the ordinary application role) — the sweep would be a silent
 *     no-op. This is the failure this file exists to make visible.
 *   - BYPASSRLS — the connection reaches every workspace through a privilege
 *     that is not a policy: it is not listed in `pg_policies`, cannot be
 *     revoked per table, and no audit of the policies would ever show it.
 *     Accepting it trades a silent no-op for a silent bypass.
 *
 * What IS accepted is a NAMED policy: `recall_traces_worker_cross_workspace`,
 * granted `TO themory_worker` by migration 0029 and created only if that role
 * exists. Enumerable, revocable, and visible to anyone reading the catalog.
 *
 * The owner needs no special case here. Unlike the engine, migration 0029 puts
 * FORCE ROW LEVEL SECURITY on every scoped table and grants the owner no
 * maintenance policy, so the owner is subject to the same fail-closed rule as
 * everyone else — it lands in the "no reach" branch on its own.
 *
 * @see migrations/0029_rls_fail_closed.sql — the named worker policies
 * @see tenant-scoped-pool.ts — the request-side guarantee this mirrors
 */
import type { Pool } from 'pg';

import { BackgroundPoolReachError } from '../../domain/errors.js';

/** What a connection's cross-workspace reach on one table actually is. */
export interface BackgroundReach {
  /** `current_user` — the role the pool authenticated as. */
  readonly role: string;
  /** The role holds `BYPASSRLS`: reach through an undeclared privilege. */
  readonly bypassRls: boolean;
  /**
   * Name of a policy granting this role unconditional reach on the table, or
   * `''` when none applies. `''` means the sweep would touch nothing.
   */
  readonly policy: string;
}

/**
 * A policy grants unconditional reach when its `USING` clause is `true` (or
 * absent), which is what `TO themory_worker USING (true)` compiles to. A
 * workspace-scoped policy has a predicate here and is correctly not counted.
 */
const REACH_SQL = `
  SELECT
    current_user AS role,
    COALESCE((SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user), false) AS bypass_rls,
    COALESCE((
      SELECT policyname FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename = $1
         AND current_user = ANY(roles)
         AND (qual IS NULL OR qual = 'true')
       ORDER BY policyname
       LIMIT 1
    ), '') AS named_policy
`;

/** Reads the reach from the catalog. Never throws on "no reach" — see the assert. */
export async function measureBackgroundReach(pool: Pool, table: string): Promise<BackgroundReach> {
  const res = await pool.query<{ role: string; bypass_rls: boolean; named_policy: string }>(
    REACH_SQL,
    [table],
  );
  const row = res.rows[0];
  if (row === undefined) {
    // The catalog always returns exactly one row for this query; no row means
    // the connection is not talking to the database we think it is.
    throw new BackgroundPoolReachError(
      `could not measure cross-workspace reach on "${table}": the catalog returned no row`,
    );
  }
  return { role: row.role, bypassRls: row.bypass_rls, policy: row.named_policy };
}

/**
 * The decision, separated from the I/O so it is testable without a database.
 *
 * @returns the refusal message, or `undefined` when the reach is sanctioned.
 */
export function backgroundReachRefusal(
  reach: BackgroundReach,
  table: string,
): string | undefined {
  if (reach.bypassRls) {
    return (
      `background pool connects as "${reach.role}", which holds BYPASSRLS: it reaches every ` +
      `workspace through a privilege that is not a policy — invisible in pg_policies and ` +
      `impossible to revoke per table. Point THEOMEM_WORKER_PG_URI at themory_worker, whose ` +
      `reach is the named policy "${table}_worker_cross_workspace".`
    );
  }
  if (reach.policy === '') {
    return (
      `background pool connects as "${reach.role}", which holds no cross-workspace policy on ` +
      `"${table}". Migration 0029 is fail-closed, so a sweep over this connection would touch ` +
      `ZERO rows and report success — the table would grow forever with nothing in the logs. ` +
      `Create the themory_worker role, re-run migration 0029 so ` +
      `"${table}_worker_cross_workspace" exists, and point THEOMEM_WORKER_PG_URI at it.`
    );
  }
  return undefined;
}

/**
 * Refuses to let workspace-spanning background work start over a pool that
 * cannot do it. Throws {@link BackgroundPoolReachError}; the caller is expected
 * to fail the boot rather than continue with a job that would sweep nothing.
 */
export async function assertBackgroundPoolCrossWorkspace(
  pool: Pool,
  table: string,
): Promise<BackgroundReach> {
  const reach = await measureBackgroundReach(pool, table);
  const refusal = backgroundReachRefusal(reach, table);
  if (refusal !== undefined) throw new BackgroundPoolReachError(refusal);
  return reach;
}
