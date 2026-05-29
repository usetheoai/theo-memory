/**
 * pgvector VectorStore — T3.3 of v0-1-local-runtime plan v1.3.
 *
 * Implements the VectorStore DIP via raw SQL through `pg.Pool` (per blueprint
 * D4 — no pgvector npm wrapper; raw SQL is enough). Schema is owned by
 * src/local/schema.ts + migrations from T2.2.
 *
 * Per-row fallback: batch insert wrapped in try/catch; on failure iterates
 * each row and attempts single-row insert in its own try/catch (per blueprint
 * D1 + Recommendation 1).
 *
 * Vector serialization: pgvector accepts `[0.1, 0.2, ...]` literal string OR
 * parameterized via `$N::vector`. We use the latter for SQL safety.
 *
 * Filter composition: ANDs each non-undefined Filters key as `col = $idx`.
 * NULL columns are skipped (passthrough — no `IS NULL` filter).
 *
 * @see .claude/knowledge-base/plans/v0-1-local-runtime-plan.md § T3.3
 * @see .claude/knowledge-base/references/mem0/mem0-ts/src/oss/src/vector_stores/pgvector.ts:105,144,169,271,310
 */
import type { Tracer } from '@opentelemetry/api';
import type { Pool, PoolClient, QueryResultRow } from 'pg';

import { MAX_EMBEDDING_DIM } from '../core/constants.js';
import type { VectorStore, VectorStoreResult } from '../core/dip/vector-store.js';
import { emitEvent } from '../core/memory-event.js';
import type { Filters } from '../core/scope.js';

type Payload = Record<string, string | number | boolean | null>;

interface MemoriesRow extends QueryResultRow {
  readonly id: string;
  readonly text: string;
  readonly hash: string;
  readonly payload: Payload;
  readonly user_id: string | null;
  readonly session_id: string | null;
  readonly agent_id: string | null;
  readonly distance?: number;
  readonly rank?: number;
}

/**
 * Convert a number[] into pgvector's `[v1,v2,...]` literal syntax.
 *
 * F-dom-1 absorption: guards every component against NaN / Infinity / -Infinity.
 * Without the guard, malformed vectors would reach pgvector and fail with a
 * cryptic `invalid input syntax for type vector` error at the SQL layer. With
 * the guard, callers see a clear JS error pointing at the offending index.
 */
function vectorLiteral(vector: readonly number[]): string {
  for (let i = 0; i < vector.length; i += 1) {
    const n = vector[i] as number;
    if (!Number.isFinite(n)) {
      throw new Error(`vectorLiteral: vector[${i}] is not finite (${String(n)}); pgvector requires finite numbers`);
    }
  }
  return `[${vector.join(',')}]`;
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
  if (parts.length === 0) {
    return { sql: '', params: [], nextParamIndex: startParamIndex };
  }
  return { sql: ` AND ${parts.join(' AND ')}`, params, nextParamIndex: idx };
}

export class PgvectorStore implements VectorStore {
  private currentUserId = '';

