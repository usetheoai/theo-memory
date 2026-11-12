/**
 * PgNearestNeighborProvider — Postgres-backed `NearestNeighborProvider` impl
 * for v0.4b long-tail multiplier per plan T4.1 (D16).
 *
 * Computes the cosine distance from a memory to its nearest non-self
 * non-invalidated neighbor in the same scope via the pgvector `<=>` operator.
 * v0.4b-fixes T3.1 generalized the scope tier from the previous
 * `agent_id`-only WHERE clause to the full `Scope` discriminated union; the
 * column predicate is selected at runtime via `scopeColumn(scope)`.
 *
 * Singleton-scope fallback: when no other memory exists in the scope, the
 * query returns 0 rows and this provider returns 1.0 (max isolation → full
 * long-tail protection per blueprint D9).
 *
 */
import type { Pool } from 'pg';

import type { NearestNeighbor, NearestNeighborProvider } from '../../../domain/dip/eviction-policy.js';
import type { Scope } from '../../../domain/scope.js';

import { scopeColumn, scopeValue } from './scope-where.js';

const MAX_ISOLATION_DISTANCE = 1;

export class PgNearestNeighborProvider implements NearestNeighborProvider {
  constructor(private readonly pool: Pool) {}

  async distance(memoryId: string, scope: Scope, workspaceId?: string): Promise<number> {
    return (await this.nearest(memoryId, scope, workspaceId))?.distance ?? MAX_ISOLATION_DISTANCE;
  }

  async nearest(memoryId: string, scope: Scope, workspaceId?: string): Promise<NearestNeighbor | null> {
    const column = scopeColumn(scope);
    // multi-tenant-rbac-and-slice1-completion T3.1 (Slice 1 100%): when a
    // workspace is bound, restrict the neighbor search to the same tenant so a
    // ws-B memory never lowers a ws-A row's isolation distance (which would bias
    // ws-A's eviction choice — a cross-workspace information bleed).
    const wsClause = workspaceId !== undefined ? ' AND m.workspace_id = $3' : '';
    const sql = `WITH self AS (
        SELECT embedding FROM memories WHERE id = $1
      )
      SELECT m.id, m.embedding <=> (SELECT embedding FROM self) AS distance
        FROM memories m
       WHERE m.${column} = $2
         AND m.id <> $1
         AND m.t_invalid IS NULL${wsClause}
       ORDER BY m.embedding <=> (SELECT embedding FROM self) ASC
       LIMIT 1`;
    const params: readonly (string)[] =
      workspaceId !== undefined
        ? [memoryId, scopeValue(scope), workspaceId]
        : [memoryId, scopeValue(scope)];
    const result = await this.pool.query<{ id: string; distance: number | string }>(
      sql,
      [...params],
    );
    const row = result.rows[0];
    if (row === undefined) {
      return null;
    }
    return { id: row.id, distance: typeof row.distance === 'string' ? Number(row.distance) : row.distance };
  }
}
