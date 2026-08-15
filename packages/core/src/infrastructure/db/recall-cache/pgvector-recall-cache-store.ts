/**
 * `PgvectorRecallCacheStore` — default `RecallCacheStore` impl backed by the
 * `recall_cache` Postgres table + pgvector cosine similarity search.
 *
 * 4-method DIP per `src/core/dip/recall-cache-store.ts` (T0.1):
 *   - `get`             — semantic lookup at cosine ≥ effective threshold, non-expired
 *   - `set`             — write-through populate; capacity-bounded LRU eviction inside
 *                          SERIALIZABLE tx (T1.2 / EC-7)
 *   - `invalidateScope` — write-triggered correctness gate (DELETE all scope rows)
 *   - `clearExpired`    — TTL-driven housekeeping sweep
 *
 * **EC-2 absorption** (dim mismatch detection): the factory at T2.1 probes
 * `atttypmod` on `recall_cache.query_embedding` and refuses to operate when
 * the embedder dim does not match. THIS class trusts that contract — every
 * `embedding` argument matches the table schema.
 *
 * **EC-7 absorption** (concurrent-set LRU race): `set()` runs in a
 * SERIALIZABLE transaction; race retries once on `40001` per
 * `withSerializableTransactionAndRetry`.
 *
 * **EC-8 absorption** (zero-norm embedding NaN cosine): pgvector `<=> 0_vec`
 * yields `NaN`. **PostgreSQL float comparisons treat NaN as greater-than all
 * non-NaN values** (per `numeric.h` + docs § 8.1.4) — so the SQL filter
 * `(1 - distance) >= threshold` does NOT exclude NaN rows; it INCLUDES them.
 * The plan's original claim (mirror IEEE 754 short-circuit) was wrong for PG.
 * Application-level guard at `get()` entry: if `queryEmbedding` is zero-norm,
 * short-circuit MISS without touching the DB. Cheap O(N) sum check (N ≤ 1536).
 *
 * **EC-12 DOCUMENT** (result_set size): JSONB rows up to ~1 MB are routine
 * in Postgres. Typical `recall topK=100 × 4 KB/item ≈ 400 KB`. Rows over
 * ~500 KB approach pgvector practical write latency — surface as a warning
 * at telemetry layer; this class does NOT artificially gate row size.
 *
 * **Module hygiene** (architecture.md § Module hygiene): targeted ≤ 300 LoC
 * per plan T1.1 Acceptance; cyclomatic ≤ 8 per method.
 *
 * @see src/core/dip/recall-cache-store.ts (the 13th DIP)
 */
import type { Pool } from 'pg';

import {
  DEFAULT_MAX_SIZE_PER_SCOPE,
  DEFAULT_THRESHOLD,
  DEFAULT_TTL_SECONDS_BY_SCOPE_TIER,
  type CachedResult,
  type RecallCacheStore,
  type RecallCacheStoreConfig,
  type ScopeTierTtlConfig,
} from '../../../domain/dip/recall-cache-store.js';
import type { MemoryItemWithScore } from '../../../domain/memory-item.js';
import type { Scope } from '../../../domain/scope.js';

import {
  getRecallCacheHitCounter,
  getRecallCacheHitDurationHistogram,
} from './recall-cache-metrics.js';
import { deriveScopeKey } from './scope-key.js';
import { withSerializableTransactionAndRetry } from './serializable-tx.js';

/**
 * `get()` SQL — selects the closest non-expired row with similarity ≥ threshold.
 *
 * Cosine similarity = `1 - (a <=> b)` (pgvector cosine distance operator).
 *
 * **EC-8 zero-norm handling (READ CAREFULLY — load-bearing application guard):**
 * Pgvector `<=> 0_vec` yields `NaN`. PostgreSQL float comparisons treat NaN
 * as GREATER-THAN every non-NaN value (per PG docs § 8.1.4), so the
 * `(1 - NaN) >= 0.8` filter HERE evaluates to TRUE and would let zero-norm
 * rows through — the opposite of IEEE 754 semantics. The fix lives at the
 * application boundary: `isZeroNorm()` short-circuits MISS at `get()` entry
 * BEFORE this SQL is run. **DO NOT remove the `isZeroNorm()` guard "because
 * the SQL filters it" — the SQL does NOT, and removing the guard silently
 * re-introduces the EC-8 cache-poisoning bug.** Cross-references the
 * file-level JSDoc above + `pgvector-recall-cache-store.test.ts` T1.1-RED-9
 * + plan EC-8 absorption.
 */
