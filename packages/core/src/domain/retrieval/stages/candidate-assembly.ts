/**
 * Steps 6-7 — assemble the per-candidate score map + the normalization denominator (M19 / #124;
 * extracted from pipeline.ts).
 *
 * Unions the semantic and BM25 result sets into one `Candidate` map (semantic wins the payload on
 * overlap, BM25-only rows fill in), attaches the pre-computed entity boost, and returns the map
 * plus `maxScore = maxPossible(activeSignals)`.
 *
 * A BM25-only row carries the cosine similarity the store computed against the query vector
 * (`VectorStoreResult.similarity`), so the semantic gate judges it on its real similarity. An
 * adapter that does not report it leaves the row at 0, which the gate drops (the old behavior).
 */
import type { VectorStoreResult } from '../../dip/vector-store.js';
import { maxPossible } from '../../scoring.js';

import type { Candidate, Payload } from './threshold-filter.js';

/** One vector-store row → a Candidate with the given semantic score (DRY — both loops use it). */
function toCandidate(
  r: VectorStoreResult,
  semantic: number,
  bm25NormalizedById: ReadonlyMap<string, number>,
  entityBoostById: ReadonlyMap<string, number>,
): Candidate {
  return {
    semantic,
    bm25: bm25NormalizedById.get(r.id) ?? 0,
    entity: entityBoostById.get(r.id) ?? 0,
    payload: { ...(r.payload as Payload) },
  };
}

export function assembleCandidates(
  semanticResults: readonly VectorStoreResult[],
  bm25Results: readonly VectorStoreResult[] | null,
  bm25NormalizedById: ReadonlyMap<string, number>,
  entityBoostById: ReadonlyMap<string, number>,
): { candidates: Map<string, Candidate>; maxScore: number } {
  const candidates = new Map<string, Candidate>();
  for (const r of semanticResults) {
    candidates.set(r.id, toCandidate(r, r.score ?? 0, bm25NormalizedById, entityBoostById));
  }
  if (bm25Results !== null) {
    for (const r of bm25Results) {
      if (!candidates.has(r.id)) {
        candidates.set(r.id, toCandidate(r, r.similarity ?? 0, bm25NormalizedById, entityBoostById));
      }
    }
  }
  const signals = {
    semantic: true,
    bm25: bm25Results !== null && bm25Results.length > 0,
    entity: entityBoostById.size > 0,
  };
  return { candidates, maxScore: maxPossible(signals) };
}
