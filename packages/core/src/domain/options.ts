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
   * @see .claude/knowledge-base/plans/skill-library-plan.md § T2.2
   */
  readonly onlySkills?: boolean;

  /**
   * v0.6: when `false` (default), exclude rows whose `superseded_by IS NOT NULL`.
   * When `true`, include the full supersession history. Translated by the runtime
   * into `Filters.excludeSuperseded = !includeSuperseded` before reaching the store.
   *
   * @see .claude/knowledge-base/plans/skill-library-plan.md § T2.2 + EC-3
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

  /**
   * cross-encoder-reranker (Roadmap Item 23) — Princípio 2 (priorização >
   * volume). When set, retrieval applies a cross-encoder rerank AFTER the
   * threshold filter and BEFORE topK truncation (the same Step 8.5 seam as
   * `diversify`, but optimizing relevance instead of diversity):
   *
   *   selected = reranker.rerank(query, candidates[:pool], topK)
   *
   * Requires a `Reranker` wired via `LocalMemoryConfig.reranker`. Default (when
   * undefined) is byte-identical — no rerank, no behavior change for existing
   * callers (opt-in per ADR D5).
   *
   * - `topK`: results to keep after rerank. Defaults to the recall `topK`.
   * - `pool`: candidate pool size fed to the reranker before truncation.
   *   Defaults to `topK * 4` (bounds cross-encoder cost — ADR D3).
   *
   * MUTUALLY EXCLUSIVE with `diversify`: setting both throws `RerankerConflict`
   * before any inference (ADR D3). When `rerank` is set but no reranker is wired
   * in config, the rerank is a no-op (results pass through cosine-sorted).
   * On inference failure the pipeline degrades to cosine order (fail-soft, ADR D4).
   *
   * Note: setting `rerank` BYPASSES the semantic recall cache (ADR D6) — the
   * v1.5 cache key does not include rerank, so a reranked request always runs
   * the full pipeline.
   *
   * @see .claude/knowledge-base/plans/cross-encoder-reranker-plan.md § ADR D3 + D5 + D6
   * @see CLAUDE.md § IMPORTANTE Princípio 2
   * @throws RerankerConflict — when both `rerank` and `diversify` are set.
   */
  readonly rerank?: {
    readonly topK?: number;
    readonly pool?: number;
  };

  /**
   * adaptive-retrieval (Roadmap Item 13) — Princípio 2 (priorização > volume) +
   * adaptive-retrieval decision hooks. Tunes the adaptive policy wired via
   * `createLocalMemory({ retrievalPolicy })`:
   *
   *   - `correctiveFloor`: the top-score threshold below which the `assess`
   *     hook recommends a corrective relax (heuristic default impl).
   *   - `relaxedThreshold`: the lower threshold the corrective re-filters the
   *     already-fetched pool at. The pipeline applies it ONLY when
   *     `0 <= relaxedThreshold < threshold` (EC-1); otherwise it is a no-op accept.
   *
   * DEFAULT OFF: the adaptive path runs ONLY when a `retrievalPolicy` is wired
   * in config. Setting `adaptive` WITHOUT a wired policy is a no-op (EC-3) —
   * byte-identical to a plain `recall()`. No behavior change for existing callers
   * (opt-in per ADR D4).
   *
   * @see .claude/knowledge-base/plans/adaptive-retrieval-plan.md § ADR D2 + D3 + D4
   * @see CLAUDE.md § IMPORTANTE Princípio 2 + Princípio 3
   */
  readonly adaptive?: {
    readonly correctiveFloor?: number;
    readonly relaxedThreshold?: number;
  };

  /**
   * graph-aware-recall — Princípio 2 (priorização via the entity-graph structural
   * signal). When set AND a `graphExpansionStore` is wired via
   * `createLocalMemory({ graphExpansionStore })`, the pipeline POOL-EXPANDS the
   * results (Step 8.7) with memories CONNECTED to the top results by a shared
   * entity (1 hop) or relation edge (opt-in 2nd hop) over the EXISTING
   * `entities`/`memory_entities`/`entity_edges` tables — surfacing connected
   * memories that did not pass the similarity threshold on their own. The graph
   * hits are scored BELOW genuine semantic hits (never outrank a real match).
   *
   *   - `hops`: traversal depth (1 = shared-entity; 2 = + one relation hop). Default 1.
   *   - `limit`: max connected memories to pool-expand (fan-out guard). Default topK.
   *
   * DEFAULT OFF: omit (or wire no store) ⇒ recall is byte-identical to today.
   * Setting `graphExpand` WITHOUT a wired store is a no-op (EC-3). A wired+requested
   * graph-expand BYPASSES the recall cache (the cache key does not encode it).
   *
   * @see .claude/knowledge-base/plans/graph-aware-recall-plan.md § ADR D3 + D4 + D5
   * @see CLAUDE.md § IMPORTANTE Princípio 2 + Princípio 3
   */
  readonly graphExpand?: {
    readonly hops?: 1 | 2;
    readonly limit?: number;
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
