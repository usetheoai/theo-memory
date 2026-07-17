/**
 * Reranker DIP — post-threshold relevance re-scoring port (Roadmap Item 23).
 *
 * A reranker re-scores `(query, document)` pairs jointly (a cross-encoder),
 * capturing relevance the bi-encoder cosine misses, then re-sorts the
 * candidates by that score and truncates to `topK`. It runs as an OPT-IN
 * post-threshold stage in the recall pipeline (sibling of the MMR diversify
 * stage), mutually exclusive with diversify per the plan ADR D3.
 *
 * **1 method** (within ADR-0008 method-count cap): `rerank`. Reranking is one
 * cohesive operation — no consumer needs a fat interface (ISP). Async because
 * model inference is inherently async in Node (diverges from the sync Python
 * reference shape — correct for this runtime).
 *
 * **Contract:**
 *   - MUST NOT mutate the input `candidates` array or its items.
 *   - Returns a new array, re-sorted by rerank relevance descending, truncated
 *     to `topK`. Empty input returns an empty array.
 *   - MAY throw on inference failure; the pipeline wraps the call and degrades
 *     to the original (cosine-sorted) order per plan ADR D4 (fail-soft —
 *     a reranker outage MUST NEVER take down recall).
 *
 * **DIP boundary discipline** (architecture.md § 3): this module lives in
 * `src/core/domain/dip` — ZERO I/O, ZERO imports from `src/infrastructure`.
 * The default impl ships at `src/infrastructure/rerankers/cross-encoder.ts`
 * behind the `@usetheo/memory/reranker-local` subpath (bundle isolation).
 *
 * @see ADR-0008 (DIP method-count cap)
 */
import type { MemoryItemWithScore } from '../memory-item.js';

export interface Reranker {
  /**
   * Re-score the `(query, candidate)` pairs, return a new array sorted by
   * rerank relevance descending and truncated to `topK`. MUST NOT mutate input.
   *
   * @param query - the recall query text.
   * @param candidates - the threshold-passing, cosine-sorted candidate pool.
   * @param topK - maximum number of results to return after reranking.
   */
  rerank(
    query: string,
    candidates: readonly MemoryItemWithScore[],
    topK: number,
  ): Promise<readonly MemoryItemWithScore[]>;
}
