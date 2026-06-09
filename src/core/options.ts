/**
 * Option-bag types for the four public verbs + parity helpers.
 *
 * @see ADR-0004 — API verbs (remember / recall / forget / reflect + parity helpers).
 * @see ADR-0006 — bi-temporal columns (asOf is uniform at the type level; runtime divergence per local v0.1).
 */
import type { ConflictResolutionPolicy } from './dip/conflict-resolution-policy.js';
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

  /**
   * v1.1 T1.1 (EC-2 absorbed): multi-peer attribution for verbatim-path callers.
   * The perspective owner of the fact — typically a peer ID (user id, agent id,
   * or `'system'` for self-statements). N-valent semantic per blueprint Q5
   * (any string accepted). Hoisted to the `attributed_to` column at persist
   * time. Read by T2.1 when `infer: false`; the LLM-extracted
   * `extracted[i].attributed_to` wins when `infer: true` (the default).
   *
   * ADR-0008 method-count cap preserved (zero new methods; one new optional param).
   *
   * @see .claude/knowledge-base/plans/v1-1-multi-peer-and-bi-temporal-plan.md § ADR D2
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
   * **Inference contract (ADR D1)**: category is OPERATOR-supplied; the LLM
   * extraction pipeline does NOT auto-derive a category from free-form text.
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
   * @see .claude/knowledge-base/plans/themory-category-filter-server-side-plan.md § T1.1 + ADR D1 + D3 + D6
   * @see .claude/knowledge-base/plans/red-team-full-system-fixes-cycle-1-plan.md § T3.1 (XSS contract)
   */
  readonly category?: string;
}

export interface RecallOptions {
  /** Default `20` (upstream-pipeline parity). Upper bound on number of memories returned. */
  readonly topK?: number;

  /** Default `0.1` (upstream-pipeline parity). Semantic-similarity gate applied BEFORE BM25 + entity-boost composition. */
  readonly threshold?: number;

  /**
   * Bi-temporal point-in-time query. When set, recall returns the memories
   * that were valid at the given instant via the null-safe predicate
   * `(t_valid IS NULL OR t_valid <= asOf) AND (t_invalid IS NULL OR t_invalid > asOf)`.
   *
   * Available on the local runtime since v1.1 per ADR-0011 (supersedes
   * ADR-0006 runtime clause). ADR-0006 schema clause (`t_valid`/`t_invalid`
   * columns since v0.1) is reinforced by the Apache-2.0 prior art referenced in ADR-0011.
   *
   * EC-11 absorbed (GDPR caveat): soft-deleted memories (`forget(id)`
   * without `{ hard: true }`) remain recoverable via historical `asOf`
   * queries. GDPR-strict erasure REQUIRES `forget(id, { hard: true })`
   * (per the v0.4b hard-delete option shipped 2026-05-31). Hard-deleted
   * rows are PHYSICALLY removed and cannot be resurrected by asOf.
   *
   * EC-3 absorbed (boundary validation): the local runtime throws
   * `InvalidScope('asOf must be a valid Date')` when `asOf.getTime()` is
   * NaN, per architecture.md § 8 (validate at boundaries).
   *
   * @see ADR-0006 — schema clause (t_valid/t_invalid columns).
   * @see ADR-0011 — runtime-clause lift; recall honors asOf from v1.1.
   * @throws InvalidScope — when asOf is an invalid Date (NaN .getTime()).
   */
  readonly asOf?: Date;

  /**
   * v1.1 T2.2: multi-peer attribution filter. When set, recall returns ONLY
   * memories where `attributed_to` matches the supplied peer ID exactly
   * (Postgres `=` semantics; NULL rows do NOT match per EC-7).
   *
   * N-valent semantic per blueprint Q5: accepts arbitrary string (user id,
   * agent id, "system", or any peer identifier). The pipeline boundary routes
   * this into `Filters.attributed_to` BEFORE reaching the vector store; the
   * store composes `AND attributed_to = $N` into the recall WHERE clause.
   *
   * ADR-0008 method-count cap preserved (zero new methods; one new optional param).
   *
   * @see .claude/knowledge-base/plans/v1-1-multi-peer-and-bi-temporal-plan.md § T2.2 + ADR D2
   */
  readonly attributedTo?: string;

  /**
   * v0.6: when `true`, restrict recall to `kind='skill'` rows. Default `false`.
   * Translated by the runtime into `Filters.kind = 'skill'` before reaching the store.
   *
   * @see .claude/knowledge-base/plans/voyager-skill-library-plan.md § T2.2
   */
  readonly onlySkills?: boolean;

  /**
   * v0.6: when `false` (default), exclude rows whose `superseded_by IS NOT NULL`.
   * When `true`, include the full supersession history. Translated by the runtime
   * into `Filters.excludeSuperseded = !includeSuperseded` before reaching the store.
   *
   * @see .claude/knowledge-base/plans/voyager-skill-library-plan.md § T2.2 + EC-3
   */
  readonly includeSuperseded?: boolean;

  /**
   * principles-alignment-hardening T4.2 / ADR D3 — Princípio 2 (CLAUDE.md § IMPORTANTE)
   * priorização > volume via MMR rerank. When set, retrieval applies Maximal
   * Marginal Relevance reranking AFTER score combine + BEFORE topK truncation:
   *
   *   selected = MMR(candidates, lambda, topPool ?? topK*3, topK)
   *
   * Default (when undefined) is byte-identical to v1.5 — no rerank, no behavior
   * change for existing callers (opt-in per ADR D3 Alternatives B rejection).
   *
   * - `lambda` ∈ [0, 1]: relevance vs diversity trade-off. lambda=1 ⇒ pure
   *   relevance order (no diversity); lambda=0 ⇒ pure diversity (no relevance);
   *   lambda=0.7 ⇒ literature default for diverse-but-relevant. Throws
   *   `InvalidScope` when lambda ∉ [0, 1] (EC-3 absorption per architecture.md § 8).
   * - `topPool`: candidate pool size before MMR selection. Defaults to `topK * 3`.
   *
   * @see .claude/knowledge-base/plans/principles-alignment-hardening-plan.md § T4.2 + § ADR D3
   * @see CLAUDE.md § IMPORTANTE Princípio 2
   * @throws InvalidScope — when `diversify.lambda` is outside [0, 1].
   */
  readonly diversify?: {
    readonly lambda: number;
    readonly topPool?: number;
  };
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

  /**
   * v0.7 episodic→semantic distillation per ADR D2. When supplied, the
   * post-derivation phase passes the recall'd memories as a single cluster
   * to `policy.consolidate(candidates, ctx)` and atomically soft-deletes
   * the rejected rows + writes one `consolidation_history` audit row per
   * returned result (EC-8). When omitted, behavior is byte-identical to
   * v0.4a (no consolidation; `NoopConflictPolicy` would also short-circuit
   * to the same result).
   *
   * @see .claude/knowledge-base/plans/v0-7-distillation-pipeline-plan.md § T2.1 + ADR D2
   */
  readonly conflictResolution?: ConflictResolutionPolicy;
}

export interface GetAllOptions {
  /** Default `100`. Upper bound on listed memories. */
  readonly topK?: number;

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
   * @see .claude/knowledge-base/plans/themory-category-filter-server-side-plan.md § T1.1 + ADR D5 + EC-3 + EC-9
   */
  readonly category?: string;
}
