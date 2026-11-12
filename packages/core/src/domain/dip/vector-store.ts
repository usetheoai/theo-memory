/**
 *
 * @see ADR-0008 — DIP method counts (VectorStore: 13 required — 11 original +
 *   `deleteInScope` (themory-scoped-forget) + `listEpisodes` (first-class-episodes M2);
 *   both additive read/scoped methods on the store that owns `memories`).
 * @see ADR-0001 — upstream-shape architecture (nine-step search requires keywordSearch BM25 fallback).
 *
 * v0.6 note: skill semantics (`insertSkill` / `insertDerivedSkill`) live on the
 * concrete local stores as duck-typed extensions (matching the v0.4a
 * consolidate path uses runtime `typeof store.insertSkill === 'function'`
 * guards (see `src/local/index.ts` v0.4a reflect chain for the pattern).
 *
 */
import type { EpisodeListOptions } from '../episode.js';
import type { Filters } from '../scope.js';

export interface VectorStoreResult {
  readonly id: string;
  readonly payload: Readonly<Record<string, string | number | boolean | null>>;
  readonly score?: number;
  /**
   * Cosine similarity between this row's stored vector and the query vector, in [-1, 1].
   * Set by `keywordSearch` when the caller passes `queryVector`, so a row found only by the
   * lexical channel is gated and scored on its real semantic similarity instead of 0.
   * Absent on `search` results (there `score` already is the similarity).
   */
  readonly similarity?: number;
  /**
   * Wall-clock when the row was first persisted, projected from the adapter's
   * underlying store (e.g., PgvectorStore SELECTs `created_at` column;
   * InMemoryVectorStore stamps `new Date()` at insert).
   *
   * When `undefined`, the consumer falls back to `new Date()` AND emits the OTel
   * `getall_temporal_fallback{count}` event per request — surfaces stale-impl
   * adapter usage (rows without temporal projection) instead of silently lying
   * about freshness.
   *
   * Additive optional field (backward-compatible for all 6+ existing callsites
   * in `src/local/index.ts` and the 2 in-tree impls).
   *
   */
  readonly createdAt?: Date;
  /**
   * themory-category-filter-server-side T3.1 — operator-supplied category tag
   * projected from the adapter's underlying store (PgvectorStore SELECTs `category`
   * column; InMemoryVectorStore reads `payload['category']`). NULL on rows
   * persisted without a category (per ADR D1 honest no-backfill).
   *
   * EC-12 dual-pathway: when this field is non-NULL, the adapter ALSO surfaces
   * `payload['category']` with the same value — consumers reading via either
   * pathway (top-level OR payload JSONB) continue to work. Mirrors the v1.1
   * `attributed_to` precedent (architectural symmetry; redundancy is intentional).
   *
   * Additive optional field — backward-compatible.
   *
   */
  readonly category?: string;
}

/**
 * Per-id outcome returned by `VectorStore.insert` — surfaces UPSERT semantics
 * to the wrap site so `MemoryItem.confirmationCount` + `MemoryItem.rejectedAsDuplicate`
 * can be populated honestly per ADR D1 + D4 of principles-alignment-hardening.
 *
 * For adapters lacking UPSERT semantics (e.g., in-memory backends), each row is
 * treated as a fresh insert: confirmationCount=1, rejectedAsDuplicate=false.
 *
 */
export interface InsertOutcome {
  /** The request had already committed; no assertion was added. */
  readonly idempotentReplay?: boolean;
  readonly distinctSourceCount?: number | null;
  readonly expiresAt?: Date | null;
  readonly id: string;
  readonly confirmationCount: number;
  readonly rejectedAsDuplicate: boolean;
}

export interface VectorStore {
  /**
   * Count an access to each memory: the caller of recall() received it. Feeds the
   * forgetting signals (access_count, last_accessed_at). Called with the ids recall
   * returns, never with internal search candidates. Best-effort: a failure must not fail
   * the recall. Adapters without access bookkeeping omit it.
   */
  recordAccess?(ids: readonly string[]): Promise<void>;

