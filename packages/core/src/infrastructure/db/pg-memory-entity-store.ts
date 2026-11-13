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
import type { Tracer } from '@opentelemetry/api';
import type { Pool } from 'pg';

import type {
  EntityNodeSummary,
  ForgetEntityResult,
  ListEntitiesParams,
  MemoryEntityStore,
  UpsertAndLinkParams,
} from '../../domain/dip/memory-entity-store.js';
import { EntityForgetScopeError } from '../../domain/dip/memory-entity-store.js';
import { emitEvent } from '../../domain/memory-event.js';
import type { Filters } from '../../domain/scope.js';

import { queryLinkedKeysForMemories } from './pg-linked-keys.js';
import { runInTx, scopeIds } from './pg-tx.js';

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
  constructor(
    private readonly pool: Pool,
    /** Optional OTel tracer — when present, `forgetEntity` emits `entity_forgotten` (Princípio 3). */
    private readonly tracer?: Tracer,
  ) {}

  async upsertAndLink(params: UpsertAndLinkParams): Promise<void> {
    if (params.entities.length === 0) return;
    const { memoryId, workspaceId, filters } = params;
    const { userId, sessionId, agentId } = scopeIds(filters);

    await runInTx(this.pool, async (client) => {
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
    });
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
         -- #115: LIVE memories only. Counting soft-deleted links made the
         -- dashboard offer "Forget N memories" for entities whose links were
         -- already forgotten (cascade then honestly deleted 0 — confusing).
         -- An entity with zero live links drops out of the listing entirely.
         JOIN memories m ON m.id = me.memory_id AND m.t_invalid IS NULL AND (m.expires_at IS NULL OR m.expires_at>NOW())
         LEFT JOIN LATERAL (
           SELECT string_agg(rel, '; ' ORDER BY rel) AS summary
             FROM (
               SELECT DISTINCT ee.normalized_relation || ' → ' || te.name AS rel
                 FROM entity_edges ee
                 JOIN memories source ON source.id=ee.source_memory_id AND source.t_invalid IS NULL AND (source.expires_at IS NULL OR source.expires_at>NOW())
                 JOIN entities te ON te.id = ee.target_entity_id
                WHERE ee.source_entity_id = e.id
                  AND te.superseded_by IS NULL
                  AND ee.t_invalid IS NULL
             ) d
         ) s ON true
        WHERE e.workspace_id = $1
          AND e.superseded_by IS NULL
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

  /**
   * M13 T2.1 (#111) — auditable supersede in ONE transaction. The UPDATE's
   * `superseded_by IS NULL` predicate is the atomic arbiter for concurrent
   * calls (exactly one wins); the target is validated fail-closed BEFORE any
   * write (lesson theo-cloud#252). Never DELETE — links move, edges repoint,
   * the old row keeps its history behind the pointer.
   */
  async supersedeEntity(params: { oldId: string; newId: string; workspaceId: string }): Promise<boolean> {
    const { oldId, newId, workspaceId } = params;
    return runInTx(this.pool, async (client) => {
      // Fail-closed target validation (both rows, same workspace, new not superseded).
      const check = await client.query<{ id: string }>(
        `SELECT id FROM entities WHERE id = $1 AND workspace_id = $2 AND superseded_by IS NULL`,
        [newId, workspaceId],
      );
      if (check.rowCount === 0) {
        throw new Error(`supersedeEntity: target entity ${newId} not found (or superseded) in workspace`);
      }
      // Atomic arbiter: only the call that flips NULL→newId proceeds to repoint.
      const marked = await client.query(
        `UPDATE entities SET superseded_by = $1 WHERE id = $2 AND workspace_id = $3 AND superseded_by IS NULL`,
        [newId, oldId, workspaceId],
      );
      if ((marked.rowCount ?? 0) === 0) {
        return false; // already superseded (idempotent) or old row absent — no writes to roll back
      }
      // Repoint links: copy then drop (composite PK → ON CONFLICT DO NOTHING).
      await client.query(
        `INSERT INTO memory_entities (memory_id, entity_id)
         SELECT memory_id, $1 FROM memory_entities WHERE entity_id = $2
         ON CONFLICT DO NOTHING`,
        [newId, oldId],
      );
      await client.query(`DELETE FROM memory_entities WHERE entity_id = $1`, [oldId]);
      // Repoint edge endpoints (provenance source_memory_id untouched).
      // /review F-arch-1/F-dom-db-1: a blind UPDATE collides with
      // entity_edges_scope_triple_uq when NEW already carries the identical
      // triple — drop the colliding old-side row FIRST (its image already
      // exists), then repoint the remainder. Same shape as the links path.
      for (const [endpoint, mirror] of [
        ['source_entity_id', 'target_entity_id'],
        ['target_entity_id', 'source_entity_id'],
      ] as const) {
        await client.query(
          `DELETE FROM entity_edges old
            WHERE old.${endpoint} = $2 AND old.workspace_id = $3
              AND EXISTS (SELECT 1 FROM entity_edges nw
                    WHERE nw.workspace_id = old.workspace_id
                      AND COALESCE(nw.user_id,'') = COALESCE(old.user_id,'')
                      AND COALESCE(nw.session_id,'') = COALESCE(old.session_id,'')
                      AND COALESCE(nw.agent_id,'') = COALESCE(old.agent_id,'')
                      AND nw.${endpoint} = $1
                      AND nw.${mirror} = old.${mirror}
                      AND nw.normalized_relation = old.normalized_relation
                      AND COALESCE(nw.source_memory_id::text,'') = COALESCE(old.source_memory_id::text,''))`,
          [newId, oldId, workspaceId],
        );
        await client.query(
          `UPDATE entity_edges SET ${endpoint} = $1 WHERE ${endpoint} = $2 AND workspace_id = $3`,
          [newId, oldId, workspaceId],
        );
      }
      return true;
    });
  }

  async forgetEntity(params: {
    name: string;
    workspaceId: string;
    filters: Filters;
  }): Promise<ForgetEntityResult> {
    const { name, workspaceId, filters } = params;
    // FAIL-CLOSED (#252): an under-constrained scope must ABORT before ANY database work.
    // A user-tier delete requires a confirmed user; without it we would delete every
    // matching entity across the whole workspace — the exact open-scope wipe of the
    // cascade-delete incident. Throw BEFORE `pool.connect()` so nothing is touched.
    const userId = filters.user_id;
    if (userId === undefined || userId === '') {
      throw new EntityForgetScopeError(
        `forgetEntity(${name}) requires filters.user_id — refusing an open-scope delete.`,
      );
    }
    const { sessionId, agentId } = scopeIds(filters);

    const result = await runInTx(this.pool, async (client): Promise<ForgetEntityResult> => {
      // Resolve the target entity ids by name, scoped to (workspace, user[, session, agent]).
      const found = await client.query<{ id: string }>(
        `SELECT id FROM entities
          WHERE name = $1 AND workspace_id = $2
            AND COALESCE(user_id,'') = COALESCE($3,'')
            AND COALESCE(session_id,'') = COALESCE($4,'')
            AND COALESCE(agent_id,'') = COALESCE($5,'')
            AND superseded_by IS NULL`,
        [name, workspaceId, userId, sessionId, agentId],
      );
      const ids = found.rows.map((r) => r.id);
      if (ids.length === 0) {
        return { entitiesRemoved: 0, linksRemoved: 0, edgesRemoved: 0 };
      }
      // Remove the derived graph (memories untouched): links, edges, then the node rows.
      const delLinks = await client.query(`DELETE FROM memory_entities WHERE entity_id = ANY($1::uuid[])`, [ids]);
      const delEdges = await client.query(
        `DELETE FROM entity_edges
          WHERE workspace_id = $2
            AND (source_entity_id = ANY($1::uuid[]) OR target_entity_id = ANY($1::uuid[]))`,
        [ids, workspaceId],
      );
      const delEnts = await client.query(`DELETE FROM entities WHERE id = ANY($1::uuid[]) AND workspace_id = $2`, [ids, workspaceId]);
      return {
        entitiesRemoved: delEnts.rowCount ?? 0,
        linksRemoved: delLinks.rowCount ?? 0,
        edgesRemoved: delEdges.rowCount ?? 0,
      };
    });

    // Princípio 3 — the (only) destructive graph decision is observable. The typed event is
    // the audit trail that replaces a soft-delete tombstone (entities has no `t_invalid`;
    // the graph is a re-extractable projection — ADR-M14-2 amendment). No-op without a tracer.
    if (result.entitiesRemoved > 0 || result.linksRemoved > 0 || result.edgesRemoved > 0) {
      emitEvent(this.tracer, 'entity_forgotten', {
        entities_removed: result.entitiesRemoved,
        links_removed: result.linksRemoved,
        edges_removed: result.edgesRemoved,
      });
    }
    return result;
  }

  /**
   * M15 T2.2 (#122) — read side of the recall entity boost. Delegates to
   * {@link queryLinkedKeysForMemories}: it serves the hot READ path that ranks candidates,
   * a different reason to change from the write-path methods above.
   */
  async linkedKeysForMemories(params: {
    memoryIds: readonly string[];
    filters: Filters;
  }): Promise<ReadonlyMap<string, readonly string[]>> {
    return queryLinkedKeysForMemories(this.pool, params);
  }
}
