/**
 * PgMemoryEntityStore — default MemoryEntityStore adapter (raw SQL over pg.Pool).
 *
 * Persist-only: UPSERTs extracted entities into `entities` (deduped by the EC-1
 * UNIQUE `entities_scope_type_key_uq` via ON CONFLICT DO NOTHING) and links each
 * to its source memory via `memory_entities` (composite-PK ON CONFLICT DO NOTHING).
 * One transaction per memory so a partial failure rolls back cleanly (the caller
 * Phase 7 is fail-soft and swallows the throw). Mirrors PgvectorStore's raw-SQL
 * + pool pattern; reuses the same ON CONFLICT clause the schema UNIQUE defines.
 *
 */
import type { Pool } from 'pg';

import type {
  EntityNodeSummary,
  ListEntitiesParams,
  MemoryEntityStore,
  UpsertAndLinkParams,
} from '../../domain/dip/memory-entity-store.js';

/** F-L7: DO UPDATE the no-op `name = entities.name` so the conflicting row's id is
 *  RETURNED in one round-trip (a plain DO NOTHING returns no row on conflict,
 *  forcing a second SELECT). First-write-wins preserved (existing name/embedding
 *  kept — EXCLUDED is NOT applied). Arbiter matches `entities_scope_type_key_uq`. */
const ON_CONFLICT_SCOPE_TYPE_KEY_RETURNING =
  `ON CONFLICT (workspace_id, COALESCE(user_id,''), COALESCE(session_id,''),` +
  ` COALESCE(agent_id,''), COALESCE(type,''), COALESCE(normalized_key,'')) DO UPDATE SET name = entities.name`;

function toVectorLiteral(embedding: readonly number[]): string {
  return `[${embedding.join(',')}]`;
}

export class PgMemoryEntityStore implements MemoryEntityStore {
  constructor(private readonly pool: Pool) {}

  async upsertAndLink(params: UpsertAndLinkParams): Promise<void> {
    if (params.entities.length === 0) return;
    const { memoryId, workspaceId, filters } = params;
    const userId = filters.user_id ?? null;
    const sessionId = filters.session_id ?? null;
    const agentId = filters.agent_id ?? null;

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (const e of params.entities) {
        // EC-2 defense-in-depth at the persist boundary.
        const name = e.name.trim();
        if (name.length < 2 || e.normalizedKey.length < 2) continue;
        // F-M2 (/review): a zero-dim embedding would render as '[]'::vector and
        // fail the fixed-dim cast, rolling back the WHOLE memory's entity batch
        // (silent link loss). Skip the bad entity instead — mirrors Phase 3's
        // embed_zero_dim_skipped guard. The pipeline also filters these upstream.
        if (e.embedding.length === 0) continue;

        // UPSERT the entity in ONE round-trip (F-L7): DO UPDATE the no-op
        // `name = entities.name` so the conflicting row is "touched" and its id is
        // RETURNED (a plain DO NOTHING returns no row on conflict, forcing a second
        // SELECT). First-write-wins on the identity columns is preserved — the
        // no-op SET keeps the existing name/embedding (EXCLUDED is NOT applied).
        const ins = await client.query<{ id: string }>(
          `INSERT INTO entities
             (workspace_id, name, embedding, payload, type, normalized_key, user_id, session_id, agent_id)
           VALUES ($1, $2, $3::vector, '{}'::jsonb, $4, $5, $6, $7, $8)
           ${ON_CONFLICT_SCOPE_TYPE_KEY_RETURNING}
           RETURNING id`,
          [workspaceId, name, toVectorLiteral(e.embedding), e.type, e.normalizedKey, userId, sessionId, agentId],
        );

        const entityId = ins.rows[0]?.id;
        if (entityId === undefined) continue;

        await client.query(
          `INSERT INTO memory_entities (memory_id, entity_id) VALUES ($1, $2)
           ON CONFLICT (memory_id, entity_id) DO NOTHING`,
          [memoryId, entityId],
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

  async list(params: ListEntitiesParams): Promise<readonly EntityNodeSummary[]> {
    const { workspaceId, filters } = params;
    // ADR D4: 3-table join. memoryCount = COUNT(DISTINCT memory_id); lastSeenAt =
    // MAX(linked memory created_at) (NOT entities.created_at — first-write per dedup).
    // Scope WHERE reuses the EC-1 COALESCE idiom byte-for-byte; all values $N-bound.
    const { rows } = await this.pool.query<{
      id: string;
      name: string;
      type: string | null;
      memory_count: string;
      last_seen_at: Date;
      summary: string | null;
    }>(
      // M2 (ADR-M2-1): the `summary` LATERAL computes an on-demand deterministic
      // digest of the entity's currently-ACTIVE outgoing relations (`t_invalid IS
      // NULL`, so it evolves with M1 supersession). DISTINCT + ORDER BY for a
      // stable string; COALESCE('') so the DTO field is never NULL. Zero LLM. The
      // partial index `entity_edges_active_idx` (M1) serves the subquery.
      `SELECT e.id, e.name, e.type,
              COUNT(DISTINCT me.memory_id) AS memory_count,
              MAX(m.created_at) AS last_seen_at,
              COALESCE(s.summary, '') AS summary
         FROM entities e
         JOIN memory_entities me ON me.entity_id = e.id
         JOIN memories m ON m.id = me.memory_id
         LEFT JOIN LATERAL (
           SELECT string_agg(rel, '; ' ORDER BY rel) AS summary
             FROM (
               SELECT DISTINCT ee.normalized_relation || ' → ' || te.name AS rel
                 FROM entity_edges ee
                 JOIN entities te ON te.id = ee.target_entity_id
                WHERE ee.source_entity_id = e.id
                  AND ee.t_invalid IS NULL
             ) d
         ) s ON true
        WHERE e.workspace_id = $1
          AND COALESCE(e.user_id,'') = COALESCE($2,'')
          AND COALESCE(e.session_id,'') = COALESCE($3,'')
          AND COALESCE(e.agent_id,'') = COALESCE($4,'')
        GROUP BY e.id, s.summary
        ORDER BY memory_count DESC, e.name ASC`,
      [workspaceId, filters.user_id ?? null, filters.session_id ?? null, filters.agent_id ?? null],
    );
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      type: r.type ?? 'NOUN',
      memoryCount: Number(r.memory_count),
      lastSeenAt: r.last_seen_at instanceof Date ? r.last_seen_at.toISOString() : String(r.last_seen_at),
      summary: r.summary ?? '',
    }));
  }
}
