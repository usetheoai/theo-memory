/**
 * Option-bag types for the four public verbs + parity helpers.
 *
 * @see ADR-0004 — API verbs (remember / recall / forget / reflect + parity helpers).
 * @see ADR-0006 — bi-temporal columns (asOf is uniform at the type level; runtime divergence per local v0.1).
 */
import type { ConflictResolutionPolicy } from './dip/conflict-resolution-policy.js';
import type { MemoryEvidence } from './memory-evidence.js';
import type { Filters } from './scope.js';

export interface RememberOptions {
  /** Stable caller request key. Replays do not add assertions or extend validity.
   * Requires a write-receipt-capable store (PgvectorStore); unsupported stores fail before I/O. */
  readonly idempotencyKey?: string;
  /** Explicit deadline. Omission preserves indefinite validity. */
  readonly expiresAt?: Date;

  /** Source context. With infer:false this is caller-declared evidence; with extraction,
   * kind/quote/confidence come from each extracted fact. Never an authority marker.
   * @see docs/memory-semantics.md
   */
  readonly evidence?: MemoryEvidence;

  /** Report malformed extraction, missing embeddings, or incomplete persistence as errors.
   * Default false preserves the existing best-effort behavior. Partial writes may exist
   * when persistence fails; this option does not make a batch transactional.
   * @see docs/memory-semantics.md
   */
  readonly strictExtraction?: boolean;

  /** Flat key-value payload attached to the resulting memory items. @see MemoryItem.metadata for the same shape constraints. */
  readonly metadata?: Readonly<Record<string, string | number | boolean | null>>;

  /**
   * Default `true`. When `false`, persist text verbatim without invoking the LLM extraction pipeline.
   * Useful for migration / batch import scenarios where the caller has already extracted facts.
   *
   * @see ADR-0001 — `infer: false` escape hatch.
   */
  readonly infer?: boolean;

  /**
   * v1.1 T1.1 (EC-2 absorbed): multi-peer attribution. The perspective owner of
   * the fact — typically a peer ID (user id, agent id, or `'system'`). N-valent
   * semantic per blueprint Q5 (any string accepted). Hoisted to the
   * `attributed_to` column at persist time.
   *
   * AUTHORITY (both write paths agree — `infer:false` and `infer:true`): when
   * `attributedTo` is SET, it is AUTHORITATIVE — it wins over the LLM's per-fact
   * `extracted[i].attributed_to` guess for EVERY extracted fact. This is the
   * "declared single-author turn" mode (e.g. the Claude Code Stop hook declares
   * the whole turn is the assistant's), so an assistant summary never masquerades
   * as a user fact.
   *
   * The two modes are MUTUALLY EXCLUSIVE:
   *   - Declared-origin turn  → SET `attributedTo`; every fact gets that owner.
   *   - Multi-peer ingestion  → OMIT `attributedTo`; the LLM assigns per-fact
   *     `attributed_to` (Alice→alice, Bob→bob). Passing `attributedTo` here would
   *     flatten all facts to one peer — by design; omit it for per-fact.
   *
   * ADR-0008 method-count cap preserved (zero new methods; one new optional param).
   *
   */
  readonly attributedTo?: string;

