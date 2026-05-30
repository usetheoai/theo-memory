/**
 * PgNearestNeighborProvider — Postgres-backed `NearestNeighborProvider` impl
 * for v0.4b long-tail multiplier per plan T4.1 (D16).
 *
 * Computes the cosine distance from a memory to its nearest non-self
 * non-invalidated neighbor in the same scope via the pgvector `<=>` operator.
 * The partial index `idx_memories_eviction_score` (T0.1) supports the
 * `(agent_id, ...) WHERE t_invalid IS NULL` filter; the embedding HNSW index
 * `memories_embedding_hnsw_idx` (v0.1) supports the `<=>` ordering.
 *
 * Singleton-scope fallback: when no other memory exists in the scope, the
 * query returns 0 rows and this provider returns 1.0 (max isolation → full
 * long-tail protection per blueprint D9).
 *
 * @see .claude/knowledge-base/plans/v0-4b-forgetting-pipeline-plan.md § T4.1 (D9 + D16)
 */
import type { Pool } from 'pg';

import type { NearestNeighborProvider } from './triadic-scoring-policy.js';

const NEAREST_NEIGHBOR_SQL = `WITH self AS (
    SELECT embedding FROM memories WHERE id = $1
  )
  SELECT m.embedding <=> (SELECT embedding FROM self) AS distance
    FROM memories m
   WHERE m.agent_id = $2
     AND m.id <> $1
     AND m.t_invalid IS NULL
   ORDER BY m.embedding <=> (SELECT embedding FROM self) ASC
   LIMIT 1`;

const MAX_ISOLATION_DISTANCE = 1;

export class PgNearestNeighborProvider implements NearestNeighborProvider {
  constructor(private readonly pool: Pool) {}

  async distance(memoryId: string, agentId: string): Promise<number> {
    const result = await this.pool.query<{ distance: number | string }>(
      NEAREST_NEIGHBOR_SQL,
      [memoryId, agentId],
    );
    const row = result.rows[0];
    if (row === undefined) {
      return MAX_ISOLATION_DISTANCE;
    }
    return typeof row.distance === 'string' ? Number(row.distance) : row.distance;
  }
}
