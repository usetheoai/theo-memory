/**
 * T1.1 — Metric primitives (promoted from tests/eval/distillation/metrics.ts).
 * Semantics MUST stay identical after the move (Baseline Context invariant).
 */
import { describe, expect, it } from 'vitest';

import {
  bleuScore,
  conflictResolutionAccuracy,
  entityOverlapJaccard,
  precision,
  recall,
} from './index.js';

describe('metrics — bounds, edges, negatives', () => {
  it('test_precision_recall_jaccard_bounds_and_empty_edges', () => {
    // Jaccard bounds [0,1] + identity.
    expect(entityOverlapJaccard('a b c', 'a b c')).toBe(1);
    const j = entityOverlapJaccard('a b', 'b c');
    expect(j).toBeGreaterThan(0);
    expect(j).toBeLessThan(1);

    // Empty edges (verbatim semantics).
    expect(entityOverlapJaccard('', '')).toBe(0);
    expect(precision([], ['x'])).toBe(0);
    expect(recall(['x'], [])).toBe(0);

    // Perfect match.
    expect(precision(['São Paulo'], ['São Paulo'])).toBe(1);
    expect(recall(['São Paulo'], ['São Paulo'])).toBe(1);

    // NEGATIVE: mismatched (disjoint) inputs → 0.
    expect(precision(['apple pie'], ['diesel engine'])).toBe(0);
    expect(recall(['apple pie'], ['diesel engine'])).toBe(0);
  });

  it('conflict-resolution accuracy scores kept+rejected pairs', () => {
    expect(conflictResolutionAccuracy([])).toBe(0);
    const acc = conflictResolutionAccuracy([
      {
        fixtureId: 'f1',
        expectedKept: 'lives in Berlin',
        expectedRejected: 'lives in Paris',
        actualKept: 'lives in Berlin',
        actualRejected: 'lives in Paris',
      },
    ]);
    expect(acc).toBe(1);
  });

  it('bleuScore is bounded [0,1] and 0 on empty', () => {
    expect(bleuScore('', 'anything')).toBe(0);
    const b = bleuScore('the cat sat', 'the cat sat');
    expect(b).toBeGreaterThan(0);
    expect(b).toBeLessThanOrEqual(1);
  });
});