  /**
   * themory-category-filter-server-side T1.1: operator-supplied category tag
   * for downstream server-side filtering via `GET /v1/scopes/.../memories?category=X`.
   *
   * **Length contract**: MUST be 1-64 chars when supplied (ADR D3). The pipeline
   * boundary at `runExtractionPipeline` entry throws `InvalidScope` when the
   * value is empty OR > 64 chars (EC-2 absorption — defense-in-depth alongside
   * REST zod validation). Mirrors the v1.1 `asOf` NaN check precedent.
   *
   * **Immutability contract (ADR D6 / EC-1)**: once persisted, category is
   * IMMUTABLE via remember(). The `ON CONFLICT DO UPDATE` clause does NOT
   * overwrite the column — `confirmation_count` bumps, but the first-write
   * category wins. Operators wanting to change category use `forget(id) +
   * remember(newText, { category: 'B' })` — the canonical ADR-0003 ADD-only
   * mutation path.
   *
   * **Inference contract (auto-categorization-write-pipeline ADR D1, supersedes the
   * category-filter operator-only decision)**: when supplied, an operator category is
   * an OVERRIDE that always wins. When omitted AND auto-categorization is enabled (the
   * default), the write pipeline auto-derives a category from the extraction LLM call.
   * A caller category is written verbatim (and stays 1-64 chars per the length contract);
   * an auto-derived label is trimmed + bounded fail-soft (out-of-range → left unset,
   * never throws).
   *
   * **NULL findability (EC-9)**: pre-2026-06-09 rows have `category=NULL`
   * permanently. There is NO syntax to filter for NULL rows via the public
   * `?category=` REST query (zod min(1) rejects empty; literal "null"
   * filters for the string "null"). Uncategorized memories are returned only
   * by the no-filter call.
   *
   * ADR-0008 method-count cap preserved (zero new methods; one new optional param).
   *
   * **XSS storage contract (RED TEAM F4)**: stored verbatim — NO input sanitization.
   * Consumers rendering category in HTML MUST escape per OWASP output-encoding.
   * React auto-escapes; raw HTML renderers need DOMPurify or equivalent.
   *
   */
  readonly category?: string;
}

export type { RecallOptions } from './recall-options.js';

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

  /**
   * v0.7 episodic→semantic distillation per ADR D2. When supplied, the
   * post-derivation phase passes the recall'd memories as a single cluster
   * to `policy.consolidate(candidates, ctx)` and atomically soft-deletes
   * the rejected rows + writes one `consolidation_history` audit row per
   * returned result (EC-8). When omitted, behavior is byte-identical to
   * v0.4a (no consolidation; `NoopConflictPolicy` would also short-circuit
   * to the same result).
   *
   */
  readonly conflictResolution?: ConflictResolutionPolicy;
}

export interface GetAllOptions {
  /** Default `100`. Upper bound on listed memories. */
  readonly topK?: number;

  /**
   * Entity filter (theo-cloud#252): when set, only memories LINKED to this
   * entity (surface name, normalized server-side via `normalizeEntityKey`)
   * through `memory_entities` are returned — the server-side filter the
   * dashboard's per-entity cascade-forget requires. Stores without entity
   * links (in-memory) honestly return an empty page.
   */
  readonly entity?: string;

  /**
   * SQL-level page offset under the deterministic `created_at DESC, id ASC`
   * order (dashboard pager 2026-07-22). Default `0`.
   */
  readonly offset?: number;

  /** Raw filter access for advanced consumers (admin paths, debugging). Most consumers use ScopedMemory.getAll which derives Filters from the scope. */
  readonly filters?: Filters;

  /**
   * v0.6 (EC-3 absorption): mirrors `RecallOptions.onlySkills` so T3.1's
   * `consolidate()` Orient phase can call `scope.getAll({onlySkills: true,
   * includeSuperseded: false})` with consistent semantics.
   */
  readonly onlySkills?: boolean;

  /**
   * v0.6 (EC-3 absorption): mirrors `RecallOptions.includeSuperseded`.
   */
  readonly includeSuperseded?: boolean;

  /**
   * themory-category-filter-server-side T1.1: server-side filter — return ONLY
   * rows whose `category` column EXACTLY equals this value.
   *
   * **Byte-equality contract (EC-4 + EC-5)**: case-sensitive; NO Unicode
   * normalization (NFC vs NFD treated as distinct strings). Deliberate per
   * ADR D1 — operator-supplied vocabulary is preserved verbatim.
   *
   * **NULL semantic (ADR D5)**: rows where `category IS NULL` do NOT match
   * any filter value (SQL three-valued logic). Empty string normalizes to
   * undefined (no-filter) at the store boundary per EC-3 — `LocalScopedMemory.getAll`
   * and adapter `composeFilters` both treat `''` as `undefined` to keep
   * in-memory + pgvector + REST adapter semantics aligned.
   *
   * **NULL findability (EC-9)**: pre-2026-06-09 legacy rows are NOT findable
   * via this filter. The no-filter call (omit the option entirely) is the only
   * way to see uncategorized memories alongside categorized ones.
   *
   */
  readonly category?: string;
}
