/**
 * AdaptiveRetrievalPolicy DIP — adaptive-retrieval decision hooks (Roadmap Item 13).
 *
 * Two cohesive decision hooks that adapt the recall pipeline, wired OPT-IN,
 * default OFF:
 *
 *   - `shouldRetrieve` — the PRE-embed retrieval-decision gate. When it
 *     returns `{ retrieve: false }`, `recall()` returns `[]` WITHOUT embedding
 *     the query (skips the embed + DB cost) and emits `retrieval_skipped`.
 *   - `assess` — the POST-threshold grade-and-correct hook. It inspects
 *     the threshold-passing pool's top score; when weak it recommends a bounded
 *     in-memory corrective (re-filter the already-fetched pool at a relaxed
 *     threshold — NO re-embed, NO external fallback) via `action: 'relax'`.
 *
 * **2 methods** (within the ADR-0008 method-count cap). The policy DECIDES
 * (pure); the pipeline ACTS on the decision (SRP separation) — the policy never
 * performs I/O itself.
 *
 * **Contract:**
 *   - MUST NOT mutate the input `results` array or its items.
 *   - MAY throw; the pipeline wraps both hooks and degrades to the NORMAL
 *     (non-adaptive) retrieval path per plan ADR D4 (fail-soft — a policy
 *     outage MUST NEVER take down recall).
 *   - `assess` returning `action: 'relax'` with a `relaxedThreshold` that is
 *     NOT in `[0, originalThreshold)` is treated by the pipeline as `accept`
 *     (EC-1 — no no-op widening, no out-of-range surfacing).
 *
 * **DIP boundary discipline** (architecture.md § 3): this module lives in
 * `src/core/domain/dip` — ZERO I/O, ZERO imports from `src/infrastructure`.
 * The default impl ships at `src/infrastructure/adaptive/heuristic-policy.ts`
 * behind the `@usetheo/memory/adaptive-local` subpath (bundle isolation, ADR D5).
 *
 * @see .claude/knowledge-base/plans/adaptive-retrieval-plan.md § ADR D1 + D2 + D3 + D4
 * @see .claude/knowledge-base/discoveries/blueprints/adaptive-retrieval-blueprint.md
 * @see ADR-0008 (DIP method-count cap)
 */
import type { MemoryItemWithScore } from '../memory-item.js';
import type { Scope } from '../scope.js';

/**
 * Per-call tuning forwarded from `RecallOptions.adaptive` into the `assess`
 * hook (so a wired policy can honor per-call overrides without a per-call
 * re-construction). The shape is identical to `RecallOptions.adaptive`.
 */
export interface AdaptiveTuning {
  /** Override the policy's top-score floor below which a relax is recommended. */
  readonly correctiveFloor?: number;
  /** Override the lower threshold the corrective re-filters the pool at. */
  readonly relaxedThreshold?: number;
}

/** Result of the pre-embed `shouldRetrieve` gate. */
export interface RetrievalDecision {
  /** When `false`, recall returns `[]` without embedding + emits `retrieval_skipped`. */
  readonly retrieve: boolean;
  /** Optional human-readable rationale, surfaced on the `retrieval_skipped` event. */
  readonly reason?: string;
}

/** Result of the post-threshold `assess` grade-and-correct hook. */
export interface RetrievalAssessment {
  /** Whether the retrieved pool is judged sufficient as-is. */
  readonly sufficient: boolean;
  /**
   * The recommended action:
   *   - `accept` — keep the results unchanged.
   *   - `relax`  — re-filter the already-fetched pool at `relaxedThreshold`
   *     (bounded in-memory corrective; emits `retrieval_corrected`).
   *   - `reject` — the results are unusable; emit `retrieval_low_confidence`.
   */
  readonly action: 'accept' | 'relax' | 'reject';
  /**
   * For `action: 'relax'` — the lower threshold to re-filter the pool at. The
   * pipeline applies it ONLY when `0 <= relaxedThreshold < originalThreshold`
   * (EC-1); otherwise the relax is treated as `accept`.
   */
  readonly relaxedThreshold?: number;
  /** Optional rationale, surfaced on the emitted event. */
  readonly reason?: string;
}

export interface AdaptiveRetrievalPolicy {
  /**
   * Pre-embed retrieval-decision gate. Decide whether retrieval should run at all for
   * this query/scope. Returning `{ retrieve: false }` skips the embed + DB hit.
   *
   * @param query - the recall query text.
   * @param scope - the resolved scope (user/session/agent/repo) of the recall.
   */
  shouldRetrieve(query: string, scope: Scope): Promise<RetrievalDecision>;

  /**
   * Post-threshold grade-and-correct. Inspect the threshold-passing results and decide
   * whether they are sufficient or a bounded corrective is warranted. MUST NOT
   * mutate `results`.
   *
   * @param query - the recall query text.
   * @param results - the threshold-passing, score-sorted results.
   * @param tuning - optional per-call overrides forwarded from `RecallOptions.adaptive`.
   */
  assess(
    query: string,
    results: readonly MemoryItemWithScore[],
    tuning?: AdaptiveTuning,
  ): Promise<RetrievalAssessment>;
}
