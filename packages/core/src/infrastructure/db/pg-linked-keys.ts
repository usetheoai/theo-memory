/**
 * Read side of the recall entity boost (M15 / theo-memory#122).
 *
 * Split out of `PgMemoryEntityStore` because it answers a different question from the rest
 * of that adapter: everything else there serves the WRITE path (upsert entities, link them
 * to a memory, supersede, forget), while this serves the hot READ path that ranks recall
 * candidates. Different reason to change, different module.
 */
import type { Filters } from '../../domain/scope.js';
import type { Pool } from 'pg';

/**
 * Returns the `normalized_key` values linked to each of the given memories, in ONE query.
 *
 * Driven by the candidate ids rather than by the entity table. The candidates arrive already
 * bounded by the pipeline's over-fetch limit, so `memory_id = ANY($1)` is index-served by the
 * `memory_entities` primary key, whose leading column is `memory_id`. A query per candidate
 * would put one round-trip per candidate on the hot read path; scanning the scope's entities
 * to match them against the query text would have no upper bound at all.
 *
 * ## Scope is enforced here, not inherited
 *
 * The candidate ids already passed scope filtering in the vector search, so no unauthorized
 * MEMORY can appear. That argument does NOT extend to the entities joined onto them:
 * `memory_entities` carries no scope column, and `supersedeEntity` repoints links validating
 * the workspace only. No shipped write path produces a cross-scope link today, but relying on
 * that is inheriting an invariant instead of enforcing one. The WHERE clause below reuses the
 * same COALESCE idiom as `PgMemoryEntityStore.list`, byte for byte.
 *
 * ## Superseded entities are excluded
 *
 * `entities_scope_type_key_uq` does not include `superseded_by`, so a superseded row keeps
 * its unique slot and a later `upsertAndLink` resolves `ON CONFLICT` straight back to it,
 * linking a fresh memory to a retired alias. Without this predicate the ranking would be
 * boosted by an entity that `list`, the dashboard and the graph view all hide — a signal
 * invisible to every audit surface. `entities_live_idx` serves the predicate.
 *
 * @param filters - the same scope filters the recall pipeline is running under. `workspace_id`
 *   absent resolves to `'default'`, symmetric with the write path in `entity-linking.ts`;
 *   letting `undefined` reach the SQL comparison would compare against NULL, match nothing,
 *   and leave the boost silently at zero, which is the failure class #122 is.
 * @returns memory id to its linked keys. Memories with no link are absent from the map.
 */
export async function queryLinkedKeysForMemories(
  pool: Pool,
  params: { memoryIds: readonly string[]; filters: Filters },
): Promise<ReadonlyMap<string, readonly string[]>> {
  const byMemory = new Map<string, string[]>();
  if (params.memoryIds.length === 0) {
    return byMemory; // no candidates, no work — never reach for the pool
  }

  const { filters } = params;
  const { rows } = await pool.query<{ memory_id: string; normalized_key: string | null }>(
    `SELECT me.memory_id, e.normalized_key
       FROM memory_entities me
       JOIN entities e ON e.id = me.entity_id
      WHERE me.memory_id = ANY($1::uuid[])
        AND e.workspace_id = $2
        AND e.superseded_by IS NULL
        AND COALESCE(e.user_id,'') = COALESCE($3,'')
        AND COALESCE(e.session_id,'') = COALESCE($4,'')
        AND COALESCE(e.agent_id,'') = COALESCE($5,'')
        AND e.normalized_key IS NOT NULL`,
    [
      params.memoryIds,
      filters.workspace_id ?? 'default',
      filters.user_id ?? null,
      filters.session_id ?? null,
      filters.agent_id ?? null,
    ],
  );

  for (const row of rows) {
    if (row.normalized_key === null) {
      continue;
    }
    const keys = byMemory.get(row.memory_id);
    if (keys === undefined) {
      byMemory.set(row.memory_id, [row.normalized_key]);
    } else {
      keys.push(row.normalized_key);
    }
  }
  return byMemory;
}