  /** Replay committed facts before invoking extraction. Null means no receipt exists. */
  findWriteReplay?(requestKey: string, requestHash: string, filters: Filters): Promise<readonly VectorStoreResult[] | null>;

  /** Idempotent setup: create collection/table, indices, dimension probe, etc. Adapters MAY no-op when already initialized. */
  initialize(): Promise<void>;

  /**
   * Persist N vectors with matching ids + payloads. Returns per-id outcomes
   * exposing UPSERT semantics: when the underlying store has scope-aware dedup
   * (e.g., PgvectorStore via migration 0011's composite UNIQUE), repeated
   * writes of the same (hash, scope) tuple bump `confirmationCount` and mark
   * `rejectedAsDuplicate=true`; fresh inserts return `confirmationCount=1` +
   * `rejectedAsDuplicate=false`.
   *
   * Per ADR-0001, adapters MUST implement the per-row fallback path: batch
   * failure -> per-item retry. Per principles-alignment-hardening ADR D1 + D4,
   * the outcome array MUST contain one entry per input id, in input order.
   */
  insert(
    vectors: readonly (readonly number[])[],
    ids: readonly string[],
    payloads: readonly Record<string, string | number | boolean | null>[],
  ): Promise<readonly InsertOutcome[]>;

  /** Semantic search over the query vector. */
  search(
    query: readonly number[],
    topK?: number,
    filters?: Filters,
  ): Promise<readonly VectorStoreResult[]>;

  /**
   * BM25 keyword search. REQUIRED method per ADR-0001 (nine-step search relies on it).
   * Adapters that genuinely cannot implement BM25 return `null` to opt out of the BM25 component;
   * the method itself MUST exist on the type.
   *
   * Scores are Okapi BM25 over the rows the search is scoped to (`domain/retrieval/bm25.ts`):
   * a row containing ANY query term is a candidate, and rarer terms weigh more (IDF). The recall
   * pipeline's sigmoid normalization is centered on raw BM25 values, so a score on another scale
   * (cosine, ts_rank, raw term overlap) would make the lexical signal meaningless. A conjunctive
   * match would drop almost every natural-language question, whose words are rarely all present
   * in one stored fact.
   *
   * When `queryVector` is given, each result carries `similarity` (cosine to the query vector).
   */
  keywordSearch(
    query: string,
    topK?: number,
    filters?: Filters,
    queryVector?: readonly number[],
  ): Promise<readonly VectorStoreResult[] | null>;

  /** Fetch a single result by id, or null if not present. */
  get(vectorId: string): Promise<VectorStoreResult | null>;

  /**
   * Internal-only mutation — refreshes a vector + payload in place.
   * NOT exposed on the public Memory surface (ADR-0003 ADD-only).
   * Used by reflection / consolidation paths to refresh embeddings.
   */
  update(
    vectorId: string,
    vector: readonly number[],
    payload: Record<string, string | number | boolean | null>,
  ): Promise<void>;

  /** Delete a single vector by id. */
  delete(vectorId: string): Promise<void>;

  /**
   * Scope-checked delete (themory-scoped-forget T1.1, ADR D1): delete the row by
   * id ONLY when its `workspace_id` AND every bound scope-tier column in `filters`
   * match. Returns whether a row matched (0 → caller maps to MemoryNotFound → 404,
   * no existence leak; the non-matching row is never touched). `hard=false` is a
   * soft delete on stores that model `t_invalid` (Pg); stores without it (in-memory)
   * physically delete regardless of `hard`. Pg soft is idempotent-404 on a row
   * already soft-deleted (EC-4).
   */
  deleteInScope(vectorId: string, filters: Filters, hard: boolean): Promise<boolean>;

