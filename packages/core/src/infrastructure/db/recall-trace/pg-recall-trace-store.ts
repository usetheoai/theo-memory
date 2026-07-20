/**
 * PgRecallTraceStore — Postgres adapter for the S1 recall-trace write surface
 * (explainable-recall T2.1). Default `RecallTraceStore` impl.
 *
 * Raw parameterized SQL (mirrors `pg-usage-counter-store.ts`), NOT the drizzle
 * query builder — the drizzle `recallTraces` def is the schema source-of-truth
 * for migrations; reads/writes go through raw SQL for a lean hot path.
 *
 * `record` is a single multi-row INSERT of the dropped candidates, capped at
 * `maxRowsPerRecall` (the pipeline also truncates via `recallTraceContext.maxRows`;
 * this cap is defence-in-depth on the direct-SDK path). An empty batch is a no-op.
 *
 * @see plan explainable-recall § Phase 2 / T2.1
 * @see package.json#exports."./recall-trace-pg"
 */
import type { Pool } from 'pg';

import {
  DEFAULT_MAX_ROWS_PER_RECALL,
  type DropReason,
  type RecallTraceBatch,
  type RecallTraceRow,
  type RecallTraceStore,
  type RecallTraceStoreConfig,
} from '../../../domain/dip/recall-trace-store.js';

const COLUMNS =
  'recall_id, workspace_id, scope_key, memory_id, semantic, bm25, entity, composite, threshold, drop_reason';

const SELECT_BY_RECALL_ID =
  `SELECT recall_id, workspace_id, scope_key, memory_id, semantic, bm25, entity,` +
  ` composite, threshold, drop_reason, created_at` +
  // explainable-recall S2 (D3) — the workspace predicate is the tenant boundary:
  // a recall_id minted under another workspace returns 0 rows (CWE-441 / IDOR).
  ` FROM recall_traces WHERE recall_id = $1 AND workspace_id = $2 ORDER BY created_at ASC, id ASC`;

/** node-postgres row shape for `recall_traces` (real → number, text → string). */
interface RawTraceRow {
  readonly recall_id: string;
  readonly workspace_id: string;
  readonly scope_key: string;
  readonly memory_id: string;
  readonly semantic: number;
  readonly bm25: number;
  readonly entity: number;
  readonly composite: number | null;
  readonly threshold: number;
  readonly drop_reason: string;
  readonly created_at: Date;
}

function toRow(r: RawTraceRow): RecallTraceRow {
  return {
    recallId: r.recall_id,
    workspaceId: r.workspace_id,
    scopeKey: r.scope_key,
    memoryId: r.memory_id,
    semantic: r.semantic,
    bm25: r.bm25,
    entity: r.entity,
    composite: r.composite,
    threshold: r.threshold,
    dropReason: r.drop_reason as DropReason,
    createdAt: r.created_at,
  };
}

export class PgRecallTraceStore implements RecallTraceStore {
  private readonly maxRowsPerRecall: number;

  constructor(
    private readonly pool: Pool,
    config: RecallTraceStoreConfig = {},
  ) {
    this.maxRowsPerRecall = config.maxRowsPerRecall ?? DEFAULT_MAX_ROWS_PER_RECALL;
  }

  async record(batch: RecallTraceBatch): Promise<void> {
    const rows = batch.rows.slice(0, this.maxRowsPerRecall);
    if (rows.length === 0) {
      return;
    }
    const values: unknown[] = [];
    const tuples: string[] = [];
    for (const row of rows) {
      const base = values.length;
      tuples.push(
        `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},` +
          `$${base + 6},$${base + 7},$${base + 8},$${base + 9},$${base + 10})`,
      );
      values.push(
        batch.recallId,
        batch.workspaceId,
        batch.scopeKey,
        row.memoryId,
        row.semantic,
        row.bm25,
        row.entity,
        row.composite,
        row.threshold,
        row.dropReason,
      );
    }
    await this.pool.query(
      `INSERT INTO recall_traces (${COLUMNS}) VALUES ${tuples.join(',')}`,
      values,
    );
  }

  async getByRecallId(
    recallId: string,
    workspaceId: string,
  ): Promise<readonly RecallTraceRow[]> {
    const { rows } = await this.pool.query<RawTraceRow>(SELECT_BY_RECALL_ID, [recallId, workspaceId]);
    return rows.map(toRow);
  }
}
