/**
 * pgvector VectorStore — implements the {@link VectorStore} DIP via raw SQL
 * through `pg.Pool`. Schema lives in `src/local/schema.ts` + migrations.
 * Per-row fallback: batch INSERT in try/catch; on failure, iterate per-row.
 * Vector serialization via {@link vectorLiteral} ($N::vector). Skill CRUD
 * delegated to {@link PgvectorSkillStore} (T3.1 / F3).
 */
import type { Tracer } from '@opentelemetry/api';
import type { Pool, PoolClient, QueryResultRow } from 'pg';

import { MAX_EMBEDDING_DIM } from '../core/constants.js';
import type { VectorStore, VectorStoreResult } from '../core/dip/vector-store.js';
import { emitEvent } from '../core/memory-event.js';
import type { Filters } from '../core/scope.js';

import { PgvectorSkillStore } from './pgvector-skill-store.js';
import { vectorLiteral } from './pgvector-vector-literal.js';
import type { InsertDerivedSkillArgs, InsertSkillArgs } from './skill-store-args.js';

type Payload = Record<string, string | number | boolean | null>;

interface MemoriesRow extends QueryResultRow {
  readonly id: string;
  readonly text: string;
  readonly hash: string;
  readonly payload: Payload;
  readonly user_id: string | null;
  readonly session_id: string | null;
  readonly agent_id: string | null;
  readonly kind?: string | null;
  readonly code?: string | null;
  readonly description?: string | null;
  readonly code_language?: string | null;
  readonly derived_from?: unknown;
  readonly superseded_by?: string | null;
  readonly distance?: number;
  readonly rank?: number;
}

function rowToResult(row: MemoriesRow): VectorStoreResult {
  const payload: Payload = {
    ...row.payload,
    text: row.text,
    hash: row.hash,
  };
  if (row.user_id !== null) {
    payload['user_id'] = row.user_id;
  }
  if (row.session_id !== null) {
    payload['session_id'] = row.session_id;
  }
  if (row.agent_id !== null) {
    payload['agent_id'] = row.agent_id;
  }
  // v0.6 — project skill columns into payload when present (kind/code/description/code_language)
  // + provenance + supersession. Mirrors how user_id/session_id/agent_id are projected above.
  if (row.kind !== undefined && row.kind !== null) {
    payload['kind'] = row.kind;
  }
  if (row.code !== undefined && row.code !== null) {
    payload['code'] = row.code;
  }
  if (row.description !== undefined && row.description !== null) {
    payload['description'] = row.description;
  }
  if (row.code_language !== undefined && row.code_language !== null) {
    payload['code_language'] = row.code_language;
  }
  if (row.derived_from !== undefined && row.derived_from !== null) {
    // pg returns jsonb as a parsed value (string[] here); stringify for the payload contract.
    payload['derived_from'] = JSON.stringify(row.derived_from);
  }
  if (row.superseded_by !== undefined && row.superseded_by !== null) {
    payload['superseded_by'] = row.superseded_by;
  }
  const score = row.distance !== undefined ? 1 - row.distance : row.rank;
  return score !== undefined
    ? { id: row.id, payload, score }
    : { id: row.id, payload };
}

interface FilterClause {
  readonly sql: string;
  readonly params: readonly (string | number | boolean | null)[];
  readonly nextParamIndex: number;
}

function composeFilters(filters: Filters | undefined, startParamIndex: number): FilterClause {
  if (filters === undefined) {
    return { sql: '', params: [], nextParamIndex: startParamIndex };
  }
  const parts: string[] = [];
  const params: (string | number | boolean | null)[] = [];
  let idx = startParamIndex;
  for (const col of ['user_id', 'session_id', 'agent_id'] as const) {
    const value = filters[col];
    if (value === undefined) {
      continue;
    }
    parts.push(`${col} = $${idx}`);
    params.push(value);
    idx += 1;
  }
  // v0.6: kind discriminator and supersession filter per skill-library T2.2.
  if (filters.kind !== undefined) {
    parts.push(`kind = $${idx}`);
    params.push(filters.kind);
    idx += 1;
  }
  if (filters.excludeSuperseded === true) {
    // `superseded_by IS NULL` does not parameterize — embed the literal SQL fragment.
    parts.push(`superseded_by IS NULL`);
  }
  if (parts.length === 0) {
    return { sql: '', params: [], nextParamIndex: startParamIndex };
  }
  return { sql: ` AND ${parts.join(' AND ')}`, params, nextParamIndex: idx };
}

