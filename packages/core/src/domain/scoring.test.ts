/**
 * RED-phase tests for src/core/scoring.ts — T1.3 of v0-1-local-runtime plan v1.3.
 *
 * Pure-core scoring functions ported verbatim from the upstream additive composition
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

describe('entityBoost (non-decreasing + saturating — #125)', () => {
  test('zero links returns exactly zero', () => {
    // Preserved invariant: an unlinked candidate contributes nothing (exact 0, not epsilon).
    expect(entityBoost(0)).toBe(0);
  });

  test('is non-decreasing in numLinked (#125 regression)', () => {
    // The M15 semantics feed numLinked the query<->memory intersection count: more matched
    // entities MUST mean at least as much boost. The old curve W/(1+0.001*(n-1)^2) DECREASED.
    for (let n = 1; n <= 25; n += 1) {
      expect(entityBoost(n + 1)).toBeGreaterThanOrEqual(entityBoost(n));
    }
  });

  test('more matched entities never scores less (#125 concrete case)', () => {
    expect(entityBoost(3)).toBeGreaterThan(entityBoost(1));
  });

  test('saturates at ENTITY_BOOST_WEIGHT (ceiling preserved, no domination)', () => {
    // Two magnitudes (EC-1): approaches the ceiling monotonically and never crosses it, staying
    // finite (no NaN/Infinity) — the W·n/(n+c) form is numerically stable across the range.
    for (const n of [100, 10000]) {
      expect(entityBoost(n)).toBeLessThanOrEqual(ENTITY_BOOST_WEIGHT);
      expect(Number.isFinite(entityBoost(n))).toBe(true);
    }
    expect(entityBoost(10000)).toBeGreaterThan(entityBoost(100));
    expect(entityBoost(10000)).toBeGreaterThan(ENTITY_BOOST_WEIGHT * 0.9);
  });

  test('negative numLinked returns 0 (defensive guard — never negative boost)', () => {
    // Negative case: numLinked comes from a Map size and is
    // non-negative by construction, but the `n<=0` guard must return exact 0, not a negative
    // value the `n/(n+c)` formula would produce at n<0 (or a divide near n=-c).
    expect(entityBoost(-1)).toBe(0);
    expect(entityBoost(-100)).toBe(0);
  });
});

describe('maxPossible', () => {
  test('semantic only → 1.0', () => {
    expect(maxPossible({ semantic: true, bm25: false, entity: false })).toBe(1.0);
  });

  test('semantic + bm25 → 2.0', () => {
    expect(maxPossible({ semantic: true, bm25: true, entity: false })).toBe(2.0);
  });

  test('semantic + entity → 1.0 (entity is numerator-only; does NOT inflate the denominator — #127)', () => {
    expect(maxPossible({ semantic: true, bm25: false, entity: true })).toBe(1.0);
  });

  test('all three signals → 2.0 (entity excluded from maxPossible — #127)', () => {
    expect(maxPossible({ semantic: true, bm25: true, entity: true })).toBe(2.0);
  });
});

describe('numerator-only entity boost — no candidate eviction (#127)', () => {
  test('unlinked candidate score is unchanged whether or not entity is active for others', () => {
    // Semantic headroom BELOW the 1.0 clamp so the effect is measurable (SEPA precondition:
    // a saturated 1.0 corpus would tie everything at the clamp and hide the fix).
    const withEntityActive = combineScores(
      { semantic: 0.85, bm25: 0, entityBoostScore: 0 },
      maxPossible({ semantic: true, bm25: false, entity: true }),
    );
    const withoutEntity = combineScores(
      { semantic: 0.85, bm25: 0, entityBoostScore: 0 },
      maxPossible({ semantic: true, bm25: false, entity: false }),
    );
    // #127: turning the entity signal on for OTHER candidates must not lower this one's score.
    expect(withEntityActive).toBeCloseTo(withoutEntity, 6);
    expect(withEntityActive).toBeCloseTo(0.85, 6);
  });

  test('linked candidate still ranks above unlinked when both have semantic headroom', () => {
    const denom = maxPossible({ semantic: true, bm25: false, entity: true });
    const linked = combineScores({ semantic: 0.85, bm25: 0, entityBoostScore: 0.25 }, denom);
    const unlinked = combineScores({ semantic: 0.85, bm25: 0, entityBoostScore: 0 }, denom);
    // The M15 gain is preserved: the boost still discriminates (does not tie at the clamp).
    expect(linked).toBeGreaterThan(unlinked);
  });
});

describe('combineScores', () => {
  test('caps at 1.0 even when raw sum exceeds maxPossible', () => {
    expect(combineScores({ semantic: 1, bm25: 1, entityBoostScore: 0.5 }, 2.0)).toBeCloseTo(1.0, 3);
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
