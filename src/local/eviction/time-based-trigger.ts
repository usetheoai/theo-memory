/**
 * TimeBasedTrigger — cron-scheduled background eviction per blueprint D10.
 *
 * Fires at the configured cron schedule (single scope per trigger; consumers
 * instantiate multiple triggers for multi-scope coverage). On tick, runs a
 * fixed-fraction eviction pass against the configured scope — independent of
 * any size threshold (different from CapacityBasedTrigger which fires only
 * on overflow).
 *
 * REUSES `croner` from v0.4a's SleepTimeReflectionPolicy — ZERO new runtime
 * dep per blueprint Q2 Rule 9 REJECT-all verdict (lru-cache / quick-lru /
 * keyv all rejected as wrong-abstraction-layer).
 *
 * EC-9 absorption (cron format guard): constructor eagerly probes the
 * expression via `new Cron(expr, { paused: true })` so format errors surface
 * at construction, not at first tick. Croner natively supports both 5-field
 * (minute-resolution) and 6-field (second-resolution) cron expressions.
 *
 * Advisory lock pattern: each tick acquires
 * `pg_try_advisory_xact_lock(hashtext('eviction_' || scope))` inside a
 * transaction so a concurrent CapacityBasedTrigger fire on the same scope
 * does not double-evict.
 *
 * @see .claude/knowledge-base/plans/v0-4b-forgetting-pipeline-plan.md § T5.2 (D10 + EC-9)
 */
import { Cron } from 'croner';
import type { Pool, PoolClient } from 'pg';

import type { EvictionResult, ScoreContext } from '../../core/dip/eviction-policy.js';
import type { MemoryItem } from '../../core/memory-item.js';

import type { TriadicScoringPolicy } from './triadic-scoring-policy.js';

export interface TimeBasedTriggerConfig {
  readonly cronExpression: string;
  readonly evictionFraction: number;
  readonly scopeId: string;
}

/**
 * EC-9 absorption — TimeBasedTrigger rejects empty or unparseable cron
 * expressions at construction so format errors surface BEFORE start().
 */
export class InvalidCronExpressionError extends Error {
  override readonly name = 'InvalidCronExpressionError' as const;

  constructor(cronExpression: string, options?: ErrorOptions) {
    super(`Invalid cron expression: ${JSON.stringify(cronExpression)}`, options);
    Object.setPrototypeOf(this, InvalidCronExpressionError.prototype);
  }
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

type OnTickCallback = (result: EvictionResult | null) => void;

export class TimeBasedTrigger {
  private readonly cronExpression: string;
  private readonly evictionFraction: number;
  private readonly scopeId: string;
  private cronJob: Cron | null = null;
  private tickListener: OnTickCallback | null = null;

  constructor(
    private readonly pool: Pool,
    private readonly policy: TriadicScoringPolicy,
    config: TimeBasedTriggerConfig,
  ) {
    if (config.cronExpression === '') {
      throw new InvalidCronExpressionError(config.cronExpression);
    }
    try {
      const probe = new Cron(config.cronExpression, { paused: true });
      probe.stop();
    } catch (err) {
      throw new InvalidCronExpressionError(config.cronExpression, { cause: err });
    }
    this.cronExpression = config.cronExpression;
    this.evictionFraction = config.evictionFraction;
    this.scopeId = config.scopeId;
  }

  /**
   * Register a callback invoked on every tick (after the eviction pass
   * completes). Receives the EvictionResult (or null on lock contention /
   * no-op). Useful for testing real-cron timing AND for telemetry hooks.
   * At most ONE listener is supported — second call replaces the first.
   */
  onTick(listener: OnTickCallback): void {
    this.tickListener = listener;
  }

  isStarted(): boolean {
    return this.cronJob !== null;
  }

  /** Start the cron job. Idempotent: second invocation is a no-op. */
  start(): void {
    if (this.cronJob !== null) {
      return;
    }
    this.cronJob = new Cron(this.cronExpression, () => {
      void this.tickNow(new Date()).catch((err: unknown) => {
        // eslint-disable-next-line no-console
        console.warn('[v0.4b TimeBasedTrigger] tick failed:', err);
      });
    });
  }

  /** Stop the cron job. Idempotent — calling on a non-started or already-stopped instance is a no-op. */
  stop(): void {
    if (this.cronJob !== null) {
      this.cronJob.stop();
      this.cronJob = null;
    }
  }

  /**
   * Deterministic-test entry point: bypasses the cron schedule and runs
   * one eviction pass immediately. Production code path uses the same
   * function via the cron callback registered in `start()`.
   */
  async tickNow(now: Date): Promise<EvictionResult | null> {
    const client = await this.pool.connect();
    let result: EvictionResult | null = null;
    try {
      result = await this.runFixedFractionPass(client, now);
    } finally {
      client.release();
    }
    this.tickListener?.(result);
    return result;
  }

  private async runFixedFractionPass(
    client: PoolClient,
    now: Date,
  ): Promise<EvictionResult | null> {
    await client.query('BEGIN');
    try {
      const lockResult = await client.query<{ locked: boolean }>(
        'SELECT pg_try_advisory_xact_lock(hashtext($1)) AS locked',
        [`eviction_${this.scopeId}`],
      );
      if (lockResult.rows[0]?.locked !== true) {
        await client.query('COMMIT');
        return null;
      }
      const candidatesResult = await client.query<ScopeCandidateRow>(
        `SELECT id, text, hash, user_id, session_id, agent_id, payload,
                t_valid, t_invalid, created_at, updated_at,
                last_accessed_at, access_count, half_life_seconds, llm_importance_score
           FROM memories
          WHERE agent_id = $1
            AND t_invalid IS NULL`,
        [this.scopeId],
      );
      if (candidatesResult.rows.length === 0) {
        await client.query('COMMIT');
        return null;
      }
      const candidates = candidatesResult.rows.map(rowToMemoryItem);
      const context: ScoreContext = { meanIsolationDistance: 0, now };
      const victimIds = await this.policy.selectVictims(
        candidates,
        this.evictionFraction,
        context,
      );
      if (victimIds.length === 0) {
        await client.query('COMMIT');
        return { softDeleted: [], alreadyInvalid: [], errors: [] };
      }
      await client.query(
        `UPDATE memories
            SET t_invalid = NOW()
          WHERE id = ANY($1::uuid[])
            AND t_invalid IS NULL`,
        [victimIds],
      );
      await client.query('COMMIT');
      return { softDeleted: victimIds, alreadyInvalid: [], errors: [] };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  }
}