export class PgvectorStore implements VectorStore {
  private currentUserId = '';
  private readonly skillStore: PgvectorSkillStore;

  /** `tracer` is optional OTel for F-arch-3 per-row fallback observability. */
  constructor(
    private readonly pool: Pool,
    private readonly tracer?: Tracer,
  ) {
    this.skillStore = new PgvectorSkillStore(pool, this.withTransaction.bind(this));
  }

  async initialize(): Promise<void> {
    // Schema is owned by Drizzle migrations (T2.2). Just verify connectivity.
    await this.pool.query('SELECT 1');
  }

  async insert(
    vectors: readonly (readonly number[])[],
    ids: readonly string[],
    payloads: readonly Payload[],
  ): Promise<void> {
    if (vectors.length !== ids.length || vectors.length !== payloads.length) {
      throw new Error('insert: vectors, ids, and payloads must have equal length');
    }
    try {
      await this.insertBatch(vectors, ids, payloads);
    } catch {
      // F-arch-3: persist_fallback fires per batch invocation; per-row failures
      // are skipped (do not poison the rest of the batch) and tallied below.
      emitEvent(this.tracer, 'persist_fallback', { count: vectors.length });
      let failed = 0;
      for (let i = 0; i < vectors.length; i += 1) {
        try {
          await this.insertSingle(
            vectors[i] as readonly number[],
            ids[i] as string,
            payloads[i] as Payload,
          );
        } catch {
          failed += 1;
        }
      }
      if (failed > 0) {
        emitEvent(this.tracer, 'persist_fallback', { failed_rows: failed, total: vectors.length });
      }
    }
  }

  private async insertBatch(
    vectors: readonly (readonly number[])[],
    ids: readonly string[],
    payloads: readonly Payload[],
  ): Promise<void> {
    const values: string[] = [];
    const params: unknown[] = [];
    let p = 1;
    for (let i = 0; i < vectors.length; i += 1) {
      const id = ids[i] as string;
      const vec = vectors[i] as readonly number[];
      const payload = payloads[i] as Payload;
      const text = String(payload['text'] ?? '');
      const hash = String(payload['hash'] ?? id);
      const userId = (payload['user_id'] as string | undefined) ?? null;
      const sessionId = (payload['session_id'] as string | undefined) ?? null;
      const agentId = (payload['agent_id'] as string | undefined) ?? null;
      const cleanedPayload: Payload = { ...payload };
      delete cleanedPayload['text'];
      delete cleanedPayload['hash'];
      delete cleanedPayload['user_id'];
      delete cleanedPayload['session_id'];
      delete cleanedPayload['agent_id'];
      values.push(
        `($${p++}, $${p++}, $${p++}, $${p++}::vector, $${p++}::jsonb, $${p++}, $${p++}, $${p++})`,
      );
      params.push(id, text, hash, vectorLiteral(vec), JSON.stringify(cleanedPayload), userId, sessionId, agentId);
    }
    const sql = `
      INSERT INTO memories (id, text, hash, embedding, payload, user_id, session_id, agent_id)
      VALUES ${values.join(', ')}
      ON CONFLICT (hash) DO NOTHING
    `;
    await this.pool.query(sql, params);
  }

  private async insertSingle(
    vector: readonly number[],
    id: string,
    payload: Payload,
  ): Promise<void> {
    await this.insertBatch([vector], [id], [payload]);
  }

