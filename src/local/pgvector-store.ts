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
import type { ConflictResolutionResult } from '../core/dip/conflict-resolution-policy.js';
import type { InsertOutcome, VectorStore, VectorStoreResult } from '../core/dip/vector-store.js';
import { EmbeddingMismatch } from '../core/errors.js';
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
  /** v1.1 T2.1: first-class promoted column for multi-peer attribution (NULL on pre-v1.1 rows). */
  readonly attributed_to?: string | null;
  readonly kind?: string | null;
  readonly code?: string | null;
  readonly description?: string | null;
  readonly code_language?: string | null;
  readonly derived_from?: unknown;
  readonly superseded_by?: string | null;
  /** principles-alignment-hardening T2.1 / ADR D1 — Princípio 1 confirmação factor. */
  readonly confirmation_count?: number;
  /**
   * dashboard-memories-tab-standardization T2.1: project DB wall-clock so
   * `VectorStoreResult.createdAt` flows through to consumers. Nullable to
   * absorb EC-1 (NULL legacy rows defensive-in-depth — schema currently
   * declares created_at .notNull(), so reachability requires manual psql
   * INSERT after constraint drop OR pg_restore). `pg` returns timestamptz
   * as JS `Date` natively; no manual parse.
   */
  readonly created_at?: Date | null;
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
  // v1.1 T2.1 — project attributed_to column into payload when non-null. NULL rows
  // (pre-v1.1) leave the key absent, surfacing as `undefined` on the consumer DTO.
  if (row.attributed_to !== undefined && row.attributed_to !== null) {
    payload['attributed_to'] = row.attributed_to;
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
  // principles-alignment-hardening T2.1 / EC-6 — project confirmation_count
  // into payload when the column is part of the SELECT projection. recall()'s
  // wrap pipeline hoists this into MemoryItem.confirmationCount.
  if (row.confirmation_count !== undefined && row.confirmation_count !== null) {
    payload['confirmation_count'] = row.confirmation_count;
  }
  const score = row.distance !== undefined ? 1 - row.distance : row.rank;
  // dashboard-memories-tab-standardization T2.1 — null-safe createdAt projection.
  // EC-1: NULL → undefined (NOT new Date(0) which would silently lie 1970-01-01).
  // Forward-compat against (a) manual psql INSERT bypassing DEFAULT, (b) future
  // schema relaxation, (c) pg_restore. Schema currently declares created_at .notNull().
  const createdAt = row.created_at != null ? row.created_at : undefined;
  // Compose progressively to honor exactOptionalPropertyTypes (omit undefined fields).
  const base: VectorStoreResult = { id: row.id, payload };
  return {
    ...base,
    ...(score !== undefined ? { score } : {}),
    ...(createdAt !== undefined ? { createdAt } : {}),
  };
}

interface FilterClause {
  readonly sql: string;
  readonly params: readonly (string | number | boolean | null)[];
  readonly nextParamIndex: number;
}

/**
 * v1.1 T3.1 + ADR-0011: bi-temporal recall predicate. When `asOf` is set,
 * compose the null-safe clause per ADR-0011:
 *
 *   (t_valid IS NULL OR t_valid <= $N) AND (t_invalid IS NULL OR t_invalid > $N+1)
 *
 * NULL `t_valid` rows (pre-bi-temporal legacy) treated as `-Infinity`
 * (always-valid since creation). When asOf is omitted, fall back to the
 * pre-v1.1 currently-valid filter `t_invalid IS NULL` so existing callers
 * see ZERO behavior change (regression guard locked in unit tests).
 */
