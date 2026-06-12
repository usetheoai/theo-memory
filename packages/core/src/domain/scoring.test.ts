/**
 * RED-phase tests for src/core/scoring.ts — T1.3 of v0-1-local-runtime plan v1.3.
 *
 * Pure-core scoring functions ported verbatim from the upstream additive composition
 * .claude/knowledge-base/references/mem0/mem0-ts/src/oss/src/utils/scoring.ts:1-138 per blueprint D2.
 *
 * EC-1 absorbed: combineScores guards maxPossible=0 → returns 0 (no divide-by-zero NaN).
 * EC-8 absorbed: NaN propagates predictably; Phase 5 threshold gate drops NaN-scored results.
 */
import { describe, expect, test } from 'vitest';

import {
  ENTITY_BOOST_WEIGHT,
  combineScores,
  entityBoost,
  maxPossible,
  sigmoidBm25,
} from './scoring.js';

describe('ENTITY_BOOST_WEIGHT constant', () => {
  test('equals 0.5 (upstream verbatim)', () => {
    expect(ENTITY_BOOST_WEIGHT).toBe(0.5);
  });
});

describe('sigmoidBm25', () => {
  test('returns 0.5 at the midpoint for short query', () => {
    // short query (≤3 tokens): midpoint=4, steepness=0.5
    expect(sigmoidBm25(4, 2)).toBeCloseTo(0.5, 3);
  });

  test('returns 0.5 at the midpoint for long query', () => {
    // long query (>3 tokens): midpoint=8, steepness=0.3
    expect(sigmoidBm25(8, 5)).toBeCloseTo(0.5, 3);
  });

  test('is monotonically increasing in raw score', () => {
    for (let i = 0; i < 10; i += 1) {
      expect(sigmoidBm25(i + 1, 3)).toBeGreaterThan(sigmoidBm25(i, 3));
    }
  });

  test('returns a value in (0, 1) for any finite raw score', () => {
    expect(sigmoidBm25(0, 2)).toBeGreaterThan(0);
    expect(sigmoidBm25(0, 2)).toBeLessThan(1);
    expect(sigmoidBm25(100, 2)).toBeGreaterThan(0.99);
    expect(sigmoidBm25(100, 2)).toBeLessThanOrEqual(1);
  });
});

describe('entityBoost', () => {
  test('zero links returns zero', () => {
    expect(entityBoost(0)).toBe(0);
  });

  test('one link returns ENTITY_BOOST_WEIGHT (no attenuation when numLinked=1)', () => {
    expect(entityBoost(1)).toBeCloseTo(ENTITY_BOOST_WEIGHT, 3);
  });

  test('attenuates as numLinked grows beyond 1', () => {
    expect(entityBoost(10)).toBeLessThan(entityBoost(2));
    expect(entityBoost(2)).toBeLessThan(entityBoost(1));
  });
});

describe('maxPossible', () => {
  test('semantic only → 1.0', () => {
    expect(maxPossible({ semantic: true, bm25: false, entity: false })).toBe(1.0);
  });

  test('semantic + bm25 → 2.0', () => {
    expect(maxPossible({ semantic: true, bm25: true, entity: false })).toBe(2.0);
  });

  test('semantic + entity → 1.5', () => {
    expect(maxPossible({ semantic: true, bm25: false, entity: true })).toBe(1.5);
  });

  test('all three signals → 2.5', () => {
    expect(maxPossible({ semantic: true, bm25: true, entity: true })).toBe(2.5);
  });
});

describe('combineScores', () => {
  test('caps at 1.0 even when raw sum exceeds maxPossible', () => {
    expect(combineScores({ semantic: 1, bm25: 1, entityBoostScore: 0.5 }, 2.5)).toBeCloseTo(1.0, 3);
  });

  test('normalizes by maxPossible', () => {
    expect(combineScores({ semantic: 0.8, bm25: 0, entityBoostScore: 0 }, 1.0)).toBeCloseTo(0.8, 3);
  });

  test('does NOT gate on threshold internally (Phase 5 owns gating)', () => {
    // Should return a value even when semantic is below typical thresholds
    expect(combineScores({ semantic: 0.1, bm25: 0, entityBoostScore: 0 }, 1.0)).toBeCloseTo(0.1, 3);
  });

  test('EC-1: returns 0 when maxPossible is 0 (no signals active; divide-by-zero guard)', () => {
    expect(combineScores({ semantic: 0, bm25: 0, entityBoostScore: 0 }, 0)).toBe(0);
  });

  test('EC-8: NaN semantic input propagates to NaN output (Phase 5 threshold gate drops it)', () => {
    expect(combineScores({ semantic: NaN, bm25: 0.5, entityBoostScore: 0 }, 1.5)).toBeNaN();
  });
});
