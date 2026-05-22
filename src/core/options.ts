/**
 * Option-bag types for the four public verbs + parity helpers.
 *
 * @see ADR-0004 — API verbs (remember / recall / forget / reflect + parity helpers).
 * @see ADR-0006 — bi-temporal columns (asOf is uniform at the type level; runtime divergence per local v0.1).
 */
import type { Filters } from './scope.js';

export interface RememberOptions {
  /** Flat key-value payload attached to the resulting memory items. @see MemoryItem.metadata for the same shape constraints. */
  readonly metadata?: Readonly<Record<string, string | number | boolean | null>>;

  /**
   * Default `true`. When `false`, persist text verbatim without invoking the LLM extraction pipeline.
   * Useful for migration / batch import scenarios where the caller has already extracted facts.
   *
   * @see ADR-0001 — `infer: false` escape hatch.
   */
  readonly infer?: boolean;
}

export interface RecallOptions {
  /** Default `20` (Mem0 parity). Upper bound on number of memories returned. */
  readonly topK?: number;

  /** Default `0.1` (Mem0 parity). Semantic-similarity gate applied BEFORE BM25 + entity-boost composition. */
  readonly threshold?: number;

  /**
   * Bi-temporal point-in-time query. When set, recall returns the memories that were valid at the given instant.
   *
   * @see ADR-0006 — local v0.1 runtime throws BiTemporalNotSupportedLocally when this field is provided; cloud v0.5+ honors it.
   * @throws BiTemporalNotSupportedLocally — on the local runtime until v0.5+ backports the asOf query support.
   */
  readonly asOf?: Date;
}

export interface ForgetOptions {
  /**
   * Default `false`. Soft delete via `tInvalid` (bi-temporal). When `true`, removes the row entirely (hard delete) — useful for GDPR-style erasure.
   *
   * @see ADR-0006 — soft delete sets `tInvalid: now()`; hard delete drops the row.
   */
  readonly hard?: boolean;
}

export interface ReflectOptions {
  /**
   * Default `10`. Upper bound on iterations per reflection cycle. The sleep-time worker (v0.4a) uses this as its cap.
   *
   * @see ADR-0005 — reflection trigger (explicit-only at v0.0).
   */
  readonly maxIterations?: number;
}

export interface GetAllOptions {
  /** Default `100`. Upper bound on listed memories. */
  readonly topK?: number;

  /** Raw filter access for advanced consumers (admin paths, debugging). Most consumers use ScopedMemory.getAll which derives Filters from the scope. */
  readonly filters?: Filters;
}
