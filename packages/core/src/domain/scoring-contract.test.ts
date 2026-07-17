/**
 * T1.2 RED — Contract test parameterized over BOTH AdditiveWeightedScoring
 * weight presets per CLAUDE.md Item 5 acceptance:
 *   "Both scoring strategies pass identical recall-shape contract test
 *    (interface compliance)"
 *
 * The contract: any ScoringStrategy MUST
 *   - return array same length as input
 *   - return values in [0, 1]
 *   - handle empty batch
 *   - handle min === max gracefully (no NaN)
 *
 * Parameterized over default {1,1,1} and GENERATIVE_AGENTS_WEIGHTS {0.5, 3, 2}.
 *
 */
import { describe, expect, test } from 'vitest';

import type { ScoreInput, ScoringStrategy, ScoringWeights } from './dip/scoring-strategy.js';
import {
  AdditiveWeightedScoring,
  GENERATIVE_AGENTS_WEIGHTS,
} from './scoring-strategies/additive-weighted-scoring.js';

interface ContractFixture {
  readonly label: string;
  readonly weights: ScoringWeights | undefined;
  readonly factory: () => ScoringStrategy;
}

const FIXTURES: readonly ContractFixture[] = [
  {
    label: 'AdditiveWeightedScoring (default weights {1,1,1})',
    weights: undefined,
    factory: () => new AdditiveWeightedScoring(),
  },
  {
    label: 'AdditiveWeightedScoring (GENERATIVE_AGENTS_WEIGHTS)',
    weights: GENERATIVE_AGENTS_WEIGHTS,
    factory: () => new AdditiveWeightedScoring(GENERATIVE_AGENTS_WEIGHTS),
  },
];

describe.each(FIXTURES)('ScoringStrategy contract: $label', ({ factory }) => {
  test('empty batch returns empty array', () => {
    const strategy = factory();
    expect(strategy.score([])).toEqual([]);
  });

  test('returns array same length as input', () => {
    const strategy = factory();
    const items: ScoreInput[] = [
      { recency: 0.1, relevance: 0.5, importance: 0.9 },
      { recency: 0.5, relevance: 0.5, importance: 0.5 },
      { recency: 0.9, relevance: 0.1, importance: 0.3 },
    ];
    const result = strategy.score(items);
    expect(result).toHaveLength(3);
  });

  test('all values in [0, 1]', () => {
    const strategy = factory();
    const items: ScoreInput[] = [
      { recency: 0, relevance: 0, importance: 0 },
      { recency: 1, relevance: 1, importance: 1 },
      { recency: 0.5, relevance: 0.5, importance: 0.5 },
    ];
    const result = strategy.score(items);
    for (const v of result) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  test('handles min === max (zero variance) without NaN', () => {
    const strategy = factory();
    const items: ScoreInput[] = [
      { recency: 0.7, relevance: 0.7, importance: 0.7 },
      { recency: 0.7, relevance: 0.7, importance: 0.7 },
    ];
    const result = strategy.score(items);
    for (const v of result) {
      expect(Number.isNaN(v)).toBe(false);
    }
  });
});
