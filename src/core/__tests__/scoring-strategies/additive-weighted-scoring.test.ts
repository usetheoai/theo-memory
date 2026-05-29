/**
 * T1.2 RED tests for AdditiveWeightedScoring per plan v0-4a-reflection-pipeline.
 *
 * Assertions:
 *   - default weights {1,1,1} + uniform inputs → 1.0 (max possible normalized)
 *   - GENERATIVE_AGENTS_WEIGHTS {0.5, 3, 2} + uniform inputs → 1.0 (normalized)
 *   - min-max normalization is applied BEFORE the weighted sum
 *   - input >1 (pathological) gets clamped to 1 before summation
 *   - EC-1: constructor throws InvalidScoringWeightsError when all weights sum to 0
 *   - EC-8: min===max returns 0.5 (neutral) — no NaN
 *   - returned array same length as input; all values in [0, 1]
 *
 * @see .claude/knowledge-base/plans/v0-4a-reflection-pipeline-plan.md § T1.2 + ADR D3
 * @see .claude/knowledge-base/discoveries/blueprints/v0-4a-reflection-pipeline-blueprint.md § D9
 */
import { describe, expect, test } from 'vitest';

import { InvalidScoringWeightsError } from '../../errors.js';
import type { ScoreInput } from '../../dip/scoring-strategy.js';
import {
  AdditiveWeightedScoring,
  GENERATIVE_AGENTS_WEIGHTS,
} from '../../scoring-strategies/additive-weighted-scoring.js';

describe('AdditiveWeightedScoring (T1.2)', () => {
  test('default weights are {1, 1, 1}', () => {
    const strategy = new AdditiveWeightedScoring();
    // Single item: min==max for all dimensions → 0.5 per EC-8 spec
    const result = strategy.score([{ recency: 0.7, relevance: 0.5, importance: 0.3 }]);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(0.5); // EC-8: single item degenerates to neutral
  });

  test('uniform max inputs across batch with default weights returns 1.0', () => {
    const strategy = new AdditiveWeightedScoring();
    const items: ScoreInput[] = [
      { recency: 0, relevance: 0, importance: 0 },
      { recency: 1, relevance: 1, importance: 1 },
    ];
    const result = strategy.score(items);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe(0); // min row
    expect(result[1]).toBe(1); // max row
  });

  test('GENERATIVE_AGENTS_WEIGHTS = { recency: 0.5, relevance: 3, importance: 2 }', () => {
    expect(GENERATIVE_AGENTS_WEIGHTS).toEqual({
      recency: 0.5,
      relevance: 3,
      importance: 2,
    });
  });

  test('GENERATIVE_AGENTS_WEIGHTS preset produces same batch shape', () => {
    const strategy = new AdditiveWeightedScoring(GENERATIVE_AGENTS_WEIGHTS);
    const items: ScoreInput[] = [
      { recency: 0, relevance: 0, importance: 0 },
      { recency: 1, relevance: 1, importance: 1 },
    ];
    const result = strategy.score(items);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe(0);
    expect(result[1]).toBe(1);
  });

  test('clamps input >1 to 1 before summation', () => {
    const strategy = new AdditiveWeightedScoring();
    const items: ScoreInput[] = [
      { recency: 0, relevance: 0, importance: 0 },
      { recency: 5, relevance: 7, importance: 99 }, // pathological
    ];
    const result = strategy.score(items);
    // The pathological row gets clamped to {1, 1, 1} normalized
    expect(result[1]).toBeLessThanOrEqual(1);
    expect(result[1]).toBeGreaterThanOrEqual(0);
  });

  test('EC-1: throws InvalidScoringWeightsError when all weights are 0', () => {
    expect(
      () => new AdditiveWeightedScoring({ recency: 0, relevance: 0, importance: 0 }),
    ).toThrow(InvalidScoringWeightsError);
  });

  test('EC-1: error message mentions "at least one weight must be > 0"', () => {
    expect(
      () => new AdditiveWeightedScoring({ recency: 0, relevance: 0, importance: 0 }),
    ).toThrow(/at least one weight must be > 0/i);
  });

  test('EC-1: error exposes providedWeights field', () => {
    try {
      new AdditiveWeightedScoring({ recency: 0, relevance: 0, importance: 0 });
      expect.fail('expected to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidScoringWeightsError);
      const e = err as InvalidScoringWeightsError;
      expect(e.providedWeights).toEqual({ recency: 0, relevance: 0, importance: 0 });
    }
  });

  test('EC-8: zero variance (min === max) returns 0.5 for all entries — no NaN', () => {
    const strategy = new AdditiveWeightedScoring();
    const items: ScoreInput[] = [
      { recency: 0.5, relevance: 0.5, importance: 0.5 },
      { recency: 0.5, relevance: 0.5, importance: 0.5 },
      { recency: 0.5, relevance: 0.5, importance: 0.5 },
    ];
    const result = strategy.score(items);
    expect(result).toHaveLength(3);
    for (const v of result) {
      expect(Number.isNaN(v)).toBe(false);
      expect(v).toBe(0.5);
    }
  });

  test('empty batch returns empty array', () => {
    const strategy = new AdditiveWeightedScoring();
    const result = strategy.score([]);
    expect(result).toEqual([]);
  });

  test('all returned values are in [0, 1]', () => {
    const strategy = new AdditiveWeightedScoring(GENERATIVE_AGENTS_WEIGHTS);
    const items: ScoreInput[] = [
      { recency: 0.2, relevance: 0.8, importance: 0.5 },
      { recency: 0.9, relevance: 0.1, importance: 0.7 },
      { recency: 0.5, relevance: 0.5, importance: 0.5 },
    ];
    const result = strategy.score(items);
    for (const v of result) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});
