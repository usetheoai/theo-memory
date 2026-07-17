/**
 * CapacityBasedTrigger — capacity-bound automated eviction per blueprint D10.
 *
 * Fires on demand (typically post-`remember()` write); when the scope's active
 * memory count exceeds `maxMemoriesPerScope`, invokes
 * `TriadicScoringPolicy.selectVictims(fraction)` to pick the lowest-scored
 * candidates and soft-deletes them via `UPDATE memories SET t_invalid = NOW()`
 * per ADR D17. Never physical DELETE.
 *
 * `overflow_fraction = clamp(0, 0.5, (current - cap) / current)` so a single
 * pass never evicts more than 50% of the scope (blueprint D10 contract).
 *
 * EC-2 absorption: concurrent fires on the same scope are serialized at the
 * DB layer via `pg_try_advisory_xact_lock(hashtext('eviction_' || scope))`
 * acquired BEFORE the COUNT+evict path. When the lock is already held by
 * another transaction, `fire()` short-circuits to `null` (no double-evict).
 * Lock auto-releases at transaction commit/rollback.
 *
 */
import type { Pool, PoolClient } from 'pg';

import type { EvictionPolicy, EvictionResult, ScoreContext } from '../../../domain/dip/eviction-policy.js';
import type { Scope } from '../../../domain/scope.js';

import { loadCandidates } from './scope-candidate.js';
import { advisoryLockKey, scopeWhereClause } from './scope-where.js';

const MAX_OVERFLOW_FRACTION = 0.5;

/**
 * Pure helper for the overflow-fraction calculation (T5.1 REFACTOR step).
 * Returns 0 when current size is at or below cap; otherwise returns
 * `(current - cap) / current` clamped to `[0, maxFraction]`.
 */
export function computeOverflowFraction(
  currentSize: number,
  maxSize: number,
  maxFraction: number = MAX_OVERFLOW_FRACTION,
): number {
  if (currentSize <= maxSize) {
    return 0;
  }
  const raw = (currentSize - maxSize) / currentSize;
  return Math.min(maxFraction, raw);
}

export class CapacityBasedTrigger {
  constructor(
    private readonly pool: Pool,
    private readonly policy: EvictionPolicy,
    private readonly maxMemoriesPerScope: number,
  ) {}

  /**
   * Inspects the scope; on overflow, evicts via the wired
   * `TriadicScoringPolicy`. Returns the `EvictionResult` on success,
   * `null` when no eviction was needed OR when the advisory lock was
   * already held by another transaction (EC-2 absorption — the other
   * writer's eviction will resolve the overflow).
   */
  async fire(scope: Scope, now: Date, workspaceId?: string): Promise<EvictionResult | null> {
    const client = await this.pool.connect();
    try {
      return await this.fireInTransaction(client, scope, now, workspaceId);
    } finally {
      client.release();
    }
  }

  private async fireInTransaction(
    client: PoolClient,
    scope: Scope,
    now: Date,
    workspaceId?: string,
  ): Promise<EvictionResult | null> {
    await client.query('BEGIN');
    try {
      const lockResult = await client.query<{ locked: boolean }>(
        'SELECT pg_try_advisory_xact_lock(hashtext($1)) AS locked',
        [advisoryLockKey(scope, workspaceId)],
      );
      if (lockResult.rows[0]?.locked !== true) {
        await client.query('COMMIT');
        return null;
      }
      const result = await this.runEvictionPass(client, scope, now, workspaceId);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  }

  private async runEvictionPass(
    client: PoolClient,
    scope: Scope,
    now: Date,
    workspaceId?: string,
  ): Promise<EvictionResult | null> {
    // multi-tenant-rbac-and-slice1-completion T3.1: COUNT + candidate load +
    // scoring are all workspace-bound so the overflow + victim set are per-tenant.
    const where = scopeWhereClause(scope, 1, workspaceId);
    const countResult = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
         FROM memories
        WHERE ${where.sql}
          AND t_invalid IS NULL`,
      [...where.params],
    );
    const currentSize = Number(countResult.rows[0]?.count ?? '0');
    const fraction = computeOverflowFraction(currentSize, this.maxMemoriesPerScope);
    if (fraction <= 0) {
      return null;
    }
    // v0.4b-fixes T12.1 (F-xval-2): invoke EvictionPolicy lifecycle hooks
    // declared by ADR D12 so consumers wiring an observability policy receive
    // the eviction boundary signals. Hooks are optional on the DIP; we
    // call only when present + swallow errors (observability is best-effort).
    if (this.policy.onEvictionStart !== undefined) {
      try {
        await this.policy.onEvictionStart(scope, fraction);
      } catch {
        // observability-only — do NOT poison the eviction
      }
    }
    const candidates = await loadCandidates(client, scope, workspaceId);
    const context: ScoreContext = {
      meanIsolationDistance: 0,
      now,
      ...(workspaceId !== undefined ? { workspaceId } : {}),
    };
    const victimIds = await this.policy.selectVictims(candidates, fraction, context);
    let result: EvictionResult;
    if (victimIds.length === 0) {
      result = { softDeleted: [], alreadyInvalid: [], errors: [] };
    } else {
      await client.query(
        `UPDATE memories
            SET t_invalid = NOW()
          WHERE id = ANY($1::uuid[])
            AND t_invalid IS NULL`,
        [victimIds],
      );
      result = { softDeleted: victimIds, alreadyInvalid: [], errors: [] };
    }
    if (this.policy.onEvictionEnd !== undefined) {
      try {
        await this.policy.onEvictionEnd(scope, result);
      } catch {
        // observability-only
      }
    }
    return result;
  }
}
