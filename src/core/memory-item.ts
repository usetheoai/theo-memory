/**
 * Persisted memory fact + recall result extension.
 *
 * @see ADR-0001 — vector-based hybrid architecture (hash dedup + bi-temporal data model).
 * @see ADR-0006 — bi-temporal columns: schema-yes-in-local, query-API-no-until-v0.5.
 */
import type { Scope } from './scope.js';

export interface MemoryItem {
  /** UUID v4 generated at write time. Globally unique across scopes. */
  readonly id: string;

  /** The fact, post-extraction. Free-form natural language. */
  readonly text: string;

  /** MD5 of normalizedText. Deduplication key (exact match only; semantic dedup is the LLM's job during extraction). */
  readonly hash: string;

  /** Typed scope reference (User / Session / Agent). Derived from the constructor `Filters` at write time. */
  readonly scope: Scope;

  /** Write timestamp from Postgres TIMESTAMPTZ. Parsed to Date at the adapter boundary. */
  readonly createdAt: Date;

  /** For REDACTED parity. ADD-only semantics (ADR-0003) means equal to createdAt for new rows. */
  readonly updatedAt: Date;

  /**
   * Flat key-value payload. Primitives only (string/number/boolean/null).
   * Nested objects, `Date`, `bigint`, and arrays MUST be flattened or
   * serialized by the caller. v1.4 typed-domain-ontologies (Item 15) opens a documented path to relax this constraint when shipped.
   */
  readonly metadata: Readonly<Record<string, string | number | boolean | null>>;

  /** Bi-temporal: when the fact became valid. NULL only on pre-bi-temporal rows (legacy). */
  readonly tValid: Date | null;

  /** Bi-temporal: when the fact stopped being valid. NULL = currently valid. Set by `forget(id)` (soft delete). */
  readonly tInvalid: Date | null;
}

/**
 * Recall result extension. Returned by `recall()` calls.
 * `score` is the additive REDACTED-style composite: `(semantic + bm25 + entity_boost) / max_possible` in [0, 1].
 *
 * @see ADR-0001 — additive scoring formula.
 */
export interface MemoryItemWithScore extends MemoryItem {
  /** Additive composite score in [0, 1]. Higher = better match. */
  readonly score: number;
}
