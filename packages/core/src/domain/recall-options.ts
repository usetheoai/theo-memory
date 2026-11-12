/**
 * `RecallOptions` — the option-bag for `recall()`.
 *
 * Split out of `options.ts` (module-size budget): the recall surface accreted the
 * most opt-in knobs (asOf / attribution / diversify / scopes / rerank / adaptive /
 * graphExpand / recencyCollapse), so it owns its own file. Re-exported from
 * `options.ts` for import stability (consumers still `import type { RecallOptions }
 * from './options.js'`).
 *
 * @see ADR-0004 — API verbs.
 * @see ADR-0006 — bi-temporal columns (asOf).
 */

export interface RecallOptions {
  /**
   * ADR-0027 — return, with each memory, the raw messages that produced it
   * (`MemoryItemWithScore.sources`, oldest first). Default `false`. A memory with no logged
   * source (written before the log existed, with the log disabled, or whose source was erased
   * by a hard forget of another memory) gets an empty list.
   */
  readonly includeSources?: boolean;

  /** Default `20` (upstream-pipeline parity). Upper bound on number of memories returned. */
  readonly topK?: number;

  /** Default `0.1` (upstream-pipeline parity). Semantic-similarity gate applied BEFORE BM25 + entity-boost composition. */
  readonly threshold?: number;

  /**
   * explainable-recall S2 — opt-in caller-supplied recall id used to KEY the
   * accountable-forgetting trace (the `recall_traces.recall_id` of every dropped
   * candidate). When set (non-empty), the trace uses it verbatim instead of
   * minting one; the REST `POST /v1/recall` handler supplies it so it can be
   * returned in the response envelope and looked up via `GET /v1/recall-traces/:recallId`.
   * Absent/empty ⇒ a fresh UUID is minted. INPUT ONLY — the `recall()` return
   * shape is unchanged (S1 D1 bare-array invariant). No effect when tracing is off.
   */
  readonly recallId?: string;

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
   */
  readonly attributedTo?: string;

  /**
   * v0.6: when `true`, restrict recall to `kind='skill'` rows. Default `false`.
   * Translated by the runtime into `Filters.kind = 'skill'` before reaching the store.
   *
   */
  readonly onlySkills?: boolean;

  /**
   * v0.6: when `false` (default), exclude rows whose `superseded_by IS NOT NULL`.
   * When `true`, include the full supersession history. Translated by the runtime
   * into `Filters.excludeSuperseded = !includeSuperseded` before reaching the store.
   *
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
   * @see CLAUDE.md § IMPORTANTE Princípio 2
   * @throws InvalidScope — when `diversify.lambda` is outside [0, 1].
   */
  readonly diversify?: {
    readonly lambda: number;
    readonly topPool?: number;
  };

  /**
   * M10 (scope-aware recall) — Princípio 1 (relevance is a continuous score over orthogonal
   * signals). When set, retrieval applies a DETERMINISTIC scope-aware reweight AFTER score
   * combine + threshold + BEFORE topK: a SESSION-origin row (`session_id` set) is boosted by
   * RECENCY (newer `created_at` → higher) and a GLOBAL-origin row (`session_id` NULL) by
   * STABILITY (higher `confirmation_count` → higher) — so a durable global fact is not buried
   * under fresh session noise, and the current conversation surfaces. Operates on the M8
   * `session ∪ global` union pool, always inside `(workspace, user)` (isolation is enforced
   * upstream by `composeFilters`, never by this reweight).
   *
   * Default (undefined) is byte-identical to today — no reweight (opt-in per ADR D1).
   * MUTUALLY EXCLUSIVE with `rerank` (the cross-encoder) and `diversify` — all three occupy the
   * same post-threshold seam; setting more than one throws `RerankerConflict`. The weights are
   * bounded multipliers on the base score (they nudge, never invert a large base-score gap).
   *
   * - `sessionRecencyWeight` ∈ [0, 1]: session recency-boost strength (default 0.3).
   * - `globalStabilityWeight` ∈ [0, 1]: global stability-boost strength (default 0.3).
   *
   * @see CLAUDE.md § IMPORTANTE Princípio 1
   * @throws RerankerConflict — when combined with `rerank` or `diversify`.
   * @throws InvalidScope — when a weight is outside [0, 1].
   */
  readonly scopes?: {
    readonly sessionRecencyWeight?: number;
    readonly globalStabilityWeight?: number;
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
   * @see CLAUDE.md § IMPORTANTE Princípio 2 + Princípio 3
   */
  readonly graphExpand?: {
    readonly hops?: 1 | 2;
    readonly limit?: number;
  };

  /**
   * M22 / #141 — Princípio 1 (most-recent-wins). When set, retrieval applies a
   * recall-time most-recent-wins COLLAPSE over near-duplicate candidates AFTER
   * the score combine + threshold and BEFORE topK: among candidates whose
   * embeddings are near-identical (cosine ≥ `threshold`), only the one with the
   * newest `createdAt` is kept; the older duplicates are dropped (surfaced as
   * `superseded_recency` recall-trace drops — Princípio 3 auditability).
   *
   * This is the read-time mitigation for the ADD-only stale-duplicate gap
   * (ADR-0003): two live `remember`s of the same fact would otherwise be ordered
   * by relevance only, so a stale value can out-rank / crowd out its fresh update.
   * It does NOT touch the score formula (`scoring.ts`) — it only prunes a
   * near-duplicate cluster, so non-update queries are byte-unchanged.
   *
   *   - `threshold`: cosine cutoff for "near-duplicate" ∈ [0, 1]. Defaults to a
   *     conservative 0.9 (true paraphrases only). Both rows persist (ADD-only);
   *     the dropped older row remains `asOf`-recoverable.
   *
   * DEFAULT OFF: omit ⇒ recall is byte-identical to today (opt-in per ADR D1).
   *
   * MUTUALLY EXCLUSIVE with `rerank` / `diversify` / `scopes` — all four re-order
   * the SAME post-threshold pool; setting more than one throws `RerankerConflict`.
   * It COMPOSES (by pipeline order, no conflict) with `graphExpand` and `adaptive`,
   * which change the pool's MEMBERSHIP (add / re-filter candidates) rather than its
   * ordering — the collapse then prunes near-duplicates from whatever pool results.
   * Setting `recencyCollapse` also BYPASSES the recall cache (ADR D3) — it
   * re-orders the pool, so a cached plain result would poison a collapse request.
   *
   * CAVEAT (read-time only, honest disclosure): this does NOT supersede the stale
   * row on the WRITE side — durable supersession still needs reflect. It is a
   * recall-time ordering mitigation, not a write-time reconciliation.
   *
   * @see CLAUDE.md § IMPORTANTE Princípio 1 + Princípio 3
   * @see ADR-0003 — ADD-only (both rows persist).
   * @throws RerankerConflict — when combined with `rerank` / `diversify` / `scopes`.
   */
  readonly recencyCollapse?: {
    readonly threshold?: number;
  };
}
