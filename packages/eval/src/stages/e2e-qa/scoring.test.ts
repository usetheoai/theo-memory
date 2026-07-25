import { describe, expect, it } from 'vitest';

import { abstentionIsMiss } from './scoring.js';

const ABSTAIN = "I don't have that information.";

describe('abstentionIsMiss (#148 deterministic judge guard)', () => {
  it('scores an abstention on a NON-abstention question as a miss (the 6a1eabeb false-positive)', () => {
    // Given: the question demands a concrete gold answer, the model abstained.
    // Then: it is a miss — no LLM judge should get the chance to leniently accept it.
    expect(abstentionIsMiss(false, ABSTAIN, ABSTAIN)).toBe(true);
  });

  it('does NOT force-miss an abstention when the question is itself an abstention question', () => {
    // A `_abs` question whose gold IS "I don't have that info" — abstaining is correct there.
    expect(abstentionIsMiss(true, ABSTAIN, ABSTAIN)).toBe(false);
  });

  it('does NOT force-miss a substantive answer (defers to the LLM judge)', () => {
    expect(abstentionIsMiss(false, '25 minutes and 50 seconds', ABSTAIN)).toBe(false);
  });

  it('matches the abstain sentinel exactly (a different wording is a substantive answer)', () => {
    expect(abstentionIsMiss(false, 'I am not sure about that.', ABSTAIN)).toBe(false);
  });
});
