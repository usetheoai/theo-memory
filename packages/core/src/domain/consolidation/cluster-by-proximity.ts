/**
 * M24 T2.1 — bounded greedy disjoint nearest-neighbor clustering (#146).
 *
 * The scaling wall M23 proved: `LlmJudgedMergeConflictPolicy` ABSTAINS when a
 * cluster exceeds `clusterCap` (default 20), and the store handed it the WHOLE
 * live scope as one cluster — so on a real (>20-row) conversation the
 * contradiction pair never reached the judge. This function turns that flat
 * candidate list into disjoint clusters of ≤ `cap`, each a focused group of
 * mutually-near memories, so a MUTUALLY-NEAREST contradiction pair (the shape a
 * real same-fact update takes — a near-duplicate) lands in a cluster the judge
 * will actually inspect. Greedy anchor-by-id does NOT guarantee co-location for
 * an arbitrary pair split across a cap boundary; it holds for the near-duplicate
 * case this targets (validated end-to-end in docs/benchmarks/m24d-149-*.md).
 *
 * PURE domain logic per `architecture.md`: no store/LLM import, no `Date`, no
 * `Math.random`. Determinism is load-bearing — the M24 tests prove co-location
 * of a mutual-nearest pair and a stable tie-break, both of which require the
 * output to be a pure function of the input.
 *
 * Algorithm (greedy):
 *   1. Sort candidates by `memoryId` (deterministic anchor order).
 *   2. Take the first unclustered candidate as the anchor.
 *   3. Score every other unclustered candidate by cosine to the anchor;
 *      take the top `cap - 1` (ties broken by ascending `memoryId`).
 *   4. Emit {anchor, ...nearest} as a cluster (≤ cap); mark them clustered.
 *   5. Repeat until none remain.
 *   6. Drop singleton clusters — a lone candidate has nothing to consolidate
 *      with (mirrors the policy's `candidates.length < 2` guard).
 */
import { cosineSimilarity } from '../retrieval/cosine.js';

interface Clusterable {
  readonly memoryId: string;
  readonly embedding: readonly number[];
}

export function clusterByProximity<T extends Clusterable>(
  candidates: readonly T[],
  cap: number,
): readonly (readonly T[])[] {
  if (candidates.length === 0) {
    return [];
  }
  // Deterministic anchor order — a pure function of the input.
  const sorted = [...candidates].sort((a, b) => compareId(a.memoryId, b.memoryId));
  const clustered = new Set<string>();
  const clusters: (readonly T[])[] = [];

  for (const anchor of sorted) {
    if (clustered.has(anchor.memoryId)) {
      continue;
    }
    const others = sorted.filter(
      (c) => c.memoryId !== anchor.memoryId && !clustered.has(c.memoryId),
    );
    // Score by cosine to the anchor; ties resolve by ascending memoryId (stable,
    // no reliance on Array.sort insertion order).
    const scored = others
      .map((c) => ({ c, sim: cosineSimilarity(anchor.embedding, c.embedding) }))
      .sort((x, y) => y.sim - x.sim || compareId(x.c.memoryId, y.c.memoryId));

    const take = Math.max(0, cap - 1);
    const nearest = scored.slice(0, take).map((s) => s.c);
    const cluster: readonly T[] = [anchor, ...nearest];
    for (const m of cluster) {
      clustered.add(m.memoryId);
    }
    clusters.push(cluster);
  }

  // Singletons have nothing to consolidate → drop (mirrors the policy's <2 guard).
  return clusters.filter((cl) => cl.length >= 2);
}

/** Stable string comparison (ascending) — the deterministic tie-break key. */
function compareId(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
