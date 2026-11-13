/**
 * Persisted memory fact + recall result extension.
 *
 * @see ADR-0001 — upstream-shape architecture (hash dedup + bi-temporal data model).
 * @see ADR-0006 — bi-temporal columns: schema-yes-in-local, query-API-no-until-v0.5.
 */
import type { LoggedMessage } from './dip/message-log.js';
import type { EventTime } from './extraction/event-time.js';
import type { MemoryEvidence } from './memory-evidence.js';
import type { MemoryDurability } from './memory-time.js';
import type { Scope } from './scope.js';

export interface MemoryItem {
  /** This request had already committed; no assertion or post-write hook ran again. */
  readonly idempotentReplay?: boolean;
  /** Distinct identified origins; null means legacy provenance is unknown. */
  readonly distinctSourceCount?: number | null;
  /** Explicit deadline, independent of forgetting. A passing state of the moment gets one at write (ADR-0035). */
  readonly expiresAt?: Date | null;

  /** When the fact's event is, counted from when it was said. Absent when the fact names no time. */
  readonly eventTime?: EventTime;

  /** How long the extractor expected the statement to hold. Absent on memories written without extraction. */
  readonly durability?: MemoryDurability;

  /** How this context was obtained. Undefined on legacy/unclassified memories.
   * @see docs/memory-semantics.md
   */
  readonly evidence?: MemoryEvidence;

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

  /** For upstream-pipeline parity. ADD-only semantics (ADR-0003) means equal to createdAt for new rows. */
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
   * v1.1 T1.1: multi-peer attribution. The perspective owner of this fact —
   * typically a peer ID (user id, agent id, or `'system'` for self-statements).
   * N-valent semantic: any string is accepted; not restricted to a bivalent
   * `"user"`/`"assistant"` vocabulary. Populated by LLM extraction
   * (`extracted[i].attributed_to`) OR by verbatim callers passing
   * `RememberOptions.attributedTo` (EC-2 absorbed via ADR D2).
   *
   * Pre-v1.1 rows have NULL permanently because the pre-v1.1 pipeline discarded
   * the LLM-extracted value at payload composition (EC-1 honest no-backfill
   * documented in CHANGELOG migration notes).
   *
   */
  readonly attributedTo?: string;

  /**
   * v0.4a: LLM-judged importance ∈ [0, 1] cached at write per ADR D8.
   * Optional + nullable on the type to preserve backward compatibility with
   * pre-v0.4a callers; v0.4a writes populate it, v0.4b TriadicScoringPolicy
   * reads it (falling back to a neutral default when absent).
   *
   */
  readonly llmImportanceScore?: number | null;

  /**
   * v0.4b: timestamp of last recall() touching this row — drives exponential
   * half-life decay + LRU bookkeeping per plan T2.1 + T3.1. NULL means never
   * recalled since insert. Optional on the type for pre-v0.4b backward compat.
   *
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

  /**
   * principles-alignment-hardening T2.1 / ADR D1 — Princípio 1 (CLAUDE.md § IMPORTANTE)
   * confirmação factor: how many times the SAME hash was asserted within the SAME
   * scope. Starts at 1 on fresh insert; bumps on dedup-collision via
   * PgvectorStore's composite ON CONFLICT (ADR D5). Consumers can filter by
   * `confirmation_count > N` to surface high-confidence facts.
   *
   * Optional on the type for backward compat: adapters lacking UPSERT semantics
   * it undefined.
   *
   * @see CLAUDE.md § IMPORTANTE Princípio 1
   */
  readonly confirmationCount?: number;

  /**
   * principles-alignment-hardening T2.1 / ADR D4 — Princípio 3 (CLAUDE.md § IMPORTANTE)
   * IGNORE auditability surface: `true` when this item is the existing row
   * returned after a dedup-collision UPSERT (hash + scope tuple matched an
   * existing row; confirmation_count was bumped instead of a fresh INSERT).
   * `false` (or undefined) means a fresh row was inserted.
   *
   * Consumers detecting dedup-collision use `if (item.rejectedAsDuplicate === true)`.
   * Per ADR D4 this is an additive optional widening of the existing MemoryItem
   * shape (NOT a new return type) honoring ADR-0003 ADD-only invariant.
   *
   * @see CLAUDE.md § IMPORTANTE Princípio 3
   */
  readonly rejectedAsDuplicate?: boolean;

  /**
   * ADR-0029 — ids of the existing memories this write marked as no longer true. Present only
   * when the write superseded something; each one keeps its row and an `asOf` before the
   * change still returns it.
   */
  readonly supersedes?: readonly string[];

  /**
   * themory-category-filter-server-side T1.1: operator-supplied category tag
   * projected from the top-level `category` column. NULL on pre-2026-06-09 rows
   * AND on rows written without `RememberOptions.category` (per ADR D1 no
   * implicit default — honest NULL).
   *
   * **Dual-pathway projection (EC-12)**: this field is ALSO projected into
   * `metadata.category` by the pgvector adapter (SELECT-side `payload['category']
   * = row.category`). Mirrors the v1.1 `attributedTo` precedent — redundancy is
   * intentional architectural symmetry, so consumers reading via either pathway
   * (top-level OR JSONB) continue to work.
   *
   */
  readonly category?: string;
}

/**
 * Recall result extension. Returned by `recall()` calls.
 * `score` is the additive composite: `(semantic + bm25 + entity_boost) / max_possible` in [0, 1].
 *
 * @see ADR-0001 — additive scoring formula.
 */
export interface MemoryItemWithScore extends MemoryItem {
  /** Additive composite score in [0, 1]. Higher = better match. */
  readonly score: number;
  /** The raw messages that produced this memory, when `RecallOptions.includeSources` is set (ADR-0027). */
  readonly sources?: readonly LoggedMessage[];
}
