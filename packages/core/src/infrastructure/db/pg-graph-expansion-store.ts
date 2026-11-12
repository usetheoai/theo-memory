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
 * @see src/domain/dip/graph-expansion-store.ts
 */
import type { Pool } from 'pg';

import type {
  ExpandByEntitiesParams,
  GraphExpansionRow,
  GraphExpansionStore,
} from '../../domain/dip/graph-expansion-store.js';

import { rowToResult, type MemoriesRow } from './pgvector-store.js';
import { composeTemporalWhere } from './temporal-where.js';

interface ExpansionDbRow extends MemoriesRow {
  shared_entities: string | number;
}

export class PgGraphExpansionStore implements GraphExpansionStore {
  constructor(private readonly pool: Pool) {}

  async expandByEntities(params: ExpandByEntitiesParams): Promise<readonly GraphExpansionRow[]> {
    const { seedMemoryIds, filters, hops, limit } = params;
    if (seedMemoryIds.length === 0) return [];

    // $1 = seed ids; $2 = workspace; $3/$4/$5 = user/session/agent scope; then the
    // temporal params (M0, $6..); $temporal.nextParamIndex = limit.
    const ws = filters.workspace_id ?? 'default';
    // M0 (graph-aware recall temporal correctness): reuse the ADR-0011 bi-temporal
    // predicate (aliased to `m`) so graph expansion never resurfaces `t_invalid`
    // (superseded/evicted) memories and honors `asOf`. Scope params are $1..$5, so
    // the temporal params (0 when asOf omitted, 2 when set) start at $6; `LIMIT`
    // then binds at `temporal.nextParamIndex`.
    const temporal = composeTemporalWhere(filters.asOf, 6, 'm.');
    // M1 (ADR-M1-2) — the hop-2 CTE walks `entity_edges`; a superseded edge must
    // NOT expand the entity set. Reuse the SAME predicate with the `ee.` alias,
    // sharing the SAME asOf param positions ($6/$7) as `temporal` — so its params
    // are added to `params2` ONCE (edgeTemporal.params is identical, discarded).
    const edgeTemporal = composeTemporalWhere(filters.asOf, 6, 'ee.', false);
    const params2 = [
      seedMemoryIds,
      ws,
      filters.user_id ?? null,
      filters.session_id ?? null,
      filters.agent_id ?? null,
      ...temporal.params,
      limit,
    ];

    // INJECTION SAFETY (F-sec-1): the ONLY value that selects which SQL fragment
    // is built is `hops`, typed `1 | 2` at the DIP boundary (ExpandByEntitiesParams)
    // and sourced from `RecallOptions.graphExpand.hops` (also `1 | 2`). NO user
    // string is ever interpolated into the SQL — every value flows through the
    // parametrized `params2` array ($1..$N, N = temporal.nextParamIndex). Widening `hops` away from the `1 | 2`
    // literal union would require re-auditing this branch.
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
                AND ${edgeTemporal.sql}
                AND EXISTS (SELECT 1 FROM memories sm WHERE sm.id=ee.source_memory_id AND ${composeTemporalWhere(filters.asOf, 6, 'sm.').sql})
             UNION
             SELECT ee.source_entity_id AS entity_id
               FROM entity_edges ee JOIN seed_entities s ON ee.target_entity_id = s.entity_id
              WHERE ee.workspace_id = $2
                AND COALESCE(ee.user_id,'') = COALESCE($3::text,'')
                AND COALESCE(ee.session_id,'') = COALESCE($4::text,'')
                AND COALESCE(ee.agent_id,'') = COALESCE($5::text,'')
                AND ${edgeTemporal.sql}
                AND EXISTS (SELECT 1 FROM memories sm WHERE sm.id=ee.source_memory_id AND ${composeTemporalWhere(filters.asOf, 6, 'sm.').sql})
           )`
        : `expanded_entities AS (SELECT entity_id FROM seed_entities)`;

    const sql = `
      WITH seed_entities AS (
        SELECT DISTINCT entity_id FROM memory_entities WHERE memory_id = ANY($1::uuid[])
      ),
      ${expandedEntitiesCte}
      SELECT m.id, m.text, m.hash, m.payload, m.workspace_id, m.user_id, m.session_id, m.agent_id,
             m.attributed_to, m.category, m.kind, m.code, m.description, m.code_language,
             m.derived_from, m.superseded_by, m.t_valid, m.t_invalid, m.expires_at, m.distinct_source_count, m.confirmation_count,
             count(DISTINCT me.entity_id) AS shared_entities
        FROM memory_entities me
        JOIN expanded_entities xe ON xe.entity_id = me.entity_id
        -- M13 T2.2 (#111): live entities only — a superseded row must never carry
        -- an expansion path (defense in depth for mid-backfill residual links).
        JOIN entities ent ON ent.id = me.entity_id AND ent.superseded_by IS NULL
        JOIN memories m ON m.id = me.memory_id
       WHERE me.memory_id <> ALL($1::uuid[])
         AND m.workspace_id = $2
         AND COALESCE(m.user_id,'') = COALESCE($3::text,'')
         AND COALESCE(m.session_id,'') = COALESCE($4::text,'')
         AND COALESCE(m.agent_id,'') = COALESCE($5::text,'')
         AND ${temporal.sql}
       -- GROUP BY m.id only: m.id is the memories PRIMARY KEY, so every other
       -- selected m.* column is functionally dependent on it (Postgres permits
       -- this). A future non-m.* non-aggregated SELECT column MUST be added here
       -- or it will error (loud, not silent) — F-mem-4.
       GROUP BY m.id
       ORDER BY shared_entities DESC, m.id
       LIMIT $${temporal.nextParamIndex}
    `;

    const result = await this.pool.query<ExpansionDbRow>(sql, params2);
    return result.rows.map((row) => ({
      result: rowToResult(row),
      sharedEntities: typeof row.shared_entities === 'number' ? row.shared_entities : Number(row.shared_entities),
    }));
  }
}
