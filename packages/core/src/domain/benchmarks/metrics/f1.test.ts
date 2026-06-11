/**
 * T1.1 RED tests for calculateF1Score.
 *
 * SQuAD convention:
 * - both-empty → 1.0 (vacuous-perfect)
 * - only-one-empty → 0.0 (no signal)
 *
 * @see .claude/knowledge-base/plans/v0-8-independent-benchmark-reproduction-plan.md § T1.1
 */
import { describe, expect, it } from 'vitest';

import { calculateF1Score } from './f1.js';

describe('calculateF1Score', () => {
  it('returns 1.0 for identical strings', () => {
    expect(calculateF1Score('hello world', 'hello world')).toBeCloseTo(1.0);
  });

  it('returns 1.0 when both inputs are empty (SQuAD convention)', () => {
    expect(calculateF1Score('', '')).toBeCloseTo(1.0);
  });

  it('returns 0.0 when only prediction is empty', () => {
    expect(calculateF1Score('', 'hello world')).toBe(0.0);
  });

  it('returns 0.0 when only reference is empty', () => {
    expect(calculateF1Score('hello world', '')).toBe(0.0);
  });

  it('returns 0.0 when token sets are disjoint', () => {
    expect(calculateF1Score('hello world', 'foo bar')).toBe(0.0);
  });

  it('returns expected score for partial overlap (3 of 5 tokens common)', () => {
    // pred tokens: {the, quick, brown, fox, jumps}
    // ref tokens:  {the, brown, fox, runs, fast}
    // common: {the, brown, fox} = 3
    // precision = 3/5 = 0.6; recall = 3/5 = 0.6; f1 = 0.6
    expect(calculateF1Score('the quick brown fox jumps', 'the brown fox runs fast')).toBeCloseTo(
      0.6,
    );
  });

  it('is case-insensitive and strips common punctuation', () => {
    expect(calculateF1Score('Hello, World!', 'hello world')).toBeCloseTo(1.0);
  });

  it('treats repeated tokens as a set (no double-counting)', () => {
    // pred: {hello, world} (repeated "hello" collapsed)
    // ref:  {hello, world}
    expect(calculateF1Score('hello hello world', 'hello world')).toBeCloseTo(1.0);
  });
});
