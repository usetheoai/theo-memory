/**
 * T3.1 RED → GREEN test for the gold-set loader.
 *
 * Asserts:
 *   - `loadGoldSet()` returns exactly 200 typed `GoldSetFixture` rows.
 *   - Category distribution: 50 single-fact + 50 multi-fact + 25
 *     contradiction-pair + 25 entity-overlap + 50 simulated-dialog.
 *   - Hand-authored subset is exactly 50 (10 per category) — the honest
 *     T3.3 quality-signal subset per ADR D4 hybrid path.
 *   - Procedural subset is exactly 150 with `source: 'procedural-seed'`.
 *   - Every fixture passes the Zod schema (loader throws otherwise).
 *   - Every contradiction-pair fixture carries `expectedConflictPair`.
 *   - Every fixture id starts with its category prefix (file naming
 *     discipline + audit).
 *
 */
import { describe, expect, test } from 'vitest';

import {
  GOLD_SET_TOTAL,
  expectedCountFor,
  loadGoldSet,
  type GoldSetCategory,
} from '../../fixtures/distillation/loader.js';

const ALL_CATEGORIES: readonly GoldSetCategory[] = [
  'single-fact',
  'multi-fact',
  'contradiction-pair',
  'entity-overlap',
  'simulated-dialog',
];

describe('T3.1: distillation gold-set loader', () => {
  test('GOLD_SET_TOTAL constant equals 200', () => {
    expect(GOLD_SET_TOTAL).toBe(200);
  });

  test('loadGoldSet() returns exactly 200 Zod-validated fixtures', () => {
    const fixtures = loadGoldSet();
    expect(fixtures).toHaveLength(200);
  });

  test('category distribution matches expected counts (50/50/25/25/50)', () => {
    const fixtures = loadGoldSet();
    for (const category of ALL_CATEGORIES) {
      const count = fixtures.filter((f) => f.category === category).length;
      expect(count, `count for ${category}`).toBe(expectedCountFor(category));
    }
  });

  test('hand-authored subset is exactly 50 (10 per category) — T3.3 quality-signal subset', () => {
    const fixtures = loadGoldSet();
    const hand = fixtures.filter((f) => f.source === 'hand');
    expect(hand).toHaveLength(50);
    for (const category of ALL_CATEGORIES) {
      const count = hand.filter((f) => f.category === category).length;
      expect(count, `hand-authored count for ${category}`).toBe(10);
    }
  });

  test('procedural subset is exactly 150 with source="procedural-seed"', () => {
    const fixtures = loadGoldSet();
    const proc = fixtures.filter((f) => f.source === 'procedural-seed');
    expect(proc).toHaveLength(150);
  });

  test('every contradiction-pair fixture carries expectedConflictPair', () => {
    const fixtures = loadGoldSet();
    const pairs = fixtures.filter((f) => f.category === 'contradiction-pair');
    expect(pairs).toHaveLength(25);
    for (const pair of pairs) {
      expect(pair.expectedConflictPair, `id=${pair.id}`).toBeDefined();
      expect(pair.expectedConflictPair?.kept).toBeTruthy();
      expect(pair.expectedConflictPair?.rejected).toBeTruthy();
    }
  });

  test('every fixture id starts with its category prefix', () => {
    const fixtures = loadGoldSet();
    for (const fixture of fixtures) {
      expect(
        fixture.id.startsWith(`${fixture.category}-`),
        `id=${fixture.id}`,
      ).toBe(true);
    }
  });

  test('every fixture has at least one expectedFact', () => {
    const fixtures = loadGoldSet();
    for (const fixture of fixtures) {
      expect(fixture.expectedFacts.length, `id=${fixture.id}`).toBeGreaterThanOrEqual(1);
    }
  });
});
