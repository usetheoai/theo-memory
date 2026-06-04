/**
 * VectorStore DIP — adapter contract for vector-storage backends (pgvector, Qdrant, etc).
 *
 * @see ADR-0008 — DIP method counts (VectorStore: 11 required).
 * @see ADR-0001 — Mem0-shape architecture (nine-step search requires keywordSearch BM25 fallback).
 *
 * v0.6 note: skill semantics (`insertSkill` / `insertDerivedSkill`) live on the
 * concrete local stores as duck-typed extensions (matching the v0.4a
 * `insertDerivedMemory` precedent), NOT on this DIP. External adapters (Qdrant,
 * Pinecone, etc.) are not required to implement skill semantics; the
 * consolidate path uses runtime `typeof store.insertSkill === 'function'`
 * guards (see `src/local/index.ts` v0.4a reflect chain for the pattern).
 *
 * @see .claude/knowledge-base/plans/voyager-skill-library-plan.md § T2.1
 */
import type { Filters } from '../scope.js';

export interface VectorStoreResult {
  readonly id: string;
  readonly payload: Readonly<Record<string, string | number | boolean | null>>;
  readonly score?: number;
}

/**
 * Per-id outcome returned by `VectorStore.insert` — surfaces UPSERT semantics
 * to the wrap site so `MemoryItem.confirmationCount` + `MemoryItem.rejectedAsDuplicate`
 * can be populated honestly per ADR D1 + D4 of principles-alignment-hardening.
 *
 * For adapters lacking UPSERT semantics (e.g., in-memory backends), each row is
 * treated as a fresh insert: confirmationCount=1, rejectedAsDuplicate=false.
 *
 * @see .claude/knowledge-base/plans/principles-alignment-hardening-plan.md § ADR D1 + § ADR D4
 */
export interface InsertOutcome {
  readonly id: string;
  readonly confirmationCount: number;
  readonly rejectedAsDuplicate: boolean;
}

export interface VectorStore {
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
   */
  keywordSearch(
    query: string,
    topK?: number,
    filters?: Filters,
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

  /** Drop the entire collection/table. Administrative; pairs with Memory.reset(scope) at the domain layer. */
  deleteCol(): Promise<void>;

  /** Paginated list (results, totalCount). */
  list(
    filters?: Filters,
    topK?: number,
  ): Promise<readonly [readonly VectorStoreResult[], number]>;

  /**
   * @see ADR-0002 — tenant isolation uses `Filters` on every call, NOT this method.
   * This pair is preserved for Mem0-port parity (adapter-side observability / single-client telemetry).
   * Adapters SHALL NOT use `setUserId` to encode the active scope; the call MUST work for every tenant.
   */
  getUserId(): Promise<string>;

  /**
   * @see ADR-0002 — same as getUserId(). Session-metadata only.
   * Adapters SHALL NOT use this to gate read/write access; isolation always uses Filters.
   */
  setUserId(userId: string): Promise<void>;
}
