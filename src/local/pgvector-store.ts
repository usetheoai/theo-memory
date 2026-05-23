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
 * @see referencia/REDACTED/reference TS port/src/oss/src/vector_stores/pgvector.ts:105,144,169,271,310
 */
import type { Tracer } from '@opentelemetry/api';
import type { Pool, QueryResultRow } from 'pg';

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
}
