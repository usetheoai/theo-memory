/**
 * PgUsageCounterStore — Postgres adapter for the per-scope recall counter.
 *
 * Raw-SQL pg impl mirroring the edge-store UPSERT idiom (`pg-memory-graph-store.ts`).
 * The atomic `INSERT ... ON CONFLICT DO UPDATE SET recall_count = recall_count + 1`
 * is the lost-update guard: 50 concurrent increments yield exactly 50 because the
 * row-level lock the UNIQUE conflict takes serializes the read-modify-write inside
 * a single statement.
 *
 * EC-3 — the ON CONFLICT arbiter AND the getRecallCount WHERE use the byte-identical
 * `COALESCE(col,'')` expression as `scope_usage_counters_scope_uq` (schema.ts), and
 * `workspace_id` is normalized to `'default'` on BOTH paths. A divergence would
 * write one row and read another, pinning the metric at 0.
 *
 * @see .claude/knowledge-base/plans/themory-scoped-forget-and-retrieval-counter-plan.md § T2.2
 */
import type { Pool } from 'pg';

import type { UsageCounterStore } from '../../domain/dip/usage-counter-store.js';
import type { Filters } from '../../domain/scope.js';

/** EC-3 arbiter — column-for-column match of `scope_usage_counters_scope_uq`. */
const ON_CONFLICT_SCOPE_TUPLE =
  `ON CONFLICT (workspace_id, COALESCE(user_id,''), COALESCE(session_id,''),` +
  ` COALESCE(agent_id,'')) DO UPDATE SET` +
  ` recall_count = scope_usage_counters.recall_count + 1, updated_at = NOW()`;

export class PgUsageCounterStore implements UsageCounterStore {
  constructor(private readonly pool: Pool) {}

  async increment(filters: Filters): Promise<void> {
    const workspaceId = filters.workspace_id ?? 'default';
    const userId = filters.user_id ?? null;
    const sessionId = filters.session_id ?? null;
    const agentId = filters.agent_id ?? null;

    await this.pool.query(
      `INSERT INTO scope_usage_counters
         (workspace_id, user_id, session_id, agent_id, recall_count)
       VALUES ($1, $2, $3, $4, 1)
       ${ON_CONFLICT_SCOPE_TUPLE}`,
      [workspaceId, userId, sessionId, agentId],
    );
  }

  async getRecallCount(filters: Filters): Promise<number> {
    const workspaceId = filters.workspace_id ?? 'default';
    const userId = filters.user_id ?? null;
    const sessionId = filters.session_id ?? null;
    const agentId = filters.agent_id ?? null;

    // node-postgres returns int8/bigint as a STRING (precision-safe default), so
    // coerce to a JS number here — the per-scope recall count is well within
    // Number.MAX_SAFE_INTEGER for any realistic deployment.
    const { rows } = await this.pool.query<{ recall_count: string }>(
      `SELECT recall_count FROM scope_usage_counters
        WHERE workspace_id = $1
          AND COALESCE(user_id,'') = COALESCE($2,'')
          AND COALESCE(session_id,'') = COALESCE($3,'')
          AND COALESCE(agent_id,'') = COALESCE($4,'')`,
      [workspaceId, userId, sessionId, agentId],
    );
    return rows[0] === undefined ? 0 : Number(rows[0].recall_count);
  }
}
