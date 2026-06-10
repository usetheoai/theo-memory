/**
 * principles-alignment-hardening T4.2 — unit tests for mmrRerank
 * (Maximal Marginal Relevance) per ADR D3 + EC-3 boundary validation.
 *
 * @see .claude/knowledge-base/plans/principles-alignment-hardening-plan.md § T4.2
 */
import { describe, expect, test } from 'vitest';

import { InvalidScope } from '../../errors.js';
import { mmrRerank, type MmrCandidate } from '../mmr.js';

function makeCandidate(id: string, score: number, embedding: readonly number[]): MmrCandidate {
  return { id, score, embedding };
}

describe('mmrRerank — principles-alignment-hardening T4.2', () => {
  test('empty input returns empty', () => {
    expect(mmrRerank([], 0.5, 10, 5)).toEqual([]);
  });

  test('k=0 returns empty even with non-empty candidates', () => {
    const candidates = [makeCandidate('a', 0.9, [1, 0, 0])];
    expect(mmrRerank(candidates, 0.5, 10, 0)).toEqual([]);
  });

  test('topPool=0 returns empty', () => {
    const candidates = [makeCandidate('a', 0.9, [1, 0, 0])];
    expect(mmrRerank(candidates, 0.5, 0, 5)).toEqual([]);
  });

  test('lambda=1 returns relevance-only order (pure relevance, no diversity)', () => {
    const candidates = [
      makeCandidate('a', 0.9, [1, 0, 0]),
      makeCandidate('b', 0.7, [0.99, 0.1, 0]), // near-duplicate of a
      makeCandidate('c', 0.5, [0, 1, 0]),       // diverse
    ];
    const result = mmrRerank(candidates, 1, 10, 3);
    expect(result.map((c) => c.id)).toEqual(['a', 'b', 'c']);
  });

  test('lambda=0 picks diversity over relevance (pure diversity, no relevance)', () => {
    // lambda=0 means MMR ignores relevance — first pick = first candidate.
    const candidates = [
      makeCandidate('a', 0.9, [1, 0, 0]),
      makeCandidate('b', 0.85, [0.99, 0.1, 0]), // near-duplicate of a
      makeCandidate('c', 0.5, [0, 1, 0]),       // diverse from a
    ];
    const result = mmrRerank(candidates, 0, 10, 2);
    // First pick: a (best score under lambda=0 from empty selected is the one
    // with the highest mmr = -0 = 0 — but with empty selected, maxSim=0 so all
    // tie at score=0; first-in-list breaks tie).
    expect(result[0]?.id).toBe('a');
    // Second pick MUST prefer diversity: c (cosine to a = 0) over b (cosine ≈ 1).
    expect(result[1]?.id).toBe('c');
  });

  test('lambda=0.7 (literature default) balances relevance + diversity', () => {
    const candidates = [
      makeCandidate('a', 0.9, [1, 0, 0]),
      makeCandidate('b', 0.88, [0.99, 0.1, 0]), // near-duplicate of a, high score
      makeCandidate('c', 0.6, [0, 1, 0]),       // diverse but lower score
    ];
    const result = mmrRerank(candidates, 0.7, 10, 2);
    expect(result[0]?.id).toBe('a');
    // With lambda=0.7: b's mmr ≈ 0.7*0.88 - 0.3*~1 ≈ 0.32
    //                  c's mmr = 0.7*0.6 - 0.3*0 = 0.42  → c wins (diversity over near-dup)
    expect(result[1]?.id).toBe('c');
  });

  test('EC-3 absorption — throws InvalidScope when lambda < 0 (boundary validation per architecture.md § 8)', () => {
    const candidates = [makeCandidate('a', 0.9, [1, 0, 0])];
    expect(() => mmrRerank(candidates, -0.1, 10, 5)).toThrow(InvalidScope);
  });

  test('EC-3 absorption — throws InvalidScope when lambda > 1', () => {
    const candidates = [makeCandidate('a', 0.9, [1, 0, 0])];
    expect(() => mmrRerank(candidates, 1.5, 10, 5)).toThrow(InvalidScope);
  });

  test('EC-3 absorption — throws InvalidScope when lambda is NaN', () => {
    const candidates = [makeCandidate('a', 0.9, [1, 0, 0])];
    expect(() => mmrRerank(candidates, Number.NaN, 10, 5)).toThrow(InvalidScope);
  });

  test('EC-3 absorption — throws InvalidScope when lambda is Infinity', () => {
    const candidates = [makeCandidate('a', 0.9, [1, 0, 0])];
    expect(() => mmrRerank(candidates, Infinity, 10, 5)).toThrow(InvalidScope);
  });

  test('zero-norm vectors do not throw — cosine returns 0 defensively', () => {
    // Pair: one normal vector + one all-zeros. cosine(a, b) = 0 by helper guard.
    const candidates = [
      makeCandidate('a', 0.9, [1, 0, 0]),
      makeCandidate('b', 0.8, [0, 0, 0]),
    ];
    expect(() => mmrRerank(candidates, 0.5, 10, 2)).not.toThrow();
    const result = mmrRerank(candidates, 0.5, 10, 2);
    expect(result).toHaveLength(2);
  });

  test('topPool < candidates.length limits the working set', () => {
    const candidates = [
      makeCandidate('a', 0.9, [1, 0, 0]),
      makeCandidate('b', 0.85, [0, 1, 0]),
      makeCandidate('c', 0.8, [0, 0, 1]),
      makeCandidate('d', 0.75, [0.5, 0.5, 0]),
    ];
    // topPool=2 — only a, b considered; c, d ignored.
    const result = mmrRerank(candidates, 0.7, 2, 5);
    expect(result.map((c) => c.id).sort()).toEqual(['a', 'b']);
  });

  test('k > candidates.length returns all candidates without throwing', () => {
    const candidates = [
      makeCandidate('a', 0.9, [1, 0, 0]),
      makeCandidate('b', 0.5, [0, 1, 0]),
    ];
    const result = mmrRerank(candidates, 0.7, 10, 100);
    expect(result).toHaveLength(2);
  });
});