  /**
   * @param pool   — connected pg.Pool
   * @param tracer — optional OTel tracer for observability of internal per-row fallback paths
   *                 (F-arch-3 absorption — defense-in-depth event emission below the pipeline level).
   *                 When absent, fallback is silent (matches v0.1.0 behavior).
   */
  constructor(
    private readonly pool: Pool,
    private readonly tracer?: Tracer,
  ) {}

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
      // Per-row fallback (blueprint D1 / Recommendation 1)
      // F-arch-3 absorption: emit persist_fallback event so consumers observing the
      // tracer can detect partial-batch degradation. Per-row failures are still
      // skipped (do not poison the rest of the batch), but at least one
      // persist_fallback span fires per fallback invocation.
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
    // F-dom-4 absorption: guard query vector dimension. The factory probes the
    // embedder at construction time (EC-5) but the retrieval pipeline could
    // still pass a malformed query (e.g., empty array from a failed embed).
    // Surface the bug here with a clear error rather than letting pgvector
    // silently return wrong results from a dimension mismatch.
    if (query.length !== MAX_EMBEDDING_DIM) {
      throw new Error(
        `PgvectorStore.search: query vector dimension ${query.length} does not match MAX_EMBEDDING_DIM ${MAX_EMBEDDING_DIM}`,
      );
    }
    const filter = composeFilters(filters, 2);
    const sql = `
      SELECT id, text, hash, payload, user_id, session_id, agent_id,
             embedding <=> $1::vector AS distance
      FROM memories
      WHERE 1=1${filter.sql}
      ORDER BY distance ASC
      LIMIT $${filter.nextParamIndex}
    `;
    const result = await this.pool.query<MemoriesRow>(sql, [
      vectorLiteral(query),
      ...filter.params,
      topK,
    ]);
    return result.rows.map(rowToResult);
  }

  async keywordSearch(
    query: string,
    topK = 10,
    filters?: Filters,
  ): Promise<readonly VectorStoreResult[] | null> {
    const filter = composeFilters(filters, 2);
    const sql = `
      SELECT id, text, hash, payload, user_id, session_id, agent_id,
             ts_rank(to_tsvector('english', text), plainto_tsquery('english', $1)) AS rank
      FROM memories
      WHERE to_tsvector('english', text) @@ plainto_tsquery('english', $1)${filter.sql}
      ORDER BY rank DESC
      LIMIT $${filter.nextParamIndex}
    `;
    const result = await this.pool.query<MemoriesRow>(sql, [query, ...filter.params, topK]);
    return result.rows.map(rowToResult);
  }

  async get(vectorId: string): Promise<VectorStoreResult | null> {
    const result = await this.pool.query<MemoriesRow>(
      'SELECT id, text, hash, payload, user_id, session_id, agent_id FROM memories WHERE id = $1',
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
      SELECT id, text, hash, payload, user_id, session_id, agent_id
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
   * Atomically bump the reflection counter for a given scope and return the new value.
   *
   * Uses two-step find-then-modify with IS NOT DISTINCT FROM to handle the
   * Postgres NULL-comparison semantics correctly (composite-unique index
   * UPSERT semantics differ when ANY of the keys is NULL).
   *
   * Per plan v0-4a-reflection-pipeline § T2.1 + ADR D4. Consumer
   * (ThresholdReflectionPolicy) validates scope non-emptiness BEFORE calling
   * this — the reflection_counters CHECK constraint guards as final defense.
   *
   * @param scope Scope-tuple (userId / sessionId / agentId; at least one non-null)
   * @returns the new counter value AFTER the increment
   */
  /**
   * Persist a derived memory (kind='derived') with non-empty derived_from per
   * plan T4.3 + ADR D6 (kind discriminator) + ADR D7 (provenance fail-fast).
   *
   * Atomic per-call: a single INSERT statement. Multi-draft transactional
   * wrapping is the caller's responsibility (v0.4a Memory.reflect uses BEGIN/
   * COMMIT/ROLLBACK around the for-loop per EC-6).
   *
   * @param args row data; embedding length must match MAX_EMBEDDING_DIM
   * @returns the generated memory id
   */
  async insertDerivedMemory(args: {
    text: string;
    hash: string;
    embedding: readonly number[];
    derivedFrom: readonly string[];
    scope: { userId?: string | null; sessionId?: string | null; agentId?: string | null };
  }): Promise<string> {
    const vectorLiteral = `[${args.embedding.join(',')}]`;
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
      vectorLiteral,
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

  /**
   * Look up the cached LLM-importance score for a memory by content hash.
   *
   * Per plan T5.2 + ADR D8: hash-keyed cache lookup is the v0.4a strategy for
   * avoiding LLM re-invocation on identical-content writes. The
   * memories_hash_unique_idx UNIQUE constraint guarantees at most one row per
   * hash, so `LIMIT 1` is exact (not first-of-many).
   *
   * EC-17: MD5 collision risk ~10^-29 per pair (~10^-19 for 1M memories);
   * collision-SAFE by virtue of v0.1's UNIQUE constraint — a collision would
   * fail the UNIQUE insert BEFORE this lookup is reached on the cached row.
   *
   * @returns cached score in [1, 10] OR null when no row exists OR row has NULL score
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