  /**
   * ADR-0029 — mark memories as no longer true from `by.at`, because memory `by.memoryId`
   * replaced them. Only rows of the workspace and bound scope tiers in `filters` that are live,
   * valid no later than `by.at` and are not `by.memoryId` itself change; each gets
   * `t_invalid = by.at` and keeps its row for `asOf` reads. Returns the ids it invalidated.
   * Optional: a store without it never supersedes on write.
   */
  supersede?(filters: Filters, memoryIds: readonly string[], by: { readonly memoryId: string; readonly at: Date }): Promise<readonly string[]>;

  /**
   * #238 — store a memory's importance in [0, 1] (`MemoryItem.llmImportanceScore`, read by the
   * eviction policy). Only a live row of the workspace and bound scope tiers in `filters`
   * changes. Returns whether a row matched. Optional: a store without it cannot score on write.
   */
  setImportance?(filters: Filters, memoryId: string, importance: number): Promise<boolean>;

  /** Drop the entire collection/table. Administrative; pairs with Memory.reset(scope) at the domain layer. */
  deleteCol(): Promise<void>;

  /**
   * Paginated list (results, totalCount).
   *
   * Returns only currently-valid (live) rows by default — soft-deleted rows
   * (`t_invalid IS NOT NULL`) are excluded, matching `search`/recall, so a
   * forgotten memory never reappears in a listing.
   *
   * @param includeSoftDeleted — when `true`, ALSO return soft-deleted rows.
   *   Reserved for administrative full-scope purge (`Memory.reset`), which must
   *   physically remove every row in scope including tombstones. Default `false`.
   */
  list(
    filters?: Filters,
    topK?: number,
    includeSoftDeleted?: boolean,
    /**
     * SQL-level page offset under the deterministic `created_at DESC, id ASC`
     * order (dashboard pager 2026-07-22 — offset was silently ignored end-to-end
     * and no page beyond the first was reachable). Default `0`.
     */
    offset?: number,
  ): Promise<readonly [readonly VectorStoreResult[], number]>;

  /**
   * Episodic / message-log read surface (M2 / gap G3): a cursor-paginated,
   * bi-temporal-aware TEMPORAL list of the scope's memories ordered by
   * `(created_at, id)`.
   *
   * Contract:
   * - **Ordering**: `created_at <order>, id <order>` (default `desc`); `id` (UUID)
   *   is the deterministic tie-break for same-millisecond rows.
   * - **Cursor**: `options.after` / `options.before` are opaque `(created_at, id)`
   *   cursors (see `domain/episode.ts`); a cursor value matching no row simply
   *   yields the page from that position (no error — deliberate divergence from a
   *   row-id lookup). At most one of after/before is honored.
   * - **Soft-delete vs asOf (MUTUALLY EXCLUSIVE)**: when `options.asOf` is set, the
   *   ADR-0011 bi-temporal predicate applies (a row soft-deleted AFTER asOf still
   *   appears at asOf); otherwise soft-deleted rows (`t_invalid IS NOT NULL`) are
   *   excluded. The two are an if/else, never a conjunction.
   * - **queryText**: optional literal partial-text filter (ILIKE with escaped
   *   metacharacters) — NOT semantic search.
   * - **Over-fetch**: returns AT MOST `resolveEpisodeLimit(options.limit) + 1`
   *   rows; the caller (façade) uses the extra row to compute `nextCursor`.
   *
   * Additive read method; existing methods are unchanged (ADR-0008 method-count
   * note — this is a read of the same `memories` the store already owns).
   *
   */
  listEpisodes(
    filters: Filters | undefined,
    options: EpisodeListOptions,
  ): Promise<readonly VectorStoreResult[]>;

  /**
   * @see ADR-0002 — tenant isolation uses `Filters` on every call, NOT this method.
   * This pair is preserved for upstream-port parity (adapter-side observability / single-client telemetry).
   * Adapters SHALL NOT use `setUserId` to encode the active scope; the call MUST work for every tenant.
   */
  getUserId(): Promise<string>;

  /**
   * @see ADR-0002 — same as getUserId(). Session-metadata only.
   * Adapters SHALL NOT use this to gate read/write access; isolation always uses Filters.
   */
  setUserId(userId: string): Promise<void>;
}
