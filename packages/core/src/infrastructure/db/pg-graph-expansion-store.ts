/**
 * PgGraphExpansionStore — the production `GraphExpansionStore` (the JOIN traversal
 * over the EXISTING `memory_entities` / `entity_edges` / `memories` tables; NO
 * graph DB, NO new migration). graph-aware-recall T4.1.
 *
 * 1 hop (default): memories sharing ≥1 entity with the seeds. 2 hops (opt-in):
 * additionally memories whose entity is connected to a seed entity via an
 * `entity_edges` relation. Always scope-confined to the recall `filters` (EC-2,
 * ADR D5 — candidate-side scope filter) + LIMIT-bounded (fan-out guard) + seeds
 * excluded (EC-1). Returns the connected memory rows projected via the shared
 * `rowToResult` (DRY) + `sharedEntities` weight.
 *
 * @see .claude/knowledge-base/plans/graph-aware-recall-plan.md § T4.1 + ADR D2 + D5
 * @see src/domain/dip/graph-expansion-store.ts
 */
import type { Pool } from 'pg';

import type {
  ExpandByEntitiesParams,
  GraphExpansionRow,
  GraphExpansionStore,
} from '../../domain/dip/graph-expansion-store.js';

import { rowToResult, type MemoriesRow } from './pgvector-store.js';

interface ExpansionDbRow extends MemoriesRow {
  shared_entities: string | number;
}

export class PgGraphExpansionStore implements GraphExpansionStore {
  constructor(private readonly pool: Pool) {}

  async expandByEntities(params: ExpandByEntitiesParams): Promise<readonly GraphExpansionRow[]> {
    const { seedMemoryIds, filters, hops, limit } = params;
    if (seedMemoryIds.length === 0) return [];

    // $1 = seed ids; $2 = workspace; $3/$4/$5 = user/session/agent scope; $6 = limit.
    const ws = filters.workspace_id ?? 'default';
    const params2 = [
      seedMemoryIds,
      ws,
      filters.user_id ?? null,
      filters.session_id ?? null,
      filters.agent_id ?? null,
      limit,
    ];

    // hop-2 extends the relevant entity set with edge-connected entities (scope-confined on the edge).
    const expandedEntitiesCte =
      hops >= 2
        ? `expanded_entities AS (
             SELECT entity_id FROM seed_entities
             UNION
             SELECT ee.target_entity_id AS entity_id
               FROM entity_edges ee JOIN seed_entities s ON ee.source_entity_id = s.entity_id
              WHERE ee.workspace_id = $2
                AND COALESCE(ee.user_id,'') = COALESCE($3::text,'')
                AND COALESCE(ee.session_id,'') = COALESCE($4::text,'')
                AND COALESCE(ee.agent_id,'') = COALESCE($5::text,'')
             UNION
             SELECT ee.source_entity_id AS entity_id
               FROM entity_edges ee JOIN seed_entities s ON ee.target_entity_id = s.entity_id
              WHERE ee.workspace_id = $2
                AND COALESCE(ee.user_id,'') = COALESCE($3::text,'')
                AND COALESCE(ee.session_id,'') = COALESCE($4::text,'')
                AND COALESCE(ee.agent_id,'') = COALESCE($5::text,'')
           )`
        : `expanded_entities AS (SELECT entity_id FROM seed_entities)`;

    const sql = `
      WITH seed_entities AS (
        SELECT DISTINCT entity_id FROM memory_entities WHERE memory_id = ANY($1::uuid[])
      ),
      ${expandedEntitiesCte}
      SELECT m.id, m.text, m.hash, m.payload, m.workspace_id, m.user_id, m.session_id, m.agent_id,
             m.attributed_to, m.category, m.kind, m.code, m.description, m.code_language,
             m.derived_from, m.superseded_by, m.confirmation_count,
             count(DISTINCT me.entity_id) AS shared_entities
        FROM memory_entities me
        JOIN expanded_entities xe ON xe.entity_id = me.entity_id
        JOIN memories m ON m.id = me.memory_id
       WHERE me.memory_id <> ALL($1::uuid[])
         AND m.workspace_id = $2
         AND COALESCE(m.user_id,'') = COALESCE($3::text,'')
         AND COALESCE(m.session_id,'') = COALESCE($4::text,'')
         AND COALESCE(m.agent_id,'') = COALESCE($5::text,'')
       GROUP BY m.id
       ORDER BY shared_entities DESC, m.id
       LIMIT $6
    `;

    const result = await this.pool.query<ExpansionDbRow>(sql, params2);
    return result.rows.map((row) => ({
      result: rowToResult(row),
      sharedEntities: typeof row.shared_entities === 'number' ? row.shared_entities : Number(row.shared_entities),
    }));
  }
}
