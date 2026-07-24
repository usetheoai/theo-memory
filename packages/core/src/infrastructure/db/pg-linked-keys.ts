/**
 * Read side of the recall entity boost (M15 / theo-memory#122).
 *
 * Split out of `PgMemoryEntityStore` because it answers a different question from the rest
 * of that adapter: everything else there serves the WRITE path (upsert entities, link them
 * to a memory, supersede, forget), while this serves the hot READ path that ranks recall
 * candidates. Different reason to change, different module.
 */
import type { Pool } from 'pg';

/**
 * Returns the `normalized_key` values linked to each of the given memories, in ONE query.
 *
 * Driven by the candidate ids rather than by the entity table. The candidates arrive already
 * bounded by the pipeline's over-fetch limit and already filtered for scope and `t_invalid`
 * by the vector search, so `memory_id = ANY($1)` is small and index-served. A query per
 * candidate would put up to ~120 round-trips on the hot read path; scanning the scope's
 * entities to match them against the query text would have no upper bound at all.
 *
 * @param workspaceId - defence in depth (the ids are already scoped). Absent resolves to
 *   `'default'`, matching the isolation guard used elsewhere in the local runtime — letting
 *   `undefined` reach the SQL comparison would compare against NULL, match nothing, and
 *   leave the boost silently at zero, which is the failure class #122 is.
 * @returns memory id to its linked keys. Memories with no link are absent from the map.
 */
export async function queryLinkedKeysForMemories(
  pool: Pool,
  params: { memoryIds: readonly string[]; workspaceId?: string | undefined },
): Promise<ReadonlyMap<string, readonly string[]>> {
  const byMemory = new Map<string, string[]>();
  if (params.memoryIds.length === 0) {
    return byMemory; // no candidates, no work — never reach for the pool
  }

  const { rows } = await pool.query<{ memory_id: string; normalized_key: string | null }>(
    `SELECT me.memory_id, e.normalized_key
       FROM memory_entities me
       JOIN entities e ON e.id = me.entity_id
      WHERE me.memory_id = ANY($1::uuid[])
        AND e.workspace_id = $2
        AND e.normalized_key IS NOT NULL`,
    [params.memoryIds, params.workspaceId ?? 'default'],
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
