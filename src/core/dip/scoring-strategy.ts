/**
 * ScoringStrategy DIP — strategy for combining recency + relevance + importance
 * dimensions into a normalized score in [0, 1].
 *
 * 6th DIP per plan v0-4a-reflection-pipeline ADR D2. INDEPENDENT of ADR-0008's
 * locked 5 DIPs (embedder / llm / vector-store / history-manager / reflection-policy)
 * — adding this NEW DIP does not change the locked method counts of the original five.
 *
 * v0.4a ships ONE implementation: AdditiveWeightedScoring (per plan ADR D3 —
 * REJECTS multiplicative Generative Agents per blueprint Q7 finding that the
 * reference impl `retrieve.py:254-257` uses ADDITIVE weighted sum with
 * `gw = [0.5, 3, 2]`).
 *
 * Method count: 1 required (`score`). Pure type declaration; zero runtime deps.
 *
 * @see .claude/knowledge-base/plans/v0-4a-reflection-pipeline-plan.md § ADR D2
 * @see .claude/knowledge-base/discoveries/blueprints/v0-4a-reflection-pipeline-blueprint.md § D9
 */

/**
 * Raw per-memory score components in [0, 1] before strategy-specific weighting.
 *
 * Strategy implementations may apply min-max normalization across a batch
 * BEFORE the weighted sum (per blueprint D9 reference impl).
 */
export interface ScoreInput {
  /** Time-decay component: higher = more recent. */
  readonly recency: number;
  /** Semantic similarity component: higher = more relevant to query. */
  readonly relevance: number;
  /** LLM-judged importance component (cached at write per ADR D8). */
  readonly importance: number;
}

/**
 * Per-dimension weights for the additive weighted sum.
 *
 * Default v0.4a preset is `{1, 1, 1}` (uniform). Generative Agents reference
 * impl uses `{0.5, 3, 2}` (per blueprint Q7 + D9 verbatim from `retrieve.py`).
 */
export interface ScoringWeights {
  readonly recency: number;
  readonly relevance: number;
  readonly importance: number;
}

/**
 * Scores a batch of memories. Returns array same length as input, values in [0, 1].
 *
 * Batch shape (not single-item) enables strategy-specific cross-batch
 * normalization (e.g., min-max in AdditiveWeightedScoring per plan T1.2 EC-8).
 *
 * Implementations MUST:
 *  - Return same length as input
 *  - Return values in [0, 1]
 *  - Handle empty batch by returning empty array
 *  - Handle min === max gracefully (no NaN; see AdditiveWeightedScoring T1.2 EC-8 docs)
 */
export interface ScoringStrategy {
  score(items: readonly ScoreInput[]): readonly number[];
}
