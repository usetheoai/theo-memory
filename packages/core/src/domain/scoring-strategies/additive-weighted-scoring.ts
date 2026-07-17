/**
 * AdditiveWeightedScoring — the only ScoringStrategy implementation shipped at v0.4a.
 *
 * Per plan ADR D3: multiplicative Generative Agents formula is REJECTED. The
 * reference impl (`reverie/backend_server/persona/cognitive_modules/retrieve.py:254-257`,
 * confirmed in blueprint Q7) uses ADDITIVE weighted sum with `gw = [0.5, 3, 2]` —
 * the "multiplicative" framing in CLAUDE.md was a factual error.
 *
 * Algorithm (verbatim from blueprint D9):
 *   1. Min-max normalize each dimension across the batch (recency, relevance, importance)
 *   2. Compute weighted sum: score_i = w_r·R_i + w_r·R_i + w_i·I_i
 *   3. Normalize to [0, 1]: score_i / sum(weights)
 *
 * Edge cases:
 *   - EC-1: constructor with all-zero weights → InvalidScoringWeightsError (fail-fast)
 *   - EC-8: min === max for a dimension → normalized value defaults to 0.5 (neutral)
 *   - Empty batch → empty array
 *   - Pathological inputs > 1 → clamped to 1 in min-max output
 *
 */

import type {
  ScoreInput,
  ScoringStrategy,
  ScoringWeights,
} from '../dip/scoring-strategy.js';
import { InvalidScoringWeightsError } from '../errors.js';

/**
 * Default weights — uniform (recency = relevance = importance).
 */
const DEFAULT_WEIGHTS: ScoringWeights = Object.freeze({
  recency: 1,
  relevance: 1,
  importance: 1,
});

/**
 * Generative Agents preset — `gw = [0.5, 3, 2]` from reverie reference impl
 * `retrieve.py:252-253`. See blueprint Q7 + D9 for verbatim citation.
 */
export const GENERATIVE_AGENTS_WEIGHTS: ScoringWeights = Object.freeze({
  recency: 0.5,
  relevance: 3,
  importance: 2,
});

/**
 * Min-max normalize a single column. When min === max (zero variance), returns
 * 0.5 for all entries per EC-8 — keeps the score neutral instead of NaN.
 */
function minMaxNormalize(values: readonly number[]): number[] {
  if (values.length === 0) {
    return [];
  }
  let min = values[0] ?? 0;
  let max = values[0] ?? 0;
  for (let i = 1; i < values.length; i++) {
    const v = values[i] ?? 0;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  // EC-8: zero variance → neutral 0.5
  if (min === max) {
    return values.map(() => 0.5);
  }
  const range = max - min;
  return values.map((v) => (v - min) / range);
}

export class AdditiveWeightedScoring implements ScoringStrategy {
  private readonly weights: ScoringWeights;
  private readonly weightSum: number;

  constructor(weights: ScoringWeights = DEFAULT_WEIGHTS) {
    const sum = weights.recency + weights.relevance + weights.importance;
    if (sum <= 0) {
      throw new InvalidScoringWeightsError({
        recency: weights.recency,
        relevance: weights.relevance,
        importance: weights.importance,
      });
    }
    this.weights = { ...weights };
    this.weightSum = sum;
  }

  score(items: readonly ScoreInput[]): readonly number[] {
    if (items.length === 0) {
      return [];
    }
    // Clamp inputs to [0, 1] before normalization (defends against pathological values)
    const clampedRecency = items.map((i) => Math.max(0, Math.min(1, i.recency)));
    const clampedRelevance = items.map((i) => Math.max(0, Math.min(1, i.relevance)));
    const clampedImportance = items.map((i) => Math.max(0, Math.min(1, i.importance)));

    // Min-max normalize per dimension across the batch
    const normRecency = minMaxNormalize(clampedRecency);
    const normRelevance = minMaxNormalize(clampedRelevance);
    const normImportance = minMaxNormalize(clampedImportance);

    // Weighted sum + normalize to [0, 1]
    const { recency: wr, relevance: wRel, importance: wi } = this.weights;
    const result: number[] = [];
    for (let i = 0; i < items.length; i++) {
      const r = normRecency[i] ?? 0;
      const rel = normRelevance[i] ?? 0;
      const imp = normImportance[i] ?? 0;
      const weighted = wr * r + wRel * rel + wi * imp;
      result.push(weighted / this.weightSum);
    }
    return result;
  }
}
