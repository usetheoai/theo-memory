/**
 * T1.1 RED tests for calculateExactMatch.
 *
 * @see .claude/knowledge-base/plans/v0-8-independent-benchmark-reproduction-plan.md § T1.1
 */
import { describe, expect, it } from 'vitest';

import { calculateExactMatch } from '../exact-match.js';

describe('calculateExactMatch', () => {
  it('returns true for identical strings', () => {
    expect(calculateExactMatch('hello world', 'hello world')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(calculateExactMatch('Hello World', 'hello world')).toBe(true);
  });

  it('trims leading and trailing whitespace before comparing', () => {
    expect(calculateExactMatch('  hello world  ', 'hello world')).toBe(true);
  });

  it('normalizes Unicode (NFC) before comparing', () => {
    // "é" can be one codepoint (NFC: U+00E9) or two (NFD: U+0065 U+0301).
    const composed = 'café';
    const decomposed = 'café';
    expect(calculateExactMatch(composed, decomposed)).toBe(true);
  });

  it('returns false for distinct strings', () => {
    expect(calculateExactMatch('hello', 'world')).toBe(false);
  });

  it('returns true for both-empty inputs', () => {
    expect(calculateExactMatch('', '')).toBe(true);
  });

  it('returns false when only one input is empty', () => {
    expect(calculateExactMatch('', 'hello')).toBe(false);
    expect(calculateExactMatch('hello', '')).toBe(false);
  });
});
