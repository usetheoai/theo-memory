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
import type { MemoryItem } from '../../core/memory-item.js';

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

interface ScopeCandidateRow {
  readonly id: string;
  readonly text: string;
  readonly hash: string;
  readonly user_id: string | null;
  readonly session_id: string | null;
  readonly agent_id: string | null;
  readonly payload: Record<string, string | number | boolean | null>;
  readonly t_valid: Date | null;
  readonly t_invalid: Date | null;
  readonly created_at: Date;
  readonly updated_at: Date;
  readonly last_accessed_at: Date | null;
  readonly access_count: number;
  readonly half_life_seconds: number | null;
  readonly llm_importance_score: number | null;
}

function rowToMemoryItem(row: ScopeCandidateRow): MemoryItem {
  const scope: MemoryItem['scope'] = row.agent_id !== null
    ? { kind: 'agent', agentId: row.agent_id }
    : row.session_id !== null
      ? { kind: 'session', sessionId: row.session_id }
      : { kind: 'user', userId: row.user_id ?? '' };
  return {
    id: row.id,
    text: row.text,
    hash: row.hash,
    scope,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    metadata: row.payload,
    tValid: row.t_valid,
    tInvalid: row.t_invalid,
    llmImportanceScore: row.llm_importance_score,
    lastAccessedAt: row.last_accessed_at,
    accessCount: row.access_count,
    halfLifeSeconds: row.half_life_seconds,
  };
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
  async fire(scopeId: string, now: Date): Promise<EvictionResult | null> {
    const client = await this.pool.connect();
    try {
      return await this.fireInTransaction(client, scopeId, now);
    } finally {
      client.release();
    }
  }

  private async fireInTransaction(
    client: PoolClient,
    scopeId: string,
    now: Date,
  ): Promise<EvictionResult | null> {
    await client.query('BEGIN');
    try {
      const lockResult = await client.query<{ locked: boolean }>(
        'SELECT pg_try_advisory_xact_lock(hashtext($1)) AS locked',
        [`eviction_${scopeId}`],
      );
      if (lockResult.rows[0]?.locked !== true) {
        await client.query('COMMIT');
        return null;
      }
      const result = await this.runEvictionPass(client, scopeId, now);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  }

  private async runEvictionPass(
    client: PoolClient,
    scopeId: string,
    now: Date,
  ): Promise<EvictionResult | null> {
    const countResult = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
         FROM memories
        WHERE agent_id = $1
          AND t_invalid IS NULL`,
      [scopeId],
    );
    const currentSize = Number(countResult.rows[0]?.count ?? '0');
    const fraction = computeOverflowFraction(currentSize, this.maxMemoriesPerScope);
    if (fraction <= 0) {
      return null;
    }
    const candidatesResult = await client.query<ScopeCandidateRow>(
      `SELECT id, text, hash, user_id, session_id, agent_id, payload,
              t_valid, t_invalid, created_at, updated_at,
              last_accessed_at, access_count, half_life_seconds, llm_importance_score
         FROM memories
        WHERE agent_id = $1
          AND t_invalid IS NULL`,
      [scopeId],
    );
    const candidates = candidatesResult.rows.map(rowToMemoryItem);
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
