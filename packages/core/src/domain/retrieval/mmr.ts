/**
 * principles-alignment-hardening T4.2 / ADR D3 — Maximal Marginal Relevance
 * rerank, opt-in via `RecallOptions.diversify`. Closes Princípio 2 gap
 * (CLAUDE.md § IMPORTANTE): "Recuperar X memórias certas vale mais do que
 * recuperar 50 parecidas".
 *
 * MMR (Carbonell & Goldstein 1998) greedily selects candidates that maximize:
 *
 *   score(c) = lambda * relevance(c) - (1 - lambda) * max(similarity(c, selected))
 *
 * `lambda=1` collapses to relevance-only (no diversity); `lambda=0` collapses
 * to diversity-only (no relevance). `lambda=0.7` is the literature default
 * for diverse-but-relevant in IR (Information Retrieval).
 *
 * EC-3 absorption (boundary validation): throws `InvalidScope` when
 * `lambda ∉ [0, 1]` per architecture.md § 8.
 *
 * Module hygiene: targets ≤ 100 LoC (no external library, pure cosine over
 * candidates' embedding field).
 *
 * @see CLAUDE.md § IMPORTANTE Princípio 2
 */
import { InvalidScope } from '../errors.js';

import { cosineSimilarity as cosine } from './cosine.js';

export interface MmrCandidate {
  readonly id: string;
  readonly score: number;
  readonly embedding: readonly number[];
}

/**
 * Greedy MMR selection over the candidate pool.
 *
 * @param candidates - candidates already scored by the retrieval pipeline
 *                     (semantic + BM25 + entity boost combined). Must include
 *                     `embedding` for diversity computation.
 * @param lambda - relevance vs diversity weight, ∈ [0, 1].
 * @param topPool - candidate pool size before MMR (limits work; typically topK * 3).
 * @param k - final selection size; returned array has at most `k` entries.
 * @returns selected candidates in MMR-greedy order (most-relevant-diverse first).
 * @throws InvalidScope when `lambda` is outside [0, 1] (EC-3 boundary).
 */
export function mmrRerank<C extends MmrCandidate>(
  candidates: readonly C[],
  lambda: number,
  topPool: number,
  k: number,
): readonly C[] {
  // EC-3 boundary validation per architecture.md § 8.
  if (!Number.isFinite(lambda) || lambda < 0 || lambda > 1) {
    throw new InvalidScope(
      `mmrRerank: lambda must be a finite number in [0, 1]; got ${String(lambda)}`,
    );
  }
  if (candidates.length === 0) {
    return [];
  }
  // Bound the candidate pool. topPool < 1 collapses to empty per the spec.
  const pool = candidates.slice(0, Math.max(0, topPool));
  if (pool.length === 0 || k <= 0) {
    return [];
  }
  const selected: C[] = [];
  const remaining = pool.slice();
  // Greedy selection: pick the candidate with the highest MMR score from
  // remaining, append to selected, repeat until k items or remaining empty.
  while (selected.length < k && remaining.length > 0) {
    let bestIdx = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < remaining.length; i += 1) {
      const candidate = remaining[i] as C;
      const maxSim = selected.length === 0
        ? 0
        : Math.max(...selected.map((s) => cosine(candidate.embedding, s.embedding)));
      const mmrScore = lambda * candidate.score - (1 - lambda) * maxSim;
      if (mmrScore > bestScore) {
        bestScore = mmrScore;
        bestIdx = i;
      }
    }
    selected.push(remaining[bestIdx] as C);
    remaining.splice(bestIdx, 1);
  }
  return selected;
}
