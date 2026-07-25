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

/**
 * Saturation constant of the entity-boost curve `W·n/(n+c)` (#125). Internal tuning
 * parameter — NOT part of the public surface (KISS: only `entityBoost` reads it).
 * n=1 yields `W/(1+c)`; smaller c keeps the common single-match case nearer the
 * legacy 0.5 magnitude while the curve stays monotone-increasing and saturates at W.
 * c=0.25 → n=1 boost 0.40 (chosen for n=1 magnitude; validated non-regressing by the
 * M18 precision benchmark, docs/benchmarks/entity-boost-m18.md).
 */
const ENTITY_BOOST_SATURATION_C = 0.25;

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
 * Non-decreasing, saturating entity boost (#125). `numLinked` is the count of
 * DISTINCT query entities linked to a memory (the query<->memory intersection),
 * so MORE matched entities means at least as much boost — never less. Formula:
 *   `entityBoost(n) = ENTITY_BOOST_WEIGHT * n / (n + ENTITY_BOOST_SATURATION_C)`
 *   `n = 0  →  0` (exact; numerator is n)
 *   `n = 1  →  W / (1 + c)` (0.40 at c=0.25)
 *   `n → ∞  →  ENTITY_BOOST_WEIGHT` (saturation ceiling — no single memory dominates)
 * Monotone non-decreasing for any c > 0. Replaces the pre-M18 spread-attenuated
 * curve `W/(1 + 0.001*(n-1)^2)`, which was DECREASING and inverted the intent (#125).
 */
export function entityBoost(numLinked: number): number {
  if (numLinked <= 0) {
    return 0;
  }
  return (ENTITY_BOOST_WEIGHT * numLinked) / (numLinked + ENTITY_BOOST_SATURATION_C);
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
