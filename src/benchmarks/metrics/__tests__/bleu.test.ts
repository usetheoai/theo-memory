/**
 * T1.1 RED tests for calculateBleuScore.
 *
 * EC-7 absorption: empty / whitespace inputs return 0 (no signal). The
 * underlying `natural.BleuScore` returns NaN on empty inputs across some
 * versions; our wrapper guards explicitly.
 *
 * `natural` is an optionalDependency (package.json:111). When absent, the
 * suite skips cleanly via `describe.skipIf`.
 *
 * @see .claude/knowledge-base/plans/v0-8-independent-benchmark-reproduction-plan.md § T1.1
 * @see .claude/knowledge-base/reviews/v0-8-independent-benchmark-reproduction-edge-cases-2026-06-02.md § EC-7
 */
import { describe, expect, it } from 'vitest';

import { calculateBleuScore, isBleuAvailable } from '../bleu.js';

describe.skipIf(!isBleuAvailable())('calculateBleuScore', () => {
  it('returns close to 1 for identical strings', () => {
    expect(calculateBleuScore('the cat sat on the mat', 'the cat sat on the mat')).toBeGreaterThan(
      0.99,
    );
  });

  it('returns a number in [0, 1] for partial overlap', () => {
    const score = calculateBleuScore('the cat sat on the mat', 'the cat sat there');
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('returns 0 when prediction is empty (EC-7)', () => {
    expect(calculateBleuScore('', 'the cat sat on the mat')).toBe(0);
  });

  it('returns 0 when reference is empty (EC-7)', () => {
    expect(calculateBleuScore('the cat sat on the mat', '')).toBe(0);
  });

  it('returns 0 when both inputs are empty (EC-7)', () => {
    expect(calculateBleuScore('', '')).toBe(0);
  });

  it('returns 0 for whitespace-only inputs (EC-7)', () => {
    expect(calculateBleuScore('   ', '   ')).toBe(0);
    expect(calculateBleuScore('   ', 'the cat')).toBe(0);
  });
});