  async search(
    query: readonly number[],
    topK = 10,
    filters?: Filters,
  ): Promise<readonly VectorStoreResult[]> {
    // F-dom-4: guard query dimension so a malformed embed surfaces here, not
    // as silently-wrong pgvector results from a dimension mismatch.
    if (query.length !== MAX_EMBEDDING_DIM) {
      throw new Error(
        `PgvectorStore.search: query vector dimension ${query.length} does not match MAX_EMBEDDING_DIM ${MAX_EMBEDDING_DIM}`,
      );
    }
    const filter = composeFilters(filters, 2);
    // v0.4b T6.1 / D17: exclude soft-deleted rows (t_invalid IS NOT NULL)
    // from semantic recall. Audit query (raw SQL WHERE t_invalid IS NOT NULL)
    // still returns them per ADR-0006 bi-temporal contract.
    const sql = `
      SELECT id, text, hash, payload, user_id, session_id, agent_id,
             kind, code, description, code_language, derived_from, superseded_by,
             embedding <=> $1::vector AS distance
      FROM memories
      WHERE t_invalid IS NULL${filter.sql}
      ORDER BY distance ASC
      LIMIT $${filter.nextParamIndex}
    `;
    const result = await this.pool.query<MemoriesRow>(sql, [
      vectorLiteral(query),
      ...filter.params,
      topK,
    ]);
    const mapped = result.rows.map(rowToResult);
    // v0.4b T3.1 / D15: batched LRU/LFU write-back. Fire-and-forget — failures
    // log + degrade gracefully (bookkeeping is best-effort, not invariant).
    await this.recordAccess(mapped.map((r) => r.id));
    return mapped;
  }

