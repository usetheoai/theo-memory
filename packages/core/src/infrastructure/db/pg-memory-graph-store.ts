/**
 * PgMemoryGraphStore — default MemoryGraphStore adapter (raw SQL over pg.Pool).
 *
 * Persist + read for relation edges. `upsertEdges` resolves each triple's endpoint
 * names to entity ids by `(scope, normalized_key)` — deterministic via
 * `ORDER BY created_at ASC LIMIT 1` (EC-2: `compromise` POS non-determinism can
 * create two nodes sharing a normalized_key with different `type`; the earliest
 * wins) — then UPSERTs the edge into `entity_edges` (dedup by the EC-1 UNIQUE that
 * INCLUDES `source_memory_id`, so `memoryCount` aggregates across memories). One
 * transaction per memory; the caller (Phase 7) is fail-soft and swallows the throw.
 * Endpoints that do not resolve to an existing node are skipped (D5).
 *
 */
import type { Pool, PoolClient } from 'pg';

import type {
  EdgeSummary,
  ListEdgesParams,
  MemoryGraphStore,
  UpsertEdgesParams,
} from '../../domain/dip/memory-graph-store.js';

/** EC-1 dedup arbiter — column-for-column match of `entity_edges_scope_triple_uq`
 *  (incl. the `::text` cast on the nullable `source_memory_id`, which is
 *  load-bearing: the index is on `COALESCE(source_memory_id::text,'')`, so the
 *  ON CONFLICT inference must use the identical expression). DO UPDATE the no-op
 *  `relation = entity_edges.relation` so the row id is RETURNED in one round-trip
 *  (first-write-wins on the human label; mirrors the v0.10.1 entity upsert). */
const ON_CONFLICT_SCOPE_TRIPLE_RETURNING =
  `ON CONFLICT (workspace_id, COALESCE(user_id,''), COALESCE(session_id,''),` +
  ` COALESCE(agent_id,''), source_entity_id, normalized_relation, target_entity_id,` +
  ` COALESCE(source_memory_id::text,'')) DO UPDATE SET relation = entity_edges.relation`;

export class PgMemoryGraphStore implements MemoryGraphStore {
  constructor(private readonly pool: Pool) {}