const GET_SQL = `SELECT result_set, threshold_used, (1 - (query_embedding <=> $2::vector)) AS similarity, created_at
   FROM recall_cache
  WHERE scope_key = $1
    AND (1 - (query_embedding <=> $2::vector)) >= $3
    AND (expires_at IS NULL OR expires_at > NOW())
  ORDER BY query_embedding <=> $2::vector ASC
  LIMIT 1`;

/** `set()` INSERT statement (capacity check runs separately inside the tx). */
const INSERT_SQL = `INSERT INTO recall_cache
    (scope_key, query_embedding, result_set, expires_at, threshold_used, workspace_id)
  VALUES ($1, $2::vector, $3, NOW() + ($4 || ' seconds')::INTERVAL, $5,
          current_setting('app.workspace_id', true))`;

/** Capacity probe for LRU eviction inside the SERIALIZABLE tx (T1.2 / EC-7). */
const COUNT_SCOPE_SQL = `SELECT COUNT(*)::int AS count FROM recall_cache WHERE scope_key = $1`;

/** LRU eviction — drop the oldest `created_at` row inside the same scope. */
const DELETE_OLDEST_SQL = `DELETE FROM recall_cache
   WHERE id = (
     SELECT id FROM recall_cache
      WHERE scope_key = $1
      ORDER BY created_at ASC
      LIMIT 1
   )`;

/** `invalidateScope()` SQL — write-triggered correctness gate. */
const INVALIDATE_SCOPE_SQL = `DELETE FROM recall_cache WHERE scope_key = $1`;

/** `clearExpired()` sweep. */
const CLEAR_EXPIRED_SQL = `DELETE FROM recall_cache
   WHERE expires_at IS NOT NULL AND expires_at <= NOW()`;

interface GetRow {
  readonly result_set: readonly MemoryItemWithScore[];
  readonly threshold_used: number;
  readonly similarity: number;
  readonly created_at: Date;
}

/** Marker type so `Scope.kind` maps cleanly into `ScopeTierTtlConfig` keys. */
type ScopeTierKey = keyof ScopeTierTtlConfig;

export interface PgvectorRecallCacheStoreOptions {
  /**
   * semantic-recall-cache-v1-5 T3.1 — embedder-kind label for OTel metric
   * attributes (per blueprint D5: `{ scope_tier, embedder_kind }`). Best-effort
   * — passed in by the factory at construction time so the metric attribute is
   * stable across the impl's lifetime. Defaults to `'unknown'` when omitted.
   */
  readonly embedderKind?: string;
}

export class PgvectorRecallCacheStore implements RecallCacheStore {
  private readonly threshold: number;
  private readonly ttlSecondsByScopeTier: ScopeTierTtlConfig;
  private readonly maxSizePerScope: number;
  private readonly embedderKind: string;

  constructor(
    private readonly pool: Pool,
    config: RecallCacheStoreConfig = {},
    options: PgvectorRecallCacheStoreOptions = {},
  ) {
    this.threshold = config.threshold ?? DEFAULT_THRESHOLD;
    this.ttlSecondsByScopeTier = config.ttlSecondsByScopeTier ?? DEFAULT_TTL_SECONDS_BY_SCOPE_TIER;
    this.maxSizePerScope = config.maxSizePerScope ?? DEFAULT_MAX_SIZE_PER_SCOPE;
    this.embedderKind = options.embedderKind ?? 'unknown';
  }

  /** Resolve TTL for a scope tier (EC-3 absorption: 4 tiers including `repo`). */
  resolveTtlSeconds(scope: Scope): number {
    const tier: ScopeTierKey = scope.kind;
    return this.ttlSecondsByScopeTier[tier];
  }