function composeTemporalWhere(
  asOf: Date | undefined,
  startParamIndex: number,
): { sql: string; params: readonly Date[]; nextParamIndex: number } {
  if (asOf === undefined) {
    return { sql: 't_invalid IS NULL', params: [], nextParamIndex: startParamIndex };
  }
  return {
    sql: `(t_valid IS NULL OR t_valid <= $${startParamIndex}) AND (t_invalid IS NULL OR t_invalid > $${startParamIndex + 1})`,
    params: [asOf, asOf],
    nextParamIndex: startParamIndex + 2,
  };
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
  // v1.1 T2.2: multi-peer attribution filter. EC-7 absorbed: Postgres `=`
  // semantics treat empty-string and NULL distinctly (`'' = ''` true; `NULL = ''`
  // returns NULL, no match), so passing attributedTo='' matches empty-string
  // rows only — NULL rows from pre-v1.1 stay excluded.
  // EC-5 absorbed: this single filter clause runs on the PRIMARY memory query
  // path inside vectorStore.search; the entity-boost subquery doesn't exist as
  // a separate SQL fragment in pgvector-store (entity store is opt-out per
  // ADR-0007 and currently disabled), so cross-attribution isolation holds via
  // this single clause. Future entity-store revival MUST add the same filter
  // to its subquery — guarded by the EC-5 integration assertion in T4.1.
  if (filters.attributed_to !== undefined) {
    parts.push(`attributed_to = $${idx}`);
    params.push(filters.attributed_to);
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

  /**
   * adapters-openrouter-local-embedder T0.2: 2nd arg widened from positional
   * `tracer?: Tracer` to options object carrying both `embeddingDim?` and
   * `tracer?`. Backward-compat preserved for `new PgvectorStore(pool)`;
   * empirical sweep at iteration 2 SEPA pre-RED confirmed ZERO callers use
   * the positional-tracer form anywhere in the SDK + tests + examples.
   *
   * `embeddingDim` defaults to `MAX_EMBEDDING_DIM` (1536). When set to a
   * smaller value (e.g., 384 for Xenova/all-MiniLM-L6-v2), the search guard
   * at line ~240 asserts against `this.embeddingDim` instead of the
   * constant — error message surfaces the CONFIGURED dim so the operator
   * can pinpoint a misconfigured store vs a misbehaving embedder.
   *
   * `tracer` continues to be optional OTel for F-arch-3 per-row fallback
   * observability.
   *
   * @see .claude/knowledge-base/plans/adapters-openrouter-local-embedder-plan.md § T0.2
   * @see .claude/knowledge-base/implementations/adapters-openrouter-local-embedder/sepa-iterations/iteration-2-pre-red.md (M2 widening rationale)
   */
  private readonly embeddingDim: number;
  private readonly tracer?: Tracer;
  constructor(
    private readonly pool: Pool,
    options?: { readonly embeddingDim?: number; readonly tracer?: Tracer },
  ) {
    this.embeddingDim = options?.embeddingDim ?? MAX_EMBEDDING_DIM;
    // exactOptionalPropertyTypes: assign only when defined so the field
    // stays `tracer?: Tracer` (not `Tracer | undefined`) — preserves the
    // existing per-row fallback observability branch shape downstream.
    if (options?.tracer !== undefined) {
      this.tracer = options.tracer;
    }
    this.skillStore = new PgvectorSkillStore(pool, this.withTransaction.bind(this));
  }

  /**
   * v0.4b-fixes T4.1 — exposes the underlying `Pool` to the eviction
   * pipeline wired by `createLocalMemory({ eviction: {...} })`. The eviction
   * triggers + half-life persister + nearest-neighbor provider all share the
   * same pool the store already holds; without this accessor the factory
   * would have to require consumers to pass `pool` twice.
   *
   * @internal Not part of the VectorStore DIP — adapter-specific.
   */
  get poolForEviction(): Pool {
    return this.pool;
  }

  async initialize(): Promise<void> {
    // Schema is owned by Drizzle migrations (T2.2). Just verify connectivity.
    await this.pool.query('SELECT 1');
  }

  /**
   * /review F-M15 + F-Mi6: shared dimension guard used by every method that
   * accepts a vector parameter. Throws typed `EmbeddingMismatch` (not bare
   * `Error`) so callers can `instanceof`-match and report consistently with
   * the createLocalMemory boot-time probe.
   *
   * Public `search`, `insert`, `update`, `insertDerivedMemory` all assert via
   * this helper; private `insertBatch` / `insertSingle` are reached only
   * through `insert`, so the guard sits at the boundary that the VectorStore
   * DIP exposes.
   */
  private assertEmbeddingDim(vector: readonly number[], methodLabel: string): void {
    if (vector.length !== this.embeddingDim) {
      throw new EmbeddingMismatch(this.embeddingDim, vector.length, {
        cause: new Error(`PgvectorStore.${methodLabel}`),
      });
    }
  }

  async insert(
    vectors: readonly (readonly number[])[],
    ids: readonly string[],
    payloads: readonly Payload[],
  ): Promise<readonly InsertOutcome[]> {
    if (vectors.length !== ids.length || vectors.length !== payloads.length) {
      throw new Error('insert: vectors, ids, and payloads must have equal length');
    }
    // /review F-M15: assert each vector matches the configured dim BEFORE
    // pgvector raises an opaque cast error. Loop is O(N) on the input slice
    // size, identical cost to the existing payload normalization just below.
    for (const vec of vectors) {
      this.assertEmbeddingDim(vec, 'insert');
    }
    try {
      return await this.insertBatch(vectors, ids, payloads);
    } catch {
      // F-arch-3: persist_fallback fires per batch invocation; per-row failures
      // are skipped (do not poison the rest of the batch) and tallied below.
      emitEvent(this.tracer, 'persist_fallback', { count: vectors.length });
      const outcomes: InsertOutcome[] = [];
      let failed = 0;
      for (let i = 0; i < vectors.length; i += 1) {
        try {
          const singleOutcomes = await this.insertSingle(
            vectors[i] as readonly number[],
            ids[i] as string,
            payloads[i] as Payload,
          );
          outcomes.push(...singleOutcomes);
        } catch {
          failed += 1;
        }
      }
      if (failed > 0) {
        emitEvent(this.tracer, 'persist_fallback', { failed_rows: failed, total: vectors.length });
      }
      return outcomes;
    }
  }

  private async insertBatch(
    vectors: readonly (readonly number[])[],
    ids: readonly string[],
    payloads: readonly Payload[],
  ): Promise<readonly InsertOutcome[]> {
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
      // v1.1 T2.1: hoist attributed_to from payload to column. EC-2: this single
      // hoist serves BOTH the LLM-extraction path (pipeline writes
      // extracted[i].attributed_to into payload) AND the verbatim infer:false
      // path (pipeline writes options.attributedTo into payload).
      const attributedTo = (payload['attributed_to'] as string | undefined) ?? null;
      const cleanedPayload: Payload = { ...payload };
      delete cleanedPayload['text'];
      delete cleanedPayload['hash'];
      delete cleanedPayload['user_id'];
      delete cleanedPayload['session_id'];
      delete cleanedPayload['agent_id'];
      delete cleanedPayload['attributed_to'];
      values.push(
        `($${p++}, $${p++}, $${p++}, $${p++}::vector, $${p++}::jsonb, $${p++}, $${p++}, $${p++}, $${p++})`,
      );
      params.push(
        id,
        text,
        hash,
        vectorLiteral(vec),
        JSON.stringify(cleanedPayload),
        userId,
        sessionId,
        agentId,
        attributedTo,
      );
    }
    // principles-alignment-hardening T1.1 — composite ON CONFLICT per ADR D5.
    // The conflict target MUST match migration 0011's memories_hash_scope_unique_idx
    // expression list (hash, COALESCE(user_id,''), COALESCE(session_id,''), COALESCE(agent_id,'')).
    // On collision, bump confirmation_count by 1 (Princípio 1 — confirmação factor per ADR D1).
    // RETURNING (xmax = 0) AS inserted is the canonical PG tell-tale for INSERT-vs-UPDATE:
    // xmax = 0 on fresh inserts, non-zero on updates. confirmation_count is RETURNed post-bump.
    const sql = `
      INSERT INTO memories (id, text, hash, embedding, payload, user_id, session_id, agent_id, attributed_to)
      VALUES ${values.join(', ')}
      ON CONFLICT (hash, COALESCE(user_id, ''), COALESCE(session_id, ''), COALESCE(agent_id, ''))
      DO UPDATE SET confirmation_count = memories.confirmation_count + 1
      RETURNING id, confirmation_count, user_id, session_id, agent_id, (xmax = 0) AS inserted
    `;
    const result = await this.pool.query<{
      id: string;
      confirmation_count: number;
      user_id: string | null;
      session_id: string | null;
      agent_id: string | null;
      inserted: boolean;
    }>(sql, params);
    // principles-alignment-hardening T1.1 — Princípio 3 IGNORE auditability per ADR D2.
    // Emit dedup_collision_confirmed for each row whose ON CONFLICT branch fired
    // (existed in scope; confirmation_count bumped). Skip for fresh inserts.
    // EC-5 absorption: emitEvent is a no-op when tracer === undefined (handled
    // by emitEvent itself per src/core/memory-event.ts:46), so no explicit guard
    // needed here.
    const outcomes: InsertOutcome[] = [];
    for (const row of result.rows) {
      if (!row.inserted) {
        const scopeTier: string =
          row.session_id !== null ? 'session' : row.agent_id !== null ? 'agent' : row.user_id !== null ? 'user' : 'none';
        emitEvent(this.tracer, 'dedup_collision_confirmed', {
          memory_id: row.id,
          confirmation_count: row.confirmation_count,
          scope_tier: scopeTier,
        });
      }
      outcomes.push({
        id: row.id,
        confirmationCount: row.confirmation_count,
        rejectedAsDuplicate: !row.inserted,
      });
    }
    return outcomes;
  }

  private async insertSingle(
    vector: readonly number[],
    id: string,
    payload: Payload,
  ): Promise<readonly InsertOutcome[]> {
    return this.insertBatch([vector], [id], [payload]);
  }

  async search(
    query: readonly number[],
    topK = 10,
    filters?: Filters,
  ): Promise<readonly VectorStoreResult[]> {
    // F-dom-4 + T0.2: guard query dimension so a malformed embed surfaces
    // here, not as silently-wrong pgvector results from a dimension mismatch.
    // Reads from `this.embeddingDim` (default MAX_EMBEDDING_DIM) so a
    // parametrically-configured store reports the CONFIGURED dim — operator
    // can pinpoint misconfig vs misbehaving embedder per T0.2 § Deep Dives.
    // /review F-Mi6: throw typed `EmbeddingMismatch` instead of bare `Error`
    // for symmetry with the createLocalMemory boot-time probe + the public
    // taxonomy in `src/core/errors.ts`.
    this.assertEmbeddingDim(query, 'search');
    // v0.4b T6.1 / D17 + v1.1 T3.1: bi-temporal recall predicate. Default
    // currently-valid `t_invalid IS NULL`; with filters.asOf, switch to the
    // null-safe predicate per ADR-0011.
    const temporal = composeTemporalWhere(filters?.asOf, 2);
    const filter = composeFilters(filters, temporal.nextParamIndex);
    const sql = `
      SELECT id, text, hash, payload, user_id, session_id, agent_id, attributed_to,
             kind, code, description, code_language, derived_from, superseded_by, confirmation_count,
             embedding <=> $1::vector AS distance
      FROM memories
      WHERE ${temporal.sql}${filter.sql}
      ORDER BY distance ASC
      LIMIT $${filter.nextParamIndex}
    `;
    const result = await this.pool.query<MemoriesRow>(sql, [
      vectorLiteral(query),
      ...temporal.params,
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
    // v0.4b T6.1 / D17 + v1.1 T3.1: same bi-temporal handling as semantic search.
    const temporal = composeTemporalWhere(filters?.asOf, 2);
    const filter = composeFilters(filters, temporal.nextParamIndex);
    const sql = `
      SELECT id, text, hash, payload, user_id, session_id, agent_id, attributed_to,
             kind, code, description, code_language, derived_from, superseded_by, confirmation_count,
             ts_rank(to_tsvector('english', text), plainto_tsquery('english', $1)) AS rank
      FROM memories
      WHERE to_tsvector('english', text) @@ plainto_tsquery('english', $1)
        AND ${temporal.sql}${filter.sql}
      ORDER BY rank DESC
      LIMIT $${filter.nextParamIndex}
    `;
    const result = await this.pool.query<MemoriesRow>(sql, [
      query,
      ...temporal.params,
      ...filter.params,
      topK,
    ]);
    return result.rows.map(rowToResult);
  }

  async get(vectorId: string): Promise<VectorStoreResult | null> {
    const result = await this.pool.query<MemoriesRow>(
      `SELECT id, text, hash, payload, user_id, session_id, agent_id, attributed_to,
              kind, code, description, code_language, derived_from, superseded_by, confirmation_count
         FROM memories WHERE id = $1`,
      [vectorId],
    );
    if (result.rows.length === 0) {
      return null;
    }
    return rowToResult(result.rows[0] as MemoriesRow);
  }

  async update(vectorId: string, vector: readonly number[], payload: Payload): Promise<void> {
    // /review F-M15: dim guard symmetry — same EmbeddingMismatch path used
    // by `search` + `insert` so update-path callers surface configuration
    // errors at the SDK boundary, not as opaque pgvector cast errors.
    this.assertEmbeddingDim(vector, 'update');
    const text = String(payload['text'] ?? '');
    const hash = String(payload['hash'] ?? vectorId);
    const userId = (payload['user_id'] as string | undefined) ?? null;
    const sessionId = (payload['session_id'] as string | undefined) ?? null;
    const agentId = (payload['agent_id'] as string | undefined) ?? null;
    // v1.1 T2.1: update-path mirrors insert-path hoist so re-upserts preserve attribution.
    const attributedTo = (payload['attributed_to'] as string | undefined) ?? null;
    const cleanedPayload: Payload = { ...payload };
    delete cleanedPayload['text'];
    delete cleanedPayload['hash'];
    delete cleanedPayload['user_id'];
    delete cleanedPayload['session_id'];
    delete cleanedPayload['agent_id'];
    delete cleanedPayload['attributed_to'];
    await this.pool.query(
      `UPDATE memories
         SET embedding = $2::vector,
             text = $3,
             hash = $4,
             payload = $5::jsonb,
             user_id = $6,
             session_id = $7,
             agent_id = $8,
             attributed_to = $9,
             updated_at = NOW()
       WHERE id = $1`,
      [
        vectorId,
        vectorLiteral(vector),
        text,
        hash,
        JSON.stringify(cleanedPayload),
        userId,
        sessionId,
        agentId,
        attributedTo,
      ],
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

    // dashboard-memories-tab-standardization T2.1:
    //   - SELECT projection extended with `created_at` so VectorStoreResult.createdAt flows.
    //   - ORDER BY flipped to `created_at DESC, id ASC` per EC-2 absorption:
    //     newest-first primary + deterministic id tiebreak for identical timestamps.
    //     Dashboard pagination consumes this contract (same query → same order across refreshes).
    const pageSql = `
      SELECT id, text, hash, payload, user_id, session_id, agent_id, attributed_to,
             kind, code, description, code_language, derived_from, superseded_by, confirmation_count,
             created_at
      FROM memories
      WHERE 1=1${filter.sql}
      ORDER BY created_at DESC, id ASC
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
    // /review F-M15: dim guard symmetry — derived-memory write path also
    // routes through the same EmbeddingMismatch contract.
    this.assertEmbeddingDim(args.embedding, 'insertDerivedMemory');
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

  /**
   * v0.7 T2.1 — pull (id, text, createdAt) for the scope's active memories so
   * the conflict-resolution policy gets REAL timestamps (LWW comparator + EC-1
   * tie-break). The reflect() `sourceMemories` array uses synthetic
   * `createdAt: new Date()` per the v0.4a pipeline; that's fine for LLM
   * derivation but breaks LWW determinism.
   */
  async recallConsolidationCandidates(
    filters: Filters,
  ): Promise<readonly { memoryId: string; text: string; createdAt: Date }[]> {
    // /review v0-7 F-C2: filter `kind = 'extracted'` to preserve the
    // episodic→semantic boundary. Without this guard, v0.6 procedural
    // skill rows (kind='skill') AND already-consolidated rows (kind='derived')
    // would enter the cluster — a consumer running reflect({ conflictResolution })
    // on an agent_id scope that ALSO holds a memory.skills(repoId) library
    // would mass-tombstone the skill library. The 2nd reflect() call would
    // also re-consolidate already-derived rows, breaking the boundary.
    // /review v0-7 F-M7 (extended at v1.1 T3.1): consolidation guards against
    // future-valid rows. ADR-0011 lifts the local-runtime `asOf` gate, so
    // future-valid `t_valid > NOW()` rows could now legitimately exist if a
    // consumer time-travels via `RecallOptions.asOf`. The `t_valid <= NOW()`
    // predicate keeps consolidation focused on the CURRENT epoch regardless
    // of historical/future projections at recall time.
    const where: string[] = [
      "kind = 'extracted'",
      't_invalid IS NULL',
      '(t_valid IS NULL OR t_valid <= NOW())',
    ];
    const params: unknown[] = [];
    if (filters.user_id !== undefined) {
      params.push(filters.user_id);
      where.push(`user_id = $${String(params.length)}`);
    }
    if (filters.session_id !== undefined) {
      params.push(filters.session_id);
      where.push(`session_id = $${String(params.length)}`);
    }
    if (filters.agent_id !== undefined) {
      params.push(filters.agent_id);
      where.push(`agent_id = $${String(params.length)}`);
    }
    const { rows } = await this.pool.query<{ id: string; text: string; created_at: Date }>(
      `SELECT id, text, created_at FROM memories WHERE ${where.join(' AND ')}`,
      params,
    );
    return rows.map((r) => ({ memoryId: r.id, text: r.text, createdAt: r.created_at }));
  }

  /**
   * v0.7 T2.1 — persist N `ConflictResolutionResult` rows atomically: for each
   * result, soft-delete the rejected memory ids (`t_invalid = NOW()` per
   * ADR-0006) AND insert one `consolidation_history` audit row. EC-8 absorbed:
   * the entire batch runs inside a single `withTransaction` so a mid-batch
   * `INSERT consolidation_history` failure rolls BOTH the soft-deletes AND
   * any earlier inserts; the consumer never observes half-applied state.
   *
   * @see .claude/knowledge-base/plans/v0-7-distillation-pipeline-plan.md § T2.1 + EC-8
   */
  async persistConsolidations(
    results: readonly ConflictResolutionResult[],
  ): Promise<void> {
    if (results.length === 0) return;
    await this.withTransaction(async (client) => {
      for (const r of results) {
        if (r.rejectedMemoryIds.length > 0) {
          await client.query(
            `UPDATE memories SET t_invalid = NOW()
              WHERE id = ANY($1::uuid[]) AND t_invalid IS NULL`,
            [[...r.rejectedMemoryIds]],
          );
        }
        await client.query(
          `INSERT INTO consolidation_history (
             kept_memory_id, rejected_memory_ids, reason, policy_name,
             original_episode_ids
           ) VALUES ($1, $2::jsonb, $3, $4, $5::jsonb)`,
          [
            r.keptMemoryId,
            JSON.stringify([...r.rejectedMemoryIds]),
            r.reason,
            r.policyName,
            JSON.stringify([...r.originalEpisodeIds]),
          ],
        );
      }
    });
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
