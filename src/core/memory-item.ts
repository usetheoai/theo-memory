/**
 * Persisted memory fact + recall result extension.
 *
 * @see ADR-0001 — Mem0-shape architecture (hash dedup + bi-temporal data model).
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

  /** For Mem0 parity. ADD-only semantics (ADR-0003) means equal to createdAt for new rows. */
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

  /**
   * v0.4a: LLM-judged importance ∈ [0, 1] cached at write per ADR D8.
   * Optional + nullable on the type to preserve backward compatibility with
   * pre-v0.4a callers; v0.4a writes populate it, v0.4b TriadicScoringPolicy
   * reads it (falling back to a neutral default when absent).
   *
   * @see .claude/knowledge-base/plans/v0-4a-reflection-pipeline-plan.md § ADR D8
   */
  readonly llmImportanceScore?: number | null;

  /**
   * v0.4b: timestamp of last recall() touching this row — drives exponential
   * half-life decay + LRU bookkeeping per plan T2.1 + T3.1. NULL means never
   * recalled since insert. Optional on the type for pre-v0.4b backward compat.
   *
   * @see .claude/knowledge-base/plans/v0-4b-forgetting-pipeline-plan.md § T0.1 (D13)
   */
  readonly lastAccessedAt?: Date | null;

  /**
   * v0.4b: monotonic access counter incremented by `recall()` write-back hook
   * per plan T3.1. Drives the access-frequency dimension of triadic scoring.
   * Optional on the type for pre-v0.4b backward compat (treated as 0 when absent).
   */
  readonly accessCount?: number;

  /**
   * v0.4b: per-row half-life in seconds; lazy-backfilled from llmImportanceScore
   * on first scoring per plan T2.2 (D14). NULL until first backfill; consumer
   * computes via the D14 formula at scoring time.
   */
  readonly halfLifeSeconds?: number | null;
}

/**
 * Recall result extension. Returned by `recall()` calls.
 * `score` is the additive Mem0-style composite: `(semantic + bm25 + entity_boost) / max_possible` in [0, 1].
 *
 * @see ADR-0001 — additive scoring formula.
 */
export interface MemoryItemWithScore extends MemoryItem {
  /** Additive composite score in [0, 1]. Higher = better match. */
  readonly score: number;
}
