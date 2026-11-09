/**
 * pgvector VectorStore — implements the {@link VectorStore} DIP via raw SQL
 * through `pg.Pool`. Schema lives in `src/local/schema.ts` + migrations.
 * Per-row fallback: batch INSERT in try/catch; on failure, iterate per-row.
 * Vector serialization via {@link vectorLiteral} ($N::vector). Skill CRUD
 * delegated to {@link PgvectorSkillStore} (T3.1 / F3).
 */
import type { Tracer } from '@opentelemetry/api';
import type { Pool, PoolClient, QueryResultRow } from 'pg';

import { MAX_EMBEDDING_DIM } from '../../domain/constants.js';
import type { ConflictResolutionResult } from '../../domain/dip/conflict-resolution-policy.js';
import type { InsertOutcome, VectorStore, VectorStoreResult } from '../../domain/dip/vector-store.js';
import {
  type EpisodeListOptions,
  decodeEpisodeCursor,
  escapeLikePattern,
  resolveEpisodeLimit,
} from '../../domain/episode.js';
import {
  DerivedMemorySourcesUnavailableError,
  EmbeddingMismatch,
  IdempotencyConflict,
  MemoryStoreError,
} from '../../domain/errors.js';
import { normalizeEntityKey } from '../../domain/extraction/entity-linking.js';
import { persistErrorAttributes } from '../../domain/extraction/persist-error.js';
import { emitEvent } from '../../domain/memory-event.js';
import { BM25_B, BM25_K1 } from '../../domain/retrieval/bm25.js';
import type { Filters } from '../../domain/scope.js';

import { writeWithEvidence } from './evidence-write.js';
import { runInTx } from './pg-tx.js';
import { PgvectorSkillStore } from './pgvector-skill-store.js';
import { parseVectorLiteral, vectorLiteral } from './pgvector-vector-literal.js';
import type {
  InsertDerivedSkillArgs,
  InsertSkillArgs,
  ListSkillsBySubjectArgs,
} from './skill-store-args.js';
import { composeTemporalWhere } from './temporal-where.js';
import {
  configureWorkspaceWritesFromPool,
  isTenantScopedPool,
  workspaceIdForWrite,
} from './workspace-write-scope.js';

type Payload = Record<string, string | number | boolean | null>;

export interface MemoriesRow extends QueryResultRow {
  readonly id: string;
  readonly text: string;
  readonly hash: string;
  readonly payload: Payload;
  /** multi-tenant-workspace-isolation T3.1 — projected so forget() can compare. */
  readonly workspace_id?: string | null;
  readonly user_id: string | null;
  readonly session_id: string | null;
  readonly agent_id: string | null;
  /** v1.1 T2.1: first-class promoted column for multi-peer attribution (NULL on pre-v1.1 rows). */
  readonly attributed_to?: string | null;
  /** themory-category-filter-server-side T3.2 — first-class promoted column for operator
   *  category tag (NULL on pre-2026-06-09 rows per ADR D1 honest no-backfill). */
  readonly category?: string | null;
  readonly kind?: string | null;
  readonly code?: string | null;
  readonly description?: string | null;
  readonly code_language?: string | null;
  readonly derived_from?: unknown;
  readonly superseded_by?: string | null;
  /** principles-alignment-hardening T2.1 / ADR D1 — Princípio 1 confirmação factor. */
  readonly confirmation_count?: number;
  readonly expires_at?: Date | null;
  readonly t_valid?: Date | null;
  readonly t_invalid?: Date | null;
  readonly distinct_source_count?: number | null;
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
  /** keywordSearch only, when a query vector was given: 1 - cosine distance. NULL when the row has no vector. */
  readonly similarity?: number | null;
}