  async get(
    queryEmbedding: readonly number[],
    scope: Scope,
    workspaceId?: string,
  ): Promise<CachedResult | undefined> {
    // EC-8 absorption: PG NaN semantics differ from IEEE 754 — NaN > x is TRUE
    // in PG (per PG docs § 8.1.4), so the SQL `>=` filter does NOT exclude
    // NaN rows. Guard at the entry: zero-norm query → MISS without DB roundtrip.
    if (isZeroNorm(queryEmbedding)) {
      return undefined;
    }
    const scopeKey = deriveScopeKey(scope, workspaceId);
    const vectorLiteral = embeddingToVectorLiteral(queryEmbedding);
    // T3.1 — wall-clock latency observation for the HIT path (miss-path
    // latency is observed at the Memory.recall() wrap site since miss includes
    // the 9-step pipeline cost).
    const start = performance.now();
    const { rows } = await this.pool.query<GetRow>(GET_SQL, [scopeKey, vectorLiteral, this.threshold]);
    const row = rows[0];
    if (row === undefined) {
      return undefined;
    }
    const attrs = { scope_tier: scope.kind, embedder_kind: this.embedderKind };
    getRecallCacheHitCounter().add(1, attrs);
    getRecallCacheHitDurationHistogram().record(performance.now() - start, attrs);
    return {
      results: row.result_set,
      cachedAt: row.created_at,
      similarity: row.similarity,
    };
  }

  async set(
    queryEmbedding: readonly number[],
    scope: Scope,
    results: readonly MemoryItemWithScore[],
    ttlSeconds: number,
    workspaceId?: string,
  ): Promise<void> {
    const scopeKey = deriveScopeKey(scope, workspaceId);
    const vectorLiteral = embeddingToVectorLiteral(queryEmbedding);
    const resultSetJson = JSON.stringify(results);
    // EC-7 absorption: SERIALIZABLE isolation defends against the concurrent-set LRU race.
    // PG aborts one tx with `40001`; the wrapper retries once. Both inserts ultimately land.
    await withSerializableTransactionAndRetry(this.pool, async (tx) => {
      const countResult = await tx.query<{ count: number }>(COUNT_SCOPE_SQL, [scopeKey]);
      const count = countResult.rows[0]?.count ?? 0;
      if (count >= this.maxSizePerScope) {
        await tx.query(DELETE_OLDEST_SQL, [scopeKey]);
      }
      await tx.query(INSERT_SQL, [
        scopeKey,
        vectorLiteral,
        resultSetJson,
        String(ttlSeconds),
        this.threshold,
      ]);
    });
  }

  async invalidateScope(scope: Scope, workspaceId?: string): Promise<number> {
    const scopeKey = deriveScopeKey(scope, workspaceId);
    const result = await this.pool.query(INVALIDATE_SCOPE_SQL, [scopeKey]);
    return result.rowCount ?? 0;
  }

  async clearExpired(): Promise<number> {
    const result = await this.pool.query(CLEAR_EXPIRED_SQL);
    return result.rowCount ?? 0;
  }
}

/**
 * Format a number[] as pgvector's `[1.0,2.0,...]` literal. The driver
 * doesn't infer pgvector binding so we cast `$N::vector` server-side.
 */
function embeddingToVectorLiteral(embedding: readonly number[]): string {
  return `[${embedding.join(',')}]`;
}

/**
 * EC-8 absorption — detect zero-norm vectors at `get()` entry.
 *
 * Returns `true` IFF every component is exactly zero. Defending against the
 * PG-specific NaN > x semantics gap: pgvector's cosine distance on a zero
 * vector is `0/0 = NaN`, which PostgreSQL treats as greater-than all values
 * (NOT IEEE 754 false), so the SQL `>=` filter would let the row through.
 *
 * Cheap O(N) scan — embeddings cap at MAX_EMBEDDING_DIM=1536 components.
 */
function isZeroNorm(embedding: readonly number[]): boolean {
  for (const x of embedding) {
    if (x !== 0) return false;
  }
  return true;
}
