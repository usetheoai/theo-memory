/**
 * #140 harness abstention — unit test for the pure coverage-gate helper.
 *
 * LLM-free (no key): `shouldAbstain` is a pure function over recalled scores.
 * The blueprint declined a core "coverage" field (YAGNI + boundary) — the
 * coverage signal already exists as `MemoryItemWithScore.score`; this helper is
 * the answerer-discipline fix that lives in the eval harness.
 */
import { describe, expect, it } from 'vitest';

import type { MemoryItemWithScore } from '@usetheo/memory';

import { shouldAbstain } from './coverage-gate.js';

/** Minimal MemoryItemWithScore stub carrying only the `score` the gate reads. */
function scored(score: number): MemoryItemWithScore {
  return { score } as MemoryItemWithScore;
}

describe('coverage-gate — shouldAbstain (#140)', () => {
  const TAU = 0.3;

  it('test_coverage_gate_abstains_on_empty_or_low_score', () => {
    // Empty recall → nothing to answer from → abstain.
    expect(shouldAbstain([], TAU)).toBe(true);
    // All recalled scores below τ → thin coverage → abstain.
    expect(shouldAbstain([scored(0.1), scored(0.29)], TAU)).toBe(true);
    // At least one score ≥ τ → sufficient coverage → answer.
    expect(shouldAbstain([scored(0.1), scored(0.5)], TAU)).toBe(false);
  });

  it('answers exactly at the threshold (max score === τ is NOT below τ)', () => {
    expect(shouldAbstain([scored(0.3)], TAU)).toBe(false);
  });
});