  /**
   * v0.4b T3.1: single batched UPDATE incrementing access_count + setting
   * last_accessed_at = NOW() for the given memory ids.
   *
   * EC-8 absorption: SQL uses `SELECT DISTINCT unnest($1::uuid[])` so a
   * duplicate id in the input is incremented ONCE (defensive against future
   * code paths that might pass duplicates).
   *
   * Plan T3.1 § Deep Dives "Fire-and-forget telemetry": on failure, console.warn
   * + degrade gracefully (caller still receives the recall results unchanged).
   * OTel counter `theo.memory.lru_update_failures` is declared at T8.1 wiring
   * re-run per the existing OTel-counter exposure pattern.
   */
  private async recordAccess(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) {
      return;
    }
    try {
      await this.pool.query(
        `UPDATE memories
            SET access_count = access_count + 1,
                last_accessed_at = NOW()
          WHERE id IN (SELECT DISTINCT unnest($1::uuid[]))`,
        [ids],
      );
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        '[v0.4b] LRU bookkeeping UPDATE failed (recall results returned unchanged):',
        err,
      );
    }
  }

  async keywordSearch(
    query: string,
    topK = 10,
    filters?: Filters,
  ): Promise<readonly VectorStoreResult[] | null> {
    const filter = composeFilters(filters, 2);
    // v0.4b T6.1 / D17: exclude soft-deleted rows from keyword recall.
    const sql = `
      SELECT id, text, hash, payload, user_id, session_id, agent_id,
             kind, code, description, code_language, derived_from, superseded_by,
             ts_rank(to_tsvector('english', text), plainto_tsquery('english', $1)) AS rank
      FROM memories
      WHERE to_tsvector('english', text) @@ plainto_tsquery('english', $1)
        AND t_invalid IS NULL${filter.sql}
      ORDER BY rank DESC
      LIMIT $${filter.nextParamIndex}
    `;
    const result = await this.pool.query<MemoriesRow>(sql, [query, ...filter.params, topK]);
    return result.rows.map(rowToResult);
  }

  async get(vectorId: string): Promise<VectorStoreResult | null> {
    const result = await this.pool.query<MemoriesRow>(
      `SELECT id, text, hash, payload, user_id, session_id, agent_id,
              kind, code, description, code_language, derived_from, superseded_by
         FROM memories WHERE id = $1`,
      [vectorId],
    );
    if (result.rows.length === 0) {
      return null;
    }
    return rowToResult(result.rows[0] as MemoriesRow);
  }

  async update(vectorId: string, vector: readonly number[], payload: Payload): Promise<void> {
    const text = String(payload['text'] ?? '');
    const hash = String(payload['hash'] ?? vectorId);
    const userId = (payload['user_id'] as string | undefined) ?? null;
    const sessionId = (payload['session_id'] as string | undefined) ?? null;
    const agentId = (payload['agent_id'] as string | undefined) ?? null;
    const cleanedPayload: Payload = { ...payload };
    delete cleanedPayload['text'];
    delete cleanedPayload['hash'];
    delete cleanedPayload['user_id'];
    delete cleanedPayload['session_id'];
    delete cleanedPayload['agent_id'];
    await this.pool.query(
      `UPDATE memories
         SET embedding = $2::vector,
             text = $3,
             hash = $4,
             payload = $5::jsonb,
             user_id = $6,
             session_id = $7,
             agent_id = $8,
             updated_at = NOW()
       WHERE id = $1`,
      [vectorId, vectorLiteral(vector), text, hash, JSON.stringify(cleanedPayload), userId, sessionId, agentId],
    );
  }

  async delete(vectorId: string): Promise<void> {
    await this.pool.query('DELETE FROM memories WHERE id = $1', [vectorId]);
  }

  async deleteCol(): Promise<void> {
    await this.pool.query('TRUNCATE memories CASCADE');
  }

  async list(
    filters?: Filters,
    topK = 100,
  ): Promise<readonly [readonly VectorStoreResult[], number]> {
    const filter = composeFilters(filters, 1);
    const countSql = `SELECT COUNT(*)::int AS total FROM memories WHERE 1=1${filter.sql}`;
    const countResult = await this.pool.query<{ total: number }>(countSql, [...filter.params]);
    const total = countResult.rows[0]?.total ?? 0;

    const pageSql = `
      SELECT id, text, hash, payload, user_id, session_id, agent_id,
             kind, code, description, code_language, derived_from, superseded_by
      FROM memories
      WHERE 1=1${filter.sql}
      ORDER BY created_at ASC
      LIMIT $${filter.nextParamIndex}
    `;
    const pageResult = await this.pool.query<MemoriesRow>(pageSql, [...filter.params, topK]);
    return [pageResult.rows.map(rowToResult), total];
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getUserId(): Promise<string> {
    return this.currentUserId;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async setUserId(userId: string): Promise<void> {
    this.currentUserId = userId;
  }

  /**
   * Persist a derived memory (kind='derived') with non-empty derived_from per
   * plan T4.3 + ADR D6 (kind discriminator) + ADR D7 (provenance fail-fast).
   * Caller wraps multi-draft writes in BEGIN/COMMIT/ROLLBACK per v0.4a EC-6.
   */
  async insertDerivedMemory(args: {
    text: string;
    hash: string;
    embedding: readonly number[];
    derivedFrom: readonly string[];
    scope: { userId?: string | null; sessionId?: string | null; agentId?: string | null };
  }): Promise<string> {
    const sql = `
      INSERT INTO memories (
        text, hash, embedding, payload,
        user_id, session_id, agent_id,
        kind, derived_from
      ) VALUES (
        $1, $2, $3::vector, '{}'::jsonb,
        $4, $5, $6,
        'derived', $7::jsonb
      )
      RETURNING id
    `;
    const result = await this.pool.query<{ id: string }>(sql, [
      args.text,
      args.hash,
      vectorLiteral(args.embedding),
      args.scope.userId ?? null,
      args.scope.sessionId ?? null,
      args.scope.agentId ?? null,
      JSON.stringify([...args.derivedFrom]),
    ]);
    const row = result.rows[0];
    if (row === undefined) {
      throw new Error('insertDerivedMemory: INSERT returned no rows');
    }
    return row.id;
  }

  /** T3.1 / F3: skill CRUD delegated to {@link PgvectorSkillStore} (composition seam). */
  async insertSkill(args: InsertSkillArgs): Promise<string> {
    return this.skillStore.insertSkill(args);
  }

  async insertDerivedSkill(args: InsertDerivedSkillArgs): Promise<string> {
    return this.skillStore.insertDerivedSkill(args);
  }

  /**
   * EC-17: MD5 collision risk ~10^-29 per pair (~10^-19 for 1M memories) —
   * collision-SAFE by the UNIQUE constraint, so LIMIT 1 is exact.
   * Returns score in [1, 10] OR null when no row OR row has NULL score.
   */
  async getImportanceByHash(hash: string): Promise<number | null> {
    const result = await this.pool.query<{ llm_importance_score: string | null }>(
      `SELECT llm_importance_score FROM memories WHERE hash = $1 LIMIT 1`,
      [hash],
    );
    const row = result.rows[0];
    if (row === undefined || row.llm_importance_score === null) {
      return null;
    }
    return Number(row.llm_importance_score);
  }

  /** Persist a cached importance score for the row identified by content hash. */
  async setImportanceByHash(hash: string, score: number): Promise<void> {
    await this.pool.query(
      `UPDATE memories SET llm_importance_score = $1, updated_at = NOW() WHERE hash = $2`,
      [score, hash],
    );
  }

  async markSuperseded(
    sourceIds: readonly string[],
    supersededBy: string,
  ): Promise<void> {
    return this.skillStore.markSuperseded(sourceIds, supersededBy);
  }

  async insertDerivedSkillAtomic(
    args: InsertDerivedSkillArgs,
    sourceIdsToSupersede: readonly string[],
  ): Promise<string> {
    return this.skillStore.insertDerivedSkillAtomic(args, sourceIdsToSupersede);
  }

  /** Acquire a pool client for transactional persist (EC-6 rollback semantics). */
  async withTransaction<T>(fn: (tx: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async bumpReflectionCounter(scope: {
    userId?: string | null;
    sessionId?: string | null;
    agentId?: string | null;
  }): Promise<number> {
    const userId = scope.userId ?? null;
    const sessionId = scope.sessionId ?? null;
    const agentId = scope.agentId ?? null;

    // Find existing row using IS NOT DISTINCT FROM (treats NULL = NULL)
    const findSql = `
      SELECT id, count FROM reflection_counters
      WHERE scope_user_id IS NOT DISTINCT FROM $1
        AND scope_session_id IS NOT DISTINCT FROM $2
        AND scope_agent_id IS NOT DISTINCT FROM $3
      LIMIT 1
    `;
    const found = await this.pool.query<{ id: string; count: string }>(findSql, [userId, sessionId, agentId]);

    if (found.rows.length > 0) {
      const row = found.rows[0];
      if (row === undefined) {
        throw new Error('unreachable: rows.length > 0 but row undefined');
      }
      const updateSql = `
        UPDATE reflection_counters
        SET count = count + 1, updated_at = NOW()
        WHERE id = $1
        RETURNING count
      `;
      const updateResult = await this.pool.query<{ count: string }>(updateSql, [row.id]);
      const updatedRow = updateResult.rows[0];
      if (updatedRow === undefined) {
        throw new Error('reflection_counters UPDATE returned no rows');
      }
      return Number(updatedRow.count);
    }

    // No existing row — insert with count=1 (CHECK upstream blocks all-NULL)
    const insertSql = `
      INSERT INTO reflection_counters (scope_user_id, scope_session_id, scope_agent_id, count)
      VALUES ($1, $2, $3, 1)
      RETURNING count
    `;
    const insertResult = await this.pool.query<{ count: string }>(insertSql, [userId, sessionId, agentId]);
    const insertedRow = insertResult.rows[0];
    if (insertedRow === undefined) {
      throw new Error('reflection_counters INSERT returned no rows');
    }
    return Number(insertedRow.count);
  }
}
