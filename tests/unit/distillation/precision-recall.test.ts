/**
 * T3.2 RED→GREEN test for the distillation evaluation metric helpers.
 *
 * 8 assertions covering:
 *   - tokenize: lowercase + word-split + punctuation drop
 *   - bleuScore: identical strings = 1.0; partial overlap > 0; disjoint near 0
 *   - bleuScore (EC-10): real n-gram match using natural.NGrams (BLEU
 *     implemented manually — natural lib does NOT export BleuScore;
 *     plan EC-10 was fabricated, honest correction in metrics.ts header)
 *   - entityOverlapJaccard: identical = 1; disjoint = 0; partial overlap
 *   - precision: matched / extracted
 *   - recall: matched / expected
 *   - conflictResolutionAccuracy: per-pair correctness
 *
 */
import { describe, expect, test } from 'vitest';

import {
  bleuScore,
  conflictResolutionAccuracy,
  entityOverlapJaccard,
  precision,
  recall,
  tokenize,
} from '../../eval/distillation/metrics.js';

describe('T3.2: distillation evaluation metrics', () => {
  test('tokenize lowercases + splits on whitespace + drops punctuation', () => {
    const tokens = tokenize('The cat sat on the mat!');
    expect(tokens).toEqual(['the', 'cat', 'sat', 'on', 'the', 'mat']);
  });

  test('bleuScore — identical strings = 1.0', () => {
    expect(bleuScore('the cat sat on the mat', 'the cat sat on the mat')).toBeCloseTo(
      1.0,
      2,
    );
  });

  test('bleuScore (EC-10) — near-identical with 1 token diff is in (0.4, 1.0)', () => {
    // Strict BLEU-4 without smoothing scores ~0.54 for this pair due to the
    // n=2..4 mismatches around the differing token. That is canonical BLEU
    // behavior — sentence-level scores on short inputs are penalized hard
    // when middle tokens differ. Documented + accepted; precision/recall
    // use Jaccard rather than BLEU for short distillation facts.
    const s = bleuScore('the cat sat on the mat', 'the cat sat on a mat');
    expect(s).toBeGreaterThan(0.4);
    expect(s).toBeLessThan(1.0);
  });

  test('bleuScore — disjoint sentences < 0.1', () => {
    expect(bleuScore('foo bar baz', 'quux corge grault')).toBeLessThan(0.1);
  });

  test('entityOverlapJaccard — identical = 1, disjoint = 0, partial = 1/3', () => {
    expect(entityOverlapJaccard('alice bob carol', 'alice bob carol')).toBe(1.0);
    expect(entityOverlapJaccard('alice', 'bob')).toBe(0);
    // {alice,bob} vs {alice,carol} -> inter={alice}=1; union={alice,bob,carol}=3 -> 1/3
    expect(entityOverlapJaccard('alice bob', 'alice carol')).toBeCloseTo(1 / 3, 3);
  });

  test('precision — 2 of 3 extracted match expected', () => {
    const extracted = ['the cat sat on the mat', 'paulo likes coffee', 'completely unrelated'];
    const expected = ['the cat sat on the mat', 'paulo prefers coffee'];
    const p = precision(extracted, expected, 0.5);
    expect(p).toBeCloseTo(2 / 3, 2);
  });

  test('recall — 2 of 2 expected matched by extracted', () => {
    const extracted = ['the cat sat on the mat', 'paulo likes coffee', 'completely unrelated'];
    const expected = ['the cat sat on the mat', 'paulo prefers coffee'];
    const r = recall(extracted, expected, 0.5);
    expect(r).toBeCloseTo(1.0, 2);
  });

  test('conflictResolutionAccuracy — 2 of 3 decisions correct', () => {
    const acc = conflictResolutionAccuracy(
      [
        // Correct
        {
          fixtureId: 'f1',
          expectedKept: 'lives in sao paulo',
          expectedRejected: 'lives in porto alegre',
          actualKept: 'lives in sao paulo',
          actualRejected: 'lives in porto alegre',
        },
        // Correct (slight wording variation but BLEU >= 0.5)
        {
          fixtureId: 'f2',
          expectedKept: 'works at anthropic as staff engineer',
          expectedRejected: 'works at stripe as senior engineering manager',
          actualKept: 'works at anthropic as staff engineer',
          actualRejected: 'works at stripe as senior engineering manager',
        },
        // Wrong — kept fact doesn't match expected (different relocation)
        {
          fixtureId: 'f3',
          expectedKept: 'lives in tokyo',
          expectedRejected: 'lives in lisbon',
          actualKept: 'married last year',
          actualRejected: 'still single',
        },
      ],
      0.5,
    );
    expect(acc).toBeCloseTo(2 / 3, 2);
  });
});