export function rowToResult(row: MemoriesRow): VectorStoreResult {
  const payload: Payload = {
    ...row.payload,
    text: row.text,
    hash: row.hash,
  };
  // multi-tenant-workspace-isolation T3.1: project workspace_id so consumers
  // (LocalMemory.forget's cross-workspace 404 check) can read it.
  if (row.workspace_id !== undefined && row.workspace_id !== null) {
    payload['workspace_id'] = row.workspace_id;
  }
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
  // themory-category-filter-server-side T3.2 / EC-12 dual-pathway — project the
  // category column into BOTH the top-level VectorStoreResult.category field
  // AND payload['category'] so consumers reading via either path keep working.
  // NULL rows leave both absent.
  if (row.category !== undefined && row.category !== null) {
    payload['category'] = row.category;
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
  // M10 T1.1 — project created_at into payload (dual-pathway, mirroring confirmation_count)
  // so recall()'s wrap pipeline can hoist the REAL age into MemoryItemWithScore.createdAt
  // (the recency signal the scope-aware reweight reads). Stored as an ISO string in the
  // primitive-only payload contract; the pipeline parses it back to a Date.
  if (row.created_at != null) {
    payload['created_at'] = row.created_at.toISOString();
  }
  if (row.t_valid !== undefined) payload['t_valid'] = row.t_valid?.toISOString() ?? null;
  if (row.t_invalid !== undefined) payload['t_invalid'] = row.t_invalid?.toISOString() ?? null;
  if (row.expires_at !== undefined) payload['expires_at'] = row.expires_at?.toISOString() ?? null;
  if (row.distinct_source_count !== undefined) payload['distinct_source_count'] = row.distinct_source_count;
  const score = row.distance !== undefined ? 1 - row.distance : row.rank;
  // dashboard-memories-tab-standardization T2.1 — null-safe createdAt projection.
  // EC-1: NULL → undefined (NOT new Date(0) which would silently lie 1970-01-01).
  // Forward-compat against (a) manual psql INSERT bypassing DEFAULT, (b) future
  // schema relaxation, (c) pg_restore. Schema currently declares created_at .notNull().
  const createdAt = row.created_at != null ? row.created_at : undefined;
  // Compose progressively to honor exactOptionalPropertyTypes (omit undefined fields).
  const base: VectorStoreResult = { id: row.id, payload };
  // themory-category-filter-server-side T3.2 / EC-12 — top-level category projection
  // ALONGSIDE the payload projection above. Both pathways surface the same value;
  // redundancy is intentional architectural symmetry (mirrors v1.1 attributed_to).
  const categoryProj =
    row.category !== undefined && row.category !== null ? row.category : undefined;
  return {
    ...base,
    ...(score !== undefined ? { score } : {}),
    ...(row.similarity !== undefined && row.similarity !== null ? { similarity: row.similarity } : {}),
    ...(createdAt !== undefined ? { createdAt } : {}),
    ...(categoryProj !== undefined ? { category: categoryProj } : {}),
  };
}

interface FilterClause {
  readonly sql: string;
  readonly params: readonly (string | number | boolean | null)[];
  readonly nextParamIndex: number;
}

// ADR-0011 bi-temporal recall predicate now lives in `./temporal-where` so the
// graph expansion path reuses the SAME audited predicate (M0 / DRY). Imported at
// the top of this module; the three call sites below are unchanged (columnPrefix
// defaults to '').

/**
 * skills-cross-repo-flat-list T1.1 (Drawback #2, High) — escape SQL LIKE
 * metacharacters in a value used as a literal prefix, so a subject containing
 * `\ % _` cannot broaden/narrow the `agent_id LIKE '{subject}:%' ESCAPE '\'`
 * match (cross-tenant leak guard). Order matters: backslash FIRST, then the
 * wildcards, so the wildcard-escape backslashes are not themselves re-escaped.
 */
function escapeLikeWildcards(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

function composeFilters(filters: Filters | undefined, startParamIndex: number): FilterClause {
  if (filters === undefined) {
    return { sql: '', params: [], nextParamIndex: startParamIndex };
  }
  const parts: string[] = [];
  const params: (string | number | boolean | null)[] = [];
  let idx = startParamIndex;
  // multi-tenant-workspace-isolation T1.1 (ADR D1/D4): workspace_id is the OUTER
  // tenant anchor — composed FIRST so the (workspace_id, <scope>) hot-path index
  // (migration 0016) is usable. Filters when present; the REST path always
  // supplies it via ScopedFilters, so a scoped query is never workspace-unscoped.
  for (const col of ['workspace_id', 'user_id', 'session_id', 'agent_id'] as const) {
    const value = filters[col];
    if (value === undefined) {
      continue;
    }
    // M8: when a hierarchical predicate owns session_id/agent_id (scopeHierarchy set),
    // skip their plain equality — session_id is kept in the filter for the WRITE column
    // derivation, but the RECALL predicate is the hierarchy branch below.
    if (filters.scopeHierarchy !== undefined && (col === 'session_id' || col === 'agent_id')) {
      continue;
    }
    parts.push(`${col} = $${idx}`);
    params.push(value);
    idx += 1;
  }
  // M8 hierarchical recall (owner decision 2026-07-22) — the tier's hierarchical scope
  // predicate (mirrors the in-memory matcher). Set by filtersFromScope for the User tier
  // ('global') and the user-bound Session tier ({ session }); it OWNS session_id/agent_id
  // (the equality loop above did NOT emit them). The IS-NULL / OR fragments don't
  // parameterize the column, but the session id IS a bound parameter (injection-safe).
  if (filters.scopeHierarchy === 'global') {
    // GLOBAL: durable user rows only — no session/agent sub-partition leaks in.
    parts.push(`session_id IS NULL AND agent_id IS NULL`);
  } else if (filters.scopeHierarchy !== undefined) {
    // SESSION ∪ GLOBAL: this session's rows OR the user's global rows (no agent rows).
    parts.push(`agent_id IS NULL AND (session_id = $${idx} OR session_id IS NULL)`);
    params.push(filters.scopeHierarchy.session);
    idx += 1;
  }
  // v1.1 T2.2: multi-peer attribution filter. EC-7 absorbed: Postgres `=`
  // semantics treat empty-string and NULL distinctly (`'' = ''` true; `NULL = ''`
  // returns NULL, no match), so passing attributedTo='' matches empty-string
  // rows only — NULL rows from pre-v1.1 stay excluded.
  // EC-5 absorbed: this single filter clause runs on the PRIMARY memory query
  // path inside vectorStore.search.
  //
  // M15 (#122) UPDATE — the trigger this note anticipated has fired. The entity boost is
  // live, and its lookup lives in `pg-linked-keys.ts`, not as a subquery here. That lookup
  // does NOT need an `attributed_to` clause: it is keyed by candidate ids that already
  // passed THIS filter, and it returns entity keys rather than memory rows, so no
  // additional attribution surface is exposed. It does carry the full scope predicate
  // (workspace + user + session + agent) and excludes superseded entities, for reasons
  // documented there. The named T4.1 guard from the original note was never written;
  // isolation is asserted instead in `tests/integration/entity-boost/linked-keys.test.ts`.
  if (filters.attributed_to !== undefined) {
    parts.push(`attributed_to = $${idx}`);
    params.push(filters.attributed_to);
    idx += 1;
  }
  // themory-category-filter-server-side T3.2 / EC-3 — empty-string filter
  // normalizes to no-filter at the store boundary so pgvector + in-memory +
  // LocalScopedMemory.getAll share identical semantic. Postgres `=` treats
  // empty string and NULL distinctly (`'' = ''` true; `NULL = ''` returns
  // NULL/no-match), so passing category='' WOULD filter for the empty-string
  // category — NOT the intended ADR D5 behavior. Defense-in-depth alongside
  // REST zod min(1) validation: direct SDK callers bypass zod.
  // EC-6: parameterized binding via $${idx}; the params array protects against
  // SQL injection regardless of the literal value (`' OR 1=1 --` is bound as a
  // string and never re-parsed as SQL).
  if (filters.category !== undefined && filters.category !== '') {
    parts.push(`category = $${idx}`);
    params.push(filters.category);
    idx += 1;
  }
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
   */
  private readonly embeddingDim: number;
  private readonly tracer?: Tracer;
  constructor(
    private readonly pool: Pool,
    options?: { readonly embeddingDim?: number; readonly tracer?: Tracer },
  ) {
    // A fronteira onde o pool entra num store é onde o modo de escrita se
    // decide: pool marcado por `tenantScopedPool` mantém estrito, pool cru
    // declara single-tenant. Ver workspace-write-scope.ts.
    configureWorkspaceWritesFromPool(pool);

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
    // Schema is owned by Drizzle migrations (T2.2). Just verify connectivity —
    // unless the pool is tenant-scoped. That pool refuses any connection outside
    // a workspace scope, and initialize() runs at boot, where no request (and so
    // no workspace) exists: probing it killed the server's boot (#225). The
    // composition root that built the scoped pool owns liveness on the RAW pool
    // underneath it (run-server's request-role guard and /v1/health probe).
    if (isTenantScopedPool(this.pool)) return;
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

  async findWriteReplay(requestKey: string, requestHash: string, filters: Filters): Promise<readonly VectorStoreResult[] | null> {
    const scopeKey = JSON.stringify([filters.workspace_id ?? 'default', filters.user_id ?? null,
      filters.session_id ?? null, filters.agent_id ?? null]);
    const result = await this.pool.query<MemoriesRow & { request_hash: string }>(
      `SELECT m.*,r.request_hash FROM memory_write_receipts r JOIN memories m ON m.id=r.memory_id
       WHERE r.workspace_id=$1 AND r.scope_key=$2 AND r.request_key=$3 ORDER BY m.created_at,m.id`,
      [filters.workspace_id ?? 'default', scopeKey, requestKey]);
    if (result.rows.length === 0) return null;
    if (result.rows.some((row) => row.request_hash !== requestHash)) throw new IdempotencyConflict();
    return result.rows.map(rowToResult);
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
    } catch (error) {
      if (error instanceof IdempotencyConflict) throw error;
      // F-arch-3: persist_fallback fires per batch invocation; per-row failures
      // are skipped (do not poison the rest of the batch) and tallied below.
      emitEvent(this.tracer, 'persist_fallback', { count: vectors.length });
      const outcomes: InsertOutcome[] = [];
      let failed = 0;
      let firstFailure: unknown;
      for (let i = 0; i < vectors.length; i += 1) {
        try {
          const singleOutcomes = await this.insertSingle(
            vectors[i] as readonly number[],
            ids[i] as string,
            payloads[i] as Payload,
          );
          outcomes.push(...singleOutcomes);
        } catch (rowError) {
          if (rowError instanceof IdempotencyConflict) throw rowError;
          failed += 1;
          firstFailure ??= rowError;
        }
      }
      if (failed > 0) {
        emitEvent(this.tracer, 'persist_fallback', { failed_rows: failed, total: vectors.length, ...persistErrorAttributes(firstFailure) });
      }
      // Nothing was saved: the batch failed, and the caller gets the database's reason (#231).
      if (outcomes.length === 0 && firstFailure !== undefined) {
        throw firstFailure instanceof Error ? firstFailure : new MemoryStoreError('Memory insert failed.', { cause: firstFailure });
      }
      return outcomes;
    }
  }

  private async insertBatch(
    vectors: readonly (readonly number[])[], ids: readonly string[], payloads: readonly Payload[],
  ): Promise<readonly InsertOutcome[]> {
    return writeWithEvidence(this.pool, vectors, ids, payloads,
      (client, vector, memoryId, payload) => this.insertBatchRaw([vector], [memoryId], [payload], client));
  }

  private async insertBatchRaw(
    vectors: readonly (readonly number[])[],
    ids: readonly string[],
    payloads: readonly Payload[],
    executor: Pick<Pool, 'query'>,
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
      // multi-tenant-workspace-isolation T1.1: hoist workspace_id from payload to
      // column, same pattern as user_id. Defaults to 'default' (the no-credential
      // collapse target, ADR D7) so SDK/unit callers that don't bind a workspace
      // land in the default tenant rather than a NULL violation.
      const workspaceId = (payload['workspace_id'] as string | undefined) ?? 'default';
      const userId = (payload['user_id'] as string | undefined) ?? null;
      const sessionId = (payload['session_id'] as string | undefined) ?? null;
      const agentId = (payload['agent_id'] as string | undefined) ?? null;
      // v1.1 T2.1: hoist attributed_to from payload to column. EC-2: this single
      // hoist serves BOTH the LLM-extraction path (pipeline writes
      // extracted[i].attributed_to into payload) AND the verbatim infer:false
      // path (pipeline writes options.attributedTo into payload).
      const attributedTo = (payload['attributed_to'] as string | undefined) ?? null;
      // themory-category-filter-server-side T3.2 — same hoist pattern for the
      // operator-supplied category tag. Pipeline writes options.category into
      // payload['category'] at T3.3; this hoist promotes it to the top-level
      // column. Delete from cleanedPayload so it lives in ONE canonical place
      // (the projection back into payload on SELECT happens at rowToResult).
      const category = (payload['category'] as string | undefined) ?? null;
      const cleanedPayload: Payload = { ...payload };
      delete cleanedPayload['text'];
      delete cleanedPayload['hash'];
      delete cleanedPayload['workspace_id'];
      delete cleanedPayload['user_id'];
      delete cleanedPayload['session_id'];
      delete cleanedPayload['agent_id'];
      delete cleanedPayload['attributed_to'];
      delete cleanedPayload['category'];
      // Valid-from instant (RememberOptions.observedAt). Absent → the insert time, as before.
      const tValid = typeof payload['t_valid'] === 'string' ? payload['t_valid'] : null;
      delete cleanedPayload['t_valid'];
      values.push(
        `($${p++}, $${p++}, $${p++}, $${p++}::vector, $${p++}::jsonb, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, COALESCE($${p++}::timestamptz, now()))`,
      );
      params.push(
        id,
        text,
        hash,
        vectorLiteral(vec),
        JSON.stringify(cleanedPayload),
        workspaceId,
        userId,
        sessionId,
        agentId,
        attributedTo,
        category,
        payload['expires_at'] ?? null,
        tValid,
      );
    }
    // principles-alignment-hardening T1.1 — composite ON CONFLICT per ADR D5.
    // The conflict target MUST match migration 0011's memories_hash_scope_unique_idx
    // expression list (hash, COALESCE(user_id,''), COALESCE(session_id,''), COALESCE(agent_id,'')).
    // On collision, bump confirmation_count by 1 (Princípio 1 — confirmação factor per ADR D1).
    // RETURNING (xmax = 0) AS inserted is the canonical PG tell-tale for INSERT-vs-UPDATE:
    // xmax = 0 on fresh inserts, non-zero on updates. confirmation_count is RETURNed post-bump.
    //
    // themory-category-filter-server-side T3.2 / ADR D6 (EC-1 absorbed):
    // category is INTENTIONALLY OMITTED from the DO UPDATE SET list. First-write
    // wins per ADR-0003 ADD-only spirit — once a row has a category, it is
    // immutable via remember(). Operators wanting to change category use the
    // canonical mutation path: `forget(id) + remember(newText, {category: 'B'})`.
    // Including category in the SET list would silently mutate operator-supplied
    // content on every re-remember (surprise + ADD-only violation).
    const sql = `
      INSERT INTO memories (id, text, hash, embedding, payload, workspace_id, user_id, session_id, agent_id, attributed_to, category, expires_at, t_valid)
      VALUES ${values.join(', ')}
      ON CONFLICT (workspace_id, hash, COALESCE(user_id, ''), COALESCE(session_id, ''), COALESCE(agent_id, ''))
      WHERE t_invalid IS NULL
      DO UPDATE SET confirmation_count = memories.confirmation_count + 1,
        -- A confirmation observed earlier than the stored row proves the fact held since then.
        t_valid = LEAST(memories.t_valid, EXCLUDED.t_valid)
      RETURNING id, confirmation_count, user_id, session_id, agent_id, (xmax = 0) AS inserted
    `;
    const result = await executor.query<{
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
    const cols =
      'id, text, hash, payload, user_id, session_id, agent_id, attributed_to, category, ' +
      // M10 T1.1: project created_at so the recalled row carries its REAL age (rowToResult maps
      // it) — the recency signal the scope-aware reweight reads. Without it the pipeline
      // hardcoded createdAt=now and a recency boost was a no-op.
      'kind, code, description, code_language, derived_from, superseded_by, t_valid, t_invalid, expires_at, distinct_source_count, confirmation_count, created_at';
    // EG-6 (recall-scoped-exact-search): a SELECTIVE (scope-filtered) recall must
    // NOT be starved by the HNSW global-top-`ef_search`-then-filter behavior of
    // pgvector 0.5.1 (a sparse scope whose rows are not among the global nearest
    // returns 0). When a filter is present, filter the scope rows FIRST via the
    // scope btree in a MATERIALIZED CTE (the planner cannot fold it back into an
    // HNSW plan) and sort that small subset by distance EXACTLY → recall@k correct
    // regardless of shared-index density. Unscoped search (no filter — not produced
    // by recall() today) keeps the plain HNSW ORDER BY path. Columns + param order
    // `[vector, ...temporal, ...filter, topK]` are preserved across both variants.
    // Branch on `filter.sql` (not `filter.params.length`): a param-less selective
    // clause (`excludeSuperseded` emits `superseded_by IS NULL` with NO param) MUST
    // also take the exact path — keying on params would route it to the unscoped
    // branch that omits `${filter.sql}`, silently dropping the clause.
    const hasFilter = filter.sql !== '';
    const sql = hasFilter
      ? `
      WITH scoped AS MATERIALIZED (
        SELECT ${cols}, embedding
        FROM memories
        WHERE ${temporal.sql}${filter.sql}
      )
      SELECT ${cols}, embedding <=> $1::vector AS distance
      FROM scoped
      ORDER BY distance ASC
      LIMIT $${filter.nextParamIndex}
    `
      : `
      SELECT ${cols}, embedding <=> $1::vector AS distance
      FROM memories
      WHERE ${temporal.sql}
      ORDER BY distance ASC
      LIMIT $${filter.nextParamIndex}
    `;
    const result = await this.pool.query<MemoriesRow>(sql, [
      vectorLiteral(query),
      ...temporal.params,
      ...filter.params,
      topK,
    ]);
    // Read-only: access bookkeeping is recordAccess(), called by recall for the rows it returns.
    return result.rows.map(rowToResult);
  }

  /**
   * v0.4b T3.1: single batched UPDATE incrementing access_count + setting
   * last_accessed_at = NOW() for the given memory ids (VectorStore.recordAccess).
   *
   * EC-8 absorption: a duplicate id in the input is incremented ONCE.
   *
   * The rows are locked in id order (SELECT ... ORDER BY id FOR UPDATE) before the
   * update. Without a fixed order, two concurrent recalls naming overlapping rows in
   * different orders deadlock, and Postgres aborts one of them: its increments are lost.
   *
   * Plan T3.1 § Deep Dives "Fire-and-forget telemetry": on failure, console.warn
   * + degrade gracefully (caller still receives the recall results unchanged).
   * OTel counter `theo.memory.lru_update_failures` is declared at T8.1 wiring
   * re-run per the existing OTel-counter exposure pattern.
   */
  async recordAccess(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) {
      return;
    }
    try {
      await this.pool.query(
        `WITH target AS (
           SELECT id FROM memories WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE
         )
         UPDATE memories m
            SET access_count = m.access_count + 1,
                last_accessed_at = NOW()
           FROM target
          WHERE m.id = target.id`,
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
    queryVector?: readonly number[],
  ): Promise<readonly VectorStoreResult[] | null> {
    // v0.4b T6.1 / D17 + v1.1 T3.1: same bi-temporal handling as semantic search.
    // $1 = query text, $2 = query vector (or NULL), then temporal + scope filters, then topK.
    const temporal = composeTemporalWhere(filters?.asOf, 3);
    const filter = composeFilters(filters, temporal.nextParamIndex);
    // Okapi BM25 with the Lucene IDF (domain/retrieval/bm25.ts, same k1/b), computed over the
    // rows the search is scoped to. Terms are the english-stemmed lexemes of to_tsvector, so
    // stop words drop out and "painted" matches "paint". Matching is disjunctive (any term),
    // and IDF keeps a term that nearly every row contains (a speaker's own name) from
    // dominating. ts_rank was used before; it has no IDF and returns values two orders of
    // magnitude below what the recall pipeline's sigmoid normalization is centered on.
    const sql = `
      WITH q AS (
        SELECT array_agg(DISTINCT lexeme) AS lexemes FROM unnest(to_tsvector('english', $1))
      ),
      docs AS (
        SELECT id, text, hash, payload, user_id, session_id, agent_id, attributed_to, category,
               kind, code, description, code_language, derived_from, superseded_by, t_valid, t_invalid, expires_at,
               distinct_source_count, confirmation_count, embedding,
               to_tsvector('english', text) AS tsv
        FROM memories
        WHERE ${temporal.sql}${filter.sql}
      ),
      doc_len AS (
        SELECT d.id, COALESCE(SUM(COALESCE(array_length(u.positions, 1), 1)), 0)::float8 AS dl
        FROM docs d LEFT JOIN LATERAL unnest(d.tsv) u ON true
        GROUP BY d.id
      ),
      stats AS (
        SELECT COUNT(*)::float8 AS n, COALESCE(AVG(dl), 0)::float8 AS avgdl FROM doc_len
      ),
      terms AS (
        SELECT d.id, u.lexeme, COALESCE(array_length(u.positions, 1), 1)::float8 AS tf
        FROM docs d, q, unnest(d.tsv) u
        WHERE u.lexeme = ANY(q.lexemes)
      ),
      df AS (
        SELECT lexeme, COUNT(*)::float8 AS df FROM terms GROUP BY lexeme
      ),
      scored AS (
        SELECT t.id,
               SUM(ln(1 + (s.n - f.df + 0.5) / (f.df + 0.5))
                   * t.tf * (${String(BM25_K1)} + 1)
                   / (t.tf + ${String(BM25_K1)} * (1 - ${String(BM25_B)} + ${String(BM25_B)} * l.dl / NULLIF(s.avgdl, 0)))) AS rank
        FROM terms t
        JOIN df f USING (lexeme)
        JOIN doc_len l ON l.id = t.id
        CROSS JOIN stats s
        GROUP BY t.id
      )
      SELECT d.id, d.text, d.hash, d.payload, d.user_id, d.session_id, d.agent_id, d.attributed_to, d.category,
             d.kind, d.code, d.description, d.code_language, d.derived_from, d.superseded_by, d.t_valid, d.t_invalid,
             d.expires_at, d.distinct_source_count, d.confirmation_count,
             sc.rank,
             CASE WHEN $2::vector IS NULL THEN NULL ELSE 1 - (d.embedding <=> $2::vector) END AS similarity
      FROM scored sc
      JOIN docs d ON d.id = sc.id
      ORDER BY sc.rank DESC, d.id
      LIMIT $${filter.nextParamIndex}
    `;
    const result = await this.pool.query<MemoriesRow>(sql, [
      query,
      queryVector === undefined ? null : vectorLiteral(queryVector),
      ...temporal.params,
      ...filter.params,
      topK,
    ]);
    return result.rows.map(rowToResult);
  }

  async get(vectorId: string): Promise<VectorStoreResult | null> {
    // `t_invalid` is selected (and surfaced on the payload) but NOT filtered here: the
    // internal callers need the row even when it is soft-deleted — `LocalMemory.forget`
    // reads it to authorize a GDPR hard-erasure of an ALREADY-forgotten memory. The
    // public read (`LocalMemory.get`) is what hides forgotten rows.
    const result = await this.pool.query<MemoriesRow & { t_invalid: Date | null }>(
      `SELECT id, text, hash, payload, workspace_id, user_id, session_id, agent_id, attributed_to, category,
              kind, code, description, code_language, derived_from, superseded_by, t_valid, t_invalid, expires_at, distinct_source_count, confirmation_count, t_invalid
         FROM memories WHERE id = $1`,
      [vectorId],
    );
    if (result.rows.length === 0) {
      return null;
    }
    const row = result.rows[0] as MemoriesRow & { t_invalid: Date | null };
    const mapped = rowToResult(row);
    if (row.t_invalid !== null && row.t_invalid !== undefined) {
      (mapped.payload as Record<string, unknown>)['t_invalid'] = row.t_invalid.toISOString();
    }
    return mapped;
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

  /**
   * Scope-checked delete (themory-scoped-forget T1.1, ADR D1). Removes the row
   * ONLY when its `workspace_id` AND every bound scope-tier column in `filters`
   * match — so a cross-subject / cross-workspace id matches 0 rows (the caller
   * maps that to MemoryNotFound → 404, no existence leak; the other row is never
   * touched). Single SQL — no read-then-write race. Soft (default) sets
   * `t_invalid = NOW()` guarded by `t_invalid IS NULL` (double-soft → 0 rows →
   * idempotent 404, EC-4). Hard physically deletes; child rows in
   * `memory_entities` / `entity_edges` cascade (FKs are ON DELETE CASCADE,
   * migrations 0018/0019 — no children-first logic, EC-1). Returns whether a row
   * matched.
   *
   * #110 — hard delete also garbage-collects the graph, TARGETED (O(k), never a
   * full-table sweep): the entities this memory linked are re-checked after the
   * cascade; any that lost their LAST `memory_entities` link is deleted, along
   * with edges touching a collected endpoint. Same transaction as the delete —
   * a crash never leaves half-collected state. Emits `entity_gc_collected`
   * (Princípio 3) when anything was collected.
   */
  async supersede(filters: Filters, memoryIds: readonly string[], by: { readonly memoryId: string; readonly at: Date }): Promise<readonly string[]> {
    if (memoryIds.length === 0) return [];
    const params: unknown[] = [[...new Set(memoryIds)], filters.workspace_id ?? 'default', by.memoryId, by.at.toISOString()];
    let where = 'id = ANY($1::uuid[]) AND workspace_id = $2 AND id <> $3::uuid';
    for (const col of ['user_id', 'session_id', 'agent_id'] as const) {
      const val = filters[col];
      if (val !== undefined && val !== null) {
        params.push(val);
        where += ` AND ${col} = $${String(params.length)}`;
      }
    }
    const { rows } = await this.pool.query<{ id: string }>(
      `UPDATE memories
          SET t_invalid = $4::timestamptz, updated_at = NOW(),
              payload = payload || jsonb_build_object('superseded_by_memory', $3::text)
        WHERE ${where} AND t_invalid IS NULL AND (t_valid IS NULL OR t_valid <= $4::timestamptz)
        RETURNING id`,
      params,
    );
    return rows.map((r) => r.id);
  }

  async deleteInScope(vectorId: string, filters: Filters, hard: boolean): Promise<boolean> {
    // workspace param matches what rows carry: unbound rows store 'default'.
    const params: unknown[] = [vectorId, filters.workspace_id ?? 'default'];
    let where = 'id = $1 AND workspace_id = $2';
    // AND every provided scope-tier column (a scoped binding sets exactly one).
    for (const col of ['user_id', 'session_id', 'agent_id'] as const) {
      const val = filters[col];
      if (val !== undefined && val !== null) {
        params.push(val);
        where += ` AND ${col} = $${String(params.length)}`;
      }
    }
    if (!hard) {
      const result = await this.pool.query(
        `UPDATE memories SET t_invalid = NOW() WHERE ${where} AND t_invalid IS NULL`,
        params,
      );
      return (result.rowCount ?? 0) > 0;
    }
    const { matched, entitiesCollected, edgesCollected } = await this.withTransaction(async (client) => {
      // Capture the linked entity ids BEFORE the delete cascades the links away.
      const { rows: linked } = await client.query<{ entity_id: string }>(
        'SELECT entity_id FROM memory_entities WHERE memory_id = $1',
        [vectorId],
      );
      const result = await client.query(`DELETE FROM memories WHERE ${where}`, params);
      const hit = (result.rowCount ?? 0) > 0;
      let ents = 0;
      let edges = 0;
      if (hit && linked.length > 0) {
        const ids = linked.map((r) => r.entity_id);
        // Edges first (they reference entities): drop edges whose endpoint is about
        // to be collected (endpoint in `ids` AND endpoint now has zero links).
        // M13 T2.2 (#111): `collectible` = zero-link entities among the linked ids
        // MINUS supersede anchors — a row carrying `superseded_by` and a row
        // referenced BY one are audit-trail anchors (Princípio 3); the GC never
        // collects either, and edges follow the same set so provenance survives.
        const collectibleCte =
          `collectible AS (
             SELECT e.id FROM entities e
              WHERE e.id = ANY($1::uuid[])
                AND e.superseded_by IS NULL
                AND NOT EXISTS (SELECT 1 FROM memory_entities me WHERE me.entity_id = e.id)
                AND NOT EXISTS (SELECT 1 FROM entities o WHERE o.superseded_by = e.id))`;
        const edgeRes = await client.query(
          `WITH ${collectibleCte}
           DELETE FROM entity_edges ee
           WHERE ee.source_entity_id IN (SELECT id FROM collectible)
              OR ee.target_entity_id IN (SELECT id FROM collectible)`,
          [ids],
        );
        edges = edgeRes.rowCount ?? 0;
        const entRes = await client.query(
          `WITH ${collectibleCte}
           DELETE FROM entities e
           WHERE e.id IN (SELECT id FROM collectible)`,
          [ids],
        );
        ents = entRes.rowCount ?? 0;
      }
      return { matched: hit, entitiesCollected: ents, edgesCollected: edges };
    });
    if (entitiesCollected > 0 || edgesCollected > 0) {
      emitEvent(this.tracer, 'entity_gc_collected', {
        entities_collected: entitiesCollected,
        edges_collected: edgesCollected,
      });
    }
    return matched;
  }

  async deleteCol(): Promise<void> {
    await this.pool.query('TRUNCATE memories CASCADE');
  }

  async list(
    filters?: Filters,
    topK = 100,
    includeSoftDeleted = false,
    offset = 0,
  ): Promise<readonly [readonly VectorStoreResult[], number]> {
    const filter = composeFilters(filters, 1);
    // Live-only by default: exclude soft-deleted rows (t_invalid IS NOT NULL),
    // matching search()/recall. Without this, a memory the consumer forgot still
    // appears in getAll → scopes endpoint / OpenMemory list_memories / dashboard.
    // The getAll projection hardcodes tInvalid:null, confirming list is live-only.
    // includeSoftDeleted=true is reserved for Memory.reset (full-scope purge),
    // which must enumerate tombstones to physically delete them.
    const temporal = composeTemporalWhere(filters?.asOf, filter.nextParamIndex);
    const liveClause = includeSoftDeleted ? '1=1' : temporal.sql;
    const baseParams = [...filter.params, ...(includeSoftDeleted ? [] : temporal.params)];
    const pageIndex = includeSoftDeleted ? filter.nextParamIndex : temporal.nextParamIndex;
    const countSql = `SELECT COUNT(*)::int AS total FROM memories WHERE ${liveClause}${filter.sql}`;
    const countResult = await this.pool.query<{ total: number }>(countSql, baseParams);
    const total = countResult.rows[0]?.total ?? 0;

    // dashboard-memories-tab-standardization T2.1:
    //   - SELECT projection extended with `created_at` so VectorStoreResult.createdAt flows.
    //   - ORDER BY flipped to `created_at DESC, id ASC` per EC-2 absorption:
    //     newest-first primary + deterministic id tiebreak for identical timestamps.
    //     Dashboard pagination consumes this contract (same query → same order across refreshes).
    const pageSql = `
      SELECT id, text, hash, payload, user_id, session_id, agent_id, attributed_to, category,
             kind, code, description, code_language, derived_from, superseded_by, t_valid, t_invalid, expires_at, distinct_source_count, confirmation_count,
             created_at
      FROM memories
      WHERE ${liveClause}${filter.sql}
      ORDER BY created_at DESC, id ASC
      LIMIT $${pageIndex} OFFSET $${pageIndex + 1}
    `;
    const pageResult = await this.pool.query<MemoriesRow>(pageSql, [...baseParams, topK, offset]);
    return [pageResult.rows.map(rowToResult), total];
  }

  /**
   * Entity-filtered listing (theo-cloud#252) — the live memories LINKED to one
   * entity via `memory_entities`, under the scope `filters`, newest first.
   * `entityName` is the SURFACE name (what `/entities` returns as `id`);
   * normalization to `entities.normalized_key` happens here (same
   * `normalizeEntityKey` the write-path linking uses), workspace-bound so a
   * same-named entity in another workspace never leaks. Duck-typed store
   * extension (skills precedent — off the VectorStore DIP); consumed by
   * `LocalScopedMemory.getAll({ entity })` → `?entity=` on the scope listing.
   */
  async listByEntity(
    filters: Filters | undefined,
    entityName: string,
    topK = 100,
    offset = 0,
  ): Promise<readonly [readonly VectorStoreResult[], number]> {
    const filter = composeFilters(filters, 3);
    const normalizedKey = normalizeEntityKey(entityName);
    const workspaceId = filters?.workspace_id ?? 'default';
    const temporal = composeTemporalWhere(filters?.asOf, filter.nextParamIndex);
    const entityClause = `${temporal.sql}${filter.sql}
       AND EXISTS (
         SELECT 1 FROM memory_entities me
         JOIN entities e ON e.id = me.entity_id
         WHERE me.memory_id = memories.id
           AND e.workspace_id = $1 AND e.normalized_key = $2
       )`;
    const baseParams = [workspaceId, normalizedKey, ...filter.params, ...temporal.params];
    const countResult = await this.pool.query<{ total: number }>(
      `SELECT COUNT(*)::int AS total FROM memories WHERE ${entityClause}`,
      baseParams,
    );
    const total = countResult.rows[0]?.total ?? 0;
    const pageResult = await this.pool.query<MemoriesRow>(
      `SELECT id, text, hash, payload, user_id, session_id, agent_id, attributed_to, category,
              kind, code, description, code_language, derived_from, superseded_by, t_valid, t_invalid, expires_at, distinct_source_count, confirmation_count,
              created_at
       FROM memories
       WHERE ${entityClause}
       ORDER BY created_at DESC, id ASC
       LIMIT $${temporal.nextParamIndex} OFFSET $${temporal.nextParamIndex + 1}`,
      [...baseParams, topK, offset],
    );
    return [pageResult.rows.map(rowToResult), total];
  }

  /**
   * Session enumeration (session-separation fix 2026-07-23) — distinct
   * `session_id` values under the `(workspace, user)` anchor in `filters`, with
   * live counts + newest activity. Duck-typed store extension (skills-methods
   * precedent — off the VectorStore DIP per ADR-0008); consumed by
   * `LocalScopedMemory.listSessions` → `GET /v1/scopes/user/:id/sessions`.
   * Uses the M8 composite index (migration 0024) leading columns.
   */
  async listSessions(
    filters?: Filters,
  ): Promise<readonly { sessionId: string; memoryCount: number; lastActivityAt: Date }[]> {
    const params: string[] = [filters?.workspace_id ?? 'default'];
    let userClause = '';
    if (filters?.user_id !== undefined && filters.user_id !== null) {
      params.push(filters.user_id);
      userClause = ' AND user_id = $2';
    }
    const res = await this.pool.query<{ session_id: string; memory_count: number; last_activity_at: Date }>(
      `SELECT session_id, COUNT(*)::int AS memory_count, MAX(created_at) AS last_activity_at
       FROM memories
       WHERE t_invalid IS NULL AND (expires_at IS NULL OR expires_at > NOW()) AND session_id IS NOT NULL AND workspace_id = $1${userClause}
       GROUP BY session_id
       ORDER BY MAX(created_at) DESC
       LIMIT 500`,
      params,
    );
    return res.rows.map((r) => ({
      sessionId: r.session_id,
      memoryCount: r.memory_count,
      lastActivityAt: r.last_activity_at,
    }));
  }

  /**
   * skills-cross-repo-flat-list T1.1 (ADR D1/D3) — tenant-safe cross-repo skills
   * listing. Filters `kind='skill'` rows whose `agent_id` starts with the
   * escaped `'{subject}:'` prefix (the gateway's per-customer namespace, ADR D3
   * multi-workspace correctness). The prefix is wildcard-escaped and bound as a
   * param with `ESCAPE '\'` so a subject containing `% _ \` cannot broaden the
   * match (cross-tenant leak guard). Live-only, newest-first; returns
   * `[rows, total]` mirroring `list()`. The caller decodes + strips the prefix.
   */
  async listSkillsBySubject(
    args: ListSkillsBySubjectArgs,
  ): Promise<readonly [readonly VectorStoreResult[], number]> {
    const prefix = `${escapeLikeWildcards(args.subject)}:%`;
    // Param order: $1 workspace_id, $2 agent_id prefix, [$3 q], then limit/offset.
    const params: (string | number)[] = [args.workspaceId, prefix];
    let p = 3;
    const supersededClause = args.includeSuperseded ? '' : ' AND superseded_by IS NULL';
    let qClause = '';
    if (args.q !== undefined && args.q.length > 0) {
      // /review COR-1: escape LIKE metacharacters in `q` (mirror listEpisodes) so a
      // `q` of `%`/`_` is a LITERAL substring — matching the in-memory store's
      // `.includes()` semantics (store parity) rather than a wildcard.
      qClause = ` AND description ILIKE $${p} ESCAPE '\\'`;
      params.push(`%${escapeLikePattern(args.q)}%`);
      p += 1;
    }
    const where = `t_invalid IS NULL AND kind = 'skill' AND workspace_id = $1 AND agent_id LIKE $2 ESCAPE '\\'${supersededClause}${qClause}`;
    const countSql = `SELECT COUNT(*)::int AS total FROM memories WHERE ${where}`;
    const countResult = await this.pool.query<{ total: number }>(countSql, params);
    const total = countResult.rows[0]?.total ?? 0;

    const limitIdx = p;
    const offsetIdx = p + 1;
    const pageSql = `
      SELECT id, text, hash, payload, user_id, session_id, agent_id, attributed_to, category,
             kind, code, description, code_language, derived_from, superseded_by, t_valid, t_invalid, expires_at, distinct_source_count, confirmation_count,
             created_at
      FROM memories
      WHERE ${where}
      ORDER BY created_at DESC, id ASC
      LIMIT $${limitIdx} OFFSET $${offsetIdx}
    `;
    const pageResult = await this.pool.query<MemoriesRow>(pageSql, [
      ...params,
      args.limit,
      args.offset,
    ]);
    return [pageResult.rows.map(rowToResult), total];
  }

  /**
   * first-class-episodes M2 T2.1 — cursor-paginated, bi-temporal-aware temporal
   * list ordered by `(created_at, id)`.
   *
   * EC-1: `composeTemporalWhere(options.asOf)` is MUTUALLY EXCLUSIVE — asOf set →
   * ADR-0011 bi-temporal predicate (a row soft-deleted AFTER asOf still appears);
   * asOf unset → `t_invalid IS NULL` (live only). Never a conjunction.
   * EC-2: `queryText` uses `ILIKE $n ESCAPE '\'` over a metacharacter-escaped
   * pattern so `%`/`_`/`\` match literally.
   * EC-3: cursor predicate is a row-value comparison `(created_at, id) {<|>} ($a,$b)`
   * matching the `ORDER BY created_at, id` comparator (full ms precision via the
   * opaque cursor; UUID id is the deterministic tie-break).
   *
   */
  async listEpisodes(
    filters: Filters | undefined,
    options: EpisodeListOptions,
  ): Promise<readonly VectorStoreResult[]> {
    const cap = resolveEpisodeLimit(options.limit);
    const order = options.order === 'asc' ? 'ASC' : 'DESC';

    // EC-1: asOf vs soft-delete are an if/else (composeTemporalWhere), never ANDed.
    const temporal = composeTemporalWhere(options.asOf, 1);
    const filter = composeFilters(filters, temporal.nextParamIndex);
    const params: (string | number | boolean | Date | null)[] = [
      ...temporal.params,
      ...filter.params,
    ];
    let idx = filter.nextParamIndex;
    const extra: string[] = [];

    // EC-3: cursor row-value comparison. After = later-in-active-order; before =
    // earlier. For DESC, "later" means smaller (created_at,id); for ASC, larger.
    //
    // PRECISION (the load-bearing detail): the `created_at` COLUMN is timestamptz
    // (microsecond), but the cursor carries a JS-Date/ISO MILLISECOND value (the
    // `pg` driver already truncates timestamptz → JS Date at ms, so the encoded
    // cursor can only ever be ms). Comparing the raw µs column against an ms
    // cursor makes the boundary row leak back in for ASC (`col_µs > cursor_ms` is
    // true for the boundary row itself). We therefore compare — and order by —
    // `created_at` TRUNCATED to milliseconds, so the column and the cursor share
    // one granularity and the unique `id` is the deterministic intra-ms tie-break.
    const cursorRaw = options.after ?? options.before;
    if (cursorRaw !== undefined) {
      const isAfter = options.after !== undefined;
      const cursor = decodeEpisodeCursor(cursorRaw);
      const laterIsSmaller = order === 'DESC';
      const op = isAfter === laterIsSmaller ? '<' : '>';
      extra.push(`(date_trunc('milliseconds', created_at), id) ${op} ($${idx}, $${idx + 1})`);
      params.push(cursor.createdAt, cursor.id);
      idx += 2;
    }

    // EC-2: literal partial-text filter (ILIKE with escaped metacharacters).
    if (options.queryText !== undefined && options.queryText.length > 0) {
      extra.push(`text ILIKE $${idx} ESCAPE '\\'`);
      params.push(`%${escapeLikePattern(options.queryText)}%`);
      idx += 1;
    }

    const extraSql = extra.length > 0 ? ` AND ${extra.join(' AND ')}` : '';
    const pageSql = `
      SELECT id, text, hash, payload, workspace_id, user_id, session_id, agent_id, attributed_to, category,
             kind, code, description, code_language, derived_from, superseded_by, t_valid, t_invalid, expires_at, distinct_source_count, confirmation_count,
             created_at
      FROM memories
      WHERE ${temporal.sql}${filter.sql}${extraSql}
      ORDER BY date_trunc('milliseconds', created_at) ${order}, id ${order}
      LIMIT $${idx}
    `;
    // Over-fetch cap+1 so the façade can compute nextCursor (truncation disclosure).
    params.push(cap + 1);
    const result = await this.pool.query<MemoriesRow>(pageSql, params);
    return result.rows.map(rowToResult);
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
    attributedTo?: string;
    scope: {
      workspaceId?: string | null;
      userId?: string | null;
      sessionId?: string | null;
      agentId?: string | null;
    };
  }): Promise<string> {
    // /review F-M15: dim guard symmetry — derived-memory write path also
    // routes through the same EmbeddingMismatch contract.
    this.assertEmbeddingDim(args.embedding, 'insertDerivedMemory');
    // multi-tenant-workspace-isolation T1.1: a reflection-derived memory stays
    // in its source workspace; default to 'default' (ADR D7) when unbound.
    return runInTx(this.pool, async (client) => {
    const sources = await client.query<{ expires_at: Date | null }>(
      `SELECT expires_at FROM memories WHERE id=ANY($1::uuid[]) AND workspace_id=$2
       AND t_invalid IS NULL AND (expires_at IS NULL OR expires_at>NOW()) FOR SHARE`,
      [[...args.derivedFrom], args.scope.workspaceId ?? 'default']);
    const expectedSources = new Set(args.derivedFrom).size;
    if (sources.rows.length !== expectedSources || sources.rows.length === 0) {
      throw new DerivedMemorySourcesUnavailableError(expectedSources, sources.rows.length);
    }
    const deadlines = sources.rows.flatMap((row) => row.expires_at === null ? [] : [row.expires_at.getTime()]);
    const expiresAt = deadlines.length === 0 ? null : new Date(Math.min(...deadlines));
    const sql = `
      INSERT INTO memories (
        text, hash, embedding, payload,
        workspace_id, user_id, session_id, agent_id,
        kind, derived_from, expires_at, attributed_to
      ) VALUES (
        $1, $2, $3::vector, '{}'::jsonb,
        $4, $5, $6, $7,
        'derived', $8::jsonb, $9, $10
      )
      RETURNING id
    `;
    const result = await client.query<{ id: string }>(sql, [
      args.text,
      args.hash,
      vectorLiteral(args.embedding),
      args.scope.workspaceId ?? 'default',
      args.scope.userId ?? null,
      args.scope.sessionId ?? null,
      args.scope.agentId ?? null,
      JSON.stringify([...args.derivedFrom]),
      expiresAt,
      args.attributedTo ?? null,
    ]);
    const row = result.rows[0];
    if (row === undefined) {
      throw new Error('insertDerivedMemory: INSERT returned no rows');
    }
    await client.query(`INSERT INTO memory_evidence(workspace_id,memory_id,origin_source_id,evidence)
      SELECT DISTINCT ON (origin_source_id) workspace_id,$1,origin_source_id,evidence FROM memory_evidence
      WHERE memory_id=ANY($2::uuid[]) AND workspace_id=$3 ON CONFLICT DO NOTHING`,
      [row.id,[...args.derivedFrom],args.scope.workspaceId ?? 'default']);
    await client.query(`UPDATE memories SET distinct_source_count=(SELECT COUNT(*) FROM memory_evidence
      WHERE memory_id=$1) WHERE id=$1`, [row.id]);
    return row.id;
    });
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
  ): Promise<
    readonly {
      memoryId: string;
      text: string;
      createdAt: Date;
      confirmationCount?: number;
      distinctSourceCount?: number | null;
      expiresAt?: Date | null;
      embedding?: readonly number[];
      attributedTo?: string;
    }[]
  > {
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
      composeTemporalWhere(undefined, 1).sql,
      '(t_valid IS NULL OR t_valid <= NOW())',
    ];
    const params: unknown[] = [];
    // multi-tenant-workspace-isolation /review F-dom-api-1 (CRITICAL): reflect()
    // is a PRIMARY verb, NOT a deferred secondary surface. Without this clause a
    // ws-A reflect would pull ws-B's extracted rows into the LLM merge prompt AND
    // could soft-delete a ws-B row as "rejected" — a cross-workspace read +
    // DESTRUCTIVE IDOR. The workspace_id flows in via the workspace-bound
    // memory's filters (filtersFromScope(scope, workspaceId)).
    if (filters.workspace_id !== undefined) {
      params.push(filters.workspace_id);
      where.push(`workspace_id = $${String(params.length)}`);
    }
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
    const { rows } = await this.pool.query<{
      id: string;
      text: string;
      created_at: Date;
      confirmation_count: number;
      distinct_source_count: number | null;
      expires_at: Date | null;
      embedding: string;
      attributed_to: string | null;
    }>(
      // M9: confirmation_count is the durability signal the SessionToGlobalConsolidationPolicy reads.
      // M24 T1.1: project embedding so the bounded `clusterByProximity` domain fn can group
      // candidates by cosine (pgvector returns the vector type as a `[a,b,c]` text literal).
      `SELECT id, text, created_at, expires_at, distinct_source_count, confirmation_count, embedding, attributed_to FROM memories WHERE ${where.join(' AND ')}`,
      params,
    );
    return rows.map((r) => ({
      memoryId: r.id,
      text: r.text,
      createdAt: r.created_at,
      confirmationCount: r.confirmation_count,
      distinctSourceCount: r.distinct_source_count,
      expiresAt: r.expires_at,
      embedding: parseVectorLiteral(r.embedding),
      ...(r.attributed_to === null ? {} : { attributedTo: r.attributed_to }),
    }));
  }

  /**
   * v0.7 T2.1 — persist N `ConflictResolutionResult` rows atomically: for each
   * result, soft-delete the rejected memory ids (`t_invalid = NOW()` per
   * ADR-0006) AND insert one `consolidation_history` audit row. EC-8 absorbed:
   * the entire batch runs inside a single `withTransaction` so a mid-batch
   * `INSERT consolidation_history` failure rolls BOTH the soft-deletes AND
   * any earlier inserts; the consumer never observes half-applied state.
   *
   */
  async persistConsolidations(
    results: readonly ConflictResolutionResult[],
    options?: { readonly promote?: boolean },
  ): Promise<number> {
    if (results.length === 0) return 0;
    const promote = options?.promote === true;
    let promotedCount = 0;
    await this.withTransaction(async (client) => {
      for (const r of results) {
        // M9 (T2.1): promote the durable representative to GLOBAL (session_id→NULL,
        // agent_id→NULL) in the SAME txn as the soft-delete + audit, so promotion +
        // duplicate-decay + provenance are atomic (EC-8 rollback parity). The
        // `session_id IS NOT NULL OR agent_id IS NOT NULL` guard makes re-runs idempotent
        // (a concurrent/duplicate promotion updates 0 rows, never an error). workspace_id
        // + user_id are UNTOUCHED — the promotion never crosses the (workspace, user)
        // isolation boundary (M9 hard gate).
        //
        // F-arch-3/F-xval-5 (review fix): the audit row + the returned count reflect the
        // rows ACTUALLY promoted (rowCount > 0), NOT the policy's decision count — so an
        // idempotent re-run (or a concurrent loser) writes NO duplicate audit row and does
        // not over-report the promotion (Princípio 3 fidelity). The v0.7 non-promote path
        // (options omitted) is unchanged: it always audits its soft-delete decision.
        if (promote) {
          const res = await client.query(
            `UPDATE memories SET session_id = NULL, agent_id = NULL
              WHERE id = $1::uuid AND t_invalid IS NULL
                AND (session_id IS NOT NULL OR agent_id IS NOT NULL)`,
            [r.keptMemoryId],
          );
          if ((res.rowCount ?? 0) === 0) {
            continue; // nothing promoted (already global / lost the race) → no audit, no count
          }
          promotedCount += 1;
        }
        if (r.rejectedMemoryIds.length > 0) {
          await client.query(
            `UPDATE memories SET t_invalid = NOW()
              WHERE id = ANY($1::uuid[]) AND t_invalid IS NULL`,
            [[...r.rejectedMemoryIds]],
          );
        }
        await client.query(
          // workspace_id é parâmetro, não expressão SQL: quem decide é
          // `workspaceIdForWrite`, estrito por padrão (sem escopo, lança).
          // Omitido, isto caía no DEFAULT 'default' e a linha de auditoria
          // nascia no inquilino errado — ou, sob a policy, era recusada.
          `INSERT INTO consolidation_history (
             kept_memory_id, rejected_memory_ids, reason, policy_name,
             original_episode_ids, workspace_id
           ) VALUES ($1, $2::jsonb, $3, $4, $5::jsonb, $6)`,
          [
            r.keptMemoryId,
            JSON.stringify([...r.rejectedMemoryIds]),
            r.reason,
            r.policyName,
            JSON.stringify([...r.originalEpisodeIds]),
            workspaceIdForWrite('persistConsolidations'),
          ],
        );
      }
    });
    return promotedCount;
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

    // T3.3 — atomic upsert eliminates the SELECT-then-INSERT/UPDATE race (ADR D5).
    // reflection_counters has a UNIQUE btree index on (scope_user_id,
    // scope_session_id, scope_agent_id). Standard btree treats NULL as
    // distinct from NULL, so ON CONFLICT won't fire when columns are NULL.
    // CTE-based approach: attempt UPDATE first (IS NOT DISTINCT FROM handles
    // NULL = NULL), then INSERT only when no existing row matched. The
    // serializable isolation of the CTE guarantees atomicity.
    const upsertSql = `
      WITH updated AS (
        UPDATE reflection_counters
        SET count = count + 1, updated_at = NOW()
        WHERE scope_user_id IS NOT DISTINCT FROM $1
          AND scope_session_id IS NOT DISTINCT FROM $2
          AND scope_agent_id IS NOT DISTINCT FROM $3
          AND workspace_id = $4
        RETURNING count
      ),
      inserted AS (
        INSERT INTO reflection_counters
               (scope_user_id, scope_session_id, scope_agent_id, count, workspace_id)
        SELECT $1, $2, $3, 1, $4
        WHERE NOT EXISTS (SELECT 1 FROM updated)
        RETURNING count
      )
      SELECT count FROM updated
      UNION ALL
      SELECT count FROM inserted
    `;
    const result = await this.pool.query<{ count: string }>(upsertSql, [
      userId,
      sessionId,
      agentId,
      workspaceIdForWrite('bumpReflectionCounter'),
    ]);
    const row = result.rows[0];
    if (row === undefined) {
      throw new Error('reflection_counters UPSERT returned no rows');
    }
    return Number(row.count);
  }
}
