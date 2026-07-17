/**
 * Pure-core scoring primitives for the v0.1 9-step retrieval pipeline.
 *
 * Ported verbatim from the upstream additive composition documented in
 * blueprint D2 — see knowledge-base coordinate below for the prior-art reference.
 *
 * Formula: `combined = min((semantic + bm25 + entity_boost) / max_possible, 1.0)`.
 * Threshold gate happens in Phase 5 (retrieval/pipeline.ts) BEFORE combining —
 * `combineScores` is dumb arithmetic.
 *
 * EC-1: combineScores guards `maxPossible === 0` to avoid divide-by-zero NaN.
 * EC-8: NaN propagates predictably; Phase 5 threshold gate drops NaN-scored results.
 *
 */

/** ENTITY_BOOST_WEIGHT — upstream additive constant. Hardcoded; surfaceable via config at v1.x only if measurement demands tuning. */
export const ENTITY_BOOST_WEIGHT = 0.5;

/** Sigmoid params tuned by query length (scoring.ts:23-42). Short queries (≤3 tokens) center on raw=4; longer center on raw=8. */
function sigmoidParams(queryLength: number): { steepness: number; midpoint: number } {
  if (queryLength <= 3) {
    return { steepness: 0.5, midpoint: 4 };
  }
  return { steepness: 0.3, midpoint: 8 };
}

/**
 * Maps a raw BM25 score into (0, 1) via a logistic curve adapted to query length.
 * Short queries saturate faster (lower midpoint) than long queries — short-tail
 * keyword matches in a 2-word query carry more signal than the same in an 8-word query.
 */
export function sigmoidBm25(raw: number, queryLength: number): number {
  const { steepness, midpoint } = sigmoidParams(queryLength);
  return 1 / (1 + Math.exp(-steepness * (raw - midpoint)));
}

/**
 * Spread-attenuated entity boost — prevents a single memory with many entity
 * matches from dominating the ranking. Formula:
 *   `numLinked = 0  →  0`
 *   `numLinked = 1  →  ENTITY_BOOST_WEIGHT (peak; no attenuation)`
 *   `numLinked > 1  →  ENTITY_BOOST_WEIGHT * 1 / (1 + 0.001 * (numLinked - 1)^2)`
 * Citation: scoring.ts:50-72.
 */
export function entityBoost(numLinked: number): number {
  if (numLinked <= 0) {
    return 0;
  }
  const spread = 1 / (1 + 0.001 * Math.pow(numLinked - 1, 2));
  return ENTITY_BOOST_WEIGHT * spread;
}

/** Which signals are active in this query. */
export interface ActiveSignals {
  readonly semantic: boolean;
  readonly bm25: boolean;
  readonly entity: boolean;
}

/**
 * Maximum possible combined score given which signals are active.
 * Returns one of {0, 1.0, 1.5, 2.0, 2.5} per scoring.ts:108-130.
 * Semantic contributes up to 1.0; BM25 contributes up to 1.0; entity contributes up to ENTITY_BOOST_WEIGHT.
 */
export function maxPossible(signals: ActiveSignals): number {
  let total = 0;
  if (signals.semantic) {
    total += 1.0;
  }
  if (signals.bm25) {
    total += 1.0;
  }
  if (signals.entity) {
    total += ENTITY_BOOST_WEIGHT;
  }
  return total;
}

/** Per-candidate signal values entering the combiner. */
export interface CandidateScores {
  readonly semantic: number;
  readonly bm25: number;
  readonly entityBoostScore: number;
}

/**
 * Combine three signal scores via additive normalization. Caps at 1.0.
 * Caller MUST have applied the semantic threshold gate BEFORE calling — this
 * function is dumb arithmetic per the threshold-gates-semantic-BEFORE-combining
 * invariant (scoring.ts:117-120).
 *
 * EC-1 guard: `maxPossible === 0` returns 0 (no signals → no score).
 * EC-8: NaN inputs propagate to NaN output predictably.
 */
export function combineScores(scores: CandidateScores, maxPossibleValue: number): number {
  if (maxPossibleValue === 0) {
    return 0;
  }
  const sum = scores.semantic + scores.bm25 + scores.entityBoostScore;
  return Math.min(sum / maxPossibleValue, 1.0);
}
