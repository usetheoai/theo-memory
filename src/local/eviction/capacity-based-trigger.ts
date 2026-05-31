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
 * @see .claude/knowledge-base/plans/v0-4b-forgetting-pipeline-plan.md § T5.1 (D10 + EC-2 + D17)
 */
import type { Pool, PoolClient } from 'pg';

import type { EvictionResult, ScoreContext } from '../../core/dip/eviction-policy.js';
import type { Scope } from '../../core/scope.js';

import { loadCandidates } from './scope-candidate.js';
import { advisoryLockKey, scopeWhereClause } from './scope-where.js';
import type { TriadicScoringPolicy } from './triadic-scoring-policy.js';

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
    private readonly policy: TriadicScoringPolicy,
    private readonly maxMemoriesPerScope: number,
  ) {}

  /**
   * Inspects the scope; on overflow, evicts via the wired
   * `TriadicScoringPolicy`. Returns the `EvictionResult` on success,
   * `null` when no eviction was needed OR when the advisory lock was
   * already held by another transaction (EC-2 absorption — the other
   * writer's eviction will resolve the overflow).
   */
  async fire(scope: Scope, now: Date): Promise<EvictionResult | null> {
    const client = await this.pool.connect();
    try {
      return await this.fireInTransaction(client, scope, now);
    } finally {
      client.release();
    }
  }

  private async fireInTransaction(
    client: PoolClient,
    scope: Scope,
    now: Date,
  ): Promise<EvictionResult | null> {
    await client.query('BEGIN');
    try {
      const lockResult = await client.query<{ locked: boolean }>(
        'SELECT pg_try_advisory_xact_lock(hashtext($1)) AS locked',
        [advisoryLockKey(scope)],
      );
      if (lockResult.rows[0]?.locked !== true) {
        await client.query('COMMIT');
        return null;
      }
      const result = await this.runEvictionPass(client, scope, now);
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
  ): Promise<EvictionResult | null> {
    const where = scopeWhereClause(scope);
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
    const candidates = await loadCandidates(client, scope);
    const context: ScoreContext = { meanIsolationDistance: 0, now };
    const victimIds = await this.policy.selectVictims(candidates, fraction, context);
    if (victimIds.length === 0) {
      return { softDeleted: [], alreadyInvalid: [], errors: [] };
    }
    await client.query(
      `UPDATE memories
          SET t_invalid = NOW()
        WHERE id = ANY($1::uuid[])
          AND t_invalid IS NULL`,
      [victimIds],
    );
    return { softDeleted: victimIds, alreadyInvalid: [], errors: [] };
  }
}