  async upsertEdges(params: UpsertEdgesParams): Promise<void> {
    if (params.edges.length === 0) return;
    const { memoryId, workspaceId, filters } = params;
    const userId = filters.user_id ?? null;
    const sessionId = filters.session_id ?? null;
    const agentId = filters.agent_id ?? null;

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (const e of params.edges) {
        if (e.normalizedRelation.length < 1) continue;
        const sourceId = await this.resolveEntityId(client, workspaceId, userId, sessionId, agentId, e.normalizedSourceKey);
        const targetId = await this.resolveEntityId(client, workspaceId, userId, sessionId, agentId, e.normalizedTargetKey);
        // D5: an endpoint the node extractor did not produce → skip (fail-soft).
        if (sourceId === undefined || targetId === undefined) continue;

        // M1 supersession (ADR-M1-1): a new (source, relation, target) invalidates
        // a PRIOR active edge with the SAME (scope, source_entity, normalized_relation)
        // but a DIFFERENT target — "X loves A" then "X loves B" retires the A edge
        // (history preserved via t_invalid, not deleted). Same-triple re-assert is a
        // no-op here (target_entity_id <> $7 excludes it) and dedups via ON CONFLICT.
        await client.query(
          `UPDATE entity_edges SET t_invalid = now()
             WHERE workspace_id = $1
               AND COALESCE(user_id,'') = COALESCE($2::text,'')
               AND COALESCE(session_id,'') = COALESCE($3::text,'')
               AND COALESCE(agent_id,'') = COALESCE($4::text,'')
               AND source_entity_id = $5
               AND normalized_relation = $6
               AND target_entity_id <> $7
               AND t_invalid IS NULL`,
          [workspaceId, userId, sessionId, agentId, sourceId, e.normalizedRelation, targetId],
        );

        await client.query(
          `INSERT INTO entity_edges
             (workspace_id, source_entity_id, target_entity_id, relation, normalized_relation, source_memory_id, user_id, session_id, agent_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ${ON_CONFLICT_SCOPE_TRIPLE_RETURNING}
           RETURNING id`,
          [workspaceId, sourceId, targetId, e.relation, e.normalizedRelation, memoryId, userId, sessionId, agentId],
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * M1 forget-propagation — invalidate every currently-active edge produced by
   * `memoryId`. `source_memory_id` is a globally-unique UUID, so no scope filter
   * is needed. Idempotent (`t_invalid IS NULL` guard).
   */
  async invalidateEdgesByMemory(memoryId: string): Promise<void> {
    await this.pool.query(
      `UPDATE entity_edges SET t_invalid = now()
         WHERE source_memory_id = $1 AND t_invalid IS NULL`,
      [memoryId],
    );
  }

  /** EC-2: resolve an endpoint name (already normalized by the caller — do NOT
   *  re-normalize) to its entity id by `(scope, normalized_key)`. Earliest node
   *  wins so a duplicate key (PROPER vs COMPOUND) resolves deterministically.
   *  M13 T2.2 (#111): superseded rows are excluded — new edges must attach to the
   *  live identity, never resurrect a mechanism-labeled predecessor. */
  private async resolveEntityId(
    client: PoolClient,
    workspaceId: string,
    userId: string | null,
    sessionId: string | null,
    agentId: string | null,
    normalizedKey: string,
  ): Promise<string | undefined> {
    const { rows } = await client.query<{ id: string }>(
      `SELECT id FROM entities
        WHERE workspace_id = $1
          AND COALESCE(user_id,'') = COALESCE($2,'')
          AND COALESCE(session_id,'') = COALESCE($3,'')
          AND COALESCE(agent_id,'') = COALESCE($4,'')
          AND normalized_key = $5
          AND superseded_by IS NULL
        ORDER BY created_at ASC
        LIMIT 1`,
      [workspaceId, userId, sessionId, agentId, normalizedKey],
    );
    return rows[0]?.id;
  }

  async listEdges(params: ListEdgesParams): Promise<readonly EdgeSummary[]> {
    const { workspaceId, filters } = params;
    // EC-1: count(DISTINCT source_memory_id) aggregates the SAME triple across
    // memories (the UNIQUE includes source_memory_id → one row per (triple, memory)).
    // Scope WHERE is on the edge's OWN scope columns (ee.*), $N-bound.
    const { rows } = await this.pool.query<{
      source: string;
      relation: string;
      target: string;
      memory_count: string;
      active: boolean;
    }>(
      // M1 — `active` = bool_or(t_invalid IS NULL): a triple is active if ANY of
      // its rows is still valid. In the audit view (includeSuperseded) this lets
      // the consumer distinguish retired edges from active ones per triple.
      `SELECT se.name AS source, ee.relation AS relation, te.name AS target,
              count(DISTINCT ee.source_memory_id) AS memory_count,
              bool_or(ee.t_invalid IS NULL AND source.t_invalid IS NULL AND (source.expires_at IS NULL OR source.expires_at>NOW())) AS active
         FROM entity_edges ee
         JOIN memories source ON source.id=ee.source_memory_id
         JOIN entities se ON se.id = ee.source_entity_id
         JOIN entities te ON te.id = ee.target_entity_id
        WHERE ee.workspace_id = $1
          AND COALESCE(ee.user_id,'') = COALESCE($2,'')
          AND COALESCE(ee.session_id,'') = COALESCE($3,'')
          AND COALESCE(ee.agent_id,'') = COALESCE($4,'')
          AND (source.expires_at IS NULL OR source.expires_at>NOW())
          ${params.includeSuperseded === true ? '' : 'AND ee.t_invalid IS NULL AND source.t_invalid IS NULL'}
        GROUP BY se.name, ee.relation, te.name
        ORDER BY memory_count DESC, se.name ASC`,
      [workspaceId, filters.user_id ?? null, filters.session_id ?? null, filters.agent_id ?? null],
    );
    return rows.map((r) => ({
      source: r.source,
      relation: r.relation,
      target: r.target,
      memoryCount: Number(r.memory_count),
      active: r.active !== false, // default true (active-only view omits the column semantics)
    }));
  }
}
