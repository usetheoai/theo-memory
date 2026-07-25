/**
 * M24 T2.1 — `clusterByProximity` pure greedy disjoint nearest-neighbor clustering.
 *
 * Proves the core mechanism of the #146 fix WITHOUT a DB or LLM: a flat candidate
 * list becomes disjoint bounded clusters (≤ cap) so every contradiction pair
 * reaches the judge in a cluster the LlmJudgedMergeConflictPolicy will NOT abstain
 * on (size ≤ clusterCap). Deterministic — the co-location proof (test b) and the
 * tie-break proof (test c) both rely on there being no `Math.random`.
 */
import { describe, expect, test } from 'vitest';

import { clusterByProximity } from './cluster-by-proximity.js';

interface Cand {
  readonly memoryId: string;
  readonly embedding: readonly number[];
  readonly text?: string;
}

/** Unit vector of length `dim` with `1` at each given index. */
function unit(dim: number, ...ones: number[]): number[] {
  const v = new Array<number>(dim).fill(0);
  for (const i of ones) v[i] = 1;
  return v;
}

describe('clusterByProximity — bounded disjoint greedy clustering (M24 T2.1)', () => {
  test('test_clusters_are_bounded_by_cap: 25 candidates, cap 20 → all ≤ cap, disjoint, all covered', () => {
    const DIM = 40;
    const cands: Cand[] = [];
    // Group A (13): share dim 0, tiny distinct signal at dim 10+i → mutually similar.
    for (let i = 0; i < 13; i += 1) {
      const v = unit(DIM, 0);
      v[10 + i] = 0.01;
      cands.push({ memoryId: `m${String(i).padStart(2, '0')}`, embedding: v });
    }
    // Group B (12): share dim 1 (orthogonal to A), tiny distinct signal.
    for (let i = 0; i < 12; i += 1) {
      const v = unit(DIM, 1);
      v[25 + i] = 0.01;
      cands.push({ memoryId: `m${String(13 + i).padStart(2, '0')}`, embedding: v });
    }

    const clusters = clusterByProximity(cands, 20);

    // Every cluster is within the cap and is a real pair-or-more (no singletons).
    for (const cl of clusters) {
      expect(cl.length).toBeLessThanOrEqual(20);
      expect(cl.length).toBeGreaterThanOrEqual(2);
    }
    // Disjoint + complete: the union of all clusters is exactly the 25 inputs, once each.
    const seen = clusters.flatMap((cl) => cl.map((c) => c.memoryId));
    expect(new Set(seen).size).toBe(25);
    expect(seen.length).toBe(25);
  });

  test('test_mutual_nearest_pair_lands_together: near pair co-locates despite 20 fillers', () => {
    const DIM = 30;
    // Near pair in the (dim0,dim1) plane, angle chosen so cos ≈ 0.51.
    const theta = 0.5175; // rad; cos(2θ) ≈ 0.51
    const near1: Cand = { memoryId: 'z-near1', embedding: unitPlane(DIM, theta) };
    const near2: Cand = { memoryId: 'z-near2', embedding: unitPlane(DIM, -theta) };
    // 20 fillers all share dim 2 (mutually cos ≈ 1), each a tiny distinct signal;
    // orthogonal to the (dim0,dim1) plane → cos ≈ 0 to the near pair.
    const fillers: Cand[] = [];
    for (let i = 0; i < 20; i += 1) {
      const v = unit(DIM, 2);
      v[3 + (i % (DIM - 3))] = 0.01;
      fillers.push({ memoryId: `f${String(i).padStart(2, '0')}`, embedding: v });
    }

    const clusters = clusterByProximity([...fillers, near1, near2], 20);

    // near1 and near2 must land in the SAME returned cluster.
    const withNear1 = clusters.find((cl) => cl.some((c) => c.memoryId === 'z-near1'));
    expect(withNear1).toBeDefined();
    expect(withNear1?.some((c) => c.memoryId === 'z-near2')).toBe(true);
  });

  test('test_deterministic_tie_break_by_memory_id: equal distances resolve by memoryId, stably', () => {
    const DIM = 3;
    // a,b,c mutually orthogonal → cos(a,b)=cos(a,c)=0 (a tie for a's nearest).
    const a: Cand = { memoryId: 'a', embedding: unit(DIM, 0) };
    const b: Cand = { memoryId: 'b', embedding: unit(DIM, 1) };
    const c: Cand = { memoryId: 'c', embedding: unit(DIM, 2) };

    // cap 2 → anchor 'a' picks ONE nearest; the tie must resolve to 'b' (id asc).
    const run1 = clusterByProximity([c, b, a], 2);
    const run2 = clusterByProximity([a, b, c], 2); // different input order, same result

    for (const clusters of [run1, run2]) {
      // 'c' is left a singleton after {a,b} forms → dropped (only pairs+ returned).
      expect(clusters).toHaveLength(1);
      const only = clusters[0] ?? [];
      const ids = only.map((x) => x.memoryId).sort();
      expect(ids).toEqual(['a', 'b']);
    }
  });

  test('fewer than cap inputs → one cluster (failure-scenario: small scope degrades to whole-scope)', () => {
    const DIM = 8;
    const cands: Cand[] = [
      { memoryId: 'p', embedding: unit(DIM, 0) },
      { memoryId: 'q', embedding: unit(DIM, 0) },
      { memoryId: 'r', embedding: unit(DIM, 0) },
    ];
    const clusters = clusterByProximity(cands, 20);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toHaveLength(3);
  });

  test('singleton input → empty (nothing to consolidate)', () => {
    const clusters = clusterByProximity([{ memoryId: 'solo', embedding: unit(4, 0) }], 20);
    expect(clusters).toEqual([]);
  });

  test('preserves the candidate ...rest fields (generic pass-through)', () => {
    const DIM = 4;
    const clusters = clusterByProximity(
      [
        { memoryId: 'x', embedding: unit(DIM, 0), text: 'hello' },
        { memoryId: 'y', embedding: unit(DIM, 0), text: 'world' },
      ],
      20,
    );
    expect(clusters[0]?.map((c) => c.text).sort()).toEqual(['hello', 'world']);
  });
});

/** Unit vector in the (dim0,dim1) plane at angle `theta` (radians). */
function unitPlane(dim: number, theta: number): number[] {
  const v = new Array<number>(dim).fill(0);
  v[0] = Math.cos(theta);
  v[1] = Math.sin(theta);
  return v;
}
