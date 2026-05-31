/**
 * PgHalfLifePersister — Postgres-backed `HalfLifePersister` impl for v0.4b
 * lazy `half_life_seconds` backfill per plan T2.2 (D14).
 *
 * Issues a single UPDATE per scoring call when the row's `half_life_seconds`
 * is NULL. The `WHERE id = $2 AND half_life_seconds IS NULL` guard makes the
 * UPDATE idempotent — a second scoring of the same row is a no-op (matching
 * tuple count = 0 even when the statement runs).
 *
 * The EC-1 stale-half-life-on-importance-update invariant is enforced at the
 * DB layer by trigger `memories_reset_half_life_on_importance_update_trg`
 * (migration 0004) — when `llm_importance_score` is UPDATEd to a different
 * value, the trigger sets `half_life_seconds = NULL` so the next scoring
 * re-backfills via this persister.
 *
 * @see .claude/knowledge-base/plans/v0-4b-forgetting-pipeline-plan.md § T2.2 (D14 + EC-1)
 */
import type { Pool } from 'pg';

import type { HalfLifePersister } from '../../core/dip/eviction-policy.js';

const PERSIST_HALF_LIFE_SQL = `UPDATE memories
   SET half_life_seconds = $1
 WHERE id = $2
   AND half_life_seconds IS NULL`;

export class PgHalfLifePersister implements HalfLifePersister {
  constructor(private readonly pool: Pool) {}

  async persist(memoryId: string, halfLifeSeconds: number): Promise<void> {
    await this.pool.query(PERSIST_HALF_LIFE_SQL, [halfLifeSeconds, memoryId]);
  }
}
